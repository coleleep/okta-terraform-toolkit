import { AxiosInstance } from 'axios';
import { getClient, getGrantedScopes } from './auth';
import { EndpointProbeResult, ResourceCount, ProbeProgress } from '../../shared/types';
import { SUB_RESOURCE_ENDPOINTS, PROBE_TIMEOUT_MS, STATUS_OK_THRESHOLD, STATUS_WARNING_THRESHOLD } from '../../shared/constants';
import { diagnoseProbeFailure } from '../../shared/scopes';

const COOLDOWN_MS = 2000;   // Pause after counting before deep probe
const RETRY_DELAY_MS = 3000; // Wait before retrying a connection failure
const MAX_RETRIES = 2;       // Retry connection-level failures (no HTTP response)

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function determineStatus(remaining: number, limit: number): 'ok' | 'warning' | 'critical' {
  if (limit === 0) return 'critical';
  const ratio = remaining / limit;
  if (ratio > STATUS_OK_THRESHOLD) return 'ok';
  if (ratio > STATUS_WARNING_THRESHOLD) return 'warning';
  return 'critical';
}

function extractRateLimits(headers: Record<string, string>) {
  const limit = parseInt(headers['x-rate-limit-limit'] || '0', 10);
  const remaining = parseInt(headers['x-rate-limit-remaining'] || '0', 10);
  const resetAt = parseInt(headers['x-rate-limit-reset'] || '0', 10);
  const serverDate = headers['date'];
  const serverNow = serverDate
    ? Math.floor(new Date(serverDate).getTime() / 1000)
    : Math.floor(Date.now() / 1000);
  const resetWindowSecs = Math.max(0, resetAt - serverNow);
  return { limit, remaining, resetAt, resetWindowSecs };
}

interface AppSamples {
  saml: { appId: string; kid: string } | null;
  oauth: { appId: string } | null;
}

async function findAppSamples(client: AxiosInstance): Promise<AppSamples> {
  const result: AppSamples = { saml: null, oauth: null };
  try {
    const appsResponse = await client.get('/api/v1/apps?limit=200', { timeout: PROBE_TIMEOUT_MS });
    const apps = Array.isArray(appsResponse.data) ? appsResponse.data : [];
    const signOnModes = [...new Set(apps.map((a: { signOnMode?: string }) => a.signOnMode))];
    console.log(`[deep-probe] Fetched ${apps.length} apps. signOnModes: ${signOnModes.join(', ')}`);

    // Find SAML app + kid
    const samlApp = apps.find((app: { signOnMode?: string }) => app.signOnMode === 'SAML_2_0');
    if (samlApp) {
      console.log(`[deep-probe] Found SAML app: id=${samlApp.id}, label=${samlApp.label}`);
      try {
        const keysResponse = await client.get(`/api/v1/apps/${samlApp.id}/credentials/keys`, { timeout: PROBE_TIMEOUT_MS });
        const keys = Array.isArray(keysResponse.data) ? keysResponse.data : [];
        if (keys.length > 0) {
          const activeKey = keys.find((k: { status?: string }) => k.status === 'ACTIVE') || keys[0];
          console.log(`[deep-probe] SAML kid=${activeKey.kid}`);
          result.saml = { appId: samlApp.id, kid: activeKey.kid };
        }
      } catch {
        console.log(`[deep-probe] Failed to fetch SAML app keys`);
      }
    } else {
      console.log(`[deep-probe] No SAML_2_0 app found`);
    }

    // Find OAuth/OIDC app
    const oauthApp = apps.find((app: { signOnMode?: string; name?: string }) =>
      app.signOnMode === 'OPENID_CONNECT' || app.name === 'oidc_client'
    );
    if (oauthApp) {
      console.log(`[deep-probe] Found OAuth app: id=${oauthApp.id}, label=${oauthApp.label}`);
      result.oauth = { appId: oauthApp.id };
    } else {
      console.log(`[deep-probe] No OIDC/OAuth app found`);
    }

    return result;
  } catch (err: unknown) {
    const message = (err as { message?: string })?.message || String(err);
    console.log(`[deep-probe] findAppSamples failed: ${message}`);
    return result;
  }
}

const SAML_METADATA_ENDPOINT = '/api/v1/apps/{id}/sso/saml/metadata';
const APP_GRANTS_ENDPOINT = '/api/v1/apps/{id}/grants';

// Endpoints that don't use the parent sample ID — they're static paths
const STATIC_ENDPOINTS = new Set([
  '/api/v1/meta/schemas/user/default',
  '/api/v1/meta/schemas/group/default',
  '/api/v1/meta/types/user?limit=1',
  '/api/v1/groups/rules?limit=1',
]);

/**
 * Resolve the actual URL to probe for a given endpoint definition.
 * Routes SAML metadata to a SAML app sample, generic endpoints to the default sample ID.
 */
