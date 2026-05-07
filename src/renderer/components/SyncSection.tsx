import React, { useState } from 'react';
import { useStore } from '../hooks/useStore';
import { generateVersionsTf, generateVariablesTf, generateProviderTf } from '../../shared/terraform-gen';
import { EndpointProbeResult, ConfigRecommendation, ProbeResult } from '../../shared/types';

interface ResourceMatch {
  sourceAddress: string;
  sourceType: string;
  sourceId: string;
  sourceName: string;
  targetId: string | null;
  targetName: string | null;
  status: 'matched' | 'missing' | 'ambiguous';
  level: number;
  parentSourceId?: string | null;
  parentTargetId?: string | null;
}

interface SyncSummary {
  totalResources: number;
  matched: number;
  missing: number;
  ambiguous: number;
  subResourceCount: number;
  byType: Record<string, { total: number; matched: number; missing: number }>;
  matches: ResourceMatch[];
}

interface ConvertedConfig {
  portableHcl: string;
  importBlocks: string;
  instructions: string[];
  warnings: string[];
}

type SyncStep = 'upload' | 'compare' | 'convert';

export default function SyncSection() {
  const { connection, probeResult, recommendation, providerVersion } = useStore();
  const [step, setStep] = useState<SyncStep>('upload');
  const [files, setFiles] = useState<Record<string, string> | null>(null);
  const [summary, setSummary] = useState<SyncSummary | null>(null);
  const [converted, setConverted] = useState<ConvertedConfig | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeFile, setActiveFile] = useState<'portable' | 'imports'>('portable');
  const [copied, setCopied] = useState(false);

  const [probeProgress, setProbeProgress] = useState<string | null>(null);

  const api = (window as unknown as { oktaTerraform: {
    syncOpenFiles: () => Promise<{ success: boolean; data?: Record<string, string> } | null>;
    syncAnalyze: (tfFiles: Record<string, string>, stateContent?: string) =>
      Promise<{ success: boolean; data?: SyncSummary; error?: string }>;
    syncConvert: (tfContent: string, matches: ResourceMatch[], targetOrgUrl: string) =>
      Promise<{ success: boolean; data?: ConvertedConfig; error?: string }>;
    syncDeepProbe: (terraformTypes: string[]) =>
      Promise<{ success: boolean; data?: { probeResults: unknown[]; resourceCounts: unknown[] }; error?: string }>;
    onSyncDeepProbeProgress: (callback: (progress: { phase: string; detail: string; completed?: number; total?: number }) => void) => () => void;
    saveProjectDir: (files: Record<string, string>) => Promise<{ success: boolean; data?: string; error?: string }>;
    getRecommendations: (probeResult: unknown, workload?: unknown) =>
      Promise<{ success: boolean; data?: unknown; error?: string }>;
  }}).oktaTerraform;

  const handleUpload = async () => {
    const result = await api.syncOpenFiles();
    if (!result?.success || !result.data) return;

    setFiles(result.data);
    setError(null);
    setSummary(null);
    setConverted(null);

    // Auto-analyze
    setLoading(true);
    const tfFiles: Record<string, string> = {};
    let stateContent: string | undefined;

    for (const [name, content] of Object.entries(result.data)) {
      if (name.endsWith('.tfstate') || name === 'terraform.tfstate') {
        stateContent = content;
      } else {
        tfFiles[name] = content;
      }
    }

    const analyzeResult = await api.syncAnalyze(tfFiles, stateContent);
    if (analyzeResult.success && analyzeResult.data) {
      setSummary(analyzeResult.data);
      setStep('compare');

      // Extract unique terraform resource types from the comparison
      const terraformTypes = [...new Set(analyzeResult.data.matches.map(m => m.sourceType))];
      if (terraformTypes.length > 0) {
        triggerSyncDeepProbe(terraformTypes);
      }
    } else {
      setError(analyzeResult.error ?? 'Failed to analyze files');
    }
    setLoading(false);
  };

  const triggerSyncDeepProbe = async (terraformTypes: string[]) => {
    setProbeProgress('Probing target org rate limits...');
    const cleanup = api.onSyncDeepProbeProgress((progress) => {
      if (progress.total && progress.completed !== undefined) {
        setProbeProgress(`${progress.detail} (${progress.completed}/${progress.total})`);
      } else {
        setProbeProgress(progress.detail);
      }
    });

    const result = await api.syncDeepProbe(terraformTypes);
    cleanup();

    if (result.success && result.data && probeResult) {
      // Merge deep probe results into the existing probe data and refresh recommendation
      const subResults = result.data.probeResults as EndpointProbeResult[];
      const mergedEndpoints: EndpointProbeResult[] = [...probeResult.endpoints, ...subResults];
      const successfulAll = mergedEndpoints.filter(r =>
        r.status !== 'error' && r.status !== 'skipped' && r.limit > 0
      );
      const mergedProbeResult: ProbeResult = {
        ...probeResult,
        endpoints: mergedEndpoints,
        overallMinLimit: successfulAll.length > 0
          ? Math.min(...successfulAll.map(r => r.limit))
          : probeResult.overallMinLimit,
      };

      // Get updated recommendation with the deeper probe data
      const recResult = await api.getRecommendations(mergedProbeResult);
      if (recResult.success && recResult.data) {
        useStore.setState({ probeResult: mergedProbeResult, recommendation: recResult.data as ConfigRecommendation });
      }
    }
    setProbeProgress(null);
  };

  const handleConvert = async () => {
    if (!files || !summary) return;
    setLoading(true);
    setError(null);

    // Combine all .tf file content
    const tfContent = Object.entries(files)
      .filter(([name]) => name.endsWith('.tf'))
      .map(([name, content]) => `# --- ${name} ---\n${content}`)
      .join('\n\n');

    const result = await api.syncConvert(
      tfContent,
      summary.matches,
      connection.orgUrl ?? '',
    );

    if (result.success && result.data) {
      setConverted(result.data);
      setStep('convert');
    } else {
      setError(result.error ?? 'Failed to convert config');
    }
    setLoading(false);
  };

  const handleExport = async () => {
    if (!converted) return;
    const exportFiles: Record<string, string> = {
      'main.tf': converted.portableHcl,
    };
    if (converted.importBlocks) {
      exportFiles['imports.tf'] = converted.importBlocks;
    }
    // Include provider config with rate limit optimization from probe
    if (connection.orgUrl) {
      exportFiles['versions.tf'] = generateVersionsTf(providerVersion);
      exportFiles['variables.tf'] = generateVariablesTf('api_token');
      if (recommendation?.recommended) {
        exportFiles['provider.tf'] = generateProviderTf(
          recommendation.recommended,
          connection.orgUrl,
          'api_token'
        );
      } else {
        // Fallback: provider block without rate limit tuning
        exportFiles['provider.tf'] = generateProviderTf(
          { max_retries: 5, backoff: true, min_wait_seconds: 30, max_wait_seconds: 300, request_timeout: 0, max_api_capacity: 100, parallelism: 1 },
          connection.orgUrl,
          'api_token'
        );
      }
    }
    await api.saveProjectDir(exportFiles);
  };

  const handleCopy = (content: string) => {
    navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Rate limit comparison data
  const rateLimitInfo = probeResult ? {
    bottleneck: probeResult.overallMinLimit,
    endpoints: probeResult.endpoints.filter(e => e.status !== 'error' && e.status !== 'skipped').length,
  } : null;

  return (
    <div className="max-w-5xl space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-text-primary">Org Sync</h1>
          <p className="text-xs text-text-muted">
            Upload .tf files and .tfstate from your source org to sync configuration to this org
            {connection.orgUrl && <span className="text-accent-teal ml-1">({connection.orgUrl})</span>}
          </p>
        </div>
        {step !== 'upload' && (
          <button
            onClick={() => { setStep('upload'); setFiles(null); setSummary(null); setConverted(null); }}
            className="px-3 py-1.5 text-xs font-medium text-text-muted bg-surface-3 rounded-lg hover:bg-surface-4 transition-colors"
          >
            Start Over
          </button>
        )}
      </div>

      {/* Step indicator */}
      <div className="flex items-center gap-2">
        {(['upload', 'compare', 'convert'] as SyncStep[]).map((s, i) => (
          <React.Fragment key={s}>
            <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium ${
              step === s ? 'bg-accent-teal/10 text-accent-teal' :
              (['upload', 'compare', 'convert'].indexOf(step) > i) ? 'text-accent-green' : 'text-text-muted'
            }`}>
              <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
                step === s ? 'bg-accent-teal text-surface-0' :
                (['upload', 'compare', 'convert'].indexOf(step) > i) ? 'bg-accent-green/20 text-accent-green' : 'bg-surface-3 text-text-muted'
              }`}>{i + 1}</span>
              {s === 'upload' ? 'Upload' : s === 'compare' ? 'Compare' : 'Convert'}
            </div>
            {i < 2 && <div className="w-8 h-px bg-border" />}
          </React.Fragment>
        ))}
      </div>

      {/* Upload step */}
      {step === 'upload' && !loading && (
        <button
          onClick={handleUpload}
          className="w-full py-16 border-2 border-dashed border-border rounded-xl hover:border-accent-teal/50 hover:bg-accent-teal/5 transition-colors cursor-pointer"
        >
          <div className="text-center">
            <svg className="mx-auto mb-3" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" className="text-text-muted" />
              <polyline points="17 8 12 3 7 8" className="text-accent-teal" />
              <line x1="12" y1="3" x2="12" y2="15" className="text-accent-teal" />
            </svg>
            <span className="text-sm font-medium text-text-secondary block">Select Terraform files</span>
            <span className="text-xs text-text-muted block mt-1">.tf files + terraform.tfstate from your source org</span>
          </div>
        </button>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex items-center gap-3 p-8 bg-surface-2 rounded-xl border border-border">
          <div className="animate-spin w-5 h-5 border-2 border-accent-teal border-t-transparent rounded-full" />
          <span className="text-sm text-text-secondary">
            {step === 'upload' || step === 'compare' ? 'Analyzing files and matching resources...' : 'Converting configuration with AI...'}
          </span>
        </div>
      )}

      {error && (
        <div className="bg-accent-red/10 border border-accent-red/30 rounded-xl p-4">
          <p className="text-xs text-accent-red">{error}</p>
        </div>
      )}

      {/* Compare step */}
      {step === 'compare' && summary && !loading && (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-5 gap-3">
            <div className="bg-surface-2 rounded-xl border border-border p-4">
              <div className="text-text-muted text-[10px] uppercase tracking-widest font-semibold">Total</div>
              <div className="text-2xl font-bold text-text-primary font-mono mt-1">{summary.totalResources}</div>
            </div>
            <div className="bg-surface-2 rounded-xl border border-border p-4">
              <div className="text-text-muted text-[10px] uppercase tracking-widest font-semibold">Matched</div>
              <div className="text-2xl font-bold text-accent-green font-mono mt-1">{summary.matched}</div>
            </div>
            <div className="bg-surface-2 rounded-xl border border-border p-4">
              <div className="text-text-muted text-[10px] uppercase tracking-widest font-semibold">Missing</div>
              <div className="text-2xl font-bold text-accent-amber font-mono mt-1">{summary.missing}</div>
            </div>
            <div className="bg-surface-2 rounded-xl border border-border p-4">
              <div className="text-text-muted text-[10px] uppercase tracking-widest font-semibold">Ambiguous</div>
              <div className="text-2xl font-bold text-accent-red font-mono mt-1">{summary.ambiguous}</div>
            </div>
            <div className="bg-surface-2 rounded-xl border border-border p-4">
              <div className="text-text-muted text-[10px] uppercase tracking-widest font-semibold">Sub-Resources</div>
              <div className="text-2xl font-bold text-accent-teal font-mono mt-1">{summary.subResourceCount}</div>
            </div>
          </div>

          {/* Rate limit comparison */}
          {rateLimitInfo && (
            <div className="bg-surface-2 rounded-xl border border-border p-4">
              <h3 className="text-[10px] uppercase tracking-widest font-semibold text-text-muted mb-2">Target Org Rate Limits</h3>
              <div className="flex gap-6">
                <div>
                  <span className="text-xs text-text-muted">Bottleneck</span>
                  <p className="text-lg font-bold font-mono text-accent-teal">{rateLimitInfo.bottleneck > 0 ? `${rateLimitInfo.bottleneck} req/win` : 'Not probed'}</p>
                </div>
                <div>
                  <span className="text-xs text-text-muted">Probed Endpoints</span>
                  <p className="text-lg font-bold font-mono text-text-primary">{rateLimitInfo.endpoints}</p>
                </div>
                <div className="flex-1">
                  <span className="text-xs text-text-muted">Note</span>
                  <p className="text-xs text-text-secondary mt-0.5">
                    {summary.missing > 0
                      ? `${summary.missing} resources will be created in target — ensure rate limits can handle the apply.`
                      : 'All resources matched — this is a config update, not a creation run.'}
                  </p>
                </div>
              </div>
              {probeProgress && (
                <div className="mt-3 pt-3 border-t border-border flex items-center gap-2">
                  <div className="w-3 h-3 border-2 border-accent-teal border-t-transparent rounded-full animate-spin" />
                  <span className="text-xs text-text-muted">{probeProgress}</span>
                </div>
              )}
              {!probeProgress && recommendation?.recommended && (
                <div className="mt-3 pt-3 border-t border-border">
                  <span className="text-[10px] uppercase tracking-widest font-semibold text-text-muted">Optimized Config</span>
                  <div className="flex gap-4 mt-1 text-xs font-mono text-text-secondary">
                    <span>parallelism={recommendation.recommended.parallelism}</span>
                    <span>max_api_capacity={recommendation.recommended.max_api_capacity}</span>
                    <span>request_timeout={recommendation.recommended.request_timeout}s</span>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* By type breakdown */}
          <div className="bg-surface-2 rounded-xl border border-border overflow-hidden">
            <div className="px-4 py-3 border-b border-border">
              <h3 className="text-xs font-medium text-text-muted uppercase tracking-wide">By Resource Type</h3>
            </div>
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-text-muted uppercase tracking-wide border-b border-border">
                  <th className="px-4 py-2 font-medium">Type</th>
                  <th className="px-4 py-2 font-medium text-right">Total</th>
                  <th className="px-4 py-2 font-medium text-right">Matched</th>
                  <th className="px-4 py-2 font-medium text-right">Missing</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {Object.entries(summary.byType).map(([type, counts]) => (
                  <tr key={type} className="hover:bg-surface-3">
                    <td className="px-4 py-2 font-mono text-text-secondary">{type}</td>
                    <td className="px-4 py-2 text-right font-mono text-text-primary">{counts.total}</td>
                    <td className="px-4 py-2 text-right font-mono text-accent-green">{counts.matched}</td>
                    <td className={`px-4 py-2 text-right font-mono ${counts.missing > 0 ? 'text-accent-amber' : 'text-text-muted'}`}>{counts.missing}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Resource match details */}
          <div className="bg-surface-2 rounded-xl border border-border overflow-hidden">
            <div className="px-4 py-3 border-b border-border">
              <h3 className="text-xs font-medium text-text-muted uppercase tracking-wide">Resource Matches</h3>
            </div>
            <div className="max-h-80 overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-surface-2">
                  <tr className="text-left text-text-muted uppercase tracking-wide border-b border-border">
                    <th className="px-4 py-2 font-medium">Source</th>
                    <th className="px-4 py-2 font-medium">Name</th>
                    <th className="px-4 py-2 font-medium">Target ID</th>
                    <th className="px-4 py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {/* Top-level resources first, then nest sub-resources under their parents */}
                  {(() => {
                    const topLevel = summary.matches.filter(m => !m.level || m.level === 0);
                    const subResources = summary.matches.filter(m => m.level && m.level > 0);
                    const rows: React.ReactElement[] = [];

                    for (const m of topLevel) {
                      rows.push(
                        <tr key={m.sourceAddress} className="hover:bg-surface-3">
                          <td className="px-4 py-2 font-mono text-text-secondary">{m.sourceAddress}</td>
                          <td className="px-4 py-2 text-text-primary">{m.sourceName}</td>
                          <td className="px-4 py-2 font-mono text-text-muted">{m.targetId ?? '—'}</td>
                          <td className="px-4 py-2">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase ${
                              m.status === 'matched' ? 'bg-accent-green/10 text-accent-green' :
                              m.status === 'missing' ? 'bg-accent-amber/10 text-accent-amber' :
                              'bg-accent-red/10 text-accent-red'
                            }`}>{m.status}</span>
                          </td>
                        </tr>
                      );

                      // Nest level-1 children under this parent
                      const children = subResources.filter(s => s.level === 1 && s.parentSourceId === m.sourceId);
                      for (const child of children) {
                        rows.push(
                          <tr key={child.sourceAddress} className="hover:bg-surface-3 bg-surface-1/50">
                            <td className="px-4 py-2 font-mono text-text-secondary pl-8">
                              <span className="text-text-muted mr-1">└</span>{child.sourceAddress}
                            </td>
                            <td className="px-4 py-2 text-text-primary">{child.sourceName}</td>
                            <td className="px-4 py-2 font-mono text-text-muted">{child.targetId ?? '—'}</td>
                            <td className="px-4 py-2">
                              <span className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase ${
                                child.status === 'matched' ? 'bg-accent-green/10 text-accent-green' :
                                child.status === 'missing' ? 'bg-accent-amber/10 text-accent-amber' :
                                'bg-accent-red/10 text-accent-red'
                              }`}>{child.status}</span>
                            </td>
                          </tr>
                        );

                        // Nest level-2 grandchildren under this child
                        const grandchildren = subResources.filter(g => g.level === 2 && g.parentSourceId === child.sourceId);
                        for (const gc of grandchildren) {
                          rows.push(
                            <tr key={gc.sourceAddress} className="hover:bg-surface-3 bg-surface-1/30">
                              <td className="px-4 py-2 font-mono text-text-secondary pl-12">
                                <span className="text-text-muted mr-1">└</span>{gc.sourceAddress}
                              </td>
                              <td className="px-4 py-2 text-text-primary">{gc.sourceName}</td>
                              <td className="px-4 py-2 font-mono text-text-muted">{gc.targetId ?? '—'}</td>
                              <td className="px-4 py-2">
                                <span className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase ${
                                  gc.status === 'matched' ? 'bg-accent-green/10 text-accent-green' :
                                  gc.status === 'missing' ? 'bg-accent-amber/10 text-accent-amber' :
                                  'bg-accent-red/10 text-accent-red'
                                }`}>{gc.status}</span>
                              </td>
                            </tr>
                          );
                        }
                      }
                    }

                    // Show any orphaned sub-resources that couldn't be nested
                    const nestedIds = new Set(rows.map(r => r.key));
                    const orphans = subResources.filter(s => !nestedIds.has(s.sourceAddress));
                    for (const m of orphans) {
                      rows.push(
                        <tr key={m.sourceAddress} className="hover:bg-surface-3 bg-surface-1/50">
                          <td className="px-4 py-2 font-mono text-text-secondary pl-8">
                            <span className="text-text-muted mr-1">?</span>{m.sourceAddress}
                          </td>
                          <td className="px-4 py-2 text-text-primary">{m.sourceName}</td>
                          <td className="px-4 py-2 font-mono text-text-muted">{m.targetId ?? '—'}</td>
                          <td className="px-4 py-2">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase ${
                              m.status === 'matched' ? 'bg-accent-green/10 text-accent-green' :
                              m.status === 'missing' ? 'bg-accent-amber/10 text-accent-amber' :
                              'bg-accent-red/10 text-accent-red'
                            }`}>{m.status}</span>
                          </td>
                        </tr>
                      );
                    }

                    return rows;
                  })()}
                </tbody>
              </table>
            </div>
          </div>

          {/* Convert button */}
          <button
            onClick={handleConvert}
            className="w-full py-3 text-sm font-semibold bg-accent-teal text-surface-0 rounded-xl hover:bg-accent-teal/90 transition-colors"
          >
            Convert Config for Target Org
          </button>
        </>
      )}

      {/* Convert step */}
      {step === 'convert' && converted && !loading && (
        <>
          {/* Warnings */}
          {converted.warnings.length > 0 && (
            <div className="bg-accent-amber/5 border border-accent-amber/20 rounded-xl p-4">
              <p className="text-xs font-semibold text-accent-amber uppercase tracking-wide mb-2">Warnings</p>
              <ul className="space-y-1">
                {converted.warnings.map((w, i) => (
                  <li key={i} className="text-xs text-text-secondary flex gap-2">
                    <span className="text-accent-amber flex-shrink-0">!</span>
                    <span>{w}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Config files */}
          <div className="bg-surface-2 rounded-xl border border-border overflow-hidden">
            <div className="flex border-b border-border">
              <button
                onClick={() => setActiveFile('portable')}
                className={`px-4 py-2.5 text-xs font-mono transition-colors ${
                  activeFile === 'portable' ? 'text-accent-teal bg-surface-3 border-b-2 border-accent-teal' : 'text-text-muted hover:text-text-secondary'
                }`}
              >
                main.tf
              </button>
              {converted.importBlocks && (
                <button
                  onClick={() => setActiveFile('imports')}
                  className={`px-4 py-2.5 text-xs font-mono transition-colors ${
                    activeFile === 'imports' ? 'text-accent-teal bg-surface-3 border-b-2 border-accent-teal' : 'text-text-muted hover:text-text-secondary'
                  }`}
                >
                  imports.tf
                </button>
              )}
              <button
                onClick={() => handleCopy(activeFile === 'portable' ? converted.portableHcl : converted.importBlocks)}
                className="ml-auto px-3 py-2 text-xs text-text-muted hover:text-text-secondary transition-colors"
              >
                {copied ? 'Copied!' : 'Copy'}
              </button>
            </div>
            <pre className="p-4 text-xs font-mono text-text-secondary overflow-x-auto max-h-80 overflow-y-auto bg-surface-0">
              {activeFile === 'portable' ? converted.portableHcl : converted.importBlocks}
            </pre>
          </div>

          {/* Instructions */}
          <div className="bg-surface-2 rounded-xl border border-border p-4">
            <p className="text-[10px] font-semibold text-text-muted uppercase tracking-widest mb-3">Instructions</p>
            <ol className="space-y-2">
              {converted.instructions.map((s, i) => (
                <li key={i} className="text-xs text-text-secondary flex gap-2">
                  <span className="text-accent-teal font-bold flex-shrink-0 font-mono">{i + 1}.</span>
                  <span>{s}</span>
                </li>
              ))}
            </ol>
          </div>

          {/* Export */}
          <button
            onClick={handleExport}
            className="w-full py-3 text-sm font-semibold bg-accent-teal text-surface-0 rounded-xl hover:bg-accent-teal/90 transition-colors"
          >
            Export Project
          </button>
        </>
      )}
    </div>
  );
}
