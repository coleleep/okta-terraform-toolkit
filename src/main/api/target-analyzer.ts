import {
  ProbeResult, ResourceWorkload, TargetRuntimeAnalysis,
  EndpointBottleneck, TerraformProviderConfig, RuntimeEstimate,
  LimitCoverage, LimitSource,
} from '../../shared/types';
import { RESOURCE_TYPES, OPERATIONS } from '../../shared/constants';

/** A limit only counts if it was actually resolved — never substitute a default. */
function resolveLimit(
  probeResult: ProbeResult,
  label: string,
): { limit: number; source: LimitSource; method: 'GET' | 'POST' } | null {
  const match = probeResult.endpoints.find(ep =>
    ep.label === label && ep.status !== 'error' && ep.status !== 'skipped' && ep.limit > 0
  );
  return match ? { limit: match.limit, source: match.source, method: match.method } : null;
}

function buildCoverage(probeResult: ProbeResult, labels: string[]): LimitCoverage {
  const relevant = [...new Set(labels)];
  let measured = 0;
  let estimated = 0;
  const missingLabels: string[] = [];

  for (const label of relevant) {
    const resolved = resolveLimit(probeResult, label);
    if (!resolved) missingLabels.push(label);
    else if (resolved.source === 'baseline') estimated++;
    else measured++;
  }

  return { relevant: relevant.length, measured, estimated, missingLabels };
}

/** Appended to every summary so an optimistic verdict can never read as a measured one. */
function coverageNote(coverage: LimitCoverage): string {
  if (coverage.missingLabels.length === 0 && coverage.estimated === 0) return '';

  const parts: string[] = [];
  if (coverage.missingLabels.length > 0) {
    parts.push(
      `${coverage.missingLabels.length} of ${coverage.relevant} buckets have no limit data ` +
      `(${coverage.missingLabels.join(', ')}) — the bottleneck may be understated.`
    );
  }
  if (coverage.estimated > 0) {
    parts.push(
      `${coverage.estimated} bucket${coverage.estimated > 1 ? 's' : ''} used a published default ` +
      `rather than a measured limit.`
    );
  }
  return ` ${parts.join(' ')}`;
}

/**
 * Analyze whether a target runtime is achievable with current rate limits.
 * Uses the runtime estimate from the recommendation when available.
 * Handles both grid-selected resources and custom workloads.
 */
