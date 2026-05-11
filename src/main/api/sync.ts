import { AxiosInstance } from 'axios';
import { getClient } from './auth';
import { SUB_RESOURCE_SYNC_CONFIG } from '../../shared/constants';

interface OktaListResponse {
  id: string;
  name?: string;
  label?: string;
  title?: string;
  login?: string;
  profile?: { name?: string; login?: string };
  [key: string]: unknown;
}

const MAX_PAGES = 10; // Cap at 2000 items (200 per page)

function parseNextLink(linkHeader: string | undefined): string | null {
  if (!linkHeader) return null;
  const match = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
  return match ? match[1] : null;
}

async function fetchAllPages(client: AxiosInstance, endpoint: string, params?: Record<string, unknown>): Promise<OktaListResponse[]> {
  const results: OktaListResponse[] = [];
  let url: string | null = endpoint;
  let page = 0;

  while (url && page < MAX_PAGES) {
    const response = page === 0
      ? await client.get<OktaListResponse[]>(url, { params: { limit: 200, ...params } })
      : await client.get<OktaListResponse[]>(url);

    if (Array.isArray(response.data)) {
      results.push(...response.data);
    }

    const linkHeader = response.headers?.link as string | undefined;
    url = parseNextLink(linkHeader);
    page++;
  }

  return results;
}

// ── State file parser ──────────────────────────────────────

export interface StateResource {
  type: string;           // e.g., "okta_group"
  address: string;        // e.g., "okta_group.engineering"
  name: string;           // terraform resource name (e.g., "engineering")
  oktaId: string;         // actual Okta ID from state
  displayName: string;    // human-readable name from attributes
  attributes: Record<string, unknown>;
  parentId?: string;      // source parent's Okta ID (from tfstate attributes)
  parentAddress?: string; // address of parent StateResource
  grandparentId?: string; // for level-2 resources (e.g., policy rules → auth server)
}

export interface ParsedState {
  terraformVersion: string;
  resources: StateResource[];
}

function extractDisplayName(type: string, attrs: Record<string, unknown>): string {
  // Try common name fields in order of preference
  if (attrs.label && typeof attrs.label === 'string') return attrs.label;
  if (attrs.name && typeof attrs.name === 'string') return attrs.name;
  if (attrs.title && typeof attrs.title === 'string') return attrs.title;
  if (attrs.login && typeof attrs.login === 'string') return attrs.login;
  if (attrs.profile && typeof attrs.profile === 'object' && attrs.profile !== null) {
    const p = attrs.profile as Record<string, unknown>;
    if (p.name && typeof p.name === 'string') return p.name;
    if (p.login && typeof p.login === 'string') return p.login;
  }
  return attrs.id as string || 'unknown';
}

export function parseStateFile(content: string): ParsedState {
  const state = JSON.parse(content);

  if (state.version !== 4) {
    throw new Error(`Unsupported state file version: ${state.version}. Expected version 4.`);
  }

  const resources: StateResource[] = [];

  for (const resource of (state.resources || [])) {
    // Only process Okta managed resources
    if (resource.mode !== 'managed') continue;
    if (!resource.type?.startsWith('okta_')) continue;

    for (const instance of (resource.instances || [])) {
      const attrs = instance.attributes || {};
      resources.push({
        type: resource.type,
        address: `${resource.type}.${resource.name}`,
        name: resource.name,
        oktaId: attrs.id as string || '',
        displayName: extractDisplayName(resource.type, attrs),
        attributes: attrs,
      });
    }
  }

  // Link sub-resources to their parents
  for (const resource of resources) {
    const config = SUB_RESOURCE_SYNC_CONFIG[resource.type];
    if (!config) continue;

    const parentId = resource.attributes[config.parentIdField] as string | undefined;
    if (parentId) {
      resource.parentId = parentId;
      const parent = resources.find(r => r.oktaId === parentId);
      if (parent) {
        resource.parentAddress = parent.address;
      }
    }

    if (config.level === 2 && config.grandparentIdField) {
      resource.grandparentId = resource.attributes[config.grandparentIdField] as string | undefined;
    }
  }

  return {
    terraformVersion: state.terraform_version || 'unknown',
    resources,
  };
}

