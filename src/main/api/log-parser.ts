import { createReadStream } from 'fs';
import { createInterface } from 'readline';
import { LogAnalysis, LogEndpointStats, LogIssue, LogErrorDetail } from '../../shared/types';

// Okta ID pattern: segments of 20+ alphanumeric chars
const OKTA_ID_RE = /\/[0-9a-zA-Z]{18,}/g;

function normalizeEndpoint(url: string): string {
  // Extract path from full URL
  const match = url.match(/\/api\/v1\/.+/);
  if (!match) return url;
  let path = match[0];
  // Remove query params
  path = path.split('?')[0];
  // Replace Okta IDs with {id}
  path = path.replace(OKTA_ID_RE, '/{id}');
  return path;
}

function labelForPattern(pattern: string): string {
  if (pattern.includes('/apps/{id}/users/{id}')) return 'App User (single)';
  if (pattern.includes('/apps/{id}/users')) return 'App User Assignments';
  if (pattern.includes('/apps/{id}/groups/{id}')) return 'App Group (single)';
  if (pattern.includes('/apps/{id}/groups')) return 'App Group Assignments';
  if (pattern.includes('/apps/{id}')) return 'Application';
  if (pattern.includes('/users/{id}/groups')) return 'User Groups';
  if (pattern.includes('/users/{id}/roles')) return 'User Roles';
  if (pattern.includes('/users/{id}')) return 'User (single)';
  if (pattern.includes('/users/me')) return 'Current User';
  if (pattern.includes('/groups/{id}/users')) return 'Group Members';
  if (pattern.includes('/groups/{id}')) return 'Group (single)';
  if (pattern.includes('/authorizationServers/{id}')) return 'Auth Server';
  if (pattern.includes('/policies/{id}')) return 'Policy';
  if (pattern.includes('/zones/{id}')) return 'Network Zone';
  if (pattern.includes('/meta/schemas')) return 'Schema';
  if (pattern.includes('/meta/types')) return 'User Types';
  if (pattern.includes('/org')) return 'Org Settings';
  return pattern.replace('/api/v1/', '');
}

function extractTimestamp(line: string): string | null {
  const m = line.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2}))/);
  return m ? m[1] : null;
}

function timestampToMs(ts: string): number {
  return new Date(ts).getTime();
}

interface EndpointAccumulator {
  totalCalls: number;
  rateLimited: number;
  errors: number;
  rateLimits: number[];   // X-Rate-Limit-Limit values seen
  remainings: number[];   // X-Rate-Limit-Remaining values seen
  errorsByStatus: Record<number, number>;
}

