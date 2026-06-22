import React, { useState } from 'react';
import { useStore } from '../hooks/useStore';

interface Props {
  onClose: () => void;
}

export default function ConnectOrgModal({ onClose }: Props) {
  const { connecting, connection, connect } = useStore();
  const [orgUrl, setOrgUrl] = useState('');
  const [token, setToken] = useState('');
  const [submitError, setSubmitError] = useState<string | null>(connection.error ?? null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);
    let url = orgUrl.trim();
    if (!url.startsWith('https://') && !url.startsWith('http://')) {
      url = `https://${url}`;
    }
    url = url.replace(/\/+$/, '');
    const success = await connect({ orgUrl: url, authMethod: 'token', token: token.trim() });
    if (success) onClose();
    else setSubmitError(connection.error ?? 'Connection failed');
  };

  const isValid = orgUrl.trim().length > 0 && token.trim().length > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={connecting ? undefined : onClose} />
      <div className="relative bg-surface-1 border border-border rounded-xl w-full max-w-md mx-4 p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-sm font-semibold text-text-primary">Connect to Org</h2>
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

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="modal-orgUrl" className="block text-xs font-medium text-text-secondary mb-1.5 uppercase tracking-wide">
              Org URL
            </label>
            <input
              id="modal-orgUrl"
              type="text"
              value={orgUrl}
              onChange={(e) => setOrgUrl(e.target.value)}
              placeholder="https://your-org.okta.com"
              className="w-full px-3 py-2.5 bg-surface-0 border border-border rounded-lg text-sm text-text-primary placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-accent-teal/30 focus:border-accent-teal/50 font-mono"
              disabled={connecting}
              autoFocus
            />
          </div>

          <div>
            <label htmlFor="modal-token" className="block text-xs font-medium text-text-secondary mb-1.5 uppercase tracking-wide">
              API Token
            </label>
            <input
              id="modal-token"
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

          {(submitError || connection.error) && (
            <div className="bg-accent-red/10 border border-accent-red/30 rounded-lg p-3 text-sm text-accent-red">
              {submitError || connection.error}
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
      </div>
    </div>
  );
}
