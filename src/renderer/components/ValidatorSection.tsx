import React, { useState, useEffect, useRef } from 'react';
import { Finding } from '../../shared/types';

interface VaultSummaryEntry {
  token: string;
  kind: string;
  sourceFile: string;
  sourceAttr: string;
}

type Stage = 'upload' | 'ready' | 'analyzing' | 'reviewed' | 'exported';

const SEVERITY_STYLES: Record<Finding['severity'], string> = {
  error: 'bg-red-50 text-red-700 border-red-200',
  warning: 'bg-amber-50 text-amber-700 border-amber-200',
  suggestion: 'bg-blue-50 text-blue-700 border-blue-200',
};

export default function ValidatorSection() {
  const [stage, setStage] = useState<Stage>('upload');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [vaultSummary, setVaultSummary] = useState<VaultSummaryEntry[]>([]);
  const [vaultExpanded, setVaultExpanded] = useState(false);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [fixedMaskedFiles, setFixedMaskedFiles] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [exportedDir, setExportedDir] = useState<string | null>(null);

  const sessionIdRef = useRef<string | null>(null);
  sessionIdRef.current = sessionId;

  useEffect(() => {
    return () => {
      if (sessionIdRef.current) {
        window.oktaTerraform.validatorClearSession(sessionIdRef.current);
      }
    };
  }, []);

  const handleUpload = async () => {
    setError(null);
    const result = await window.oktaTerraform.validatorOpenFiles();
    if (!result) return;
    if (!result.success || !result.data) {
      setError(result.error ?? 'Upload failed');
      return;
    }
    setSessionId(result.data.sessionId);
    setVaultSummary(result.data.vaultSummary);
    setStage('ready');
  };

  const handleAnalyze = async () => {
    if (!sessionId) return;
    setError(null);
    setStage('analyzing');
    const result = await window.oktaTerraform.validatorAnalyze(sessionId);
    if (!result.success || !result.data) {
      setError(result.error ?? 'Analysis failed');
      setStage('ready');
      return;
    }
    setFindings(result.data.findings);
    setFixedMaskedFiles(result.data.fixedMaskedFiles);
    setStage('reviewed');
  };

  const handleExport = async () => {
    if (!sessionId) return;
    setError(null);
    const result = await window.oktaTerraform.validatorExport(sessionId, fixedMaskedFiles);
    if (!result.success) {
      setError(result.error ?? 'Export failed');
      return;
    }
    setExportedDir(result.data ?? null);
    setStage('exported');
  };

  const handleDiscard = async () => {
    if (sessionId) await window.oktaTerraform.validatorClearSession(sessionId);
    setSessionId(null);
    setVaultSummary([]);
    setFindings([]);
    setFixedMaskedFiles({});
    setError(null);
    setExportedDir(null);
    setStage('upload');
  };

  const vaultCounts = vaultSummary.reduce<Record<string, number>>((acc, e) => {
    acc[e.kind] = (acc[e.kind] ?? 0) + 1;
    return acc;
  }, {});

  const correctnessFindings = findings.filter(f => f.category === 'correctness');
  const optimizationFindings = findings.filter(f => f.category === 'optimization');

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold text-text-primary">Validate Terraform Project</h1>
        <p className="text-xs text-text-muted mt-1">
          Upload your Terraform project for a PII-safe correctness and optimization review.
        </p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-xs rounded-lg p-3">{error}</div>
      )}

      {stage === 'upload' && (
        <div className="bg-surface-2 rounded-xl border border-border p-8 text-center space-y-3">
          <p className="text-text-secondary text-sm">Select your .tf, .tfstate, and .tfvars files to begin.</p>
          <button
            onClick={handleUpload}
            className="px-4 py-2 text-xs font-medium bg-accent-teal text-surface-0 hover:bg-accent-teal/90 rounded-lg transition-colors"
          >
            Select Files
          </button>
        </div>
      )}

      {stage !== 'upload' && (
        <div className="bg-surface-2 rounded-xl border border-border overflow-hidden">
          <button
            onClick={() => setVaultExpanded(!vaultExpanded)}
            className="w-full flex items-center justify-between px-4 py-3 text-left"
          >
            <span className="text-sm font-medium text-text-primary">
              {vaultSummary.length} value{vaultSummary.length === 1 ? '' : 's'} masked before analysis
              {Object.entries(vaultCounts).length > 0 && (
                <span className="text-text-muted"> ({Object.entries(vaultCounts).map(([kind, count]) => `${count} ${kind}`).join(', ')})</span>
              )}
            </span>
            <span className={`text-text-muted transition-transform ${vaultExpanded ? 'rotate-180' : ''}`}>&#9662;</span>
          </button>
          {vaultExpanded && (
            <div className="px-4 pb-3 border-t border-border text-xs font-mono text-text-muted space-y-1">
              {vaultSummary.map((e, i) => (
                <div key={i}>{e.token} &larr; {e.sourceAttr} in {e.sourceFile}</div>
              ))}
            </div>
          )}
        </div>
      )}

      {stage === 'ready' && (
        <button
          onClick={handleAnalyze}
          className="px-4 py-2 text-xs font-medium bg-accent-teal text-surface-0 hover:bg-accent-teal/90 rounded-lg transition-colors"
        >
          Analyze
        </button>
      )}

      {stage === 'analyzing' && (
        <div className="bg-surface-2 rounded-xl border border-border p-6 text-center text-text-secondary text-sm">
          Analyzing project...
        </div>
      )}

      {stage === 'reviewed' && (
        <div className="space-y-4">
          <FindingsGroup title="Correctness" findings={correctnessFindings} />
          <FindingsGroup title="Optimization" findings={optimizationFindings} />
          <button
            onClick={handleExport}
            className="px-4 py-2 text-xs font-medium bg-accent-teal text-surface-0 hover:bg-accent-teal/90 rounded-lg transition-colors"
          >
            Export Fixed Project
          </button>
        </div>
      )}

      {stage === 'exported' && exportedDir && (
        <div className="bg-green-50 border border-green-200 text-green-700 text-xs rounded-lg p-3">
          Exported to {exportedDir}
        </div>
      )}

      {stage !== 'upload' && (
        <button
          onClick={handleDiscard}
          className="px-3 py-1.5 text-xs font-medium text-text-muted hover:text-text-secondary bg-surface-3 hover:bg-surface-4 rounded-lg transition-colors"
        >
          Discard / Start Over
        </button>
      )}
    </div>
  );
}

