import { ManagedResourceType } from './types';

// Okta OAuth2 API scopes available for service apps (client credentials flow)
// Source: https://developer.okta.com/docs/api/oauth2
export interface ScopeRequirement {
  resourceType: ManagedResourceType;
  readScope: string | null;    // null = no OAuth scope exists, API key only
  manageScope: string | null;  // null = no OAuth scope exists, API key only
  adminRole: string;           // minimum standard admin role needed
  customRoleSupported: boolean; // can a custom admin role be used?
  customRolePermission?: string; // the custom role permission key, if applicable
  apiKeyOnly?: boolean;        // true if this resource has NO OAuth scope at all
  notes?: string;
}

export const SCOPE_REQUIREMENTS: ScopeRequirement[] = [
  // Core resources — all have OAuth scopes
  { resourceType: 'users', readScope: 'okta.users.read', manageScope: 'okta.users.manage', adminRole: 'Group Admin', customRoleSupported: true, customRolePermission: 'okta.users.manage' },
  { resourceType: 'groups', readScope: 'okta.groups.read', manageScope: 'okta.groups.manage', adminRole: 'Group Admin', customRoleSupported: true, customRolePermission: 'okta.groups.manage' },
  { resourceType: 'applications', readScope: 'okta.apps.read', manageScope: 'okta.apps.manage', adminRole: 'Application Admin', customRoleSupported: true, customRolePermission: 'okta.apps.manage' },
  { resourceType: 'authServers', readScope: 'okta.authorizationServers.read', manageScope: 'okta.authorizationServers.manage', adminRole: 'API Access Management Admin', customRoleSupported: true, customRolePermission: 'okta.authorizationServers.manage' },
  { resourceType: 'policies', readScope: 'okta.policies.read', manageScope: 'okta.policies.manage', adminRole: 'Super Admin', customRoleSupported: false, notes: 'Policy management requires Super Admin — custom roles cannot manage policies' },
  { resourceType: 'idps', readScope: 'okta.idps.read', manageScope: 'okta.idps.manage', adminRole: 'Super Admin', customRoleSupported: true, customRolePermission: 'okta.idps.manage' },

  // Security
  { resourceType: 'authenticators', readScope: 'okta.authenticators.read', manageScope: 'okta.authenticators.manage', adminRole: 'Super Admin', customRoleSupported: false, notes: 'Authenticator management requires Super Admin' },
  { resourceType: 'behaviors', readScope: 'okta.behaviors.read', manageScope: 'okta.behaviors.manage', adminRole: 'Super Admin', customRoleSupported: false, notes: 'Behavior rules require Super Admin' },
  { resourceType: 'captchas', readScope: 'okta.captchas.read', manageScope: 'okta.captchas.manage', adminRole: 'Super Admin', customRoleSupported: false, notes: 'CAPTCHA configuration requires Super Admin' },

  // Infrastructure
  { resourceType: 'networkZones', readScope: 'okta.networkZones.read', manageScope: 'okta.networkZones.manage', adminRole: 'Super Admin', customRoleSupported: false, notes: 'Network zones require Super Admin — no custom role permission available' },
  { resourceType: 'trustedOrigins', readScope: 'okta.trustedOrigins.read', manageScope: 'okta.trustedOrigins.manage', adminRole: 'Super Admin', customRoleSupported: false },
  { resourceType: 'domains', readScope: 'okta.domains.read', manageScope: 'okta.domains.manage', adminRole: 'Super Admin', customRoleSupported: false },
  { resourceType: 'emailDomains', readScope: 'okta.emailDomains.read', manageScope: 'okta.emailDomains.manage', adminRole: 'Super Admin', customRoleSupported: false },
  { resourceType: 'brands', readScope: 'okta.brands.read', manageScope: 'okta.brands.manage', adminRole: 'Super Admin', customRoleSupported: true, customRolePermission: 'okta.customizations.manage' },

  // Hooks & streams
  { resourceType: 'eventHooks', readScope: 'okta.eventHooks.read', manageScope: 'okta.eventHooks.manage', adminRole: 'Super Admin', customRoleSupported: true, customRolePermission: 'okta.eventHooks.manage' },
  { resourceType: 'inlineHooks', readScope: 'okta.inlineHooks.read', manageScope: 'okta.inlineHooks.manage', adminRole: 'Super Admin', customRoleSupported: true, customRolePermission: 'okta.inlineHooks.manage' },
  { resourceType: 'logStreams', readScope: 'okta.logStreams.read', manageScope: 'okta.logStreams.manage', adminRole: 'Super Admin', customRoleSupported: false },

  // Advanced
  { resourceType: 'devices', readScope: 'okta.devices.read', manageScope: 'okta.devices.manage', adminRole: 'Super Admin', customRoleSupported: true, customRolePermission: 'okta.devices.manage' },
  { resourceType: 'profileMappings', readScope: 'okta.profileMappings.read', manageScope: 'okta.profileMappings.manage', adminRole: 'Super Admin', customRoleSupported: false },
  { resourceType: 'customRoles', readScope: 'okta.roles.read', manageScope: 'okta.roles.manage', adminRole: 'Super Admin', customRoleSupported: true, customRolePermission: 'okta.roles.manage' },
  { resourceType: 'realms', readScope: 'okta.realms.read', manageScope: 'okta.realms.manage', adminRole: 'Super Admin', customRoleSupported: true, customRolePermission: 'okta.realms.manage' },
  { resourceType: 'features', readScope: 'okta.features.read', manageScope: 'okta.features.manage', adminRole: 'Super Admin', customRoleSupported: false, notes: 'Feature flags require Super Admin' },
  { resourceType: 'pushProviders', readScope: 'okta.pushProviders.read', manageScope: 'okta.pushProviders.manage', adminRole: 'Super Admin', customRoleSupported: false },

  // Org settings
  { resourceType: 'orgSettings', readScope: 'okta.orgs.read', manageScope: 'okta.orgs.manage', adminRole: 'Super Admin', customRoleSupported: false, notes: 'Org settings require Super Admin' },

  // Governance (OIG) — requires Okta Identity Governance license
  { resourceType: 'governance', readScope: 'okta.governance.accessCertifications.read', manageScope: 'okta.governance.accessCertifications.manage', adminRole: 'Super Admin', customRoleSupported: false, notes: 'Governance resources require OIG license and Super Admin' },
];

