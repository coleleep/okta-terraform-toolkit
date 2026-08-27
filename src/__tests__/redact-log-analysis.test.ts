import { redactLogAnalysis, redactLogText } from '../main/api/redact-vault';
import { LogAnalysis } from '../shared/types';

function baseAnalysis(): LogAnalysis {
  return {
    detectedConfig: { minWait: 30, maxWait: 300, maxRetries: 4 },
    startTime: '2026-01-01T00:00:00Z',
    endTime: '2026-01-01T00:10:00Z',
    durationSeconds: 600,
    totalRequests: 1234,
    successfulRequests: 1200,
    rateLimited: 30,
    errors: 4,
    deadlineExceeded: 0,
    rateLimitExhausted: 0,
    estimatedBackoffSeconds: 12,
    endpoints: [
      {
        pattern: '/api/v1/users/{id}',
        method: 'GET',
        label: 'User (single)',
        totalCalls: 500,
        rateLimited: 10,
        errors: 1,
        minRateLimit: 600,
        lowestRemaining: 5,
      },
    ],
    issues: [],
    errorsByStatus: { 403: 4 },
    errorDetails: [],
    terraformErrors: [],
  };
}

describe('redactLogAnalysis', () => {
  it('masks PII embedded in captured error details', () => {
    const analysis = baseAnalysis();
    analysis.errorDetails = [
      {
        endpoint: '/api/v1/users/00u1a2b3c4d5e6f7g8h9',
        label: 'User (single)',
        httpStatus: 403,
        message: 'user jane.doe@acme.com on https://acme.okta.com denied',
        count: 2,
      },
    ];

    const redacted = redactLogAnalysis(analysis);
    const blob = JSON.stringify(redacted);
    expect(blob).not.toContain('00u1a2b3c4d5e6f7g8h9');
    expect(blob).not.toContain('jane.doe@acme.com');
    expect(blob).not.toContain('acme.okta.com');
  });

  it('masks PII inside terraformErrors', () => {
    const analysis = baseAnalysis();
    analysis.terraformErrors = ['404 on oty1a2b3c4d5e6f7g8h9 for admin@acme.okta.com'];

    const blob = JSON.stringify(redactLogAnalysis(analysis));
    expect(blob).not.toContain('oty1a2b3c4d5e6f7g8h9');
    expect(blob).not.toContain('admin@acme.okta.com');
  });

  it('preserves numeric stats and endpoint patterns the analyzer depends on', () => {
    const analysis = baseAnalysis();
    const redacted = redactLogAnalysis(analysis);

    expect(redacted.totalRequests).toBe(1234);
    expect(redacted.rateLimited).toBe(30);
    expect(redacted.durationSeconds).toBe(600);
    expect(redacted.detectedConfig.maxRetries).toBe(4);
    // The endpoint pattern uses {id} (not a real Okta ID), so it must survive
    // untouched — logDerivedLimits keys rate limit buckets off it.
    expect(redacted.endpoints[0].pattern).toBe('/api/v1/users/{id}');
    expect(redacted.endpoints[0].label).toBe('User (single)');
    expect(redacted.endpoints[0].minRateLimit).toBe(600);
  });
});

describe('redactLogText (raw terraform-debug.log scrub)', () => {
  it('scrubs the API token from an Authorization header', () => {
    const raw =
      '2026/01/01 [DEBUG] GET https://acme.okta.com/api/v1/users\n' +
      'Authorization: SSWS 00abcdefghijklmnopqrstuvwxyz1234567890AB\n' +
      'user jane.doe@acme.com id 00u1a2b3c4d5e6f7g8h9';

    const scrubbed = redactLogText(raw);
    expect(scrubbed).not.toContain('00abcdefghijklmnopqrstuvwxyz1234567890AB');
    expect(scrubbed).not.toContain('jane.doe@acme.com');
    expect(scrubbed).not.toContain('acme.okta.com');
    expect(scrubbed).not.toContain('00u1a2b3c4d5e6f7g8h9');
    // Non-sensitive structure is preserved so the log stays useful for debugging.
    expect(scrubbed).toContain('[DEBUG] GET');
  });
});
