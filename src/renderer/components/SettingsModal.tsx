import React, { useState, useEffect } from 'react';

const api = (window as any).oktaTerraform;

interface Props {
  onClose: () => void;
}

export default function SettingsModal({ onClose }: Props) {
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [hasKey, setHasKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [logLevel, setLogLevelState] = useState<string>('info');
  const [providerVersions, setProviderVersions] = useState<{ version: string; cached: boolean }[]>([]);
  const [selectedProviderVersion, setSelectedProviderVersionState] = useState<string>('system');
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [versionsError, setVersionsError] = useState<string | null>(null);
  const [downloadingVersion, setDownloadingVersion] = useState<string | null>(null);
  const [downloadPercent, setDownloadPercent] = useState(0);

  useEffect(() => {
    api.getClaudeConfig().then((r: any) => {
      if (r.data?.hasKey) {
        setHasKey(true);
        setBaseUrl(r.data.baseUrl || '');
        if (r.data.baseUrl) setShowAdvanced(true);
      }
    });
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

  const handleSave = async () => {
    if (!apiKey.trim()) return;
    setSaving(true);
    await api.setClaudeConfig({ apiKey: apiKey.trim(), baseUrl: baseUrl.trim() || undefined });
    setSaving(false);
    onClose();
  };

  const handleRemove = async () => {
    await api.removeClaudeConfig();
    onClose();
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative bg-surface-2 border border-border rounded-xl p-6 w-full max-w-md shadow-2xl">
        <h2 className="text-lg font-semibold text-text-primary mb-1">AI Settings</h2>
        <p className="text-xs text-text-muted mb-5">Configure your Claude API connection for AI-powered features.</p>

        <div className="space-y-4">
          <div>
            <label htmlFor="settings-key" className="block text-xs font-medium text-text-secondary mb-1.5 uppercase tracking-wide">
              API Key
            </label>
            <div className="relative">
              <input
                id="settings-key"
                type={showKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={hasKey ? '••••••••••••••••' : 'sk-ant-...'}
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
            {hasKey && !apiKey && (
              <p className="text-xs text-text-muted mt-1.5">Key already configured. Enter a new one to replace it.</p>
            )}
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
              <p className="text-xs text-text-muted mt-1.5">Leave blank for default Anthropic endpoint.</p>
            </div>
          )}
        </div>

        {/* Logging section */}
        <div className="pt-4 border-t border-border">
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
        <div className="pt-4 border-t border-border">
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

        <div className="flex items-center justify-between mt-6 pt-4 border-t border-border">
          {hasKey ? (
            <button
              type="button"
              onClick={handleRemove}
              className="text-xs text-accent-red/80 hover:text-accent-red"
            >
              Remove key
            </button>
          ) : (
            <div />
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium text-text-muted hover:text-text-secondary bg-surface-3 hover:bg-surface-4 rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={!apiKey.trim() || saving}
              className="px-4 py-2 text-xs font-medium bg-accent-teal/15 text-accent-teal hover:bg-accent-teal/25 disabled:opacity-40 rounded-lg transition-colors"
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
