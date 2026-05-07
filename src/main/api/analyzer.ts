import { ProbeResult, ConfigRecommendation, TerraformProviderConfig, ResourceWorkload, RuntimeEstimate, PreventionOptions, CustomWorkloadEntry } from '../../shared/types';
import { TERRAFORM_DEFAULTS, RESOURCE_TYPES, HIGH_VOLUME_THRESHOLD, VERY_HIGH_VOLUME_THRESHOLD, OPERATIONS, PREVENTION_OPTIONS } from '../../shared/constants';

export function analyzeAndRecommend(
  probeResult: ProbeResult,
  workload?: ResourceWorkload
): ConfigRecommendation {
  // If workload is provided, only consider endpoints relevant to selected resources
  let relevant = probeResult.endpoints.filter(e => e.status !== 'error' && e.status !== 'skipped' && e.limit > 0);

  if (workload && workload.selected.length > 0) {
    const relevantLabels = new Set<string>();
    for (const type of workload.selected) {
      const def = RESOURCE_TYPES.find(r => r.type === type);
      if (def) relevantLabels.add(def.probeLabel);
    }
    relevantLabels.add('Org Settings');
    relevantLabels.add('Schemas');

    const filtered = relevant.filter(e => relevantLabels.has(e.label));
    if (filtered.length > 0) {
      relevant = filtered;
    }
  }

  if (relevant.length === 0) {
    return {
      current: { ...TERRAFORM_DEFAULTS },
      recommended: { ...TERRAFORM_DEFAULTS },
      explanations: {
        backoff: 'Always enable. Without backoff, retries hammer the API immediately.',
        max_retries: 'No rate limit data available. Using default.',
        max_api_capacity: 'No rate limit data available. Using default.',
        min_wait_seconds: 'No rate limit data available. Using default.',
        max_wait_seconds: 'No rate limit data available. Using default.',
        request_timeout: 'No rate limit data available. Using default.',
        parallelism: 'No rate limit data available. Using default.',
      },
    };
  }

  const minLimit = Math.min(...relevant.map(e => e.limit));
  const resetWindows = relevant.map(e => e.resetWindowSecs).filter(w => w > 0);
  const avgResetWindow = resetWindows.length > 0
    ? resetWindows.reduce((a, b) => a + b, 0) / resetWindows.length
    : 60;
  const maxResetWindow = resetWindows.length > 0
    ? Math.max(...resetWindows)
    : 60;

  // Workload context
  const totalResources = workload?.totalResources ?? 0;
  const customWorkloads = workload?.customWorkloads ?? [];
  const hasWorkload = workload && (workload.selected.length > 0 || customWorkloads.length > 0 || totalResources > 0);
  const resourceBreakdown = workload?.counts
    .filter(c => !c.error)
    .map(c => `${c.count.toLocaleString()} ${c.label.toLowerCase()}`)
    .join(', ') ?? '';

  // Operation context
  const operationDef = hasWorkload
    ? OPERATIONS.find(o => o.type === workload.operation) ?? OPERATIONS[0]
    : null;
  const writeFactor = operationDef?.writeFactor ?? 0.5;
  let apiCallsPerResource = operationDef?.apiCallsPerResource ?? 3;

  // Prevention options: adjust API call count based on skip/include toggles
  const prevention = workload?.preventionOptions;
  let preventionDelta = 0;
  if (hasWorkload && prevention) {
    for (const opt of PREVENTION_OPTIONS) {
      const isEnabled = prevention[opt.key];
      const resourceSelected = workload.selected.includes(opt.affectedResource);
      if (!resourceSelected) continue;

      if (opt.key.startsWith('skip')) {
        // skip_* options: when enabled (true), calls are SKIPPED → reduce calls
        if (isEnabled) preventionDelta -= opt.extraCallsPerResource;
      } else {
        // include_* options: when enabled (true), calls are ADDED → increase calls
        if (isEnabled) preventionDelta += opt.extraCallsPerResource;
      }
    }
    apiCallsPerResource = Math.max(1, apiCallsPerResource + preventionDelta);
  }

  // --- Recommendations calibrated from real TF_LOG benchmarks ---
  // Tested with ~1,750 okta_app_user resources against 100 req/window endpoints.
  // Key finding: max_api_capacity=70 + request_timeout=120 + parallelism=4 gives
  // the best results — zero 429s, fastest completion (21 min vs 24 min baseline).

  // --- max_retries ---
  // With capacity throttling, retries are rarely needed (zero 429s in testing).
  // Keep 4 as safety net.
  let maxRetries = 4;
  if (minLimit >= 600) maxRetries = 5;
  if (hasWorkload && totalResources >= VERY_HIGH_VOLUME_THRESHOLD) {
    maxRetries = Math.min(maxRetries + 1, 8);
  }

  // --- max_api_capacity ---
  // 70% is the tested sweet spot: prevents 429s while maintaining throughput.
  // 60% was too conservative (slower than no throttling). 80%+ risks 429s on low-limit endpoints.
  let maxApiCapacity: number;
  if (minLimit >= 600) maxApiCapacity = 80;
  else if (minLimit >= 100) maxApiCapacity = 70; // tested sweet spot
  else maxApiCapacity = 50;

  // Write-heavy = slightly more conservative
  if (operationDef && writeFactor >= 0.7) {
    maxApiCapacity = Math.max(maxApiCapacity - 5, 40);
  }
  // Import (read-only) = can push a bit higher
  if (operationDef && writeFactor === 0 && minLimit >= 100) {
    maxApiCapacity = Math.min(maxApiCapacity + 5, 85);
  }

  // --- wait times ---
  // With capacity throttling, min_wait can be lower since the throttler handles pacing.
  // Testing showed min_wait=17 (about 1/3 of reset window) works well with capacity throttling.
  const minWaitSeconds = maxApiCapacity < 100
    ? Math.max(5, Math.min(20, Math.ceil(avgResetWindow / 3)))   // capacity throttling: lower wait
    : Math.max(10, Math.min(30, Math.ceil(avgResetWindow / 2))); // no throttling: higher wait

  let maxWaitSeconds = Math.max(60, Math.min(120, Math.ceil(maxResetWindow * 1.5)));
  // Cap at 90s — testing showed 300s is far too long and 90s is sufficient
  maxWaitSeconds = Math.min(maxWaitSeconds, 90);

  // --- request_timeout ---
  // CRITICAL: When max_api_capacity < 100, the provider queues requests waiting for
  // rate limit headroom. Timeout must exceed the queue wait time.
  // Testing confirmed: 30s → 840 errors. 120s → zero errors.
  let requestTimeout: number;
  if (maxApiCapacity < 100) {
    // Capacity throttling active → must survive queue waits
    requestTimeout = 120;
  } else {
    // No throttling → just need enough for slow API responses
    requestTimeout = 30;
  }

  // --- parallelism ---
  // With capacity throttling (max_api_capacity < 100), higher parallelism is safe
  // because the throttler paces requests. Testing confirmed parallelism=4 works well
  // with max_api_capacity=70 on 100 req/window endpoints.
  let parallelism: number;
  if (maxApiCapacity < 100) {
    // Capacity throttling active — parallelism is safe since throttler handles pacing
    if (minLimit >= 600) parallelism = 6;
    else if (minLimit >= 100) parallelism = 4; // tested with 100 req/window
    else parallelism = 2;
  } else {
    // No throttling — must be conservative to avoid 429 storms
    if (minLimit >= 600) parallelism = 4;
    else if (minLimit >= 200) parallelism = 3;
    else if (minLimit >= 100) parallelism = 2;
    else parallelism = 1;
  }
  // Write-heavy: slightly lower
  if (writeFactor >= 0.7 && parallelism > 2) {
    parallelism = Math.max(2, parallelism - 1);
  }

  const recommended: TerraformProviderConfig = {
    backoff: true,
    max_retries: maxRetries,
    max_api_capacity: maxApiCapacity,
    min_wait_seconds: minWaitSeconds,
    max_wait_seconds: maxWaitSeconds,
    request_timeout: requestTimeout,
    parallelism,
  };

  // --- Runtime estimate ---
  let runtimeEstimate: RuntimeEstimate | undefined;

  if (customWorkloads.length > 0) {
    // Custom workloads: use specific endpoint rate limits for each workload entry
    runtimeEstimate = estimateCustomRuntime(
      customWorkloads, apiCallsPerResource, maxApiCapacity,
      probeResult, writeFactor, operationDef?.label ?? 'operations', parallelism
    );
  } else if (hasWorkload && totalResources > 0) {
    runtimeEstimate = estimateRuntime(
      totalResources, apiCallsPerResource, minLimit,
      maxApiCapacity, avgResetWindow, writeFactor, resourceBreakdown,
      operationDef?.label ?? 'operations', parallelism
    );
  }

  // --- Build explanations ---
  const scopeNote = hasWorkload
    ? ` Scoped to your selected resources (${resourceBreakdown}).`
    : '';

  const opNote = operationDef
    ? ` Operation: ${operationDef.label.toLowerCase()}.`
    : '';

  const explanations: Record<keyof TerraformProviderConfig, string> = {
    backoff: 'Always enable. Without backoff, retries hammer the API immediately after a 429.',

    max_retries: hasWorkload && (totalResources >= HIGH_VOLUME_THRESHOLD || writeFactor >= 0.7)
      ? `Your most constrained relevant endpoint allows ${minLimit} req/window. ${totalResources.toLocaleString()} resources with ${operationDef?.label.toLowerCase() ?? 'mixed'} operations means ${writeFactor >= 0.7 ? 'write-heavy traffic — ' : ''}more chances of hitting rate limits. Set to ${maxRetries} retries.`
      : `Your most constrained relevant endpoint allows ${minLimit} req/window. ${maxRetries} retries balances resilience against burning through your quota.${scopeNote}`,

    max_api_capacity: (() => {
      if (operationDef && writeFactor === 0) {
        return `Import is read-only — bumped to ${maxApiCapacity}% since reads are cheaper against rate limits.${scopeNote}`;
      }
      if (hasWorkload && (totalResources >= HIGH_VOLUME_THRESHOLD || writeFactor >= 0.7)) {
        return `Set to ${maxApiCapacity}% for ${totalResources.toLocaleString()} resources with ${operationDef?.label.toLowerCase() ?? 'mixed'} operations.${writeFactor >= 0.7 ? ' Write-heavy operations consume more rate limit budget.' : ''} Leaves headroom for Admin Console and end-user traffic.`;
      }
      return `Set to ${maxApiCapacity}% to leave headroom for other API consumers (Admin Console, other integrations, end-user traffic).${scopeNote}`;
    })(),

    min_wait_seconds: `Based on your average reset window of ${Math.round(avgResetWindow)}s across relevant endpoints. Waiting ${minWaitSeconds}s before the first retry avoids wasted requests while the window is still active.`,

    max_wait_seconds: hasWorkload && totalResources >= VERY_HIGH_VOLUME_THRESHOLD
      ? `Your longest observed reset window is ${Math.round(maxResetWindow)}s. Extended to ${maxWaitSeconds}s because large resource volumes (${totalResources.toLocaleString()}) mean Terraform runs take longer — giving up too early wastes all prior work.`
      : `Your longest observed reset window is ${Math.round(maxResetWindow)}s. Capping backoff at ${maxWaitSeconds}s prevents Terraform from hanging too long on retries.`,

    request_timeout: (() => {
      if (maxApiCapacity < 100 && requestTimeout >= 90) {
        return `Set to ${requestTimeout}s because max_api_capacity=${maxApiCapacity}% causes the provider to queue requests when capacity is low. The timeout must exceed the queue wait time (up to ${Math.round(maxResetWindow)}s per rate limit window), otherwise queued requests get killed with "context deadline exceeded" errors.`;
      }
      if (requestTimeout > 30) {
        return `Increased to ${requestTimeout}s because ${totalResources.toLocaleString()} resources with ${operationDef?.label.toLowerCase() ?? ''} operations can produce slower API responses.${opNote}`;
      }
      return `30s catches stuck requests early. The default (0 = unlimited) risks Terraform hanging indefinitely on a single request.`;
    })(),

    parallelism: (() => {
      const effectiveLimit = Math.floor(minLimit * (maxApiCapacity / 100));
      if (parallelism === 1) {
        return `Set to 1 (sequential) because your effective rate limit is ${effectiveLimit} req/window — concurrent operations would quickly exhaust your quota.`;
      }
      if (operationDef && writeFactor === 0) {
        return `Bumped to ${parallelism} for import (read-only). Reads are cheaper against rate limits, and your effective limit of ${effectiveLimit} req/window supports concurrent reads.`;
      }
      return `Set to ${parallelism} based on your effective rate limit of ${effectiveLimit} req/window (${minLimit} × ${maxApiCapacity}%). ${writeFactor >= 0.7 ? 'Kept conservative due to write-heavy operations.' : 'Balances throughput against rate limit headroom.'}`;
    })(),
  };

  return {
    current: { ...TERRAFORM_DEFAULTS },
    recommended,
    explanations,
    runtimeEstimate,
  };
}