export function analyzeTargetRuntime(
  probeResult: ProbeResult,
  workload: ResourceWorkload,
  targetMinutes: number,
  recommendedConfig?: TerraformProviderConfig,
  runtimeEstimate?: RuntimeEstimate
): TargetRuntimeAnalysis {
  const operationDef = OPERATIONS.find(o => o.type === workload.operation) ?? OPERATIONS[0];
  const writeFactor = operationDef.writeFactor;
  const hasCustom = workload.customWorkloads.length > 0;

  // --- Determine the estimated runtime ---
  // Use the runtime estimate from the recommendation if available (ensures consistency)
  let estimatedMinutes: number;
  if (runtimeEstimate) {
    estimatedMinutes = (runtimeEstimate.minMinutes + runtimeEstimate.maxMinutes) / 2;
  } else {
    // Fallback: calculate from custom workloads or generic model
    estimatedMinutes = calculateEstimate(probeResult, workload, operationDef, recommendedConfig);
  }

  // --- Find the bottleneck endpoint and its rate limit ---
  let bottleneckLimit = 0;
  let bottleneckLabel = '';
  let bottleneckMethod: 'GET' | 'POST' = 'GET';
  let bottleneckEndpoint = '';
  let totalApiCalls = 0;

  if (hasCustom) {
    // Custom workloads know their exact endpoint
    const callsPerResource = writeFactor === 0 ? 1.15 : writeFactor <= 0.5 ? 2.5 : writeFactor <= 0.8 ? 2 : 3;
    for (const cw of workload.customWorkloads) {
      totalApiCalls += Math.ceil(cw.count * callsPerResource);
      // No fallback limit. A bucket with no data is reported as missing coverage
      // rather than silently analysed as 100 — an invented limit produces an
      // invented bottleneck, and that figure reaches an increase request.
      const resolved = resolveLimit(probeResult, cw.endpointLabel);
      if (!resolved) continue;
      if (bottleneckLimit === 0 || resolved.limit < bottleneckLimit) {
        bottleneckLimit = resolved.limit;
        bottleneckLabel = cw.endpointLabel;
        bottleneckEndpoint = cw.primaryEndpoint;
        bottleneckMethod = resolved.method;
      }
    }
  } else {
    // Grid resources — generic model
    const apiCallsPerResource = operationDef.apiCallsPerResource;
    totalApiCalls = workload.totalResources * apiCallsPerResource;

    const relevantLabels = new Set<string>();
    for (const type of workload.selected) {
      const def = RESOURCE_TYPES.find(r => r.type === type);
      if (def) relevantLabels.add(def.probeLabel);
    }
    relevantLabels.add('Org Settings');

    const relevant = probeResult.endpoints.filter(e =>
      e.status !== 'error' && e.status !== 'skipped' && e.limit > 0 &&
      relevantLabels.has(e.label.replace(/ \(.*\)/, '').replace(/ Create \(write\)/, ''))
    );

    for (const ep of relevant) {
      if (bottleneckLimit === 0 || ep.limit < bottleneckLimit) {
        bottleneckLimit = ep.limit;
        bottleneckLabel = ep.label;
        bottleneckEndpoint = ep.endpoint;
        bottleneckMethod = ep.method;
      }
    }
  }

  const relevantLabelsForCoverage = hasCustom
    ? workload.customWorkloads.map(cw => cw.endpointLabel)
    : workload.selected
        .map(type => RESOURCE_TYPES.find(r => r.type === type)?.probeLabel)
        .filter((l): l is string => !!l);
  const coverage = buildCoverage(probeResult, relevantLabelsForCoverage);

  if (bottleneckLimit === 0) {
    return {
      targetMinutes,
      achievable: false,
      // Was Infinity, which serialises to null over IPC and rendered as a
      // nonsense runtime. Zero with achievable: false and an explicit summary
      // is honest and displayable.
      estimatedMinutes: 0,
      requiredThroughput: 0,
      currentThroughput: 0,
      bottlenecks: [],
      coverage,
      summary: 'No rate limit data available for the selected resources.' + coverageNote(coverage),
    };
  }

  const capacityPct = recommendedConfig ? recommendedConfig.max_api_capacity / 100 : 0.8;
  const currentCallsPerMin = bottleneckLimit * (hasCustom ? 0.9 : capacityPct);
  const requiredCallsPerMin = totalApiCalls / targetMinutes;
  const achievable = estimatedMinutes <= targetMinutes;

  // --- Bottleneck analysis ---
  const requiredLimitForTarget = Math.ceil((totalApiCalls / targetMinutes) / (hasCustom ? 0.9 : capacityPct));
  const bottlenecks: EndpointBottleneck[] = [];

  if (bottleneckLimit < requiredLimitForTarget) {
    bottlenecks.push({
      endpoint: bottleneckEndpoint,
      label: bottleneckLabel,
      method: bottleneckMethod,
      currentLimit: bottleneckLimit,
      requiredLimit: requiredLimitForTarget,
      increaseNeeded: requiredLimitForTarget - bottleneckLimit,
      percentIncrease: Math.round(((requiredLimitForTarget - bottleneckLimit) / bottleneckLimit) * 100),
    });
  }

  // --- Suggested config if increases are granted ---
  let suggestedConfig: TerraformProviderConfig | undefined;
  if (!achievable && bottlenecks.length > 0) {
    const newLimit = requiredLimitForTarget;
    let par = 1;
    if (newLimit >= 300) par = 5;
    else if (newLimit >= 100) par = 3;
    else if (newLimit >= 50) par = 2;
    if (writeFactor === 0) par = Math.min(par + 2, 10);

    suggestedConfig = {
      backoff: true,
      max_retries: newLimit >= 600 ? 5 : newLimit >= 100 ? 3 : 2,
      max_api_capacity: 80,
      min_wait_seconds: 15,
      max_wait_seconds: 120,
      request_timeout: 120,
      parallelism: par,
    };
  }

  // --- Summary ---
  let summary: string;
  if (achievable) {
    summary = `Target of ${targetMinutes} min is achievable. ` +
      `Estimated runtime: ~${Math.round(estimatedMinutes)} min for ~${totalApiCalls.toLocaleString()} API calls ` +
      `against ${bottleneckLabel} (${bottleneckLimit} req/window).` + coverageNote(coverage);
  } else {
    summary = `Target of ${targetMinutes} min requires a rate limit increase. ` +
      `Estimated runtime: ~${Math.round(estimatedMinutes)} min. ` +
      `Bottleneck: ${bottleneckLabel} needs ${requiredLimitForTarget} req/window ` +
      `(currently ${bottleneckLimit}, +${bottlenecks[0]?.percentIncrease ?? 0}%).` + coverageNote(coverage);
  }

  return {
    targetMinutes,
    achievable,
    estimatedMinutes: Math.round(estimatedMinutes * 10) / 10,
    requiredThroughput: Math.round(requiredCallsPerMin),
    currentThroughput: Math.round(currentCallsPerMin),
    bottlenecks,
    coverage,
    recommendedConfig: suggestedConfig,
    summary,
  };
}

