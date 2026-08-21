import { EndpointProbeResult, LimitSource, ProbeResult } from './types';

/**
 * Precedence, lowest first — later entries win. Manual outranks a live probe
 * because a support engineer enters limits from a privileged internal lookup,
 * which reflects granted increases and custom multipliers that a probe of a
 * different org would not.
 */
const PRECEDENCE: LimitSource[] = ['baseline', 'log', 'probe', 'manual'];

/** A path's read and write limits are separate buckets and must never collide. */
function keyOf(ep: EndpointProbeResult): string {
  return `${ep.method}|${ep.label}`;
}

/**
 * Combine rate limits from multiple producers into a single ProbeResult.
 * Every consumer reads ProbeResult, so this is the only place provenance
 * precedence is decided.
 */
export function mergeLimitSources(
  sources: Partial<Record<LimitSource, EndpointProbeResult[]>>,
  displayLabel: string,
): ProbeResult {
  const merged = new Map<string, EndpointProbeResult>();

  for (const source of PRECEDENCE) {
    for (const ep of sources[source] ?? []) {
      merged.set(keyOf(ep), ep);
    }
  }

  const endpoints = [...merged.values()];

  // Report sources that survived the merge, not sources that were offered — a
  // baseline fully overridden by manual entry contributed nothing, and saying
  // otherwise would imply the result rests partly on an estimate when it does not.
  const contributed = PRECEDENCE.filter(s => endpoints.some(ep => ep.source === s));

  const withLimits = endpoints.filter(ep => ep.limit > 0);

  return {
    orgUrl: displayLabel,
    timestamp: new Date().toISOString(),
    endpoints,
    overallMinLimit: withLimits.length > 0 ? Math.min(...withLimits.map(ep => ep.limit)) : 0,
    probeDurationMs: 0,
    sources: contributed,
  };
}

/**
 * Whether this entry carries live capacity data. Manual and baseline entries
 * know the limit but not current usage. A remaining of 0 is real data (the
 * bucket is exhausted), so test for presence rather than truthiness.
 */
export function hasLiveCapacity(ep: EndpointProbeResult): boolean {
  return ep.remaining !== undefined;
}
