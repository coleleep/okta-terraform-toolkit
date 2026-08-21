import { analyzeTargetRuntime } from '../main/api/target-analyzer';
import {
  EndpointProbeResult, LimitSource, ProbeResult, ResourceWorkload,
  DEFAULT_PREVENTION_OPTIONS,
} from '../shared/types';

function ep(
  label: string,
  limit: number,
  source: LimitSource = 'manual',
  method: 'GET' | 'POST' = 'GET',
): EndpointProbeResult {
  return {
    endpoint: `/api/v1/${label.toLowerCase().replace(/\s+/g, '')}`,
    label,
    method,
    limit,
    resetWindowSecs: 60,
    status: 'unknown',
    source,
  };
}

function probe(endpoints: EndpointProbeResult[]): ProbeResult {
  const withLimits = endpoints.filter(e => e.limit > 0);
  return {
    orgUrl: 'Manual entry',
    timestamp: '2026-08-21T00:00:00.000Z',
    endpoints,
    overallMinLimit: withLimits.length > 0 ? Math.min(...withLimits.map(e => e.limit)) : 0,
    probeDurationMs: 0,
    sources: [...new Set(endpoints.map(e => e.source))],
  };
}

function customWorkload(
  entries: Array<{ resource: string; count: number; label: string; rateLimit?: number }>,
): ResourceWorkload {
  return {
    selected: [],
    counts: [],
    totalResources: entries.reduce((s, e) => s + e.count, 0),
    orgTotalResources: 0,
    operation: 'import',
    preventionOptions: { ...DEFAULT_PREVENTION_OPTIONS },
    customWorkloads: entries.map(e => ({
      terraformResource: e.resource,
      count: e.count,
      primaryEndpoint: `/api/v1/${e.label.toLowerCase()}`,
      endpointLabel: e.label,
      rateLimit: e.rateLimit ?? 0,
    })),
  };
}

describe('analyzeTargetRuntime coverage', () => {
  it('counts every bucket the workload touches as relevant', () => {
    const result = analyzeTargetRuntime(
      probe([ep('Users', 600), ep('Applications', 100)]),
      customWorkload([
        { resource: 'okta_user', count: 1000, label: 'Users' },
        { resource: 'okta_app_saml', count: 50, label: 'Applications' },
      ]),
      30,
    );

    expect(result.coverage.relevant).toBe(2);
    expect(result.coverage.measured).toBe(2);
    expect(result.coverage.missingLabels).toEqual([]);
  });

  it('reports a bucket with no limit data as missing rather than assuming 100', () => {
    const result = analyzeTargetRuntime(
      probe([ep('Users', 600)]),
      customWorkload([
        { resource: 'okta_user', count: 1000, label: 'Users' },
        { resource: 'okta_app_saml', count: 50, label: 'Applications' },
      ]),
      30,
    );

    expect(result.coverage.relevant).toBe(2);
    expect(result.coverage.measured).toBe(1);
    expect(result.coverage.missingLabels).toEqual(['Applications']);
    // 100 must not appear as a bottleneck limit — it was never measured
    expect(result.bottlenecks.every(b => b.currentLimit !== 100)).toBe(true);
  });

  it('counts a baseline-sourced limit as estimated, not measured', () => {
    const result = analyzeTargetRuntime(
      probe([ep('Users', 600, 'manual'), ep('Applications', 100, 'baseline')]),
      customWorkload([
        { resource: 'okta_user', count: 1000, label: 'Users' },
        { resource: 'okta_app_saml', count: 50, label: 'Applications' },
      ]),
      30,
    );

    expect(result.coverage.measured).toBe(1);
    expect(result.coverage.estimated).toBe(1);
  });

  it('says so in the summary when coverage is incomplete', () => {
    const result = analyzeTargetRuntime(
      probe([ep('Users', 600)]),
      customWorkload([
        { resource: 'okta_user', count: 1000, label: 'Users' },
        { resource: 'okta_app_saml', count: 50, label: 'Applications' },
      ]),
      30,
    );

    expect(result.summary).toContain('Applications');
    expect(result.summary.toLowerCase()).toContain('no limit data');
  });

  it('warns that an achievable verdict is provisional when data is missing', () => {
    const result = analyzeTargetRuntime(
      probe([ep('Users', 600)]),
      customWorkload([
        { resource: 'okta_user', count: 10, label: 'Users' },
        { resource: 'okta_app_saml', count: 5, label: 'Applications' },
      ]),
      600, // generous target, certainly achievable on what is known
    );

    expect(result.achievable).toBe(true);
    expect(result.summary.toLowerCase()).toContain('understated');
  });

  it('returns the no-data path instead of Infinity when nothing has a limit', () => {
    const result = analyzeTargetRuntime(
      probe([ep('Users', 0)]),
      customWorkload([{ resource: 'okta_user', count: 1000, label: 'Users' }]),
      30,
    );

    expect(result.achievable).toBe(false);
    expect(Number.isFinite(result.estimatedMinutes)).toBe(true);
    expect(result.coverage.measured).toBe(0);
    expect(result.coverage.missingLabels).toEqual(['Users']);
    expect(result.bottlenecks).toEqual([]);
  });

  it('does not treat a cached rateLimit of 0 as a real limit', () => {
    const result = analyzeTargetRuntime(
      probe([]),
      customWorkload([{ resource: 'okta_user', count: 1000, label: 'Users', rateLimit: 0 }]),
      30,
    );

    expect(result.coverage.measured).toBe(0);
    expect(result.coverage.missingLabels).toEqual(['Users']);
  });
});
