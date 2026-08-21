import React, { useMemo, useState } from 'react';
import { useStore } from '../hooks/useStore';
import { EndpointProbeResult } from '../../shared/types';
import {
  KNOWN_LIMIT_BUCKETS, LimitBucket, manualEntry, parseRateLimitHeaders,
} from '../../shared/limit-sources';

interface Props {
  onClose: () => void;
}

function bucketKey(b: LimitBucket): string {
  return `${b.method}|${b.label}`;
}

export default function ManualLimitsModal({ onClose }: Props) {
  const { limitSources, setLimitSource } = useStore();
  const [rows, setRows] = useState<EndpointProbeResult[]>(limitSources.manual ?? []);
  const [selectedKey, setSelectedKey] = useState(bucketKey(KNOWN_LIMIT_BUCKETS[0]));
  const [limitInput, setLimitInput] = useState('');
  const [paste, setPaste] = useState('');
  const [error, setError] = useState<string | null>(null);

  const bucketsByKey = useMemo(() => {
    const m = new Map<string, LimitBucket>();
    for (const b of KNOWN_LIMIT_BUCKETS) m.set(bucketKey(b), b);
    return m;
  }, []);

  const upsert = (entry: EndpointProbeResult) => {
    setRows(prev => [
      ...prev.filter(r => !(r.label === entry.label && r.method === entry.method)),
      entry,
    ]);
  };

  const handleAdd = () => {
    setError(null);
    const bucket = bucketsByKey.get(selectedKey);
    if (!bucket) return;
    const limit = parseInt(limitInput.trim(), 10);
    if (!Number.isFinite(limit) || limit <= 0) {
      setError('Enter a limit greater than zero.');
      return;
    }
    upsert(manualEntry(bucket, limit));
    setLimitInput('');
  };

  const handlePaste = () => {
    setError(null);
    const parsed = parseRateLimitHeaders(paste);
    if (!parsed) {
      setError('No x-rate-limit-limit header found in that text.');
      return;
    }
    const bucket = bucketsByKey.get(selectedKey);
    if (!bucket) return;
    upsert(manualEntry(bucket, parsed.limit, parsed));
    setPaste('');
  };

  const handleSave = () => {
    setLimitSource('manual', rows, 'Manual entry');
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative bg-surface-1 border border-border rounded-xl w-full max-w-2xl mx-4 p-6 max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-sm font-semibold text-text-primary">Enter Rate Limits</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-text-muted hover:text-text-secondary"
            aria-label="Close"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M1 1l12 12M13 1L1 13" />
            </svg>
          </button>
        </div>

        <p className="text-xs text-text-muted mb-4">
          Enter only the buckets you care about. Anything you leave out is reported as missing
          coverage rather than guessed at. Nothing is written to disk — these values are gone when
          OTTO closes.
        </p>

        <div className="space-y-4">
          <div>
            <label htmlFor="ml-bucket" className="block text-xs font-medium text-text-secondary mb-1.5 uppercase tracking-wide">
              Bucket
            </label>
            <select
              id="ml-bucket"
              value={selectedKey}
              onChange={(e) => setSelectedKey(e.target.value)}
              className="w-full px-3 py-2.5 bg-surface-0 border border-border rounded-lg text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-teal/30"
            >
              {KNOWN_LIMIT_BUCKETS.map(b => (
                <option key={bucketKey(b)} value={bucketKey(b)}>
                  {b.method} — {b.label}
                </option>
              ))}
            </select>
          </div>

          <div className="flex gap-2 items-end">
            <div className="flex-1">
              <label htmlFor="ml-limit" className="block text-xs font-medium text-text-secondary mb-1.5 uppercase tracking-wide">
                Limit (requests per window)
              </label>
              <input
                id="ml-limit"
                type="number"
                min="1"
                value={limitInput}
                onChange={(e) => setLimitInput(e.target.value)}
                placeholder="600"
                className="w-full px-3 py-2.5 bg-surface-0 border border-border rounded-lg text-sm text-text-primary placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-accent-teal/30 font-mono"
              />
            </div>
            <button
              type="button"
              onClick={handleAdd}
              className="px-4 py-2.5 bg-accent-teal text-surface-0 text-sm font-semibold rounded-lg hover:bg-accent-teal/90 transition-colors"
            >
              Add
            </button>
          </div>

          <div>
            <label htmlFor="ml-paste" className="block text-xs font-medium text-text-secondary mb-1.5 uppercase tracking-wide">
              Or paste response headers
            </label>
            <textarea
              id="ml-paste"
              value={paste}
              onChange={(e) => setPaste(e.target.value)}
              rows={3}
              placeholder={'x-rate-limit-limit: 600\nx-rate-limit-remaining: 599'}
              className="w-full px-3 py-2.5 bg-surface-0 border border-border rounded-lg text-xs text-text-primary placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-accent-teal/30 font-mono"
            />
            <button
              type="button"
              onClick={handlePaste}
              disabled={paste.trim().length === 0}
              className="mt-2 px-3 py-1.5 text-xs font-medium border border-border text-text-secondary rounded-lg hover:bg-surface-3 disabled:opacity-40 transition-colors"
            >
              Add from headers
            </button>
            <p className="text-xs text-text-muted mt-1.5">
              Applies to the bucket selected above. Capture with{' '}
              <code className="font-mono">curl -sD - -o /dev/null</code> — not <code className="font-mono">-I</code>,
              which sends HEAD and gets rejected without rate limit headers.
            </p>
          </div>

          {error && (
            <div className="bg-accent-red/10 border border-accent-red/30 rounded-lg p-3 text-sm text-accent-red">
              {error}
            </div>
          )}

          {rows.length > 0 && (
            <div className="border border-border rounded-lg overflow-hidden">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-text-muted uppercase tracking-wide border-b border-border">
                    <th className="px-3 py-2 font-medium">Bucket</th>
                    <th className="px-3 py-2 font-medium text-right">Limit</th>
                    <th className="px-3 py-2 font-medium text-right">Remaining</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.map(r => (
                    <tr key={`${r.method}|${r.label}`}>
                      <td className="px-3 py-2 text-text-secondary">
                        <span className={`inline-block px-1.5 py-0.5 rounded mr-1.5 font-mono ${r.method === 'GET' ? 'bg-accent-green/20 text-accent-green' : 'bg-accent-amber/20 text-accent-amber'}`}>
                          {r.method}
                        </span>
                        {r.label}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-text-primary">{r.limit}</td>
                      <td className="px-3 py-2 text-right font-mono text-text-muted">
                        {r.remaining ?? '—'}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <button
                          type="button"
                          onClick={() => setRows(prev => prev.filter(x => !(x.label === r.label && x.method === r.method)))}
                          className="text-text-muted hover:text-accent-red"
                          aria-label={`Remove ${r.method} ${r.label}`}
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <button
            type="button"
            onClick={handleSave}
            disabled={rows.length === 0}
            className="w-full py-2.5 px-4 bg-accent-teal text-surface-0 text-sm font-semibold rounded-lg hover:bg-accent-teal/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Use these limits
          </button>
        </div>
      </div>
    </div>
  );
}
