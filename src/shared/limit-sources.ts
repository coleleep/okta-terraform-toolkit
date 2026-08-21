import {
  ConfigRecommendation, CustomWorkloadEntry, DEFAULT_PREVENTION_OPTIONS, EndpointProbeResult,
  LimitSource, LogEndpointStats, ManagedResourceType, OperationType, PreventionOptions,
  ProbeProgress, ProbeResult, ResourceCount, TargetRuntimeAnalysis,
} from './types';
import { PROBE_ENDPOINTS, SUB_RESOURCE_ENDPOINTS } from './constants';

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
 * `\d+` is a single unbounded repetition with no alternation or nesting, so it
 * scans linearly and cannot backtrack catastrophically on a large paste. Bounding
 * the digit count instead would silently truncate an over-long value.
 */
function headerValue(blob: string, name: string): number | undefined {
  const m = blob.match(new RegExp(`${name}\\s*:\\s*(\\d+)`, 'i'));
  return m ? parseInt(m[1], 10) : undefined;
}

/**
 * Pull rate limit headers out of pasted text — a curl dump, a snippet from a
 * support case, or a log line. Returns null when no usable limit is present so
 * the caller can reject the paste rather than create a zero-limit entry.
 */
export function parseRateLimitHeaders(
  blob: string,
): { limit: number; remaining?: number; resetAt?: number } | null {
  const limit = headerValue(blob, 'x-rate-limit-limit');
  if (limit === undefined || limit === 0) return null;

  const remaining = headerValue(blob, 'x-rate-limit-remaining');
  const resetAt = headerValue(blob, 'x-rate-limit-reset');

  return {
    limit,
    // Omit rather than default — absent means unknown, 0 means exhausted, and
    // hasLiveCapacity() distinguishes them.
    ...(remaining !== undefined ? { remaining } : {}),
    ...(resetAt !== undefined ? { resetAt } : {}),
  };
}

export interface LimitBucket {
  label: string;
  method: 'GET' | 'POST';
  endpoint: string;
}

/**
 * Every rate limit bucket a limit can be entered for.
 *
 * Derived from PROBE_ENDPOINTS and SUB_RESOURCE_ENDPOINTS rather than written by
 * hand, because target-analyzer.ts matches workload resources to limits by label
 * string. A hand-maintained list would drift, and the failure is silent: the
 * limit merges, renders, and then matches nothing in the runtime analysis.
 */
export const KNOWN_LIMIT_BUCKETS: LimitBucket[] = (() => {
  const seen = new Map<string, LimitBucket>();

  for (const def of PROBE_ENDPOINTS) {
    seen.set(`GET|${def.label}`, {
      label: def.label,
      method: 'GET',
      endpoint: def.endpoint.split('?')[0],
    });
  }

  for (const def of SUB_RESOURCE_ENDPOINTS) {
    const method = def.method ?? 'GET';
    seen.set(`${method}|${def.label}`, {
      label: def.label,
      method,
      endpoint: def.endpoint.split('?')[0],
    });
  }

  return [...seen.values()].sort((a, b) => a.label.localeCompare(b.label));
})();

/**
 * Mirrors determineStatus in the probe modules. Duplicated rather than imported
 * because those live in the main process and this file is bundled into the
 * renderer.
 */
function deriveStatus(remaining: number, limit: number): 'ok' | 'warning' | 'critical' {
  if (limit === 0) return 'critical';
  const ratio = remaining / limit;
  if (ratio > 0.5) return 'ok';
  if (ratio > 0.1) return 'warning';
  return 'critical';
}

/**
 * Build a manual entry for a bucket. Status is 'unknown' unless a paste supplied
 * live capacity, in which case the ratio-based derivation is meaningful again.
 * resetWindowSecs defaults to 60, which is the standard Okta window and what
 * calculateEstimate already assumes when no probed window is available.
 */
export function manualEntry(
  bucket: LimitBucket,
  limit: number,
  capacity?: { remaining?: number; resetAt?: number },
): EndpointProbeResult {
  const remaining = capacity?.remaining;
  return {
    endpoint: bucket.endpoint,
    label: bucket.label,
    method: bucket.method,
    limit,
    resetWindowSecs: 60,
    status: remaining === undefined ? 'unknown' : deriveStatus(remaining, limit),
    source: 'manual',
    ...(remaining !== undefined ? { remaining } : {}),
    ...(capacity?.resetAt !== undefined ? { resetAt: capacity.resetAt } : {}),
  };
}

/**
 * Every piece of store state belonging to the case being analysed — the rate
 * limits themselves, everything computed from them, and the workload they were
 * computed against. Returned as one object so `disconnect()` and
 * `clearLimitSources()` cannot drift apart.
 *
 * Leaving any of this behind is the worst failure mode for limit sources: the
 * numbers look authoritative but describe a previous org or case, and a stale
 * bottleneck figure can reach a rate limit increase justification unnoticed.
 *
 * The workload is included rather than preserved because clearing only half of
 * it is worse than either extreme. Custom workloads cache a rateLimit per entry,
 * so dropping them while keeping the resource grid leaves the target runtime
 * planner without a workload while stale selections stay on screen. Preserving
 * them with a zeroed rateLimit is worse still: target-analyzer reads a zero as
 * `|| 100`, silently substituting an invented limit into a bottleneck figure.
 */
