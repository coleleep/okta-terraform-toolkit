import React, { useState, useEffect } from 'react';

interface DecoderResult {
  explanation: string;
  cause: string;
  fix: string;
  relatedDocs?: string;
}

export default function ErrorDecoder() {
  const [input, setInput] = useState('');
  const [result, setResult] = useState<DecoderResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasKey, setHasKey] = useState(false);
  const [dots, setDots] = useState('');

  useEffect(() => {
    if (!loading) { setDots(''); return; }
    const interval = setInterval(() => {
      setDots(d => (d.length >= 3 ? '' : d + '.'));
    }, 400);
    return () => clearInterval(interval);
  }, [loading]);

  const api = (window as unknown as { oktaTerraform: {
    decodeError: (text: string) => Promise<{ success: boolean; data?: DecoderResult; error?: string }>;
    hasClaudeKey: () => Promise<{ success: boolean; data?: boolean }>;
  }}).oktaTerraform;

  useEffect(() => {
    api.hasClaudeKey().then(r => setHasKey(!!r.data));
  }, []);

  const handleDecode = async () => {
    if (!input.trim()) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await api.decodeError(input.trim());
      if (res.success && res.data) {
        setResult(res.data);
      } else {
        setError(res.error ?? 'Failed to decode error');
      }
    } catch {
      setError('Failed to connect to Claude API');
    }
    setLoading(false);
  };

  return (
    <div>
      <h1 className="text-lg font-bold text-text-primary mb-2">Error Decoder</h1>
      <p className="text-xs text-text-secondary mb-4">
        Paste any Terraform + Okta error message and get a plain-English explanation with a specific fix.
      </p>

      {/* Input */}
      <div className="bg-surface-2 rounded-xl border border-border p-4 mb-4">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Paste your error message here...&#10;&#10;Examples:&#10;• Error: API Error (401): E0000011 - Invalid token provided&#10;• Error creating okta_app_user: The API returned an error: ...&#10;• context deadline exceeded&#10;• Error: cycle detected in resource dependencies"
          rows={6}
          className="w-full px-3 py-2 text-xs font-mono bg-surface-1 text-text-primary border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-400 resize-y"
        />
        <div className="flex items-center justify-between mt-3">
          <span className="text-xs text-text-muted">
            {input.length > 0 ? `${input.split('\n').length} lines` : 'Supports Terraform CLI output, provider errors, and Okta API responses'}
          </span>
          <button
            onClick={handleDecode}
            disabled={loading || !input.trim() || !hasKey}
            className="px-4 py-2 text-xs font-medium text-white bg-purple-600 rounded-lg hover:bg-purple-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? 'Decoding...' : !hasKey ? 'No API Key' : 'Decode Error'}
          </button>
        </div>
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex items-center gap-2 p-4 bg-surface-2 rounded-xl border border-border">
          <div className="animate-spin w-4 h-4 border-2 border-purple-500 border-t-transparent rounded-full" />
          <span className="text-xs text-text-secondary">Claude is analyzing the error{dots}</span>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="bg-accent-red/10 border border-accent-red/30 rounded-xl p-4">
          <p className="text-xs text-accent-red">{error}</p>
        </div>
      )}

      {/* Result */}
      {result && (
        <div className="bg-surface-2 rounded-xl border border-border p-4 space-y-4">
          <div>
            <span className="text-xs font-medium text-text-muted uppercase tracking-wide">What This Means</span>
            <p className="text-sm text-text-secondary mt-1">{result.explanation}</p>
          </div>

          <div>
            <span className="text-xs font-medium text-text-muted uppercase tracking-wide">Root Cause</span>
            <p className="text-sm font-medium text-text-primary mt-1">{result.cause}</p>
          </div>

          <div className="bg-accent-green/10 border border-accent-green/30 rounded-lg p-3">
            <span className="text-xs font-medium text-accent-green uppercase tracking-wide">How to Fix</span>
            <p className="text-sm text-accent-green mt-1 whitespace-pre-line">{result.fix}</p>
          </div>

          {result.relatedDocs && (
            <div className="border-t border-border pt-3">
              <span className="text-xs font-medium text-text-muted uppercase tracking-wide">Related Docs</span>
              <p className="text-xs text-accent-blue mt-1">{result.relatedDocs}</p>
            </div>
          )}

          <button
            onClick={() => { setResult(null); setInput(''); }}
            className="text-xs text-text-muted hover:text-text-primary transition-colors"
          >
            Decode another error
          </button>
        </div>
      )}

      {/* No key message */}
      {!hasKey && !loading && (
        <div className="bg-accent-amber/10 border border-accent-amber/30 rounded-xl p-4">
          <p className="text-xs text-accent-amber">Set a Claude API key to enable AI-powered error decoding.</p>
        </div>
      )}
    </div>
  );
}