function resolveEndpoint(
  endpoint: string,
  sampleId: string,
  appSamples: AppSamples
): { url: string; display: string; headers?: Record<string, string>; skip?: string } {
  // SAML metadata — needs SAML app ID + kid + XML accept header
  if (endpoint === SAML_METADATA_ENDPOINT) {
    if (!appSamples.saml) return { url: '', display: endpoint.replace('{id}', '<id>') + '?kid=<kid>', skip: 'No SAML 2.0 apps found in org' };
    return {
      url: `/api/v1/apps/${appSamples.saml.appId}/sso/saml/metadata?kid=${appSamples.saml.kid}`,
      display: endpoint.replace('{id}', '<id>') + '?kid=<kid>',
      headers: { Accept: 'application/xml' },
    };
  }

  // App Grants — only works on OAuth/OIDC apps
  if (endpoint === APP_GRANTS_ENDPOINT) {
    if (!appSamples.oauth) return { url: '', display: endpoint.replace('{id}', '<id>'), skip: 'No OAuth/OIDC apps found in org' };
    return {
      url: endpoint.replace('{id}', appSamples.oauth.appId),
      display: endpoint.replace('{id}', '<id>'),
    };
  }

  // Static endpoints — no ID replacement needed
  if (STATIC_ENDPOINTS.has(endpoint)) {
    return { url: endpoint, display: endpoint };
  }

  // Standard {id} replacement
  return {
    url: endpoint.replace('{id}', sampleId),
    display: endpoint.replace('{id}', '<id>'),
  };
}

async function probeWithRetry(
  client: AxiosInstance,
  def: { endpoint: string; label: string; method?: string },
  method: 'GET' | 'POST',
  resolved: { url: string; display: string; headers?: Record<string, string> },
): Promise<EndpointProbeResult> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      if (attempt > 0) {
        console.log(`[deep-probe]   Retry ${attempt}/${MAX_RETRIES} for ${def.label} (waiting ${RETRY_DELAY_MS}ms)...`);
        await sleep(RETRY_DELAY_MS);
      }

      console.log(`[deep-probe] Probing: ${def.label} → ${method} ${resolved.url}${attempt > 0 ? ` (attempt ${attempt + 1})` : ''}`);

      const response = method === 'POST'
        ? await client.post(resolved.url, {}, { timeout: PROBE_TIMEOUT_MS })
        : await client.get(resolved.url, {
            timeout: PROBE_TIMEOUT_MS,
            ...(resolved.headers ? { headers: resolved.headers } : {}),
          });

      const rl = extractRateLimits(response.headers as Record<string, string>);
      return {
        endpoint: resolved.display,
        label: def.label,
        method,
        ...rl,
        httpStatus: response.status,
        status: determineStatus(rl.remaining, rl.limit),
      };
    } catch (err: unknown) {
      const axiosErr = err as { response?: { headers?: Record<string, string>; status?: number; data?: unknown }; message?: string; code?: string };
      const httpStatus = axiosErr.response?.status;
      const message = axiosErr.message || String(err);
      const reqId = axiosErr.response?.headers?.['x-okta-request-id'] || 'N/A';

      console.log(`[deep-probe]   FAILED: ${def.label} — HTTP ${httpStatus}, code=${axiosErr.code}, x-okta-request-id=${reqId}`);

      // Connection-level failure (no HTTP response) — retry if attempts remain
      if (!axiosErr.response && attempt < MAX_RETRIES) {
        console.log(`[deep-probe]   No HTTP response (${axiosErr.code || 'unknown'}) — will retry`);
        continue;
      }

      // Extract rate limit headers from error response — Okta usually includes them
      if (axiosErr.response?.headers) {
        const rl = extractRateLimits(axiosErr.response.headers as Record<string, string>);
        if (rl.limit > 0) {
          console.log(`[deep-probe]   Rate limit from error: limit=${rl.limit}, remaining=${rl.remaining}`);
          return {
            endpoint: resolved.display,
            label: def.label,
            method,
            ...rl,
            httpStatus,
            status: determineStatus(rl.remaining, rl.limit),
          };
        }
        console.log(`[deep-probe]   No rate limit headers in ${httpStatus} response`);
      }

      // 401/403 = no permission, 404/405 = not applicable
      if (httpStatus === 401 || httpStatus === 403 || httpStatus === 404 || httpStatus === 405) {
        const errorCode = (axiosErr.response?.data as { errorCode?: string })?.errorCode;
        let reason: string;
        if (httpStatus === 401 || httpStatus === 403) {
          reason = diagnoseProbeFailure(resolved.display, def.label, httpStatus, errorCode, getGrantedScopes());
        } else {
          reason = 'Not applicable for sampled resource';
        }
        return {
          endpoint: resolved.display,
          label: def.label,
          method,
          limit: 0, remaining: 0, resetAt: 0, resetWindowSecs: 0,
          httpStatus,
          status: 'skipped',
          error: `${reason} (x-okta-request-id: ${reqId})`,
        };
      }

      return {
        endpoint: resolved.display,
        label: def.label,
        method,
        limit: 0, remaining: 0, resetAt: 0, resetWindowSecs: 0,
        httpStatus,
        status: 'error',
        error: `HTTP ${httpStatus ?? '?'} — ${message} (x-okta-request-id: ${reqId})`,
      };
    }
  }

  // Should never reach here, but TypeScript needs it
  return {
    endpoint: resolved.display,
    label: def.label,
    method,
    limit: 0, remaining: 0, resetAt: 0, resetWindowSecs: 0,
    status: 'error',
    error: 'Max retries exceeded',
  };
}