// ── Target org resource discovery ──────────────────────────

export interface TargetResource {
  type: string;
  oktaId: string;
  displayName: string;
  parentId?: string;     // target parent's Okta ID (for sub-resources)
}

const RESOURCE_LIST_ENDPOINTS: Record<string, string> = {
  okta_group: '/api/v1/groups',
  okta_group_rule: '/api/v1/groups/rules',
  okta_app_oauth: '/api/v1/apps',
  okta_app_saml: '/api/v1/apps',
  okta_app_swa: '/api/v1/apps',
  okta_app_bookmark: '/api/v1/apps',
  okta_app_basic_auth: '/api/v1/apps',
  okta_app_auto_login: '/api/v1/apps',
  okta_app_secure_password_store: '/api/v1/apps',
  okta_app_shared_credentials: '/api/v1/apps',
  okta_app_three_field: '/api/v1/apps',
  okta_auth_server: '/api/v1/authorizationServers',
  okta_policy_mfa: '/api/v1/policies?type=MFA_ENROLL',
  okta_policy_password: '/api/v1/policies?type=PASSWORD',
  okta_policy_signon: '/api/v1/policies?type=OKTA_SIGN_ON',
  okta_policy_sign_on: '/api/v1/policies?type=OKTA_SIGN_ON',
  okta_policy_profile_enrollment: '/api/v1/policies?type=PROFILE_ENROLLMENT',
  okta_policy_rule_signon: '/api/v1/policies',
  okta_network_zone: '/api/v1/zones',
  okta_trusted_origin: '/api/v1/trustedOrigins',
  okta_user: '/api/v1/users',
  okta_user_type: '/api/v1/meta/types/user',
  okta_idp_oidc: '/api/v1/idps',
  okta_idp_saml: '/api/v1/idps',
  okta_idp_social: '/api/v1/idps',
  okta_authenticator: '/api/v1/authenticators',
  okta_event_hook: '/api/v1/eventHooks',
  okta_inline_hook: '/api/v1/inlineHooks',
  okta_domain: '/api/v1/domains',
  okta_brand: '/api/v1/brands',
  okta_behavior: '/api/v1/behaviors',
};

export async function discoverTargetResources(resourceTypes: string[]): Promise<TargetResource[]> {
  const client = getClient();
  const results: TargetResource[] = [];
  const discoveredEndpoints = new Set<string>();

  for (const type of resourceTypes) {
    const endpoint = RESOURCE_LIST_ENDPOINTS[type];
    if (!endpoint) continue;

    // Avoid hitting the same endpoint twice (e.g., all app types share /api/v1/apps)
    // Use the full endpoint (including query params) so ?type=X variants aren't deduplicated
    if (discoveredEndpoints.has(endpoint)) continue;
    discoveredEndpoints.add(endpoint);

    try {
      const items = await fetchAllPages(client, endpoint);

      for (const item of items) {
        const displayName = item.label || item.name || item.title ||
          (item.profile as { name?: string })?.name ||
          (item.profile as { login?: string })?.login ||
          item.id;

        results.push({
          type,
          oktaId: item.id,
          displayName: String(displayName),
        });
      }
    } catch {
      // Skip types we can't access
    }
  }

  return results;
}

// ── Sub-resource discovery ───────────────────────────────────

function extractDisplayNameFromResponse(item: OktaListResponse): string {
  return String(
    item.label || item.name || item.title ||
    (item.profile as { name?: string })?.name ||
    (item.profile as { login?: string })?.login ||
    item.id
  );
}