export async function parseLogFile(filePath: string): Promise<LogAnalysis> {
  return new Promise((resolve, reject) => {
    const stream = createReadStream(filePath, { encoding: 'utf-8' });
    const rl = createInterface({ input: stream, crlfDelay: Infinity });

    // State
    let firstTimestamp: string | null = null;
    let lastTimestamp: string | null = null;
    let detectedConfig = { minWait: 0, maxWait: 0, maxRetries: 0, maxApiCapacity: undefined as number | undefined, parallelism: undefined as number | undefined };
    let configParsed = false;

    let totalRequests = 0;
    let successfulRequests = 0;
    let rateLimited = 0;
    let errorCount = 0;
    let deadlineExceeded = 0;
    let rateLimitExhausted = 0;

    const endpointMap = new Map<string, EndpointAccumulator>();
    let currentStatus: number | null = null;
    let currentEndpoint: string | null = null;
    let currentTimestamp: string | null = null;
    const terraformErrors: string[] = [];

    // Error tracking
    const errorsByStatus: Record<number, number> = {};
    const errorDetailMap = new Map<string, LogErrorDetail>(); // keyed by "endpoint|status|errorCode"

    // For backoff estimation: track 429 timestamps and next success per endpoint
    let last429Timestamp: number | null = null;
    let totalBackoffMs = 0;

    // For parallelism detection: track concurrent requests
    let maxConcurrent = 0;
    let pendingRequests = 0;
    const requestTimestamps: number[] = [];

    rl.on('line', (line) => {
      const ts = extractTimestamp(line);
      if (ts) {
        if (!firstTimestamp) firstTimestamp = ts;
        lastTimestamp = ts;
        currentTimestamp = ts;
      }

      // Config detection
      if (!configParsed && line.includes('running with backoff http client')) {
        const waitMin = line.match(/wait min (\d+)/);
        const waitMax = line.match(/wait max (\d+)/);
        const retryMax = line.match(/retry max (\d+)/);
        if (waitMin) detectedConfig.minWait = Math.round(parseInt(waitMin[1]) / 1e9);
        if (waitMax) detectedConfig.maxWait = Math.round(parseInt(waitMax[1]) / 1e9);
        if (retryMax) detectedConfig.maxRetries = parseInt(retryMax[1]);
        configParsed = true;
      }

      // max_api_capacity detection
      if (!detectedConfig.maxApiCapacity && line.includes('max_api_capacity configuration at')) {
        const capMatch = line.match(/max_api_capacity configuration at (\d+)%/);
        if (capMatch) detectedConfig.maxApiCapacity = parseInt(capMatch[1]);
      }

      // Request tracking
      if (line.includes('performing request:')) {
        const urlMatch = line.match(/url=(https?:\/\/[^\s]+)/);
        if (urlMatch) {
          totalRequests++;
          currentEndpoint = normalizeEndpoint(urlMatch[1]);

          // Parallelism tracking
          pendingRequests++;
          if (pendingRequests > maxConcurrent) maxConcurrent = pendingRequests;

          const acc = endpointMap.get(currentEndpoint) || { totalCalls: 0, rateLimited: 0, errors: 0, rateLimits: [], remainings: [], errorsByStatus: {} };
          acc.totalCalls++;
          endpointMap.set(currentEndpoint, acc);
        }
      }

      // HTTP response
      if (line.includes('HTTP/2.0 ') || line.includes('HTTP/1.1 ')) {
        const statusMatch = line.match(/HTTP\/[\d.]+ (\d{3})/);
        if (statusMatch) {
          currentStatus = parseInt(statusMatch[1]);
          pendingRequests = Math.max(0, pendingRequests - 1);

          if (currentStatus === 429) {
            rateLimited++;
            if (currentEndpoint) {
              const acc = endpointMap.get(currentEndpoint);
              if (acc) acc.rateLimited++;
            }
            if (ts) last429Timestamp = timestampToMs(ts);
          } else if (currentStatus >= 200 && currentStatus < 300) {
            successfulRequests++;
            // Backoff estimation: if we had a recent 429, the gap is backoff time
            if (last429Timestamp && ts) {
              const now = timestampToMs(ts);
              const gap = now - last429Timestamp;
              if (gap > 1000 && gap < 600000) { // 1s-10min reasonable backoff
                totalBackoffMs += gap;
              }
              last429Timestamp = null;
            }
          } else if (currentStatus >= 400) {
            errorCount++;
            errorsByStatus[currentStatus] = (errorsByStatus[currentStatus] || 0) + 1;
            if (currentEndpoint) {
              const acc = endpointMap.get(currentEndpoint);
              if (acc) {
                acc.errors++;
                acc.errorsByStatus[currentStatus] = (acc.errorsByStatus[currentStatus] || 0) + 1;
              }
              // Track error detail (will be enriched with error code if found)
              const detailKey = `${currentEndpoint}|${currentStatus}`;
              const existing = errorDetailMap.get(detailKey);
              if (existing) {
                existing.count++;
              } else {
                errorDetailMap.set(detailKey, {
                  timestamp: currentTimestamp ?? undefined,
                  endpoint: currentEndpoint,
                  label: labelForPattern(currentEndpoint),
                  httpStatus: currentStatus,
                  count: 1,
                });
              }
            }
          }
        }
      }

      // Rate limit headers
      if (line.includes('X-Rate-Limit-Limit:')) {
        const val = parseInt(line.split(':').pop()?.trim() || '0');
        if (currentEndpoint && val > 0) {
          const acc = endpointMap.get(currentEndpoint);
          if (acc) acc.rateLimits.push(val);
        }
      }
      if (line.includes('X-Rate-Limit-Remaining:')) {
        const val = parseInt(line.split(':').pop()?.trim() || '-1');
        if (val === 0) rateLimitExhausted++;
        if (currentEndpoint && val >= 0) {
          const acc = endpointMap.get(currentEndpoint);
          if (acc) acc.remainings.push(val);
        }
      }

      // Okta error codes in response body (e.g., "errorCode":"E0000011")
      const errorCodeMatch = line.match(/"errorCode"\s*:\s*"(E\d{7})"/);
      if (errorCodeMatch && currentEndpoint && currentStatus && currentStatus >= 400) {
        const detailKey = `${currentEndpoint}|${currentStatus}`;
        const detail = errorDetailMap.get(detailKey);
        if (detail && !detail.oktaErrorCode) {
          detail.oktaErrorCode = errorCodeMatch[1];
        }
      }

      // Okta error summary in response body
      const errorSummaryMatch = line.match(/"errorSummary"\s*:\s*"([^"]+)"/);
      if (errorSummaryMatch && currentEndpoint && currentStatus && currentStatus >= 400) {
        const detailKey = `${currentEndpoint}|${currentStatus}`;
        const detail = errorDetailMap.get(detailKey);
        if (detail && !detail.message) {
          detail.message = errorSummaryMatch[1];
        }
      }

      // Terraform provider errors (e.g., "Error: ...", "error creating okta_app_user")
      if (line.match(/\bError[:\s]/i) && !line.includes('X-Rate-Limit') && !line.includes('HTTP/')) {
        const providerErrorMatch = line.match(/Error:\s*(.+)/i) || line.match(/error\s+(creating|reading|updating|deleting|importing)\s+(\S+)/i);
        if (providerErrorMatch && currentEndpoint) {
          const detailKey = `${currentEndpoint}|${currentStatus || 0}`;
          const detail = errorDetailMap.get(detailKey);
          if (detail && !detail.message) {
            detail.message = providerErrorMatch[0].substring(0, 200);
          }
        }
      }

      // Terraform/provider-level errors (independent of HTTP context)
      if (line.includes('[ERROR]')) {
        const errorContent = line.replace(/^.*\[ERROR\]\s*/, '').trim();
        if (errorContent) terraformErrors.push(errorContent);
      } else if (!currentEndpoint && line.includes('Error:')) {
        const errMatch = line.match(/Error:\s*(.+)/);
        if (errMatch) terraformErrors.push(errMatch[1].trim());
      }

      // Deadline exceeded
      if (line.includes('context deadline exceeded')) {
        deadlineExceeded++;
      }
    });

    rl.on('close', () => {
      // Build endpoint stats
      const endpoints: LogEndpointStats[] = [];
      for (const [pattern, acc] of endpointMap) {
        endpoints.push({
          pattern,
          label: labelForPattern(pattern),
          totalCalls: acc.totalCalls,
          rateLimited: acc.rateLimited,
          errors: acc.errors,
          minRateLimit: acc.rateLimits.length > 0 ? Math.min(...acc.rateLimits) : 0,
          lowestRemaining: acc.remainings.length > 0 ? Math.min(...acc.remainings) : -1,
          errorsByStatus: Object.keys(acc.errorsByStatus).length > 0 ? acc.errorsByStatus : undefined,
        });
      }
      endpoints.sort((a, b) => b.totalCalls - a.totalCalls);

      // Build error details sorted by count
      const errorDetails = [...errorDetailMap.values()].sort((a, b) => b.count - a.count);

      // Infer parallelism
      detectedConfig.parallelism = maxConcurrent > 0 ? Math.min(maxConcurrent, 20) : undefined;

      // Calculate duration
      const durationSeconds = firstTimestamp && lastTimestamp
        ? Math.round((timestampToMs(lastTimestamp) - timestampToMs(firstTimestamp)) / 1000)
        : 0;

      // Detect issues
      const issues = detectIssues(
        detectedConfig, rateLimited, totalRequests, deadlineExceeded,
        rateLimitExhausted, Math.round(totalBackoffMs / 1000), endpoints,
        errorsByStatus, errorDetails, terraformErrors
      );

      resolve({
        detectedConfig,
        startTime: firstTimestamp || '',
        endTime: lastTimestamp || '',
        durationSeconds,
        totalRequests,
        successfulRequests,
        rateLimited,
        errors: errorCount,
        deadlineExceeded,
        rateLimitExhausted,
        estimatedBackoffSeconds: Math.round(totalBackoffMs / 1000),
        endpoints,
        issues,
        errorsByStatus,
        errorDetails,
        terraformErrors: terraformErrors.length > 0 ? terraformErrors : undefined,
      });
    });

    rl.on('error', reject);
    stream.on('error', reject);
  });
}

