import React, { useState, useEffect } from 'react';

const api = (window as any).oktaTerraform;

interface Props {
  onClose: () => void;
}

type ClaudeConfigData = {
  hasKey: boolean;
  baseUrl?: string;
  source?: 'ocm' | 'static';
  ocm?: { fileExists: boolean; path: string };
};

export default function SettingsModal({ onClose }: Props) {
  // Claude config state
  const [config, setConfig] = useState<ClaudeConfigData | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);

  // Other settings
  const [logLevel, setLogLevelState] = useState<string>('info');
  const [providerVersions, setProviderVersions] = useState<{ version: string; cached: boolean }[]>([]);
  const [selectedProviderVersion, setSelectedProviderVersionState] = useState<string>('system');
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [versionsError, setVersionsError] = useState<string | null>(null);
  const [downloadingVersion, setDownloadingVersion] = useState<string | null>(null);
  const [downloadPercent, setDownloadPercent] = useState(0);

  const refreshConfig = async () => {
    const r = await api.getClaudeConfig();
    const data: ClaudeConfigData | null = r.data || null;
    setConfig(data);
    setBaseUrl(data?.source === 'static' ? (data.baseUrl || '') : '');
  };

  useEffect(() => {
    refreshConfig();
    api.getLogLevel().then((r: any) => {
      if (r.data) setLogLevelState(r.data);
    });
    api.getSelectedProviderVersion().then((r: any) => {
      if (r?.data) setSelectedProviderVersionState(r.data);
    });
    setVersionsLoading(true);
    api.listProviderVersions().then((r: any) => {
      setVersionsLoading(false);
      if (r?.success && r.data) {
        setProviderVersions(r.data);
      } else {
        setVersionsError(r?.error ?? 'Could not load versions');
      }
    }).catch(() => {
      setVersionsLoading(false);
      setVersionsError('Could not load versions');
    });
    const unsubProgress = api.onProviderDownloadProgress((progress: { version: string; percent: number }) => {
      setDownloadPercent(progress.percent);
    });
    return () => { unsubProgress(); };
  }, []);

  const handleSaveStatic = async () => {
    if (!apiKey.trim()) return;
    setSaving(true);
    try {
      await api.setClaudeConfig({ apiKey: apiKey.trim(), baseUrl: baseUrl.trim() || undefined });
      setApiKey('');
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 2000);
      await refreshConfig();
    } finally {
      setSaving(false);
    }
  };

  const handleRevertToOcm = async () => {
    setSaving(true);
    try {
      await api.removeClaudeConfig();
      setApiKey('');
      setBaseUrl('');
      await refreshConfig();
    } finally {
      setSaving(false);
    }
  };

  const handleLogLevelChange = async (level: string) => {
    setLogLevelState(level);
    await api.setLogLevel(level);
  };

  const handleOpenLogFolder = async () => {
    await api.openLogFolder();
  };

  const handleProviderVersionChange = async (version: string) => {
    setSelectedProviderVersionState(version);
    await api.setSelectedProviderVersion(version);
  };

  const handleDownloadVersion = async (version: string) => {
    setDownloadingVersion(version);
    setDownloadPercent(0);
    const result = await api.downloadProviderVersion(version);
    setDownloadingVersion(null);
    if (result?.success) {
      setProviderVersions((prev) =>
        prev.map((v) => v.version === version ? { ...v, cached: true } : v)
      );
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
          <button type="button" onClick={refreshConfig} className="text-xs text-text-muted hover:text-text-secondary" disabled={saving}>
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
          <button type="button" onClick={handleRevertToOcm} className="text-xs text-accent-teal hover:underline whitespace-nowrap" disabled={saving}>
            Use OCM key
          </button>
        </div>
      );
    }
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-accent-red" />
          <span className="text-sm text-text-secondary">No AI key configured</span>
        </div>
        <div className="text-xs text-text-muted leading-relaxed">
          Run <code className="font-mono bg-surface-3 px-1.5 py-0.5 rounded text-text-secondary">ocm auth litellm</code> in your terminal, then click Reload — or open Advanced settings to configure a static key.
        </div>
        <button type="button" onClick={refreshConfig} className="text-xs text-accent-teal hover:underline" disabled={saving}>
          Reload
        </button>
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative bg-surface-2 border border-border rounded-xl p-6 w-full max-w-md shadow-2xl max-h-[90vh] overflow-y-auto">
        <h2 className="text-lg font-semibold text-text-primary mb-1">AI Settings</h2>
        <p className="text-xs text-text-muted mb-5">OTTO uses OCM-managed LiteLLM keys by default. Override with a static key under Advanced.</p>

        {renderStatus()}

        {/* Advanced settings (static-key dev override) */}
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
                <label htmlFor="settings-key" className="block text-xs font-medium text-text-secondary mb-1.5 uppercase tracking-wide">
                  Static API Key
                </label>
                <div className="relative">
                  <input
                    id="settings-key"
                    type={showKey ? 'text' : 'password'}
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder={config?.source === 'static' ? 'Enter a new key to replace the override' : 'sk-ant-... or sk-...'}
                    className="w-full px-3 py-2.5 pr-16 bg-surface-0 border border-border rounded-lg text-sm text-text-primary placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-accent-teal/30 focus:border-accent-teal/50 font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => setShowKey(!showKey)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-text-muted hover:text-text-secondary px-2 py-1"
                  >
                    {showKey ? 'Hide' : 'Show'}
                  </button>
                </div>
              </div>

              <div>
                <label htmlFor="settings-endpoint" className="block text-xs font-medium text-text-secondary mb-1.5 uppercase tracking-wide">
                  Endpoint URL
                </label>
                <input
                  id="settings-endpoint"
                  type="text"
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  placeholder="https://api.anthropic.com"
                  className="w-full px-3 py-2.5 bg-surface-0 border border-border rounded-lg text-sm text-text-primary placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-accent-teal/30 focus:border-accent-teal/50 font-mono"
                />
                <p className="text-xs text-text-muted mt-1.5">Leave blank for the default Anthropic endpoint.</p>
              </div>

              <div className="flex gap-2 flex-wrap">
                <button
                  type="button"
                  onClick={handleSaveStatic}
                  disabled={!apiKey.trim() || saving}
                  className="px-4 py-2 text-xs font-medium bg-accent-teal/15 text-accent-teal hover:bg-accent-teal/25 disabled:opacity-40 rounded-lg transition-colors"
                >
                  {savedFlash ? 'Saved!' : (saving ? 'Saving…' : 'Save static override')}
                </button>
                {config?.source === 'static' && (
                  <button
                    type="button"
                    onClick={handleRevertToOcm}
                    disabled={saving}
                    className="px-4 py-2 text-xs font-medium text-text-muted hover:text-text-secondary bg-surface-3 hover:bg-surface-4 rounded-lg transition-colors"
                  >
                    Use OCM key
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Logging section */}
        <div className="pt-4 border-t border-border mt-4">
          <p className="text-xs font-bold uppercase tracking-widest text-text-muted mb-3">Logging</p>
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1.5 uppercase tracking-wide">
                Log Level
              </label>
              <select
                value={logLevel}
                onChange={(e) => handleLogLevelChange(e.target.value)}
                className="w-full px-3 py-2 bg-surface-0 border border-border rounded-lg text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-teal/30"
              >
                <option value="debug">Debug</option>
                <option value="info">Info (default)</option>
                <option value="warn">Warn</option>
                <option value="error">Error</option>
              </select>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-text-muted font-mono">otto-audit.log</span>
              <button
                type="button"
                onClick={handleOpenLogFolder}
                className="px-3 py-1.5 text-xs bg-surface-3 text-text-secondary hover:bg-surface-4 rounded-lg transition-colors"
              >
                Open Folder
              </button>
            </div>
          </div>
        </div>

        {/* Terraform Provider section */}
        <div className="pt-4 border-t border-border mt-4">
          <p className="text-xs font-bold uppercase tracking-widest text-text-muted mb-3">Terraform Provider</p>
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1.5 uppercase tracking-wide">
              Okta Provider Version
            </label>
            {versionsError ? (
              <p className="text-xs text-accent-red">{versionsError}</p>
            ) : (
              <div className="flex items-center gap-2">
                <select
                  value={selectedProviderVersion}
                  onChange={(e) => handleProviderVersionChange(e.target.value)}
                  disabled={versionsLoading}
                  className="flex-1 px-3 py-2 bg-surface-0 border border-border rounded-lg text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-teal/30"
                >
                  <option value="system">System (latest from registry)</option>
                  {providerVersions.map((v) => (
                    <option key={v.version} value={v.version}>
                      {v.version}{v.cached ? ' ✓' : ''}
                    </option>
                  ))}
                </select>
                {selectedProviderVersion !== 'system' &&
                  !providerVersions.find((v) => v.version === selectedProviderVersion)?.cached &&
                  downloadingVersion !== selectedProviderVersion && (
                    <button
                      type="button"
                      onClick={() => handleDownloadVersion(selectedProviderVersion)}
                      className="px-3 py-1.5 text-xs bg-accent-teal/15 text-accent-teal hover:bg-accent-teal/25 rounded-lg transition-colors whitespace-nowrap"
                    >
                      Download
                    </button>
                  )}
                {downloadingVersion === selectedProviderVersion && (
                  <span className="text-xs text-text-muted whitespace-nowrap">
                    {downloadPercent}%…
                  </span>
                )}
                {selectedProviderVersion !== 'system' &&
                  providerVersions.find((v) => v.version === selectedProviderVersion)?.cached && (
                    <span className="text-xs text-accent-teal whitespace-nowrap">✓ Cached</span>
                  )}
              </div>
            )}
            {versionsLoading && (
              <p className="text-xs text-text-muted mt-1">Loading versions…</p>
            )}
          </div>
        </div>

        <div className="flex justify-end mt-6 pt-4 border-t border-border">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-medium text-text-muted hover:text-text-secondary bg-surface-3 hover:bg-surface-4 rounded-lg transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
