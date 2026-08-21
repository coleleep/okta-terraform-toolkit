import {
  ConfigRecommendation, CustomWorkloadEntry, EndpointProbeResult, LimitSource,
  ProbeProgress, ProbeResult, TargetRuntimeAnalysis,
} from './types';

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

const SOURCE_LABELS: Record<LimitSource, string> = {
  probe: 'Probed',
  log: 'Log',
  manual: 'Manual',
  baseline: 'Default',
};

/** Short badge text for where a limit came from. */
export function sourceLabel(source: LimitSource): string {
  return SOURCE_LABELS[source];
}

/**
 * Every piece of store state computed from rate limits. Returned as one object
 * so `disconnect()` and `clearLimitSources()` cannot drift apart.
 *
 * Leaving any of this behind is the worst failure mode for limit sources: the
 * numbers look authoritative but describe a previous org or case, and a stale
 * bottleneck figure can reach a rate limit increase justification unnoticed.
 */
export function clearedLimitState(): {
  probeResult: ProbeResult | null;
  baselineProbeResult: ProbeResult | null;
  probeProgress: ProbeProgress | null;
  recommendation: ConfigRecommendation | null;
  targetAnalysis: TargetRuntimeAnalysis | null;
  targetMinutes: number | null;
  customWorkloads: CustomWorkloadEntry[];
} {
  return {
    probeResult: null,
    baselineProbeResult: null,
    probeProgress: null,
    recommendation: null,
    targetAnalysis: null,
    targetMinutes: null,
    // Custom workloads cache a rateLimit per entry, so they are derived state too
    customWorkloads: [],
  };
}
