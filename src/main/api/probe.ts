import { getClient, getGrantedScopes } from './auth';
import { EndpointProbeResult, ProbeResult, ProbeProgress } from '../../shared/types';
import { PROBE_ENDPOINTS, PROBE_TIMEOUT_MS, STATUS_OK_THRESHOLD, STATUS_WARNING_THRESHOLD } from '../../shared/constants';
import { diagnoseProbeFailure } from '../../shared/scopes';

function determineStatus(remaining: number, limit: number): 'ok' | 'warning' | 'critical' {
  if (limit === 0) return 'critical';
  const ratio = remaining / limit;
  if (ratio > STATUS_OK_THRESHOLD) return 'ok';
  if (ratio > STATUS_WARNING_THRESHOLD) return 'warning';
  return 'critical';
}

export async function probeEndpoints(
  orgUrl: string,
  onProgress: (progress: ProbeProgress) => void
): Promise<ProbeResult> {
  const client = getClient();
  const startTime = Date.now();
  const results: EndpointProbeResult[] = [];
  const total = PROBE_ENDPOINTS.length;

  for (let i = 0; i < PROBE_ENDPOINTS.length; i++) {
    const { endpoint, label } = PROBE_ENDPOINTS[i];

    onProgress({ completed: i, total, currentEndpoint: label });

    console.log(`[probe] ${label} → GET ${endpoint}`);
    try {
      const response = await client.get(endpoint, {
        timeout: PROBE_TIMEOUT_MS,
      });

      const headers = response.headers as Record<string, string>;
      const limit = parseInt(headers['x-rate-limit-limit'] || '0', 10);
      const remaining = parseInt(headers['x-rate-limit-remaining'] || '0', 10);
      const resetAt = parseInt(headers['x-rate-limit-reset'] || '0', 10);

      const serverDate = headers['date'];
      const serverNow = serverDate
        ? Math.floor(new Date(serverDate).getTime() / 1000)
        : Math.floor(Date.now() / 1000);
      const resetWindowSecs = Math.max(0, resetAt - serverNow);

      results.push({
        endpoint: endpoint.split('?')[0],
        label,
        method: 'GET',
        limit,
        remaining,
        resetAt,
        resetWindowSecs,
        status: determineStatus(remaining, limit),
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      const axiosErr = err as { response?: { headers?: Record<string, string>; status?: number; data?: unknown } };
      console.log(`[probe]   FAILED: ${label} — HTTP ${axiosErr.response?.status}, error: ${message}`);
      if (axiosErr.response?.data) {
        console.log(`[probe]   Response: ${JSON.stringify(axiosErr.response.data).slice(0, 300)}`);
      }
      if (axiosErr.response?.headers) {
        const headers = axiosErr.response.headers;
        const limit = parseInt(headers['x-rate-limit-limit'] || '0', 10);
        const remaining = parseInt(headers['x-rate-limit-remaining'] || '0', 10);
        const resetAt = parseInt(headers['x-rate-limit-reset'] || '0', 10);
        const serverDate = headers['date'];
        const serverNow = serverDate
          ? Math.floor(new Date(serverDate).getTime() / 1000)
          : Math.floor(Date.now() / 1000);
        const resetWindowSecs = Math.max(0, resetAt - serverNow);

        if (limit > 0) {
          results.push({
            endpoint: endpoint.split('?')[0],
            label,
            method: 'GET',
            limit,
            remaining,
            resetAt,
            resetWindowSecs,
            status: determineStatus(remaining, limit),
          });
          continue;
        }
      }

      const httpStatus = axiosErr.response?.status;
      const errorCode = (axiosErr.response?.data as { errorCode?: string })?.errorCode;
      let skipError = message;
      let skipStatus: 'skipped' | 'error' = 'error';
      if (httpStatus === 401 || httpStatus === 403) {
        skipStatus = 'skipped';
        skipError = diagnoseProbeFailure(endpoint, label, httpStatus, errorCode, getGrantedScopes());
      }
      results.push({
        endpoint: endpoint.split('?')[0],
        label,
        method: 'GET',
        limit: 0,
        remaining: 0,
        resetAt: 0,
        resetWindowSecs: 0,
        httpStatus,
        status: skipStatus,
        error: skipError,
      });
    }
  }

  onProgress({ completed: total, total, currentEndpoint: 'Done' });

  const successfulResults = results.filter(r => r.status !== 'error' && r.status !== 'skipped' && r.limit > 0);
  const overallMinLimit = successfulResults.length > 0
    ? Math.min(...successfulResults.map(r => r.limit))
    : 0;

  return {
    orgUrl,
    timestamp: new Date().toISOString(),
    endpoints: results,
    overallMinLimit,
    probeDurationMs: Date.now() - startTime,
  };
}