export async function discoverSubResources(
  stateResources: StateResource[],
  parentMatches: ResourceMatch[],
): Promise<TargetResource[]> {
  const client = getClient();
  const results: TargetResource[] = [];

  // Build lookup: source parent ID → matched target parent ID
  const parentIdMap = new Map<string, string>();
  for (const m of parentMatches) {
    if (m.status === 'matched' && m.targetId) {
      parentIdMap.set(m.sourceId, m.targetId);
    }
  }

  // Get sub-resource types present in state
  const subResourceTypes = [...new Set(
    stateResources
      .filter(r => SUB_RESOURCE_SYNC_CONFIG[r.type])
      .map(r => r.type)
  )];

  // Discover level-1 sub-resources first
  const discoveredEndpoints = new Set<string>();

  for (const subType of subResourceTypes) {
    const config = SUB_RESOURCE_SYNC_CONFIG[subType];
    if (config.level !== 1) continue;

    // Find all unique source parent IDs for this sub-resource type
    const sourceParentIds = [...new Set(
      stateResources
        .filter(r => r.type === subType && r.parentId)
        .map(r => r.parentId!)
    )];

    for (const sourceParentId of sourceParentIds) {
      const targetParentId = parentIdMap.get(sourceParentId);
      if (!targetParentId) continue; // Parent not matched, skip

      const endpoint = config.listEndpoint.replace('{parentId}', targetParentId);
      if (discoveredEndpoints.has(endpoint)) continue;
      discoveredEndpoints.add(endpoint);

      try {
        const items = await fetchAllPages(client, endpoint);

        for (const item of items) {
          results.push({
            type: subType,
            oktaId: item.id,
            displayName: extractDisplayNameFromResponse(item),
            parentId: targetParentId,
          });
        }
      } catch {
        // Skip on error (permissions, not found, etc.)
      }
    }
  }

  // Discover level-2 sub-resources (e.g., policy rules)
  // These need intermediate parent matches to resolve
  for (const subType of subResourceTypes) {
    const config = SUB_RESOURCE_SYNC_CONFIG[subType];
    if (config.level !== 2) continue;

    // For policy rules: we need both the grandparent (auth server) and parent (policy) target IDs
    // The parent (policy) was discovered as a level-1 sub-resource above
    const level1Matches = matchSubResources(
      stateResources.filter(r => r.type === config.parentTerraformType),
      results.filter(r => r.type === config.parentTerraformType),
      parentIdMap,
    );

    // Build parent policy ID map: source policy ID → target policy ID
    const intermediateIdMap = new Map<string, string>();
    for (const m of level1Matches) {
      if (m.status === 'matched' && m.targetId) {
        intermediateIdMap.set(m.sourceId, m.targetId);
      }
    }

    // Find unique (grandparentId, parentId) pairs for this sub-resource type
    const stateRules = stateResources.filter(r => r.type === subType);
    for (const rule of stateRules) {
      if (!rule.parentId || !rule.grandparentId) continue;

      const targetGrandparentId = parentIdMap.get(rule.grandparentId);
      const targetParentId = intermediateIdMap.get(rule.parentId);
      if (!targetGrandparentId || !targetParentId) continue;

      const endpoint = config.listEndpoint
        .replace('{grandparentId}', targetGrandparentId)
        .replace('{parentId}', targetParentId);

      if (discoveredEndpoints.has(endpoint)) continue;
      discoveredEndpoints.add(endpoint);

      try {
        const items = await fetchAllPages(client, endpoint);

        for (const item of items) {
          results.push({
            type: subType,
            oktaId: item.id,
            displayName: extractDisplayNameFromResponse(item),
            parentId: targetParentId,
          });
        }
      } catch {
        // Skip on error
      }
    }
  }

  return results;
}

// ── Resource matching ──────────────────────────────────────

export interface ResourceMatch {
  sourceAddress: string;
  sourceType: string;
  sourceId: string;
  sourceName: string;
  targetId: string | null;
  targetName: string | null;
  status: 'matched' | 'missing' | 'ambiguous';
  level: number;                   // 0 = top-level, 1 = child, 2 = grandchild
  parentSourceId?: string | null;
  parentTargetId?: string | null;
}

