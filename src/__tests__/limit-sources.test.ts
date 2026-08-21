import { mergeLimitSources, hasLiveCapacity, sourceLabel, clearedLimitState } from '../shared/limit-sources';
import { EndpointProbeResult, LimitSource } from '../shared/types';

function ep(
  label: string,
  limit: number,
  source: LimitSource,
  method: 'GET' | 'POST' = 'GET',
): EndpointProbeResult {
  return {
    endpoint: `/api/v1/${label.toLowerCase()}`,
    label,
    method,
    limit,
    resetWindowSecs: 60,
    status: 'unknown',
    source,
  };
}

describe('mergeLimitSources', () => {
  it('prefers manual over every other source', () => {
    const result = mergeLimitSources({
      baseline: [ep('Users', 100, 'baseline')],
      log: [ep('Users', 200, 'log')],
      probe: [ep('Users', 300, 'probe')],
      manual: [ep('Users', 400, 'manual')],
    }, 'Manual entry');

    expect(result.endpoints).toHaveLength(1);
    expect(result.endpoints[0].limit).toBe(400);
    expect(result.endpoints[0].source).toBe('manual');
  });

  it('prefers probe over log and baseline', () => {
    const result = mergeLimitSources({
      baseline: [ep('Users', 100, 'baseline')],
      log: [ep('Users', 200, 'log')],
      probe: [ep('Users', 300, 'probe')],
    }, 'acme.okta.com');

    expect(result.endpoints[0].limit).toBe(300);
    expect(result.endpoints[0].source).toBe('probe');
  });

  it('prefers log over baseline', () => {
    const result = mergeLimitSources({
      baseline: [ep('Users', 100, 'baseline')],
      log: [ep('Users', 200, 'log')],
    }, 'run.log');

    expect(result.endpoints[0].limit).toBe(200);
    expect(result.endpoints[0].source).toBe('log');
  });

  it('uses baseline only to fill keys no other source provided', () => {
    const result = mergeLimitSources({
      baseline: [ep('Users', 100, 'baseline'), ep('Apps', 50, 'baseline')],
      manual: [ep('Users', 400, 'manual')],
    }, 'Manual entry');

    expect(result.endpoints).toHaveLength(2);
    const users = result.endpoints.find(e => e.label === 'Users');
    const apps = result.endpoints.find(e => e.label === 'Apps');
    expect(users?.limit).toBe(400);
    expect(users?.source).toBe('manual');
    expect(apps?.limit).toBe(50);
    expect(apps?.source).toBe('baseline');
  });

  it('keys by label AND method so read and write buckets never collide', () => {
    const result = mergeLimitSources({
      manual: [ep('App Users', 600, 'manual', 'GET'), ep('App Users', 100, 'manual', 'POST')],
    }, 'Manual entry');

    expect(result.endpoints).toHaveLength(2);
    const get = result.endpoints.find(e => e.method === 'GET');
    const post = result.endpoints.find(e => e.method === 'POST');
    expect(get?.limit).toBe(600);
    expect(post?.limit).toBe(100);
  });

  it('reports which sources actually contributed, not which were offered', () => {
    const result = mergeLimitSources({
      baseline: [ep('Users', 100, 'baseline')],
      manual: [ep('Users', 400, 'manual')],
    }, 'Manual entry');

    // baseline was supplied but entirely overridden, so it contributed nothing
    expect(result.sources).toEqual(['manual']);
  });

  it('computes overallMinLimit across contributing entries, ignoring zero limits', () => {
    const result = mergeLimitSources({
      manual: [ep('Users', 600, 'manual'), ep('Apps', 100, 'manual'), ep('Groups', 0, 'manual')],
    }, 'Manual entry');

    expect(result.overallMinLimit).toBe(100);
  });

  it('returns an empty result rather than throwing when given nothing', () => {
    const result = mergeLimitSources({}, 'Manual entry');

    expect(result.endpoints).toEqual([]);
    expect(result.sources).toEqual([]);
    expect(result.overallMinLimit).toBe(0);
    expect(result.orgUrl).toBe('Manual entry');
  });
});

describe('hasLiveCapacity', () => {
  it('is false when remaining is absent, so status is never derived from a missing value', () => {
    expect(hasLiveCapacity(ep('Users', 600, 'manual'))).toBe(false);
    expect(hasLiveCapacity(ep('Users', 600, 'baseline'))).toBe(false);
  });

  it('is true when remaining is present, including a genuine zero', () => {
    expect(hasLiveCapacity({ ...ep('Users', 600, 'probe'), remaining: 599 })).toBe(true);
    // exhausted is real data, not missing data
    expect(hasLiveCapacity({ ...ep('Users', 600, 'probe'), remaining: 0 })).toBe(true);
  });
});

describe('sourceLabel', () => {
  it('labels every source, marking baseline as an estimate', () => {
    expect(sourceLabel('probe')).toBe('Probed');
    expect(sourceLabel('log')).toBe('Log');
    expect(sourceLabel('manual')).toBe('Manual');
    // must read as an estimate — this value can reach an increase justification
    expect(sourceLabel('baseline')).toBe('Default');
  });
});

describe('clearedLimitState', () => {
  it('resets every piece of state derived from rate limits', () => {
    const cleared = clearedLimitState();

    // Asserted key by key on purpose: if new derived state is added to the
    // store and not added here, this test fails instead of the stale value
    // silently surviving a clear and appearing under a different org's inputs.
    expect(cleared).toEqual({
      probeResult: null,
      baselineProbeResult: null,
      probeProgress: null,
      recommendation: null,
      targetAnalysis: null,
      targetMinutes: null,
      customWorkloads: [],
    });
  });
});