function estimateRuntime(
  totalResources: number,
  apiCallsPerResource: number,
  minRateLimit: number,
  maxApiCapacityPct: number,
  avgResetWindowSecs: number,
  writeFactor: number,
  resourceBreakdown: string,
  operationLabel: string,
  parallelism: number,
): RuntimeEstimate {
  // Total API calls needed
  const totalApiCalls = totalResources * apiCallsPerResource;

  // Effective requests per window (bottleneck endpoint)
  const effectiveRateLimit = Math.floor(minRateLimit * (maxApiCapacityPct / 100));

  // Real-world calibration from TF_LOG analysis:
  // - Not all API calls hit the bottleneck endpoint. Typically ~55-60% hit
  //   the lowest-limit bucket, rest go to higher-limit endpoints.
  // - With parallelism > 1 and capacity throttling, requests queue rather than 429.
  // - Backoff waits from 429s add ~10-15% overhead on top of pure window time.
  const bottleneckFraction = 0.6; // ~60% of calls hit the bottleneck bucket
  const callsOnBottleneck = Math.ceil(totalApiCalls * bottleneckFraction);

  // Windows needed for the bottleneck bucket
  const windowsForBottleneck = Math.ceil(callsOnBottleneck / effectiveRateLimit);

  // Base runtime: windows × reset period
  const baseMinutes = (windowsForBottleneck * avgResetWindowSecs) / 60;

  // Backoff overhead: if capacity < 100, provider queues (no 429s, just waits).
  // If capacity = 100, expect ~10-20% of requests to 429 and need backoff.
  const backoffOverheadPct = maxApiCapacityPct >= 100 ? 0.15 : 0.02;
  const realisticMinutes = baseMinutes * (1 + backoffOverheadPct);

  // Pure network time (lower bound): parallelism batches × time per resource
  const avgCallMs = 200 + (writeFactor * 300);
  const msPerResource = apiCallsPerResource * avgCallMs;
  const batches = Math.ceil(totalResources / parallelism);
  const networkMinutes = (batches * msPerResource) / 60000;

  const minMinutes = Math.max(0.5, Math.ceil(Math.max(networkMinutes, baseMinutes * 0.8) * 10) / 10);
  const maxMinutes = Math.max(minMinutes + 1, Math.ceil(realisticMinutes * 10) / 10);

  const explanation = `Estimated for ${operationLabel.toLowerCase()} on ${totalResources.toLocaleString()} managed resources (${resourceBreakdown}). ` +
    `~${totalApiCalls.toLocaleString()} API calls, ~${callsOnBottleneck.toLocaleString()} hitting bottleneck (${effectiveRateLimit} eff. req/window). ` +
    `~${windowsForBottleneck} rate limit windows of ~${Math.round(avgResetWindowSecs)}s, parallelism=${parallelism}.`;

  return { minMinutes, maxMinutes, explanation };
}

