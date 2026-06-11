import React, { useState, useEffect } from 'react';
import { useStore } from '../hooks/useStore';

const api = (window as any).oktaTerraform;

type ClaudeConfigData = {
  hasKey: boolean;
  baseUrl?: string;
  source?: 'ocm' | 'static';
  ocm?: { fileExists: boolean; path: string };
};

export default function ConnectPage() {
  const { connecting, connection, connect } = useStore();
  const [orgUrl, setOrgUrl] = useState('');
  const [token, setToken] = useState('');

  // Claude config state
  const [config, setConfig] = useState<ClaudeConfigData | null>(null);
  const [claudeKey, setClaudeKey] = useState('');
  const [claudeEndpoint, setClaudeEndpoint] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [claudeSaved, setClaudeSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  const refreshConfig = async () => {
    const r = await api.getClaudeConfig();
    const data: ClaudeConfigData | null = r.data || null;
    setConfig(data);
    setClaudeEndpoint(data?.source === 'static' ? (data.baseUrl || '') : '');
  };

  useEffect(() => { refreshConfig(); }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    let url = orgUrl.trim();
    if (!url.startsWith('https://') && !url.startsWith('http://')) {
      url = `https://${url}`;
    }
    url = url.replace(/\/+$/, '');
    await connect({ orgUrl: url, authMethod: 'token', token: token.trim() });
  };

  const isValid = orgUrl.trim().length > 0 && token.trim().length > 0;

  const saveStaticKey = async () => {
    if (!claudeKey.trim()) return;
    setBusy(true);
    try {
      await api.setClaudeConfig({ apiKey: claudeKey.trim(), baseUrl: claudeEndpoint.trim() || undefined });
      setClaudeKey('');
      setClaudeSaved(true);
      setTimeout(() => setClaudeSaved(false), 2000);
      await refreshConfig();
    } finally {
      setBusy(false);
    }
  };

  const revertToOcm = async () => {
    setBusy(true);
    try {
      await api.removeClaudeConfig();
      setClaudeKey('');
      setClaudeEndpoint('');
      await refreshConfig();
    } finally {
      setBusy(false);
    }
  };

  const renderStatus = () => {
    if (!config) {
      return (
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-text-muted/40" />
          <span className="text-sm text-text-muted">Loading…</span>
        </div>
      );
    }
    if (config.hasKey && config.source === 'ocm') {
      return (
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-2 h-2 rounded-full bg-accent-teal" />
            <span className="text-sm text-text-secondary">OCM-managed LiteLLM key</span>
            {config.baseUrl && (
              <span className="text-xs text-text-muted font-mono bg-surface-3 px-2 py-0.5 rounded truncate">{config.baseUrl}</span>
            )}
          </div>
          <button
            type="button"
            onClick={refreshConfig}
            className="text-xs text-text-muted hover:text-text-secondary"
            disabled={busy}
          >
            Reload
          </button>
        </div>
      );
    }
    if (config.hasKey && config.source === 'static') {
      return (
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-2 h-2 rounded-full bg-accent-amber" />
            <span className="text-sm text-text-secondary">Static API key (dev override)</span>
            {config.baseUrl && (
              <span className="text-xs text-text-muted font-mono bg-surface-3 px-2 py-0.5 rounded truncate">{config.baseUrl}</span>
            )}
          </div>
          <button
            type="button"
            onClick={revertToOcm}
            className="text-xs text-accent-teal hover:underline whitespace-nowrap"
            disabled={busy}
          >
            Use OCM key
          </button>
        </div>
      );
    }
    // No key configured
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-accent-red" />
          <span className="text-sm text-text-secondary">No AI key configured</span>
        </div>
        <div className="text-xs text-text-muted leading-relaxed">
          Run <code className="font-mono bg-surface-3 px-1.5 py-0.5 rounded text-text-secondary">ocm install --helpers litellm</code> in your terminal, then click Reload — or open Advanced settings to configure a static key.
        </div>
        <div className="flex gap-2 pt-1">
          <button
            type="button"
            onClick={refreshConfig}
            className="text-xs text-accent-teal hover:underline"
            disabled={busy}
          >
            Reload
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen flex flex-col bg-surface-0">
      {/* Accent line */}
      <div className="h-[2px] bg-gradient-to-r from-accent-teal/0 via-accent-teal to-accent-teal/0" />

      <div className="flex-1 flex items-center justify-center p-8">
        <div className="w-full max-w-md">
          {/* Logo + title */}
          <div className="text-center mb-8">
            <div className="flex items-center justify-center mb-5">
              <svg width="64" height="64" viewBox="0 0 40 40" fill="none">
                <path d="M10 6L16 3L22 6V14L16 17L10 14V6Z" stroke="#00D4AA" strokeWidth="1.8" strokeLinejoin="round"/>
                <path d="M18 26L24 23L30 26V34L24 37L18 34V26Z" stroke="#00D4AA" strokeWidth="1.8" strokeLinejoin="round"/>
                <path d="M16 14L24 26" stroke="#00D4AA" strokeWidth="1.8" strokeLinecap="round"/>
                <path d="M12 12L20 12" stroke="#00D4AA" strokeWidth="1.4" strokeLinecap="round" opacity="0.5"/>
                <path d="M20 28L28 28" stroke="#00D4AA" strokeWidth="1.4" strokeLinecap="round" opacity="0.5"/>
              </svg>
            </div>
            <h1 className="text-3xl font-bold text-text-primary mb-1 tracking-[0.2em]">OTTO</h1>
            <p className="text-accent-teal/60 text-xs font-medium tracking-[0.3em] uppercase mb-4">Okta Terraform Tuning & Optimization</p>
            <p className="text-text-muted text-sm leading-relaxed">
              Diagnose, optimize, and sync your Terraform<br/>
              configurations with AI-powered Okta expertise.
            </p>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="bg-surface-2 border border-border rounded-xl p-6 space-y-4">
            <div>
              <label htmlFor="orgUrl" className="block text-xs font-medium text-text-secondary mb-1.5 uppercase tracking-wide">
                Org URL
              </label>
              <input
                id="orgUrl"
                type="text"
                value={orgUrl}
                onChange={(e) => setOrgUrl(e.target.value)}
                placeholder="https://your-org.okta.com"
                className="w-full px-3 py-2.5 bg-surface-0 border border-border rounded-lg text-sm text-text-primary placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-accent-teal/30 focus:border-accent-teal/50 font-mono"
                disabled={connecting}
              />
            </div>

            <div>
              <label htmlFor="token" className="block text-xs font-medium text-text-secondary mb-1.5 uppercase tracking-wide">
                API Token
              </label>
              <input
                id="token"
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="00abc..."
                className="w-full px-3 py-2.5 bg-surface-0 border border-border rounded-lg text-sm text-text-primary placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-accent-teal/30 focus:border-accent-teal/50 font-mono"
                disabled={connecting}
              />
              <p className="text-xs text-text-muted mt-1.5">
                Super Admin API token recommended for full probing. Never stored to disk.
              </p>
            </div>

            {connection.error && (
              <div className="bg-accent-red/10 border border-accent-red/30 rounded-lg p-3 text-sm text-accent-red">
                {connection.error}
              </div>
            )}

            <button
              type="submit"
              disabled={!isValid || connecting}
              className="w-full py-2.5 px-4 bg-accent-teal text-surface-0 text-sm font-semibold rounded-lg hover:bg-accent-teal/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {connecting ? 'Connecting...' : 'Connect & Analyze'}
            </button>
          </form>

          {/* AI Configuration */}
          <div className="mt-6 bg-surface-2 border border-border rounded-xl p-6">
            <h2 className="text-sm font-semibold text-text-primary mb-1">AI Configuration</h2>
            <p className="text-xs text-text-muted mb-4">Powers config conversion, log analysis, and error decoding.</p>

            {renderStatus()}

            {/* Advanced settings (static key dev-override) */}
            <div className="mt-4 pt-4 border-t border-border/50">
              <button
                type="button"
                onClick={() => setShowAdvanced(!showAdvanced)}
                className="text-xs text-text-muted hover:text-text-secondary flex items-center gap-1"
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" className={`transition-transform ${showAdvanced ? 'rotate-90' : ''}`}>
                  <path d="M4 2l4 4-4 4" />
                </svg>
                Advanced settings
              </button>

              {showAdvanced && (
                <div className="mt-4 space-y-3">
                  <p className="text-xs text-text-muted leading-relaxed">
                    Override OCM with a static API key. Saving here takes precedence over the OCM-managed key until you choose Use OCM key.
                  </p>

                  <div>
                    <label htmlFor="claudeKey" className="block text-xs font-medium text-text-secondary mb-1.5 uppercase tracking-wide">
                      Static API Key
                    </label>
                    <input
                      id="claudeKey"
                      type="password"
                      value={claudeKey}
                      onChange={(e) => setClaudeKey(e.target.value)}
                      placeholder={config?.source === 'static' ? 'Enter a new key to replace the override' : 'sk-ant-... or sk-...'}
                      className="w-full px-3 py-2.5 bg-surface-0 border border-border rounded-lg text-sm text-text-primary placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-accent-teal/30 focus:border-accent-teal/50 font-mono"
                    />
                  </div>

                  <div>
                    <label htmlFor="claudeEndpoint" className="block text-xs font-medium text-text-secondary mb-1.5 uppercase tracking-wide">
                      Endpoint URL
                    </label>
                    <input
                      id="claudeEndpoint"
                      type="text"
                      value={claudeEndpoint}
                      onChange={(e) => setClaudeEndpoint(e.target.value)}
                      placeholder="https://api.anthropic.com"
                      className="w-full px-3 py-2.5 bg-surface-0 border border-border rounded-lg text-sm text-text-primary placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-accent-teal/30 focus:border-accent-teal/50 font-mono"
                    />
                    <p className="text-xs text-text-muted mt-1.5">Leave blank for the default Anthropic endpoint.</p>
                  </div>

                  <div className="flex gap-2 flex-wrap">
                    <button
                      type="button"
                      onClick={saveStaticKey}
                      disabled={!claudeKey.trim() || busy}
                      className="px-4 py-2 text-xs font-medium bg-accent-teal/15 text-accent-teal hover:bg-accent-teal/25 disabled:opacity-40 rounded-lg transition-colors"
                    >
                      {claudeSaved ? 'Saved!' : 'Save static override'}
                    </button>
                    {config?.source === 'static' && (
                      <button
                        type="button"
                        onClick={revertToOcm}
                        disabled={busy}
                        className="px-4 py-2 text-xs font-medium text-text-muted hover:text-text-secondary bg-surface-3 hover:bg-surface-4 rounded-lg transition-colors"
                      >
                        Use OCM key
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          <p className="text-center text-text-muted/50 text-xs mt-6 font-mono tracking-wider">
            OTTO v0.1.0
          </p>
        </div>
      </div>
    </div>
  );
}