// Resources that have NO OAuth scope — can only be managed with API key
// These endpoints exist but Okta doesn't expose OAuth scopes for them
export const API_KEY_ONLY_ENDPOINTS = [
  { endpoint: '/api/v1/meta/schemas/*', label: 'User/Group Schemas', reason: 'No OAuth scope available for schema management — use API key' },
  { endpoint: '/api/v1/templates/*', label: 'SMS Templates', reason: 'No OAuth scope for template management — use API key' },
  { endpoint: '/api/v1/threats/*', label: 'Threat Insight', reason: 'No OAuth scope for threat insight — use API key' },
  { endpoint: '/api/v1/api-tokens', label: 'API Tokens', reason: 'No OAuth scope for API token management — use API key' },
];

// Standard Okta admin roles
export const STANDARD_ADMIN_ROLES = [
  { role: 'Super Admin', description: 'Full access — can perform all admin tasks. Required for most Terraform operations.' },
  { role: 'Org Admin', description: 'Organization-wide settings, users, groups, apps, policies. Cannot grant admin access.' },
  { role: 'Application Admin', description: 'Manage assigned applications, user assignments, and app settings.' },
  { role: 'Group Admin', description: 'Manage assigned groups, add/remove users, edit group settings.' },
  { role: 'API Access Management Admin', description: 'Manage authorization servers, scopes, claims, and policies.' },
  { role: 'Help Desk Admin', description: 'Password resets, MFA resets, user activation/deactivation for assigned groups.' },
  { role: 'Read-only Admin', description: 'View-only access across users, groups, apps, and policies.' },
  { role: 'Report Admin', description: 'View and run reports, read-only system log access.' },
];

/**
 * Get recommended scopes and admin roles for selected resources.
 */