export function matchResources(
  sourceResources: StateResource[],
  targetResources: TargetResource[],
): ResourceMatch[] {
  const matches: ResourceMatch[] = [];

  for (const source of sourceResources) {
    // Find target resources of compatible types
    const candidates = targetResources.filter(t => {
      // Exact type match or same base type (e.g., okta_app_oauth matches /apps)
      if (t.type === source.type) return true;
      // Apps all come from the same endpoint
      if (source.type.startsWith('okta_app_') && t.type.startsWith('okta_app_')) return true;
      // IDPs all come from the same endpoint
      if (source.type.startsWith('okta_idp_') && t.type.startsWith('okta_idp_')) return true;
      return false;
    });

    // Match by display name (case-insensitive)
    const nameMatches = candidates.filter(
      c => c.displayName.toLowerCase() === source.displayName.toLowerCase()
    );

    if (nameMatches.length === 1) {
      matches.push({
        sourceAddress: source.address,
        sourceType: source.type,
        sourceId: source.oktaId,
        sourceName: source.displayName,
        targetId: nameMatches[0].oktaId,
        targetName: nameMatches[0].displayName,
        status: 'matched',
        level: 0,
      });
    } else if (nameMatches.length > 1) {
      matches.push({
        sourceAddress: source.address,
        sourceType: source.type,
        sourceId: source.oktaId,
        sourceName: source.displayName,
        targetId: null,
        targetName: `${nameMatches.length} matches found`,
        status: 'ambiguous',
        level: 0,
      });
    } else {
      matches.push({
        sourceAddress: source.address,
        sourceType: source.type,
        sourceId: source.oktaId,
        sourceName: source.displayName,
        targetId: null,
        targetName: null,
        status: 'missing',
        level: 0,
      });
    }
  }

  return matches;
}

// Match sub-resources scoped to their parent
function matchSubResources(
  sourceResources: StateResource[],
  targetResources: TargetResource[],
  parentIdMap: Map<string, string>,  // source parent ID → target parent ID
): ResourceMatch[] {
  const matches: ResourceMatch[] = [];

  for (const source of sourceResources) {
    const config = SUB_RESOURCE_SYNC_CONFIG[source.type];
    const level = config?.level ?? 0;

    // If parent wasn't matched, child is automatically missing
    if (!source.parentId || !parentIdMap.has(source.parentId)) {
      matches.push({
        sourceAddress: source.address,
        sourceType: source.type,
        sourceId: source.oktaId,
        sourceName: source.displayName,
        targetId: null,
        targetName: null,
        status: 'missing',
        level,
        parentSourceId: source.parentId,
        parentTargetId: null,
      });
      continue;
    }

    const targetParentId = parentIdMap.get(source.parentId)!;

    // Filter candidates: same type AND same target parent
    const candidates = targetResources.filter(t =>
      t.type === source.type && t.parentId === targetParentId
    );

    const nameMatches = candidates.filter(
      c => c.displayName.toLowerCase() === source.displayName.toLowerCase()
    );

    if (nameMatches.length === 1) {
      matches.push({
        sourceAddress: source.address,
        sourceType: source.type,
        sourceId: source.oktaId,
        sourceName: source.displayName,
        targetId: nameMatches[0].oktaId,
        targetName: nameMatches[0].displayName,
        status: 'matched',
        level,
        parentSourceId: source.parentId,
        parentTargetId: targetParentId,
      });
    } else if (nameMatches.length > 1) {
      matches.push({
        sourceAddress: source.address,
        sourceType: source.type,
        sourceId: source.oktaId,
        sourceName: source.displayName,
        targetId: null,
        targetName: `${nameMatches.length} matches found`,
        status: 'ambiguous',
        level,
        parentSourceId: source.parentId,
        parentTargetId: targetParentId,
      });
    } else {
      matches.push({
        sourceAddress: source.address,
        sourceType: source.type,
        sourceId: source.oktaId,
        sourceName: source.displayName,
        targetId: null,
        targetName: null,
        status: 'missing',
        level,
        parentSourceId: source.parentId,
        parentTargetId: targetParentId,
      });
    }
  }

  return matches;
}