/**
 * Estimate runtime using custom workload entries with specific endpoint rate limits.
 * Each entry knows exactly which rate limit bucket it hits and how many resources.
 * This produces much more accurate estimates than the generic model.
 */
function estimateCustomRuntime(
  customWorkloads: CustomWorkloadEntry[],
  apiCallsPerResource: number,
  maxApiCapacityPct: number,
  probeResult: ProbeResult,
  writeFactor: number,
  operationLabel: string,
  parallelism: number,
): RuntimeEstimate {
  // For sub-resources (custom workloads), the per-resource API call count is lower
  // than the generic estimate. Calibrated from real TF_LOG data:
  // - Import/plan: ~1.15 calls per resource (1 read + occasional refresh)
  // - Create: ~2 calls (create + read-back)
  // - Update: ~2.5 calls (read + update + read-back)
  // - Full lifecycle: ~3 calls
  const customCallsPerResource =
    writeFactor === 0 ? 1.15 :      // import
    writeFactor <= 0.5 ? 2.5 :      // update
    writeFactor <= 0.8 ? 2 :        // create
    3;                               // full lifecycle

  // Group workloads by their rate limit endpoint bucket
  const buckets = new Map<string, { totalCount: number; rateLimit: number; label: string }>();
  for (const w of customWorkloads) {
    const key = w.primaryEndpoint;
    const existing = buckets.get(key);
    if (existing) {
      existing.totalCount += w.count;
    } else {
      buckets.set(key, { totalCount: w.count, rateLimit: w.rateLimit || 100, label: w.endpointLabel });
    }
  }

  // For each bucket, calculate the time to process all resources
  // Use the RAW rate limit (not capacity-adjusted) for base estimate.
  // Capacity throttling adds preemptive waits but doesn't reduce total throughput
  // as much as the naive calculation suggests — it just smooths out the traffic.
  let longestBucketMinutes = 0;
  let totalResources = 0;
  let totalApiCalls = 0;
  const bucketDetails: string[] = [];

  for (const [, bucket] of buckets) {
    totalResources += bucket.totalCount;
    const calls = Math.ceil(bucket.totalCount * customCallsPerResource);
    totalApiCalls += calls;

    // Look up the specific endpoint's reset window from probe data
    const probedEndpoint = probeResult.endpoints.find(ep =>
      ep.label === bucket.label && ep.resetWindowSecs > 0
    );
    const resetWindowSecs = probedEndpoint?.resetWindowSecs ?? 60;

    // Throughput: with capacity throttling, provider paces itself to avoid 429s.
    // Real-world testing shows ~90% of raw rate limit throughput with throttling,
    // ~85% without (429 retries eat into throughput).
    const throughputFactor = maxApiCapacityPct >= 100 ? 0.85 : 0.9;
    const effectiveThroughput = Math.floor(bucket.rateLimit * throughputFactor);
    const windows = Math.ceil(calls / Math.max(1, effectiveThroughput));
    const bucketMinutes = (windows * resetWindowSecs) / 60;

    if (bucketMinutes > longestBucketMinutes) longestBucketMinutes = bucketMinutes;
    bucketDetails.push(`${bucket.totalCount.toLocaleString()} → ${bucket.label} (${bucket.rateLimit}/win, ~${calls} calls, ~${windows} windows, ${resetWindowSecs}s reset)`);
  }

  // Backoff overhead: with capacity throttling, almost none (no 429s).
  // Without it, 429 retries add significant time.
  const backoffPct = maxApiCapacityPct < 100 ? 0.02 : 0.12;
  const realisticMinutes = longestBucketMinutes * (1 + backoffPct);

  // Network lower bound
  const avgCallMs = 150 + (writeFactor * 250);
  const msPerResource = customCallsPerResource * avgCallMs;
  const batches = Math.ceil(totalResources / parallelism);
  const networkMinutes = (batches * msPerResource) / 60000;

  const minMinutes = Math.max(0.5, Math.ceil(Math.max(networkMinutes, longestBucketMinutes * 0.85) * 10) / 10);
  const maxMinutes = Math.max(minMinutes + 1, Math.ceil(realisticMinutes * 10) / 10);

  const explanation = `Estimated for ${operationLabel.toLowerCase()} on ${totalResources.toLocaleString()} resources. ` +
    bucketDetails.join('. ') + `. ` +
    `~${totalApiCalls.toLocaleString()} API calls, parallelism=${parallelism}.`;

  return { minMinutes, maxMinutes, explanation };
}