export function getRecommendations(
  selectedResources: ManagedResourceType[],
  operation: 'import' | 'create' | 'update' | 'full_lifecycle'
): {
  scopes: string[];
  adminRole: string;
  customRolePossible: boolean;
  customRolePermissions: string[];
  apiKeyOnlyWarnings: string[];
  customRoleWarnings: string[];
  notes: string[];
} {
  const needsWrite = operation !== 'import';
  const scopes = new Set<string>();
  const customPerms = new Set<string>();
  const apiKeyWarnings: string[] = [];
  const notes: string[] = [];
  let highestRole = 'Read-only Admin';
  let allCustomRoleSupported = true;

  // Always need orgs.read
  scopes.add('okta.orgs.read');

  const roleHierarchy = ['Read-only Admin', 'Help Desk Admin', 'Group Admin', 'Application Admin', 'API Access Management Admin', 'Org Admin', 'Super Admin'];

  for (const type of selectedResources) {
    const req = SCOPE_REQUIREMENTS.find(s => s.resourceType === type);
    if (!req) continue;

    // Add scopes
    if (req.readScope) scopes.add(req.readScope);
    if (needsWrite && req.manageScope) scopes.add(req.manageScope);

    // Track admin role
    const roleIdx = roleHierarchy.indexOf(req.adminRole);
    const currentIdx = roleHierarchy.indexOf(highestRole);
    if (roleIdx > currentIdx) highestRole = req.adminRole;

    // Track custom role support
    if (!req.customRoleSupported) {
      allCustomRoleSupported = false;
      if (req.notes) notes.push(req.notes);
    }
    if (req.customRolePermission) {
      customPerms.add(req.customRolePermission);
    }
  }

  // Add supplementary scopes for sub-resources bundled under parent types
  const hasUsers = selectedResources.includes('users');
  const hasGroups = selectedResources.includes('groups');
  if (hasUsers) {
    // User Types have their own OAuth scopes separate from okta.users.*
    scopes.add('okta.userTypes.read');
    if (needsWrite) scopes.add('okta.userTypes.manage');
  }

  // Check for API-key-only endpoints that might be needed
  if (hasUsers || hasGroups) {
    apiKeyWarnings.push('User/Group Schema properties (okta_user_schema_property, okta_group_schema_property) have no OAuth scope — requires API key');
  }

  // Custom admin role limitations for groups
  const customRoleWarnings: string[] = [];
  if (hasGroups && allCustomRoleSupported) {
    customRoleWarnings.push(
      'Custom admins cannot manage groups that are assigned to an admin role. If a group grants admin privileges, only a Super Admin or standard Group Admin with explicit assignment can modify it.'
    );
    customRoleWarnings.push(
      'Custom admins cannot modify group membership for groups containing users with admin roles. This is an Okta privilege escalation prevention mechanism.'
    );
  }

  return {
    scopes: [...scopes].sort(),
    adminRole: highestRole,
    customRolePossible: allCustomRoleSupported,
    customRolePermissions: [...customPerms].sort(),
    apiKeyOnlyWarnings: apiKeyWarnings,
    customRoleWarnings,
    notes,
  };
}

// Endpoint-specific permission requirements (for probe error diagnosis)
const ENDPOINT_PERMISSION_MAP: Record<string, string> = {
  '/api/v1/meta/schemas': 'Requires Super Admin role — no dedicated OAuth scope for schema management',
  '/api/v1/templates': 'Requires Super Admin role — no dedicated OAuth scope for template management',
  '/api/v1/threats': 'Requires Super Admin role — no dedicated OAuth scope for threat insight',
  '/api/v1/api-tokens': 'Requires Super Admin role — API token management is admin-only',
};

/**
 * Diagnose a probe failure and suggest the fix.
 */
export function diagnoseProbeFailure(
  endpoint: string,
  label: string,
  httpStatus: number | undefined,
  errorCode: string | undefined,
  _grantedScopes?: string[]
): string {
  // Check endpoint-specific requirements
  const endpointReq = Object.entries(ENDPOINT_PERMISSION_MAP).find(([path]) =>
    endpoint.includes(path)
  );
  if ((httpStatus === 403 || httpStatus === 401) && endpointReq) {
    return endpointReq[1];
  }

  // Find matching resource type
  const scopeReq = SCOPE_REQUIREMENTS.find(s => {
    const labelLower = label.toLowerCase();
    return labelLower.includes(s.resourceType.toLowerCase()) ||
      labelLower.includes(s.resourceType.replace(/s$/, '').toLowerCase());
  });

  if (httpStatus === 401 && errorCode === 'E0000015') {
    return 'Feature not licensed — this API requires a feature not enabled on your org.';
  }

  if (httpStatus === 401) {
    return 'Unauthorized — API token may lack required scope or is expired.';
  }

  if (httpStatus === 403) {
    return scopeReq
      ? `Forbidden — requires "${scopeReq.adminRole}" admin role.`
      : 'Forbidden — insufficient admin privileges.';
  }

  return `HTTP ${httpStatus ?? '?'} error.`;
}
