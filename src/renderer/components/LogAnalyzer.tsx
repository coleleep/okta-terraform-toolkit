import React, { useState, useEffect } from 'react';
import { LogAnalysis, ClaudeInterpretation } from '../../shared/types';
import { useStore } from '../hooks/useStore';

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const min = Math.floor(seconds / 60);
  const sec = seconds % 60;
  return sec > 0 ? `${min}m ${sec}s` : `${min}m`;
}

const severityColors = {
  critical: { bg: 'bg-accent-red/10', border: 'border-accent-red/30', title: 'text-accent-red', text: 'text-accent-red', badge: 'bg-accent-red/20 text-accent-red' },
  warning: { bg: 'bg-accent-amber/10', border: 'border-accent-amber/30', title: 'text-accent-amber', text: 'text-accent-amber', badge: 'bg-accent-amber/20 text-accent-amber' },
  info: { bg: 'bg-accent-blue/10', border: 'border-accent-blue/30', title: 'text-accent-blue', text: 'text-accent-blue', badge: 'bg-accent-blue/20 text-accent-blue' },
};

export default function LogAnalyzer() {
  const [analysis, setAnalysis] = useState<LogAnalysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [interpretation, setInterpretation] = useState<ClaudeInterpretation | null>(null);
  const [interpreting, setInterpreting] = useState(false);
  const [interpretError, setInterpretError] = useState<string | null>(null);
  const [hasKey, setHasKey] = useState(false);
  const probeResult = useStore(state => state.probeResult);

  const [dots, setDots] = useState('');

  useEffect(() => {
    if (!loading) { setDots(''); return; }
    const interval = setInterval(() => {
      setDots(d => (d.length >= 3 ? '' : d + '.'));
    }, 400);
    return () => clearInterval(interval);
  }, [loading]);

  const [interpretDots, setInterpretDots] = useState('');

  useEffect(() => {
    if (!interpreting) { setInterpretDots(''); return; }
    const interval = setInterval(() => {
      setInterpretDots(d => (d.length >= 3 ? '' : d + '.'));
    }, 400);
    return () => clearInterval(interval);
  }, [interpreting]);

  const api = (window as unknown as { oktaTerraform: {
    openLogFile: () => Promise<string | null>;
    analyzeLog: (path: string) => Promise<{ success: boolean; data?: LogAnalysis; error?: string }>;
    interpretLog: (params: { analysis: LogAnalysis; probeResult?: unknown }) => Promise<{ success: boolean; data?: ClaudeInterpretation; error?: string }>;
    hasClaudeKey: () => Promise<{ success: boolean; data?: boolean }>;
  }}).oktaTerraform;

  useEffect(() => {
    api.hasClaudeKey().then(r => setHasKey(!!r.data));
  }, []);

  const handleInterpret = async () => {
    if (!analysis) return;
    setInterpreting(true);
    setInterpretError(null);
    try {
      const result = await api.interpretLog({ analysis, probeResult: probeResult ?? undefined });
      if (result.success && result.data) {
        setInterpretation(result.data);
      } else {
        setInterpretError(result.error ?? 'Failed to interpret log');
      }
    } catch {
      setInterpretError('Failed to connect to Claude API');
    }
    setInterpreting(false);
  };

  const handleOpen = async () => {
    const filePath = await api.openLogFile();
    if (!filePath) return;

    setLoading(true);
    setError(null);
    setFileName(filePath.split('/').pop() ?? filePath);

    const result = await api.analyzeLog(filePath);
    if (result.success && result.data) {
      setAnalysis(result.data);
    } else {
      setError(result.error ?? 'Failed to parse log file');
    }
    setLoading(false);
  };

  if (!analysis && !loading) {
    return (
      <div>
        <h1 className="text-lg font-bold text-text-primary mb-2">TF_LOG Analyzer</h1>
        <p className="text-xs text-text-secondary mb-4">
          Load a Terraform debug log (<code className="bg-surface-3 px-1 rounded">TF_LOG=DEBUG</code>) to analyze rate limit behavior, identify bottlenecks, and get optimization recommendations.
        </p>
        <div className="flex items-start gap-2.5 bg-amber-950/20 border border-amber-600/30 rounded-lg px-3.5 py-3 mb-5">
          <span className="text-amber-400 text-sm mt-0.5 shrink-0">⚠</span>
          <p className="text-[11px] text-amber-300/80 leading-relaxed">
            <span className="font-semibold text-amber-400">No PII.</span> Debug logs may contain SSWS tokens, Bearer tokens, org URLs, and user IDs. Remove sensitive data before uploading. Log contents are sent to the AI for analysis.
          </p>
        </div>
        <button
          onClick={handleOpen}
          className="w-full py-12 border-2 border-dashed border-border hover:border-okta-blue hover:bg-accent-blue/5 transition-colors cursor-pointer rounded-xl"
        >
          <div className="text-center">
            <span className="text-3xl block mb-2">📂</span>
            <span className="text-sm font-medium text-text-secondary">Click to select a log file</span>
            <span className="text-xs text-text-muted block mt-1">.log or .txt — typically 10MB+ for large runs</span>
          </div>
        </button>
        {error && <p className="text-xs text-accent-red mt-3">{error}</p>}
      </div>
    );
  }

  if (loading) {
    return (
      <div>
        <h1 className="text-lg font-bold text-text-primary mb-4">TF_LOG Analyzer</h1>
        <div className="flex items-center gap-3 p-8 bg-surface-2 rounded-xl border border-border">
          <div className="animate-spin w-5 h-5 border-2 border-okta-blue border-t-transparent rounded-full" />
          <span className="text-sm text-text-secondary">Parsing {fileName}{dots}</span>
        </div>
      </div>
    );
  }

  if (!analysis) return null;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-text-primary">TF_LOG Analyzer</h1>
          <p className="text-xs text-text-muted">{fileName}</p>
        </div>
        <button
          onClick={handleOpen}
          className="px-3 py-1.5 text-xs font-medium text-okta-blue bg-okta-blue/10 rounded-lg hover:bg-okta-blue/20 transition-colors"
        >
          Load another log
        </button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
        <SummaryCard label="Duration" value={formatDuration(analysis.durationSeconds)} />
        <SummaryCard label="Requests" value={analysis.totalRequests.toLocaleString()} />
        <SummaryCard label="429s" value={String(analysis.rateLimited)} color={analysis.rateLimited > 0 ? 'red' : 'green'} />
        <SummaryCard label="Errors" value={String(analysis.errors)} color={analysis.errors > 0 ? 'red' : 'green'} />
        <SummaryCard label="Deadline Errors" value={String(analysis.deadlineExceeded)} color={analysis.deadlineExceeded > 0 ? 'red' : 'green'} />
        <SummaryCard label="Backoff Time" value={analysis.estimatedBackoffSeconds > 0 ? formatDuration(analysis.estimatedBackoffSeconds) : '—'} color={analysis.estimatedBackoffSeconds > 30 ? 'amber' : undefined} />
      </div>

      {/* AI Interpretation */}
      <div className="bg-surface-2 rounded-xl border border-border p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xs font-medium text-text-muted uppercase tracking-wide">AI Analysis</h2>
          {!interpretation && (
            <button
              onClick={handleInterpret}
              disabled={interpreting || !hasKey}
              className="px-3 py-1.5 text-xs font-medium text-white bg-purple-600 rounded-lg hover:bg-purple-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {interpreting ? 'Analyzing...' : !hasKey ? 'No API Key' : 'Explain with AI'}
            </button>
          )}
        </div>
        {interpreting && (
          <div className="flex items-center gap-2 py-4">
            <div className="animate-spin w-4 h-4 border-2 border-purple-500 border-t-transparent rounded-full" />
            <span className="text-xs text-text-secondary">Claude is analyzing your log{interpretDots}</span>
          </div>
        )}
        {interpretError && (
          <p className="text-xs text-accent-red">{interpretError}</p>
        )}
        {interpretation && (
          <div className="space-y-3">
            <div>
              <span className="text-xs font-medium text-text-muted uppercase">Root Cause</span>
              <p className="text-sm font-medium text-text-primary mt-0.5">{interpretation.rootCause}</p>
            </div>
            <div>
              <span className="text-xs font-medium text-text-muted uppercase">What Happened</span>
              <p className="text-sm text-text-secondary mt-0.5">{interpretation.narrative}</p>
            </div>
            <div className="bg-accent-green/10 border border-accent-green/30 rounded-lg p-3">
              <span className="text-xs font-medium text-accent-green uppercase">Top Fix</span>
              <p className="text-sm font-medium text-accent-green mt-0.5">{interpretation.topFix}</p>
            </div>
            {interpretation.configChanges && Object.keys(interpretation.configChanges).length > 0 && (
              <div className="bg-surface-1 rounded-lg p-3">
                <span className="text-xs font-medium text-text-muted uppercase">Suggested Config</span>
                <pre className="text-xs font-mono text-text-secondary mt-1">
                  {Object.entries(interpretation.configChanges).map(([k, v]) => `${k} = ${v}`).join('\n')}
                </pre>
              </div>
            )}
          </div>
        )}
        {!interpretation && !interpreting && !interpretError && hasKey && (
          <p className="text-xs text-text-muted">Click "Explain with AI" to get a plain-English analysis of this run.</p>
        )}
        {!hasKey && !interpreting && (
          <p className="text-xs text-text-muted">Set a Claude API key to enable AI-powered log interpretation.</p>
        )}
      </div>

      {/* Detected config */}
      <div className="bg-surface-2 rounded-xl border border-border p-4">
        <h2 className="text-xs font-medium text-text-muted uppercase tracking-wide mb-3">Detected Provider Config</h2>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          <ConfigItem label="min_wait" value={`${analysis.detectedConfig.minWait}s`} />
          <ConfigItem label="max_wait" value={`${analysis.detectedConfig.maxWait}s`} />
          <ConfigItem label="max_retries" value={String(analysis.detectedConfig.maxRetries)} />
          <ConfigItem label="max_api_capacity" value={analysis.detectedConfig.maxApiCapacity ? `${analysis.detectedConfig.maxApiCapacity}%` : 'not set'} />
          <ConfigItem label="parallelism" value={analysis.detectedConfig.parallelism ? `~${analysis.detectedConfig.parallelism}` : 'unknown'} />
        </div>
      </div>

      {/* Issues */}
      {analysis.issues.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-xs font-medium text-text-muted uppercase tracking-wide">Findings</h2>
          {analysis.issues.map((issue, i) => {
            const colors = severityColors[issue.severity];
            return (
              <div key={i} className={`${colors.bg} border ${colors.border} rounded-lg p-3`}>
                <div className="flex items-start gap-2">
                  <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${colors.badge}`}>
                    {issue.severity}
                  </span>
                  <div>
                    <p className={`text-xs font-medium ${colors.title}`}>{issue.title}</p>
                    <p className={`text-xs ${colors.text} mt-0.5 whitespace-pre-wrap`}>{issue.detail}</p>
                    <p className={`text-xs font-medium ${colors.title} mt-1`}>→ {issue.recommendation}</p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Error breakdown by status */}
      {analysis.errorsByStatus && Object.keys(analysis.errorsByStatus).length > 0 && (
        <div className="bg-surface-2 rounded-xl border border-border p-4">
          <h2 className="text-xs font-medium text-text-muted uppercase tracking-wide mb-3">Error Breakdown by Status</h2>
          <div className="flex flex-wrap gap-3">
            {Object.entries(analysis.errorsByStatus)
              .sort(([, a], [, b]) => b - a)
              .map(([status, count]) => {
                const statusNum = parseInt(status);
                const label = statusNum === 401 ? 'Unauthorized' : statusNum === 403 ? 'Forbidden' : statusNum === 404 ? 'Not Found' : statusNum === 409 ? 'Conflict' : statusNum === 429 ? 'Rate Limited' : statusNum >= 500 ? 'Server Error' : `HTTP ${status}`;
                const color = statusNum === 429 ? 'bg-accent-amber/10 text-accent-amber border-accent-amber/30' : 'bg-accent-red/10 text-accent-red border-accent-red/30';
                return (
                  <div key={status} className={`${color} border rounded-lg px-3 py-2`}>
                    <span className="text-lg font-bold">{count}</span>
                    <span className="text-xs block">{statusNum} {label}</span>
                  </div>
                );
              })}
          </div>
        </div>
      )}

      {/* Error details table */}
      {analysis.errorDetails && analysis.errorDetails.length > 0 && (
        <div className="bg-surface-2 rounded-xl border border-border overflow-hidden">
          <div className="px-4 py-3 border-b border-border">
            <h2 className="text-xs font-medium text-text-muted uppercase tracking-wide">Error Details</h2>
          </div>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-text-muted uppercase tracking-wide border-b border-border">
                <th className="px-4 py-2 font-medium">Endpoint</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium">Error Code</th>
                <th className="px-4 py-2 font-medium">Message</th>
                <th className="px-4 py-2 font-medium text-right">Count</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {analysis.errorDetails.slice(0, 25).map((err, i) => (
                <tr key={i} className="hover:bg-surface-3">
                  <td className="px-4 py-2">
                    <span className="font-medium text-text-secondary">{err.label}</span>
                    <span className="block font-mono text-text-muted">{err.endpoint}</span>
                  </td>
                  <td className="px-4 py-2">
                    <span className={`font-medium ${err.httpStatus >= 500 ? 'text-accent-red' : err.httpStatus >= 400 ? 'text-accent-amber' : 'text-text-secondary'}`}>
                      {err.httpStatus}
                    </span>
                  </td>
                  <td className="px-4 py-2 font-mono text-text-secondary">
                    {err.oktaErrorCode || '—'}
                  </td>
                  <td className="px-4 py-2 text-text-secondary max-w-xs truncate">
                    {err.message || '—'}
                  </td>
                  <td className="px-4 py-2 text-right font-medium text-text-primary">
                    {err.count}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Endpoint breakdown */}
      {analysis.endpoints.length > 0 && (
        <div className="bg-surface-2 rounded-xl border border-border overflow-hidden">
          <div className="px-4 py-3 border-b border-border">
            <h2 className="text-xs font-medium text-text-muted uppercase tracking-wide">Endpoint Breakdown</h2>
          </div>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-text-muted uppercase tracking-wide border-b border-border">
                <th className="px-4 py-2 font-medium">Endpoint</th>
                <th className="px-4 py-2 font-medium text-right">Calls</th>
                <th className="px-4 py-2 font-medium text-right">429s</th>
                <th className="px-4 py-2 font-medium text-right">Errors</th>
                <th className="px-4 py-2 font-medium text-right">Rate Limit</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {analysis.endpoints.slice(0, 20).map((ep, i) => (
                <tr key={i} className="hover:bg-surface-3">
                  <td className="px-4 py-2">
                    <span className="font-medium text-text-secondary">{ep.label}</span>
                    <span className="block font-mono text-text-muted text-xs">
                      <span className={`inline-block px-1.5 py-0.5 rounded mr-1.5 ${ep.method === 'GET' ? 'bg-accent-green/20 text-accent-green' : 'bg-accent-amber/20 text-accent-amber'}`}>
                        {ep.method}
                      </span>
                      {ep.pattern}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-right font-medium text-text-primary">{ep.totalCalls.toLocaleString()}</td>
                  <td className={`px-4 py-2 text-right font-medium ${ep.rateLimited > 0 ? 'text-accent-red' : 'text-text-muted'}`}>
                    {ep.rateLimited}
                  </td>
                  <td className={`px-4 py-2 text-right font-medium ${ep.errors > 0 ? 'text-accent-red' : 'text-text-muted'}`}>
                    {ep.errors}
                  </td>
                  <td className="px-4 py-2 text-right text-text-secondary">
                    {ep.minRateLimit > 0 ? `${ep.minRateLimit}/win` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function SummaryCard({ label, value, color }: { label: string; value: string; color?: 'red' | 'green' | 'amber' }) {
  const valueColor = color === 'red' ? 'text-accent-red' : color === 'green' ? 'text-accent-green' : color === 'amber' ? 'text-accent-amber' : 'text-text-primary';
  return (
    <div className="bg-surface-2 rounded-lg border border-border p-3">
      <div className="text-xs text-text-muted uppercase tracking-wider">{label}</div>
      <div className={`text-lg font-bold mt-0.5 ${valueColor}`}>{value}</div>
    </div>
  );
}

function ConfigItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="text-xs text-text-muted font-mono">{label}</span>
      <span className="block text-sm font-medium text-text-secondary">{value}</span>
    </div>
  );
}