function FindingsGroup({ title, findings }: { title: string; findings: Finding[] }) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const toggle = (id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  if (findings.length === 0) {
    return (
      <div>
        <h2 className="text-sm font-semibold text-text-primary mb-2">{title}</h2>
        <p className="text-xs text-text-muted">No {title.toLowerCase()} findings.</p>
      </div>
    );
  }

  return (
    <div>
      <h2 className="text-sm font-semibold text-text-primary mb-2">{title} ({findings.length})</h2>
      <div className="space-y-2">
        {findings.map(f => (
          <div key={f.id} className="bg-surface-2 rounded-lg border border-border overflow-hidden">
            <button onClick={() => toggle(f.id)} className="w-full flex items-center gap-2 px-3 py-2 text-left">
              <span className={`text-[10px] font-medium px-2 py-0.5 rounded border ${SEVERITY_STYLES[f.severity]}`}>
                {f.severity}
              </span>
              <span className="text-xs font-mono text-text-muted">{f.resourceAddress}</span>
              <span className="text-xs text-text-primary flex-1">{f.title}</span>
            </button>
            {expandedIds.has(f.id) && (
              <div className="px-3 pb-3 border-t border-border text-xs space-y-2">
                <p className="text-text-secondary pt-2">{f.explanation}</p>
                <pre className="bg-surface-3 rounded p-2 overflow-x-auto font-mono text-text-secondary">{f.fixedSnippet}</pre>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
