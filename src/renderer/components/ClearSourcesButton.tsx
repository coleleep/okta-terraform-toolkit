import React, { useState } from 'react';
import { useStore } from '../hooks/useStore';

export default function ClearSourcesButton() {
  const { probeResult, clearLimitSources } = useStore();
  const [confirming, setConfirming] = useState(false);

  if (!probeResult) return null;

  // Confirmed because nothing here is recoverable — manual limits are never
  // written to disk, and clearing also drops the recommendation and target
  // analysis computed from them.
  if (confirming) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-xs text-text-secondary">Clear all rate limit data?</span>
        <button
          onClick={() => { clearLimitSources(); setConfirming(false); }}
          className="px-2.5 py-1 text-xs font-medium bg-accent-red text-surface-0 rounded-lg hover:bg-accent-red/90 transition-colors"
        >
          Clear
        </button>
        <button
          onClick={() => setConfirming(false)}
          className="px-2.5 py-1 text-xs font-medium border border-border text-text-secondary rounded-lg hover:bg-surface-3 transition-colors"
        >
          Cancel
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={() => setConfirming(true)}
      title="Drop all rate limit sources and start over"
      className="px-2.5 py-1 text-xs font-medium border border-border text-text-secondary rounded-lg hover:bg-surface-3 transition-colors"
    >
      Start Over
    </button>
  );
}
