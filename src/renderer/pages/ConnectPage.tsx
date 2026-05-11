import React, { useState, useEffect } from 'react';
import { useStore } from '../hooks/useStore';

const api = (window as any).oktaTerraform;

export default function ConnectPage() {
  const { connecting, connection, connect } = useStore();
  const [orgUrl, setOrgUrl] = useState('');
  const [token, setToken] = useState('');

  // Claude config state
  const [claudeKey, setClaudeKey] = useState('');
  const [claudeEndpoint, setClaudeEndpoint] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [claudeConfigured, setClaudeConfigured] = useState(false);
  const [claudeSaved, setClaudeSaved] = useState(false);
  const [editingClaude, setEditingClaude] = useState(false);

  useEffect(() => {
    api.getClaudeConfig().then((r: any) => {
      if (r.data?.hasKey) {
        setClaudeConfigured(true);
        setClaudeEndpoint(r.data.baseUrl || '');
      }
    });
  }, []);

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

            {claudeConfigured && !editingClaude ? (
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-accent-teal" />
                  <span className="text-sm text-text-secondary">API key configured</span>
                  {claudeEndpoint && (
                    <span className="text-xs text-text-muted font-mono bg-surface-3 px-2 py-0.5 rounded">{claudeEndpoint}</span>
                  )}
                </div>
                <button
                  onClick={() => setEditingClaude(true)}
                  className="text-xs text-accent-teal hover:underline"
                >
                  Change
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                <div>
                  <label htmlFor="claudeKey" className="block text-xs font-medium text-text-secondary mb-1.5 uppercase tracking-wide">
                    Claude API Key
                  </label>
                  <input
                    id="claudeKey"
                    type="password"
                    value={claudeKey}
                    onChange={(e) => setClaudeKey(e.target.value)}
                    placeholder="sk-ant-..."
                    className="w-full px-3 py-2.5 bg-surface-0 border border-border rounded-lg text-sm text-text-primary placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-accent-teal/30 focus:border-accent-teal/50 font-mono"
                  />
                </div>

                <button
                  type="button"
                  onClick={() => setShowAdvanced(!showAdvanced)}
                  className="text-xs text-text-muted hover:text-text-secondary flex items-center gap-1"
                >
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" className={`transition-transform ${showAdvanced ? 'rotate-90' : ''}`}>
                    <path d="M4 2l4 4-4 4" />
                  </svg>
                  Advanced
                </button>

                {showAdvanced && (
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
                    <p className="text-xs text-text-muted mt-1.5">Leave blank for default Anthropic endpoint.</p>
                  </div>
                )}

                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={async () => {
                      if (!claudeKey.trim()) return;
                      await api.setClaudeConfig({ apiKey: claudeKey.trim(), baseUrl: claudeEndpoint.trim() || undefined });
                      setClaudeConfigured(true);
                      setEditingClaude(false);
                      setClaudeSaved(true);
                      setClaudeKey('');
                      setTimeout(() => setClaudeSaved(false), 2000);
                    }}
                    disabled={!claudeKey.trim()}
                    className="px-4 py-2 text-xs font-medium bg-accent-teal/15 text-accent-teal hover:bg-accent-teal/25 disabled:opacity-40 rounded-lg transition-colors"
                  >
                    {claudeSaved ? 'Saved!' : 'Save'}
                  </button>
                  {editingClaude && (
                    <button
                      type="button"
                      onClick={() => setEditingClaude(false)}
                      className="px-4 py-2 text-xs font-medium text-text-muted hover:text-text-secondary bg-surface-3 hover:bg-surface-4 rounded-lg transition-colors"
                    >
                      Cancel
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>

          <p className="text-center text-text-muted/50 text-xs mt-6 font-mono tracking-wider">
            OTTO v0.1.0
          </p>
        </div>
      </div>
    </div>
  );
}