function calculateEstimate(
  probeResult: ProbeResult,
  workload: ResourceWorkload,
  operationDef: { apiCallsPerResource: number; writeFactor: number },
  recommendedConfig?: TerraformProviderConfig,
): number {
  const hasCustom = workload.customWorkloads.length > 0;
  const writeFactor = operationDef.writeFactor;

  if (hasCustom) {
    const callsPerResource = writeFactor === 0 ? 1.15 : writeFactor <= 0.5 ? 2.5 : writeFactor <= 0.8 ? 2 : 3;
    let longestBucket = 0;

    for (const cw of workload.customWorkloads) {
      const calls = Math.ceil(cw.count * callsPerResource);
      // Skip rather than assume. `|| 100` also swallowed a legitimate cached 0.
      const resolved = resolveLimit(probeResult, cw.endpointLabel);
      if (!resolved) continue;
      const throughput = resolved.limit * 0.9;
      const windows = Math.ceil(calls / throughput);
      // Use probed reset window or default 60s
      const resetWindow = probeResult.endpoints.find(ep =>
        ep.label === cw.endpointLabel && ep.resetWindowSecs > 0
      )?.resetWindowSecs ?? 60;
      const minutes = (windows * resetWindow) / 60;
      if (minutes > longestBucket) longestBucket = minutes;
    }

    return longestBucket * 1.02; // 2% overhead
  }

  // Generic model for grid resources
  const limits = probeResult.endpoints
    .filter(e => e.status !== 'error' && e.status !== 'skipped' && e.limit > 0)
    .map(e => e.limit);
  // Math.min() of an empty list is Infinity, which propagated into the estimate
  // as a real number and rendered as a nonsense runtime.
  if (limits.length === 0) return 0;
  const minLimit = Math.min(...limits);
  const capacityPct = recommendedConfig ? recommendedConfig.max_api_capacity / 100 : 0.8;
  const effectiveLimit = minLimit * capacityPct;
  const totalCalls = workload.totalResources * operationDef.apiCallsPerResource * 0.6;
  const windows = Math.ceil(totalCalls / effectiveLimit);
  return (windows * 60) / 60;
}
