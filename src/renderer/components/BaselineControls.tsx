import React, { useState } from 'react';
import { useStore } from '../hooks/useStore';
import {
  BaselineFile, baselineCaptureFromProbe, baselineIsStale, baselineLimits,
} from '../../shared/limit-sources';
import baselineJson from '../../shared/rate-limit-baselines.json';

const BASELINE = baselineJson as BaselineFile;

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Capture the current probe as the standard-org baseline.
 *
 * Only offered for a probe-sourced result. Capturing manual entries or an
 * existing baseline as "standard defaults" would be circular — the point is that
 * these numbers were measured against an org with no multipliers.
 */
export function BaselineCaptureButton() {
  const { probeResult, saveTfFile } = useStore();
  const [saved, setSaved] = useState<string | null>(null);

  if (!probeResult || !probeResult.sources.includes('probe')) return null;

  const handleSave = async () => {
    const file = baselineCaptureFromProbe(probeResult, todayIso());
    const path = await saveTfFile(JSON.stringify(file, null, 2));
    if (path) setSaved(path);
  };

  return (
    <div className="flex items-center gap-2">
      {saved && <span className="text-xs text-accent-green">Saved to {saved}</span>}
      <button
        onClick={handleSave}
        title="Export these limits as the standard-org baseline (no org URL or identifying data included)"
        className="px-2.5 py-1 text-xs font-medium border border-border text-text-secondary rounded-lg hover:bg-surface-3 transition-colors"
      >
        Save as baseline JSON
      </button>
    </div>
  );
}

/** Offers the bundled baseline as a gap-filling source, if one has been captured. */
export function UseBaselineButton() {
  const setLimitSource = useStore(state => state.setLimitSource);
  const entries = baselineLimits(BASELINE);

  if (entries.length === 0) return null;

  const stale = baselineIsStale(BASELINE, todayIso());

  return (
    <button
      onClick={() => setLimitSource('baseline', entries, 'Standard defaults')}
      title={stale
        ? `Baseline captured ${BASELINE.capturedAt} — over six months old, verify before relying on it`
        : `Standard-org defaults captured ${BASELINE.capturedAt}`}
      className="px-4 py-2 text-xs font-medium border border-border text-text-secondary hover:bg-surface-3 rounded-lg transition-colors"
    >
      Use Standard Defaults{stale ? ' (stale)' : ''}
    </button>
  );
}
