import React, { useState, useEffect } from 'react';
import { useStore } from '../hooks/useStore';
import { searchResources, ResourceDictionaryEntry } from '../../shared/resource-dictionary';
import { CustomWorkloadEntry } from '../../shared/types';

export default function CustomWorkload() {
  const { customWorkloads, addCustomWorkload, removeCustomWorkload, probeResult } = useStore();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<ResourceDictionaryEntry | null>(null);
  const [count, setCount] = useState('');
  const [probing, setProbing] = useState<string | null>(null);
  const [nlInput, setNlInput] = useState('');
  const [nlParsing, setNlParsing] = useState(false);
  const [nlResult, setNlResult] = useState<string | null>(null);
  const [nlError, setNlError] = useState<string | null>(null);
  const [hasKey, setHasKey] = useState(false);

  const nlApi = (window as { oktaTerraform: {
    buildWorkload: (desc: string) => Promise<{ success: boolean; data?: CustomWorkloadEntry[]; error?: string }>;
    hasClaudeKey: () => Promise<{ success: boolean; data?: boolean }>;
  } }).oktaTerraform;

  useEffect(() => {
    nlApi.hasClaudeKey().then(r => setHasKey(!!r.data));
  }, []);

  const handleNlParse = async () => {
    if (!nlInput.trim()) return;
    setNlParsing(true);
    setNlError(null);
    setNlResult(null);
    try {
      const result = await nlApi.buildWorkload(nlInput.trim());
      if (result.success && result.data && result.data.length > 0) {
        result.data.forEach(entry => addCustomWorkload(entry));
        const summary = result.data.map(e => `${e.count.toLocaleString()} ${e.terraformResource}`).join(', ');
        setNlResult(`Added: ${summary}`);
        setNlInput('');
      } else {
        setNlError(result.error ?? 'Could not parse workload from description');
      }
    } catch {
      setNlError('Failed to connect to Claude API');
    }
    setNlParsing(false);
  };

  const results = query.length >= 2 ? searchResources(query).filter(r => r.primaryEndpoint) : [];

  // Look up probed rate limit for an endpoint pattern
  const findRateLimit = (endpointLabel: string): number => {
    if (!probeResult) return 0;
    const match = probeResult.endpoints.find(
      ep => ep.label === endpointLabel && ep.status !== 'error' && ep.status !== 'skipped' && ep.limit > 0
    );
    return match?.limit ?? 0;
  };

  const handleAdd = () => {
    if (!selected || !count) return;
    const rateLimit = findRateLimit(selected.endpointLabel!);
    const entry: CustomWorkloadEntry = {
      terraformResource: selected.terraformResource,
      count: parseInt(count, 10),
      primaryEndpoint: selected.primaryEndpoint!,
      endpointLabel: selected.endpointLabel!,
      rateLimit,
    };
    addCustomWorkload(entry);
    setQuery('');
    setSelected(null);
    setCount('');
  };

  const handleProbe = async (w: CustomWorkloadEntry) => {
    setProbing(w.terraformResource);
    try {
      const api = (window as { oktaTerraform: { probeSubResource: (r: string, e: string) => Promise<{ success: boolean; data?: { limit: number; remaining: number; resetWindowSecs: number } }> } }).oktaTerraform;
      const result = await api.probeSubResource(w.terraformResource, w.primaryEndpoint);
      if (result.success && result.data && result.data.limit > 0) {
        addCustomWorkload({
          ...w,
          rateLimit: result.data.limit,
        });
      }
    } catch {
      // Silently fail — rate limit stays as previous value
    }
    setProbing(null);
  };

  return (
    <div className="border-t border-gray-200 mt-4 pt-4">
      <p className="text-xs text-gray-400 font-medium uppercase tracking-wide mb-1">Custom Workload</p>
      <p className="text-xs text-gray-400 mb-3">
        For sub-resources like <code className="bg-gray-100 px-1 rounded">okta_app_user</code>, enter the Terraform resource type and count.
        Click <strong>Probe</strong> to discover the exact rate limit for that endpoint.
      </p>

      {/* Natural language input */}
      {hasKey && (
        <div className="mb-4 bg-purple-50 border border-purple-100 rounded-lg p-3">
          <p className="text-xs font-medium text-purple-700 mb-2">Describe your workload in plain English</p>
          <div className="flex gap-2">
            <textarea
              value={nlInput}
              onChange={(e) => setNlInput(e.target.value)}
              placeholder="e.g., I'm importing 200 apps with 10,000 user assignments and 500 group assignments"
              rows={2}
              className="flex-1 px-3 py-1.5 text-xs border border-purple-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-400 resize-none"
            />
            <button
              onClick={handleNlParse}
              disabled={nlParsing || !nlInput.trim()}
              className="px-3 py-1.5 text-xs font-medium text-white bg-purple-600 rounded-lg hover:bg-purple-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors self-end"
            >
              {nlParsing ? 'Parsing...' : 'Parse with AI'}
            </button>
          </div>
          {nlResult && <p className="text-xs text-green-600 mt-2">{nlResult}</p>}
          {nlError && <p className="text-xs text-red-500 mt-2">{nlError}</p>}
        </div>
      )}

      {/* Search + add */}
      <div className="flex gap-2 items-end mb-3">
        <div className="flex-1 relative">
          <input
            type="text"
            value={selected ? selected.terraformResource : query}
            onChange={(e) => { setQuery(e.target.value); setSelected(null); }}
            placeholder="Search resource type (e.g. okta_app_user)"
            className="w-full px-3 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          {results.length > 0 && !selected && (
            <div className="absolute z-10 top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-40 overflow-y-auto">
              {results.slice(0, 8).map(r => (
                <button
                  key={r.terraformResource}
                  onClick={() => { setSelected(r); setQuery(''); }}
                  className="w-full text-left px-3 py-2 text-xs hover:bg-blue-50 border-b border-gray-50 last:border-0"
                >
                  <code className="font-mono text-gray-700">{r.terraformResource}</code>
                  <span className="text-gray-400 ml-2">{r.description}</span>
                  {r.endpointLabel && (
                    <span className="ml-2 text-blue-500">→ {r.endpointLabel} ({findRateLimit(r.endpointLabel!) || '?'} req/win)</span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
        <input
          type="number"
          value={count}
          onChange={(e) => setCount(e.target.value)}
          placeholder="Count"
          min={1}
          className="w-24 px-3 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <button
          onClick={handleAdd}
          disabled={!selected || !count || parseInt(count, 10) <= 0}
          className="px-3 py-1.5 text-xs font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          Add
        </button>
      </div>

      {/* Active custom workloads */}
      {customWorkloads.length > 0 && (
        <div className="space-y-1.5">
          {customWorkloads.map(w => (
            <div key={w.terraformResource} className="flex items-center gap-2 bg-blue-50 border border-blue-100 rounded-lg px-3 py-2">
              <code className="text-xs font-mono text-blue-700 flex-1">{w.terraformResource}</code>
              <span className="text-xs text-blue-600 font-medium">{w.count.toLocaleString()}</span>
              <span className="text-xs text-blue-400">→ {w.endpointLabel}</span>
              <span className={`text-xs font-medium ${w.rateLimit ? 'text-green-600' : 'text-amber-500'}`}>
                {w.rateLimit ? `${w.rateLimit} req/win` : 'unknown'}
              </span>
              <button
                onClick={() => handleProbe(w)}
                disabled={probing === w.terraformResource}
                className="px-2 py-0.5 text-xs font-medium bg-okta-blue text-white rounded hover:bg-okta-blue-light disabled:opacity-50 transition-colors"
              >
                {probing === w.terraformResource ? 'Probing...' : 'Probe'}
              </button>
              <button
                onClick={() => removeCustomWorkload(w.terraformResource)}
                className="text-xs text-red-400 hover:text-red-600"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