// ── Full hierarchical sync ───────────────────────────────────

export async function syncWithSubResources(
  stateResources: StateResource[],
): Promise<{ topLevelMatches: ResourceMatch[]; subResourceMatches: ResourceMatch[] }> {
  // Separate top-level from sub-resources
  const topLevel = stateResources.filter(r => !SUB_RESOURCE_SYNC_CONFIG[r.type]);
  const subResources = stateResources.filter(r => !!SUB_RESOURCE_SYNC_CONFIG[r.type]);

  // Step 1: Discover and match top-level resources
  const topLevelTypes = [...new Set(topLevel.map(r => r.type))];
  const topLevelTargets = topLevelTypes.length > 0
    ? await discoverTargetResources(topLevelTypes)
    : [];
  const topLevelMatches = matchResources(topLevel, topLevelTargets);

  if (subResources.length === 0) {
    return { topLevelMatches, subResourceMatches: [] };
  }

  // Step 2: Build parent ID map from top-level matches
  const parentIdMap = new Map<string, string>();
  for (const m of topLevelMatches) {
    if (m.status === 'matched' && m.targetId) {
      parentIdMap.set(m.sourceId, m.targetId);
    }
  }

  // Step 3: Discover sub-resources in target org
  const subTargets = await discoverSubResources(stateResources, topLevelMatches);

  // Step 4: Match level-1 sub-resources
  const level1Resources = subResources.filter(r => {
    const config = SUB_RESOURCE_SYNC_CONFIG[r.type];
    return config && config.level === 1;
  });
  const level1Targets = subTargets.filter(r => {
    const config = SUB_RESOURCE_SYNC_CONFIG[r.type];
    return config && config.level === 1;
  });
  const level1Matches = matchSubResources(level1Resources, level1Targets, parentIdMap);

  // Step 5: Match level-2 sub-resources (need intermediate parent map)
  const level2Resources = subResources.filter(r => {
    const config = SUB_RESOURCE_SYNC_CONFIG[r.type];
    return config && config.level === 2;
  });

  let level2Matches: ResourceMatch[] = [];
  if (level2Resources.length > 0) {
    // Build intermediate map: source level-1 ID → target level-1 ID
    const intermediateIdMap = new Map<string, string>();
    for (const m of level1Matches) {
      if (m.status === 'matched' && m.targetId) {
        intermediateIdMap.set(m.sourceId, m.targetId);
      }
    }

    const level2Targets = subTargets.filter(r => {
      const config = SUB_RESOURCE_SYNC_CONFIG[r.type];
      return config && config.level === 2;
    });
    level2Matches = matchSubResources(level2Resources, level2Targets, intermediateIdMap);
  }

  return {
    topLevelMatches,
    subResourceMatches: [...level1Matches, ...level2Matches],
  };
}

// ── Build sync summary ─────────────────────────────────────

export interface SyncSummary {
  totalResources: number;
  matched: number;
  missing: number;
  ambiguous: number;
  subResourceCount: number;
  byType: Record<string, { total: number; matched: number; missing: number }>;
  matches: ResourceMatch[];
}

export function buildSyncSummary(matches: ResourceMatch[]): SyncSummary {
  const byType: Record<string, { total: number; matched: number; missing: number }> = {};

  for (const m of matches) {
    if (!byType[m.sourceType]) {
      byType[m.sourceType] = { total: 0, matched: 0, missing: 0 };
    }
    byType[m.sourceType].total++;
    if (m.status === 'matched') byType[m.sourceType].matched++;
    if (m.status === 'missing') byType[m.sourceType].missing++;
  }

  return {
    totalResources: matches.length,
    matched: matches.filter(m => m.status === 'matched').length,
    missing: matches.filter(m => m.status === 'missing').length,
    ambiguous: matches.filter(m => m.status === 'ambiguous').length,
    subResourceCount: matches.filter(m => m.level > 0).length,
    byType,
    matches,
  };
}
