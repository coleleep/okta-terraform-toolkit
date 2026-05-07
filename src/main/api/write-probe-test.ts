import { getClient } from './auth';
import { PROBE_TIMEOUT_MS } from '../../shared/constants';

/**
 * Quick test: POST empty body to /api/v1/users to see if Okta returns
 * rate limit headers on the expected 400 response.
 */
export async function testWriteProbe(): Promise<{
  httpStatus: number | undefined;
  rateLimitHeaders: Record<string, string>;
  responseBody: unknown;
  hasRateLimits: boolean;
}> {
  const client = getClient();

  try {
    const response = await client.post('/api/v1/users', {}, { timeout: PROBE_TIMEOUT_MS });
    // Shouldn't succeed with empty body, but capture headers anyway
    return {
      httpStatus: response.status,
      rateLimitHeaders: {
        'x-rate-limit-limit': response.headers['x-rate-limit-limit'] || 'N/A',
        'x-rate-limit-remaining': response.headers['x-rate-limit-remaining'] || 'N/A',
        'x-rate-limit-reset': response.headers['x-rate-limit-reset'] || 'N/A',
        'x-okta-request-id': response.headers['x-okta-request-id'] || 'N/A',
      },
      responseBody: response.data,
      hasRateLimits: !!response.headers['x-rate-limit-limit'],
    };
  } catch (err: unknown) {
    const axiosErr = err as { response?: { headers?: Record<string, string>; status?: number; data?: unknown } };
    const headers = axiosErr.response?.headers || {};

    const result = {
      httpStatus: axiosErr.response?.status,
      rateLimitHeaders: {
        'x-rate-limit-limit': headers['x-rate-limit-limit'] || 'N/A',
        'x-rate-limit-remaining': headers['x-rate-limit-remaining'] || 'N/A',
        'x-rate-limit-reset': headers['x-rate-limit-reset'] || 'N/A',
        'x-okta-request-id': headers['x-okta-request-id'] || 'N/A',
      },
      responseBody: axiosErr.response?.data,
      hasRateLimits: !!headers['x-rate-limit-limit'],
    };

    console.log('[write-probe-test] POST /api/v1/users with empty body:');
    console.log(`[write-probe-test]   HTTP Status: ${result.httpStatus}`);
    console.log(`[write-probe-test]   x-rate-limit-limit: ${result.rateLimitHeaders['x-rate-limit-limit']}`);
    console.log(`[write-probe-test]   x-rate-limit-remaining: ${result.rateLimitHeaders['x-rate-limit-remaining']}`);
    console.log(`[write-probe-test]   x-rate-limit-reset: ${result.rateLimitHeaders['x-rate-limit-reset']}`);
    console.log(`[write-probe-test]   x-okta-request-id: ${result.rateLimitHeaders['x-okta-request-id']}`);
    console.log(`[write-probe-test]   Has rate limits: ${result.hasRateLimits}`);
    console.log(`[write-probe-test]   Response: ${JSON.stringify(result.responseBody)}`);

    return result;
  }
}