export async function deepProbeSubResources(
  resourceCounts: ResourceCount[],
  onProgress: (progress: ProbeProgress) => void
): Promise<EndpointProbeResult[]> {
  const client = getClient();
  const results: EndpointProbeResult[] = [];

  const sampleIds = new Map<string, string>();
  for (const rc of resourceCounts) {
    if (rc.sampleId && !rc.error) {
      sampleIds.set(rc.type, rc.sampleId);
    }
  }

  const endpointsToProbe = SUB_RESOURCE_ENDPOINTS.filter(ep =>
    sampleIds.has(ep.parentType)
  );

  // Cooldown after counting phase — the counting pagination can exhaust connections
  // and Okta's WAF may drop subsequent requests if they come too fast
  console.log(`[deep-probe] Cooldown ${COOLDOWN_MS}ms after counting phase...`);
  onProgress({ completed: 0, total: endpointsToProbe.length, currentEndpoint: 'Waiting for rate limit cooldown...' });
  await sleep(COOLDOWN_MS);

  // Pre-fetch app samples (SAML + OAuth) for type-specific endpoints
  const needsAppSamples = endpointsToProbe.some(ep =>
    ep.endpoint === SAML_METADATA_ENDPOINT || ep.endpoint === APP_GRANTS_ENDPOINT
  );
  let appSamples: AppSamples = { saml: null, oauth: null };
  if (needsAppSamples) {
    console.log('[deep-probe] Finding SAML + OAuth app samples...');
    appSamples = await findAppSamples(client);
  }

  const total = endpointsToProbe.length;

  for (let i = 0; i < endpointsToProbe.length; i++) {
    const def = endpointsToProbe[i];
    const sampleId = sampleIds.get(def.parentType)!;

    onProgress({ completed: i, total, currentEndpoint: def.label });

    const resolved = resolveEndpoint(def.endpoint, sampleId, appSamples);

    const method: 'GET' | 'POST' = (def.method as 'GET' | 'POST') || 'GET';

    // Skip if resolution says so (e.g., no SAML apps)
    if (resolved.skip) {
      results.push({
        endpoint: resolved.display,
        label: def.label,
        method,
        limit: 0, remaining: 0, resetAt: 0, resetWindowSecs: 0,
        status: 'skipped',
        error: resolved.skip,
      });
      continue;
    }

    // Probe with retry for connection-level failures (no HTTP response at all)
    const probeResult = await probeWithRetry(client, def, method, resolved);
    results.push(probeResult);
  }

  onProgress({ completed: total, total, currentEndpoint: 'Done' });

  return results;
}

/**
 * Probe a specific sub-resource endpoint to get its real rate limit.
 * For okta_app_user: finds a sample app, gets a sample user, probes /apps/{id}/users/{userId}.
 * Returns the rate limit, reset window, and the probed endpoint.
 */
export interface SubResourceProbeResult {
  endpoint: string;
  limit: number;
  remaining: number;
  resetWindowSecs: number;
  error?: string;
}