function detectIssues(
  config: LogAnalysis['detectedConfig'],
  rateLimited: number,
  totalRequests: number,
  deadlineExceeded: number,
  rateLimitExhausted: number,
  backoffSeconds: number,
  endpoints: LogEndpointStats[],
  errorsByStatus: Record<number, number>,
  errorDetails: LogErrorDetail[],
  terraformErrors: string[],
): LogIssue[] {
  const issues: LogIssue[] = [];

  // Terraform/provider-level errors (outside HTTP context)
  if (terraformErrors.length > 0) {
    const uniqueErrors = [...new Set(terraformErrors)];
    const isValidationFailure = uniqueErrors.some(e =>
      e.includes('Unsupported argument') || e.includes('Unsupported block') ||
      e.includes('Missing required argument') || e.includes('Invalid reference') ||
      e.includes('Unsupported attribute')
    );
    const severity = totalRequests === 0 ? 'critical' : 'warning';
    issues.push({
      severity,
      title: `${uniqueErrors.length} Terraform error${uniqueErrors.length > 1 ? 's' : ''} detected${isValidationFailure ? ' (validation failed)' : ''}`,
      detail: uniqueErrors.slice(0, 5).join('\n'),
      recommendation: isValidationFailure
        ? 'The configuration has schema errors — likely a provider version mismatch. Check that all resource arguments are supported in your installed provider version. Run "terraform providers" to verify.'
        : 'Review the errors above. These occurred at the Terraform/provider level, not at the Okta API level.',
    });
  }

  // Critical: deadline exceeded with capacity throttling
  if (deadlineExceeded > 0) {
    issues.push({
      severity: 'critical',
      title: `${deadlineExceeded} requests failed with "context deadline exceeded"`,
      detail: `The request_timeout is too low for the capacity throttling setting. When max_api_capacity < 100, the provider queues requests waiting for rate limit headroom. Queued requests are killed when the timeout expires.`,
      recommendation: `Increase request_timeout to at least 120 seconds, or remove max_api_capacity to disable throttling.`,
    });
  }

  // Critical: high 429 rate
  if (rateLimited > 0 && totalRequests > 0) {
    const pct = Math.round((rateLimited / totalRequests) * 100);
    if (pct > 10) {
      issues.push({
        severity: 'critical',
        title: `${rateLimited} requests (${pct}%) hit rate limits (429)`,
        detail: `${rateLimitExhausted} times the rate limit was fully exhausted. ~${backoffSeconds}s spent in backoff waits.`,
        recommendation: `Add max_api_capacity = 70 to proactively throttle before hitting limits. This eliminates 429s entirely. Also ensure request_timeout >= 120 when using capacity throttling.`,
      });
    } else {
      issues.push({
        severity: 'warning',
        title: `${rateLimited} requests (${pct}%) hit rate limits (429)`,
        detail: `Moderate rate limiting detected. ~${backoffSeconds}s spent in backoff waits.`,
        recommendation: `Consider adding max_api_capacity = 70 to smooth out traffic and avoid 429s.`,
      });
    }
  }

  // Warning: no capacity throttling and 429s present
  if (rateLimited > 0 && !config.maxApiCapacity) {
    issues.push({
      severity: 'warning',
      title: 'No capacity throttling detected',
      detail: `The provider is not using max_api_capacity, relying on 429 retries instead of proactive throttling.`,
      recommendation: `Add max_api_capacity = 70 with request_timeout = 120 for cleaner, faster runs.`,
    });
  }

  // Warning: max_wait too high
  if (config.maxWait > 120) {
    issues.push({
      severity: 'warning',
      title: `max_wait_seconds = ${config.maxWait}s is excessive`,
      detail: `With exponential backoff, later retries can wait up to ${config.maxWait}s per request. Testing shows 90s is sufficient.`,
      recommendation: `Set max_wait_seconds = 90.`,
    });
  }

  // Warning: min_wait too high with throttling
  if (config.minWait > 20 && config.maxApiCapacity && config.maxApiCapacity < 100) {
    issues.push({
      severity: 'warning',
      title: `min_wait_seconds = ${config.minWait}s may be too high with capacity throttling`,
      detail: `When max_api_capacity handles pacing, the first retry wait can be shorter.`,
      recommendation: `Set min_wait_seconds to ~17 (about 1/3 of the rate limit window).`,
    });
  }

  // Critical/Warning: Authentication errors (401)
  if (errorsByStatus[401] > 0) {
    const authErrors = errorDetails.filter(e => e.httpStatus === 401);
    const errorCodes = authErrors.map(e => e.oktaErrorCode).filter(Boolean);
    const hasE0000011 = errorCodes.includes('E0000011');
    const hasE0000015 = errorCodes.includes('E0000015');
    issues.push({
      severity: errorsByStatus[401] > 5 ? 'critical' : 'warning',
      title: `${errorsByStatus[401]} authentication errors (401)`,
      detail: hasE0000011
        ? 'Invalid token provided — the API token or OAuth token is expired, revoked, or malformed.'
        : hasE0000015
          ? 'Feature not enabled — one or more API endpoints require a feature or license not active on this org.'
          : `Authentication failures on: ${authErrors.map(e => e.label).join(', ')}.`,
      recommendation: hasE0000011
        ? 'Generate a new API token or refresh the OAuth client credentials. Verify the token has not expired.'
        : hasE0000015
          ? 'Check that the required Okta features/licenses are enabled for the endpoints that failed.'
          : 'Verify the API token is valid and has not expired. Check OAuth client credentials if using OAuth.',
    });
  }

  // Critical/Warning: Permission errors (403)
  if (errorsByStatus[403] > 0) {
    const permErrors = errorDetails.filter(e => e.httpStatus === 403);
    const affectedEndpoints = permErrors.map(e => `${e.label} (${e.count}x)`).join(', ');
    issues.push({
      severity: errorsByStatus[403] > 5 ? 'critical' : 'warning',
      title: `${errorsByStatus[403]} permission errors (403)`,
      detail: `Insufficient permissions on: ${affectedEndpoints}.${permErrors[0]?.oktaErrorCode ? ` Error code: ${permErrors[0].oktaErrorCode}` : ''}`,
      recommendation: 'The API token or OAuth app lacks required scopes/permissions. For OAuth, add the necessary scopes (e.g., okta.apps.manage, okta.users.manage). For API tokens, ensure the token owner has the required admin role (typically Super Admin).',
    });
  }

  // Warning: Not found errors (404)
  if (errorsByStatus[404] > 0) {
    const notFoundErrors = errorDetails.filter(e => e.httpStatus === 404);
    issues.push({
      severity: 'warning',
      title: `${errorsByStatus[404]} not-found errors (404)`,
      detail: `Resources not found on: ${notFoundErrors.map(e => `${e.label} (${e.count}x)`).join(', ')}.`,
      recommendation: 'Resources may have been deleted outside Terraform, or the resource IDs in state are stale. Run "terraform plan" to detect drift and "terraform state rm" for resources that no longer exist.',
    });
  }

  // Warning: Conflict errors (409)
  if (errorsByStatus[409] > 0) {
    const policyRuleEndpoints = endpoints.filter(e =>
      e.pattern.includes('/rules') || (e.pattern.includes('/policies') && !e.pattern.includes('/policies?'))
    );
    const policyRule409s = policyRuleEndpoints.reduce((sum, e) =>
      sum + (e.errorsByStatus?.[409] || 0), 0
    );

    if (policyRule409s > 0) {
      issues.push({
        severity: 'critical',
        title: `${policyRule409s} priority conflict(s) on policy rule endpoints`,
        detail: `The Okta API returned 409 Conflict when modifying policy rules concurrently. This happens when multiple rules under the same policy have their priority changed in parallel — the API shifts priorities automatically, causing conflicts and state drift.`,
        recommendation: `Add depends_on chains between all policy rules sharing the same parent policy, ordered by ascending priority. This serializes rule operations without reducing parallelism globally. Do NOT use parallelism=1 — depends_on chains are the correct fix.`,
      });
    }

    const nonPolicyRule409s = errorsByStatus[409] - policyRule409s;
    if (nonPolicyRule409s > 0) {
      issues.push({
        severity: 'warning',
        title: `${nonPolicyRule409s} conflict errors (409) on non-rule endpoints`,
        detail: 'Resource conflicts detected — typically means a resource already exists or was modified concurrently.',
        recommendation: 'If importing existing resources, use import blocks instead of creating. If running concurrent applies, reduce parallelism or use state locking.',
      });
    }
  }

  // Warning: Server errors (500+)
  const serverErrors = Object.entries(errorsByStatus).filter(([code]) => parseInt(code) >= 500).reduce((sum, [, count]) => sum + count, 0);
  if (serverErrors > 0) {
    issues.push({
      severity: serverErrors > 10 ? 'critical' : 'warning',
      title: `${serverErrors} server errors (5xx)`,
      detail: 'Okta API returned internal server errors. These are transient and typically resolve on retry.',
      recommendation: 'Ensure max_retries >= 5 so the provider retries automatically. If persistent, check status.okta.com for service issues.',
    });
  }

  // Warning: Bad request errors (400)
  if (errorsByStatus[400] > 0) {
    const badReqErrors = errorDetails.filter(e => e.httpStatus === 400);
    const messages = badReqErrors.filter(e => e.message).map(e => e.message!).slice(0, 3);
    issues.push({
      severity: 'warning',
      title: `${errorsByStatus[400]} validation errors (400)`,
      detail: `Invalid request data sent to Okta API.${messages.length > 0 ? ` Samples: ${messages.join('; ')}` : ''}`,
      recommendation: 'Check resource configuration for invalid values, missing required fields, or schema mismatches. This often indicates a provider version incompatibility or incorrect HCL.',
    });
  }

  // Info: clean run
  const totalNonRateLimitErrors = Object.entries(errorsByStatus).filter(([code]) => parseInt(code) !== 429).reduce((sum, [, count]) => sum + count, 0);
  if (rateLimited === 0 && deadlineExceeded === 0 && totalNonRateLimitErrors === 0 && terraformErrors.length === 0 && totalRequests > 0) {
    issues.push({
      severity: 'info',
      title: 'Clean run — no issues detected',
      detail: `${totalRequests} requests completed with zero errors.`,
      recommendation: 'Current config is working well for this workload.',
    });
  }

  // Info: busiest endpoint
  if (endpoints.length > 0) {
    const busiest = endpoints[0];
    issues.push({
      severity: 'info',
      title: `Busiest endpoint: ${busiest.label}`,
      detail: `${busiest.totalCalls} calls to ${busiest.pattern}${busiest.minRateLimit ? ` (rate limit: ${busiest.minRateLimit}/window)` : ''}.`,
      recommendation: busiest.rateLimited > 0
        ? `This endpoint had ${busiest.rateLimited} 429s — consider reducing parallelism or adding capacity throttling.`
        : 'No rate limit issues on this endpoint.',
    });
  }

  return issues;
}