export function clearedCaseState(): {
  probeResult: ProbeResult | null;
  baselineProbeResult: ProbeResult | null;
  probeProgress: ProbeProgress | null;
  recommendation: ConfigRecommendation | null;
  targetAnalysis: TargetRuntimeAnalysis | null;
  targetMinutes: number | null;
  customWorkloads: CustomWorkloadEntry[];
  limitSources: Partial<Record<LimitSource, EndpointProbeResult[]>>;
  selectedResources: ManagedResourceType[];
  resourceCounts: ResourceCount[];
  operation: OperationType;
  preventionOptions: PreventionOptions;
  countingLabel: string | null;
} {
  return {
    probeResult: null,
    baselineProbeResult: null,
    probeProgress: null,
    recommendation: null,
    targetAnalysis: null,
    targetMinutes: null,
    customWorkloads: [],
    limitSources: {},
    selectedResources: [],
    resourceCounts: [],
    operation: 'import',
    preventionOptions: { ...DEFAULT_PREVENTION_OPTIONS },
    countingLabel: null,
  };
}

/**
 * log-parser's labelForPattern and the probe's PROBE_ENDPOINTS use different
 * vocabularies, and target-analyzer matches workloads to limits by label string.
 * Without translation, log-derived limits merge and render but match nothing in
 * the runtime analysis, with no error to explain why.
 *
 * Labels absent from this table either already match the probe vocabulary
 * exactly, or are deliberately not mapped:
 *   'Schema'                    ambiguous across user/group/app schemas
 *   'Token Endpoint', 'OAuth2'  a different rate limit family from the
 *                               management API — mapping into a management
 *                               bucket would attribute a real limit wrongly
 */
export const LOG_LABEL_TO_PROBE_LABEL: Record<string, string> = {
  'Application': 'App (single)',
  'App User (single)': 'App User Assignments',
  'App Group (single)': 'App Group Assignments',
  'Auth Server': 'Auth Server (single)',
  'Policy': 'Policies',
  'Network Zone': 'Network Zones',
  'Current User': 'Users',
  'User Roles': 'User Admin Roles',
};

/**
 * Convert parsed log endpoint stats into limit entries.
 *
 * These are real measurements from the customer's own run, so they outrank
 * published defaults — but they describe the org at capture time, not now, which
 * is why they sit below a live probe in the merge precedence.
 */
export function logDerivedLimits(stats: LogEndpointStats[]): EndpointProbeResult[] {
  return stats
    .filter(s => s.minRateLimit > 0)
    .map(s => {
      // EndpointProbeResult models only read and write buckets. PUT and DELETE
      // are writes, so they collapse to POST.
      const method: 'GET' | 'POST' = s.method.toUpperCase() === 'GET' ? 'GET' : 'POST';
      // The parser uses -1 for "no remaining header ever seen"; a real 0 means
      // the bucket was exhausted, and hasLiveCapacity() must tell them apart.
      const remaining = s.lowestRemaining >= 0 ? s.lowestRemaining : undefined;
      return {
        endpoint: s.pattern,
        label: LOG_LABEL_TO_PROBE_LABEL[s.label] ?? s.label,
        method,
        limit: s.minRateLimit,
        resetWindowSecs: 60,
        status: remaining === undefined ? 'unknown' as const : deriveStatus(remaining, s.minRateLimit),
        source: 'log' as const,
        ...(remaining !== undefined ? { remaining } : {}),
      };
    });
}

export interface BaselineBucket {
  label: string;
  method: 'GET' | 'POST';
  limit: number;
}

export interface BaselineFile {
  /** How the capture was obtained, e.g. "standard org, no multipliers". */
  capturedFrom: string;
  /** ISO date (YYYY-MM-DD) the capture was taken. Empty means never captured. */
  capturedAt: string;
  buckets: BaselineBucket[];
}

/** Six months. Past this, a capture is old enough that Okta may have changed defaults. */
const BASELINE_STALE_DAYS = 183;

/**
 * Standard-org defaults, as limit entries.
 *
 * These are NOT published by Okta — Okta publishes no per-org-type limit table
 * and its docs direct you to observe your own org. They are measured from an org
 * with no multipliers or granted increases, which makes them a defensible floor
 * but still an estimate for any other org. Used only to gap-fill, and Phase 6
 * coverage counts them as estimated rather than measured.
 */
export function baselineLimits(file: BaselineFile): EndpointProbeResult[] {
  return file.buckets.map(b => ({
    endpoint: '',
    label: b.label,
    method: b.method,
    limit: b.limit,
    resetWindowSecs: 60,
    // A capture records the limit, never live capacity.
    status: 'unknown' as const,
    source: 'baseline' as const,
  }));
}

/** Uncaptured counts as stale, so an empty baseline is never trusted silently. */
export function baselineIsStale(file: BaselineFile, todayIso: string): boolean {
  if (!file.capturedAt) return true;
  const captured = Date.parse(`${file.capturedAt}T00:00:00Z`);
  const today = Date.parse(`${todayIso}T00:00:00Z`);
  if (Number.isNaN(captured) || Number.isNaN(today)) return true;
  return (today - captured) / 86_400_000 > BASELINE_STALE_DAYS;
}

/**
 * Build a baseline capture from a probe of a standard org.
 *
 * Deliberately drops the org URL, timestamps, remaining counts, and endpoint
 * paths — this file is committed to a public repository, so it carries the
 * generic limit numbers and nothing that identifies where they came from.
 */
export function baselineCaptureFromProbe(
  probeResult: ProbeResult,
  todayIso: string,
): BaselineFile {
  return {
    capturedFrom: 'standard org, no multipliers',
    capturedAt: todayIso,
    buckets: probeResult.endpoints
      .filter(ep => ep.limit > 0 && ep.status !== 'error' && ep.status !== 'skipped')
      .map(ep => ({ label: ep.label, method: ep.method, limit: ep.limit }))
      .sort((a, b) => a.label.localeCompare(b.label) || a.method.localeCompare(b.method)),
  };
}