export async function probeSubResourceEndpoint(
  terraformResource: string,
  primaryEndpoint: string
): Promise<SubResourceProbeResult> {
  const client = getClient();

  console.log(`[sub-probe] Probing sub-resource for ${terraformResource} → ${primaryEndpoint}`);

  try {
    // Map terraform resource to a concrete probe strategy
    if (terraformResource === 'okta_app_user') {
      return await probeAppUserEndpoint(client);
    }
    if (terraformResource === 'okta_app_group_assignment' || terraformResource === 'okta_app_group_assignments') {
      return await probeAppGroupEndpoint(client);
    }
    if (terraformResource === 'okta_group_memberships') {
      return await probeGroupMembersEndpoint(client);
    }

    // Generic: try to probe the list endpoint pattern
    // Replace <id> with a real sample ID from the first resource
    const parentEndpoint = primaryEndpoint.replace('/<id>', '');
    console.log(`[sub-probe] Generic probe: GET ${parentEndpoint}?limit=1`);
    const response = await client.get(`${parentEndpoint}?limit=1`, { timeout: PROBE_TIMEOUT_MS });
    const rl = extractRateLimits(response.headers as Record<string, string>);
    return {
      endpoint: primaryEndpoint,
      limit: rl.limit,
      remaining: rl.remaining,
      resetWindowSecs: rl.resetWindowSecs,
    };
  } catch (err: unknown) {
    const message = (err as { message?: string })?.message || String(err);
    const axiosErr = err as { response?: { headers?: Record<string, string> } };
    if (axiosErr.response?.headers) {
      const rl = extractRateLimits(axiosErr.response.headers as Record<string, string>);
      if (rl.limit > 0) {
        return { endpoint: primaryEndpoint, ...rl };
      }
    }
    console.log(`[sub-probe] Failed: ${message}`);
    return { endpoint: primaryEndpoint, limit: 0, remaining: 0, resetWindowSecs: 0, error: message };
  }
}

async function probeAppUserEndpoint(client: import('axios').AxiosInstance): Promise<SubResourceProbeResult> {
  const endpoint = '/api/v1/apps/<id>/users/<id>';
  // Get a sample app
  const appsRes = await client.get('/api/v1/apps?limit=1', { timeout: PROBE_TIMEOUT_MS });
  const apps = Array.isArray(appsRes.data) ? appsRes.data : [];
  if (apps.length === 0) return { endpoint, limit: 0, remaining: 0, resetWindowSecs: 0, error: 'No apps found' };

  const appId = apps[0].id;
  console.log(`[sub-probe] Sample app: ${appId}`);

  // Get a sample user from that app
  const usersRes = await client.get(`/api/v1/apps/${appId}/users?limit=1`, { timeout: PROBE_TIMEOUT_MS });
  const users = Array.isArray(usersRes.data) ? usersRes.data : [];
  if (users.length === 0) {
    // No users assigned — use the list endpoint rate limit instead
    const rl = extractRateLimits(usersRes.headers as Record<string, string>);
    console.log(`[sub-probe] No users in app, using list endpoint: limit=${rl.limit}`);
    return { endpoint: '/api/v1/apps/<id>/users', ...rl };
  }

  const userId = users[0].id;
  console.log(`[sub-probe] Sample user: ${userId}, probing /apps/${appId}/users/${userId}`);

  // Probe the actual individual endpoint
  const probeRes = await client.get(`/api/v1/apps/${appId}/users/${userId}`, { timeout: PROBE_TIMEOUT_MS });
  const rl = extractRateLimits(probeRes.headers as Record<string, string>);
  console.log(`[sub-probe] Result: limit=${rl.limit}, remaining=${rl.remaining}, reset=${rl.resetWindowSecs}s`);
  return { endpoint, ...rl };
}

async function probeAppGroupEndpoint(client: import('axios').AxiosInstance): Promise<SubResourceProbeResult> {
  const endpoint = '/api/v1/apps/<id>/groups/<id>';
  const appsRes = await client.get('/api/v1/apps?limit=1', { timeout: PROBE_TIMEOUT_MS });
  const apps = Array.isArray(appsRes.data) ? appsRes.data : [];
  if (apps.length === 0) return { endpoint, limit: 0, remaining: 0, resetWindowSecs: 0, error: 'No apps found' };

  const appId = apps[0].id;
  const groupsRes = await client.get(`/api/v1/apps/${appId}/groups?limit=1`, { timeout: PROBE_TIMEOUT_MS });
  const rl = extractRateLimits(groupsRes.headers as Record<string, string>);
  console.log(`[sub-probe] App groups list: limit=${rl.limit}, remaining=${rl.remaining}`);
  return { endpoint: '/api/v1/apps/<id>/groups', ...rl };
}

async function probeGroupMembersEndpoint(client: import('axios').AxiosInstance): Promise<SubResourceProbeResult> {
  const endpoint = '/api/v1/groups/<id>/users';
  const groupsRes = await client.get('/api/v1/groups?limit=1', { timeout: PROBE_TIMEOUT_MS });
  const groups = Array.isArray(groupsRes.data) ? groupsRes.data : [];
  if (groups.length === 0) return { endpoint, limit: 0, remaining: 0, resetWindowSecs: 0, error: 'No groups found' };

  const groupId = groups[0].id;
  const membersRes = await client.get(`/api/v1/groups/${groupId}/users?limit=1`, { timeout: PROBE_TIMEOUT_MS });
  const rl = extractRateLimits(membersRes.headers as Record<string, string>);
  console.log(`[sub-probe] Group members: limit=${rl.limit}, remaining=${rl.remaining}`);
  return { endpoint, ...rl };
}
