import {
  ProbeResult, ResourceWorkload, TargetRuntimeAnalysis,
  EndpointBottleneck, TerraformProviderConfig, RuntimeEstimate,
} from '../../shared/types';
import { RESOURCE_TYPES, OPERATIONS } from '../../shared/constants';

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
      // Find the probed rate limit for this endpoint
      const probed = probeResult.endpoints.find(ep =>
        ep.label === cw.endpointLabel && ep.status !== 'error' && ep.status !== 'skipped' && ep.limit > 0
      );
      const limit = probed?.limit ?? cw.rateLimit ?? 100;
      if (bottleneckLimit === 0 || limit < bottleneckLimit) {
        bottleneckLimit = limit;
        bottleneckLabel = cw.endpointLabel;
        bottleneckEndpoint = cw.primaryEndpoint;
        bottleneckMethod = probed?.method ?? 'GET';
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

  if (bottleneckLimit === 0) {
    return {
      targetMinutes,
      achievable: false,
      estimatedMinutes: Infinity,
      requiredThroughput: 0,
      currentThroughput: 0,
      bottlenecks: [],
      summary: 'No rate limit data available for selected resources.',
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
      `against ${bottleneckLabel} (${bottleneckLimit} req/window).`;
  } else {
    summary = `Target of ${targetMinutes} min requires a rate limit increase. ` +
      `Estimated runtime: ~${Math.round(estimatedMinutes)} min. ` +
      `Bottleneck: ${bottleneckLabel} needs ${requiredLimitForTarget} req/window ` +
      `(currently ${bottleneckLimit}, +${bottlenecks[0]?.percentIncrease ?? 0}%).`;
  }

  return {
    targetMinutes,
    achievable,
    estimatedMinutes: Math.round(estimatedMinutes * 10) / 10,
    requiredThroughput: Math.round(requiredCallsPerMin),
    currentThroughput: Math.round(currentCallsPerMin),
    bottlenecks,
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
      const limit = cw.rateLimit || 100;
      const throughput = limit * 0.9;
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
  const minLimit = Math.min(
    ...probeResult.endpoints
      .filter(e => e.status !== 'error' && e.status !== 'skipped' && e.limit > 0)
      .map(e => e.limit)
  );
  const capacityPct = recommendedConfig ? recommendedConfig.max_api_capacity / 100 : 0.8;
  const effectiveLimit = minLimit * capacityPct;
  const totalCalls = workload.totalResources * operationDef.apiCallsPerResource * 0.6;
  const windows = Math.ceil(totalCalls / effectiveLimit);
  return (windows * 60) / 60;
}
