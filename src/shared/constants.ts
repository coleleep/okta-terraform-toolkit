import { TerraformProviderConfig, ManagedResourceType, OperationType } from './types';

export interface ProbeEndpointDef {
  endpoint: string;
  label: string;
}

// Top-level endpoints probed on initial scan (no resource ID needed)
export const PROBE_ENDPOINTS: ProbeEndpointDef[] = [
  // Core resources
  { endpoint: '/api/v1/users?limit=1', label: 'Users' },
  // /api/v1/users/me doesn't work with OAuth client credentials (no user session)
  { endpoint: '/api/v1/groups?limit=1', label: 'Groups' },
  { endpoint: '/api/v1/apps?limit=1', label: 'Applications' },
  { endpoint: '/api/v1/authorizationServers?limit=1', label: 'Auth Servers' },
  { endpoint: '/api/v1/policies?type=OKTA_SIGN_ON&limit=1', label: 'Policies' },
  { endpoint: '/api/v1/idps?limit=1', label: 'Identity Providers' },
  { endpoint: '/api/v1/zones?limit=1', label: 'Network Zones' },
  { endpoint: '/api/v1/trustedOrigins?limit=1', label: 'Trusted Origins' },
  // Security & auth
  { endpoint: '/api/v1/authenticators?limit=1', label: 'Authenticators' },
  { endpoint: '/api/v1/behaviors?limit=1', label: 'Behaviors' },
  { endpoint: '/api/v1/captchas?limit=1', label: 'CAPTCHAs' },
  { endpoint: '/api/v1/threats/configuration', label: 'Threat Insight' },
  // Infrastructure
  { endpoint: '/api/v1/domains?limit=1', label: 'Domains' },
  { endpoint: '/api/v1/email-domains?limit=1', label: 'Email Domains' },
  { endpoint: '/api/v1/brands?limit=1', label: 'Brands' },
  // Hooks & streams
  { endpoint: '/api/v1/eventHooks?limit=1', label: 'Event Hooks' },
  { endpoint: '/api/v1/inlineHooks?limit=1', label: 'Inline Hooks' },
  { endpoint: '/api/v1/logStreams?limit=1', label: 'Log Streams' },
  // Devices
  { endpoint: '/api/v1/devices?limit=1', label: 'Devices' },
  // IAM
  { endpoint: '/api/v1/iam/roles?limit=1', label: 'Custom Roles' },
  // Mappings & features
  { endpoint: '/api/v1/mappings?limit=1', label: 'Profile Mappings' },
  { endpoint: '/api/v1/features?limit=1', label: 'Features' },
  { endpoint: '/api/v1/push-providers?limit=1', label: 'Push Providers' },
  { endpoint: '/api/v1/realms?limit=1', label: 'Realms' },
  // Schemas & meta
  { endpoint: '/api/v1/meta/schemas/user/default', label: 'User Schema (default)' },
  { endpoint: '/api/v1/meta/schemas/group/default', label: 'Group Schema (default)' },
  { endpoint: '/api/v1/meta/types/user?limit=1', label: 'User Types' },
  // Org & misc
  { endpoint: '/api/v1/org', label: 'Org Settings' },
  { endpoint: '/api/v1/templates/sms', label: 'Templates' },
  { endpoint: '/api/v1/api-tokens?limit=1', label: 'API Tokens' },
  // Governance (OIG)
  { endpoint: '/api/v1/governance/campaigns?limit=1', label: 'Governance' },
];

export const TERRAFORM_DEFAULTS: TerraformProviderConfig = {
  max_retries: 5,
  backoff: true,
  min_wait_seconds: 30,
  max_wait_seconds: 300,
  request_timeout: 0,
  max_api_capacity: 100,
  parallelism: 10,
};

export const PROBE_TIMEOUT_MS = 10000;

// Status thresholds (remaining / limit ratio)
export const STATUS_OK_THRESHOLD = 0.5;
export const STATUS_WARNING_THRESHOLD = 0.1;

// Resource type definitions for selection & counting
// Covers all major resource categories in Okta Terraform Provider v6.12.0
export interface ResourceTypeDef {
  type: ManagedResourceType;
  label: string;
  countEndpoint: string;
  probeLabel: string;
  category: 'core' | 'security' | 'infrastructure' | 'hooks' | 'advanced' | 'org' | 'governance';
}

export const RESOURCE_TYPES: ResourceTypeDef[] = [
  // Core
  { type: 'users', label: 'Users', countEndpoint: '/api/v1/users?limit=1', probeLabel: 'Users', category: 'core' },
  { type: 'groups', label: 'Groups', countEndpoint: '/api/v1/groups?limit=1', probeLabel: 'Groups', category: 'core' },
  { type: 'applications', label: 'Applications', countEndpoint: '/api/v1/apps?limit=1', probeLabel: 'Applications', category: 'core' },
  { type: 'authServers', label: 'Auth Servers', countEndpoint: '/api/v1/authorizationServers?limit=1', probeLabel: 'Auth Servers', category: 'core' },
  { type: 'policies', label: 'Policies', countEndpoint: '/api/v1/policies?type=OKTA_SIGN_ON&limit=1', probeLabel: 'Policies', category: 'core' },
  { type: 'idps', label: 'Identity Providers', countEndpoint: '/api/v1/idps?limit=1', probeLabel: 'Identity Providers', category: 'core' },
  // Security
  { type: 'authenticators', label: 'Authenticators', countEndpoint: '/api/v1/authenticators?limit=1', probeLabel: 'Authenticators', category: 'security' },
  { type: 'behaviors', label: 'Behaviors', countEndpoint: '/api/v1/behaviors?limit=1', probeLabel: 'Behaviors', category: 'security' },
  { type: 'captchas', label: 'CAPTCHAs', countEndpoint: '/api/v1/captchas?limit=1', probeLabel: 'CAPTCHAs', category: 'security' },
  // Infrastructure
  { type: 'networkZones', label: 'Network Zones', countEndpoint: '/api/v1/zones?limit=1', probeLabel: 'Network Zones', category: 'infrastructure' },
  { type: 'trustedOrigins', label: 'Trusted Origins', countEndpoint: '/api/v1/trustedOrigins?limit=1', probeLabel: 'Trusted Origins', category: 'infrastructure' },
  { type: 'domains', label: 'Domains', countEndpoint: '/api/v1/domains?limit=1', probeLabel: 'Domains', category: 'infrastructure' },
  { type: 'emailDomains', label: 'Email Domains', countEndpoint: '/api/v1/email-domains?limit=1', probeLabel: 'Email Domains', category: 'infrastructure' },
  { type: 'brands', label: 'Brands', countEndpoint: '/api/v1/brands?limit=1', probeLabel: 'Brands', category: 'infrastructure' },
  // Hooks & streams
  { type: 'eventHooks', label: 'Event Hooks', countEndpoint: '/api/v1/eventHooks?limit=1', probeLabel: 'Event Hooks', category: 'hooks' },
  { type: 'inlineHooks', label: 'Inline Hooks', countEndpoint: '/api/v1/inlineHooks?limit=1', probeLabel: 'Inline Hooks', category: 'hooks' },
  { type: 'logStreams', label: 'Log Streams', countEndpoint: '/api/v1/logStreams?limit=1', probeLabel: 'Log Streams', category: 'hooks' },
  // Advanced
  { type: 'devices', label: 'Devices', countEndpoint: '/api/v1/devices?limit=1', probeLabel: 'Devices', category: 'advanced' },
  { type: 'profileMappings', label: 'Profile Mappings', countEndpoint: '/api/v1/mappings?limit=1', probeLabel: 'Profile Mappings', category: 'advanced' },
  { type: 'customRoles', label: 'Custom Roles', countEndpoint: '/api/v1/iam/roles?limit=1', probeLabel: 'Custom Roles', category: 'advanced' },
  { type: 'realms', label: 'Realms', countEndpoint: '/api/v1/realms?limit=1', probeLabel: 'Realms', category: 'advanced' },
  { type: 'features', label: 'Features', countEndpoint: '/api/v1/features?limit=1', probeLabel: 'Features', category: 'advanced' },
  { type: 'pushProviders', label: 'Push Providers', countEndpoint: '/api/v1/push-providers?limit=1', probeLabel: 'Push Providers', category: 'advanced' },
  { type: 'identitySources', label: 'Identity Sources', countEndpoint: '/api/v1/identity-sources?limit=1', probeLabel: 'Identity Sources', category: 'advanced' },
  // Org settings
  { type: 'orgSettings', label: 'Org Settings', countEndpoint: '/api/v1/org', probeLabel: 'Org Settings', category: 'org' },
  // Governance (requires OIG license)
  { type: 'governance', label: 'Governance', countEndpoint: '/api/v1/governance/campaigns?limit=1', probeLabel: 'Governance', category: 'governance' },
];

export const RESOURCE_CATEGORIES: { key: string; label: string }[] = [
  { key: 'core', label: 'Core Resources' },
  { key: 'security', label: 'Security & MFA' },
  { key: 'infrastructure', label: 'Infrastructure' },
  { key: 'hooks', label: 'Hooks & Streams' },
  { key: 'advanced', label: 'Advanced' },
  { key: 'org', label: 'Org Settings' },
  { key: 'governance', label: 'Governance (OIG)' },
];

// Thresholds for volume-based recommendation adjustments
export const HIGH_VOLUME_THRESHOLD = 1000;
export const VERY_HIGH_VOLUME_THRESHOLD = 10000;

// Operation type definitions
export interface OperationDef {
  type: OperationType;
  label: string;
  description: string;
  apiCallsPerResource: number;
  writeFactor: number;
}

export const OPERATIONS: OperationDef[] = [
  {
    type: 'import',
    label: 'Import Existing',
    description: 'Import existing resources into Terraform state (read-heavy)',
    apiCallsPerResource: 2,
    writeFactor: 0,
  },
  {
    type: 'create',
    label: 'Create New',
    description: 'Create new resources via Terraform (write-heavy)',
    apiCallsPerResource: 3,
    writeFactor: 0.8,
  },
  {
    type: 'update',
    label: 'Update / Modify',
    description: 'Modify existing managed resources (mixed reads + writes)',
    apiCallsPerResource: 4,
    writeFactor: 0.5,
  },
  {
    type: 'full_lifecycle',
    label: 'Full Lifecycle',
    description: 'Plan, create, update, and destroy — all operations',
    apiCallsPerResource: 5,
    writeFactor: 0.7,
  },
];

// Prevention options that affect API call counts
// Each option maps to specific sub-resource endpoints that get skipped/added
export interface PreventionOptionDef {
  key: keyof import('./types').PreventionOptions;
  label: string;
  description: string;
  terraformAttr: string;
  status: 'active' | 'deprecated';
  affectedResource: ManagedResourceType;
  endpointAffected: string;
  // How many extra API calls per resource when this option is active
  // Positive = adds calls (include_*), effectively captured by the toggle being ON
  // For skip_* options: when skip is OFF (default), calls happen; when ON, calls are skipped
  extraCallsPerResource: number;
}

export const PREVENTION_OPTIONS: PreventionOptionDef[] = [
  {
    key: 'skipAppUsers',
    label: 'Skip App Users',
    description: 'Skip fetching user assignments per app. Saves 1 API call per app.',
    terraformAttr: 'skip_users',
    status: 'deprecated',
    affectedResource: 'applications',
    endpointAffected: '/api/v1/apps/{id}/users',
    extraCallsPerResource: 1,
  },
  {
    key: 'skipAppGroups',
    label: 'Skip App Groups',
    description: 'Skip fetching group assignments per app. Saves 1 API call per app.',
    terraformAttr: 'skip_groups',
    status: 'deprecated',
    affectedResource: 'applications',
    endpointAffected: '/api/v1/apps/{id}/groups',
    extraCallsPerResource: 1,
  },
  {
    key: 'includeUserRoles',
    label: 'Include User Roles',
    description: 'Fetch admin roles for each user. Adds 1 API call per user.',
    terraformAttr: 'include_roles',
    status: 'active',
    affectedResource: 'users',
    endpointAffected: '/api/v1/users/{id}/roles',
    extraCallsPerResource: 1,
  },
  {
    key: 'includeUserGroups',
    label: 'Include User Groups',
    description: 'Fetch group memberships for each user. Adds 1 API call per user.',
    terraformAttr: 'include_groups',
    status: 'active',
    affectedResource: 'users',
    endpointAffected: '/api/v1/users/{id}/groups',
    extraCallsPerResource: 1,
  },
  {
    key: 'includeGroupUsers',
    label: 'Include Group Users',
    description: 'Fetch member list for each group. Adds 1+ API calls per group (paginated).',
    terraformAttr: 'include_users',
    status: 'active',
    affectedResource: 'groups',
    endpointAffected: '/api/v1/groups/{id}/users',
    extraCallsPerResource: 2, // often paginated
  },
];

// Sub-resource endpoints to deep-probe per resource type (v6.6.1 complete)
// {id} is replaced with a real resource ID at probe time
export interface SubResourceEndpointDef {
  parentType: ManagedResourceType;
  endpoint: string;
  label: string;
  probeLabel: string;
  method?: 'GET' | 'POST'; // default GET; POST sends empty body for write rate limit probing
}

// NOTE: Lifecycle endpoints (/lifecycle/activate, /deactivate, etc.) are POST-only
// and return 405 on GET with no rate limit headers. They share rate limit buckets
// with their parent resource endpoints, so probing the parent GET is sufficient.
export const SUB_RESOURCE_ENDPOINTS: SubResourceEndpointDef[] = [
  // === Applications (v6.6.1: okta_app_*, okta_app_saml, okta_app_oauth, etc.) ===
  { parentType: 'applications', endpoint: '/api/v1/apps/{id}', label: 'App (single)', probeLabel: 'Applications' },
  { parentType: 'applications', endpoint: '/api/v1/apps/{id}/users?limit=1', label: 'App User Assignments', probeLabel: 'Applications' },
  { parentType: 'applications', endpoint: '/api/v1/apps/{id}/groups?limit=1', label: 'App Group Assignments', probeLabel: 'Applications' },
  { parentType: 'applications', endpoint: '/api/v1/apps/{id}/credentials/keys', label: 'App Credential Keys', probeLabel: 'Applications' },
  { parentType: 'applications', endpoint: '/api/v1/apps/{id}/credentials/secrets', label: 'App Credential Secrets', probeLabel: 'Applications' },
  { parentType: 'applications', endpoint: '/api/v1/apps/{id}/sso/saml/metadata', label: 'App SAML Metadata', probeLabel: 'Applications' },
  { parentType: 'applications', endpoint: '/api/v1/apps/{id}/grants', label: 'App Grants', probeLabel: 'Applications' },
  { parentType: 'applications', endpoint: '/api/v1/meta/schemas/apps/{id}/default', label: 'App User Schema', probeLabel: 'Applications' },
  // Removed: appSettings, settings/signon, scopeConsentGrants, oauth2/{id}/keys, pushGroups
  // These return 405 with no rate limit headers — Okta's WAF rejects the method before
  // the API layer. They share rate limit buckets with /api/v1/apps.

  // === Users (v6.6.1: okta_user, okta_user_*, okta_user_type, etc.) ===
  { parentType: 'users', endpoint: '/api/v1/users/{id}', label: 'User (single)', probeLabel: 'Users' },
  { parentType: 'users', endpoint: '/api/v1/users/{id}/appLinks', label: 'User App Links', probeLabel: 'Users' },
  { parentType: 'users', endpoint: '/api/v1/users/{id}/groups', label: 'User Groups', probeLabel: 'Users' },
  { parentType: 'users', endpoint: '/api/v1/users/{id}/roles', label: 'User Admin Roles', probeLabel: 'Users' },
  { parentType: 'users', endpoint: '/api/v1/users/{id}/factors', label: 'User Factors', probeLabel: 'Users' },
  { parentType: 'users', endpoint: '/api/v1/users/{id}/factors/questions', label: 'User Factor Questions', probeLabel: 'Users' },
  { parentType: 'users', endpoint: '/api/v1/users/{id}/blocks', label: 'User Blocks', probeLabel: 'Users' },
  { parentType: 'users', endpoint: '/api/v1/meta/schemas/user/default', label: 'User Schema', probeLabel: 'Users' },
  { parentType: 'users', endpoint: '/api/v1/meta/types/user?limit=1', label: 'User Types', probeLabel: 'Users' },
  { parentType: 'users', endpoint: '/api/v1/meta/schemas/user/linkedObjects', label: 'Linked Objects', probeLabel: 'Users' },

  // === Groups (v6.6.1: okta_group, okta_group_*, okta_group_rule, etc.) ===
  { parentType: 'groups', endpoint: '/api/v1/groups/{id}', label: 'Group (single)', probeLabel: 'Groups' },
  { parentType: 'groups', endpoint: '/api/v1/groups/{id}/users?limit=1', label: 'Group Members', probeLabel: 'Groups' },
  { parentType: 'groups', endpoint: '/api/v1/groups/{id}/owners', label: 'Group Owners', probeLabel: 'Groups' },
  { parentType: 'groups', endpoint: '/api/v1/groups/{id}/apps', label: 'Group Apps', probeLabel: 'Groups' },
  { parentType: 'groups', endpoint: '/api/v1/groups/rules?limit=1', label: 'Group Rules', probeLabel: 'Groups' },
  { parentType: 'groups', endpoint: '/api/v1/meta/schemas/group/default', label: 'Group Schema', probeLabel: 'Groups' },

  // === Auth Servers (v6.6.1: okta_auth_server, okta_auth_server_*) ===
  { parentType: 'authServers', endpoint: '/api/v1/authorizationServers/{id}', label: 'Auth Server (single)', probeLabel: 'Auth Servers' },
  { parentType: 'authServers', endpoint: '/api/v1/authorizationServers/{id}/policies', label: 'Auth Server Policies', probeLabel: 'Auth Servers' },
  { parentType: 'authServers', endpoint: '/api/v1/authorizationServers/{id}/scopes', label: 'Auth Server Scopes', probeLabel: 'Auth Servers' },
  { parentType: 'authServers', endpoint: '/api/v1/authorizationServers/{id}/claims', label: 'Auth Server Claims', probeLabel: 'Auth Servers' },
  { parentType: 'authServers', endpoint: '/api/v1/authorizationServers/{id}/clients', label: 'Auth Server Clients', probeLabel: 'Auth Servers' },

  // === Policies (v6.6.1: okta_policy_*, okta_policy_rule_*) ===
  { parentType: 'policies', endpoint: '/api/v1/policies/{id}/rules', label: 'Policy Rules', probeLabel: 'Policies' },

  // === IDPs (v6.6.1: okta_idp_oidc, okta_idp_saml, okta_idp_social) ===
  { parentType: 'idps', endpoint: '/api/v1/idps/{id}', label: 'IDP (single)', probeLabel: 'Identity Providers' },
  { parentType: 'idps', endpoint: '/api/v1/idps/{id}/credentials/keys', label: 'IDP Credential Keys', probeLabel: 'Identity Providers' },

  // === Authenticators (v6.6.1: okta_authenticator) ===
  { parentType: 'authenticators', endpoint: '/api/v1/authenticators/{id}', label: 'Authenticator (single)', probeLabel: 'Authenticators' },
  { parentType: 'authenticators', endpoint: '/api/v1/authenticators/{id}/methods', label: 'Authenticator Methods', probeLabel: 'Authenticators' },

  // === Network Zones (v6.6.1: okta_network_zone) ===
  { parentType: 'networkZones', endpoint: '/api/v1/zones/{id}', label: 'Zone (single)', probeLabel: 'Network Zones' },

  // === Trusted Origins (v6.6.1: okta_trusted_origin) ===
  { parentType: 'trustedOrigins', endpoint: '/api/v1/trustedOrigins/{id}', label: 'Trusted Origin (single)', probeLabel: 'Trusted Origins' },

  // === Behaviors (v6.6.1: okta_behavior) ===
  { parentType: 'behaviors', endpoint: '/api/v1/behaviors/{id}', label: 'Behavior (single)', probeLabel: 'Behaviors' },

  // === Domains (v6.6.1: okta_domain, okta_domain_certificate) ===
  { parentType: 'domains', endpoint: '/api/v1/domains/{id}', label: 'Domain (single)', probeLabel: 'Domains' },
  { parentType: 'domains', endpoint: '/api/v1/domains/{id}/certificate', label: 'Domain Certificate', probeLabel: 'Domains' },

  // === Email Domains (v6.6.1: okta_email_domain, okta_email_*) ===
  { parentType: 'emailDomains', endpoint: '/api/v1/email-domains/{id}', label: 'Email Domain (single)', probeLabel: 'Email Domains' },

  // === Brands (v6.6.1: okta_brand, okta_theme, okta_customized_signin_page) ===
  { parentType: 'brands', endpoint: '/api/v1/brands/{id}', label: 'Brand (single)', probeLabel: 'Brands' },
  { parentType: 'brands', endpoint: '/api/v1/brands/{id}/themes', label: 'Brand Themes', probeLabel: 'Brands' },
  { parentType: 'brands', endpoint: '/api/v1/brands/{id}/domains', label: 'Brand Domains', probeLabel: 'Brands' },

  // === Event Hooks (v6.6.1: okta_event_hook) ===
  { parentType: 'eventHooks', endpoint: '/api/v1/eventHooks/{id}', label: 'Event Hook (single)', probeLabel: 'Event Hooks' },

  // === Inline Hooks (v6.6.1: okta_inline_hook) ===
  { parentType: 'inlineHooks', endpoint: '/api/v1/inlineHooks/{id}', label: 'Inline Hook (single)', probeLabel: 'Inline Hooks' },

  // === Log Streams (v6.6.1: okta_log_stream) ===
  { parentType: 'logStreams', endpoint: '/api/v1/logStreams/{id}', label: 'Log Stream (single)', probeLabel: 'Log Streams' },

  // === Devices (v6.6.1: okta_device) ===
  { parentType: 'devices', endpoint: '/api/v1/devices/{id}', label: 'Device (single)', probeLabel: 'Devices' },
  { parentType: 'devices', endpoint: '/api/v1/devices/{id}/users', label: 'Device Users', probeLabel: 'Devices' },

  // === Custom Roles (v6.6.1: okta_admin_role_custom) ===
  { parentType: 'customRoles', endpoint: '/api/v1/iam/roles/{id}', label: 'Custom Role (single)', probeLabel: 'Custom Roles' },

  // === Features (v6.6.1: okta_feature) ===
  { parentType: 'features', endpoint: '/api/v1/features/{id}', label: 'Feature (single)', probeLabel: 'Features' },
  { parentType: 'features', endpoint: '/api/v1/features/{id}/dependencies', label: 'Feature Dependencies', probeLabel: 'Features' },
  { parentType: 'features', endpoint: '/api/v1/features/{id}/dependents', label: 'Feature Dependents', probeLabel: 'Features' },

  // === Realms (v6.6.1: okta_realm) ===
  { parentType: 'realms', endpoint: '/api/v1/realms/{id}', label: 'Realm (single)', probeLabel: 'Realms' },

  // === Push Providers (v6.6.1: okta_push_provider) ===
  { parentType: 'pushProviders', endpoint: '/api/v1/push-providers/{id}', label: 'Push Provider (single)', probeLabel: 'Push Providers' },

  // === Write probes (POST with empty body → 400 but with rate limit headers) ===
  // These reveal write rate limit buckets which may differ from read buckets.
  { parentType: 'users', endpoint: '/api/v1/users', label: 'User Create (write)', probeLabel: 'Users', method: 'POST' },
  { parentType: 'groups', endpoint: '/api/v1/groups', label: 'Group Create (write)', probeLabel: 'Groups', method: 'POST' },
  { parentType: 'applications', endpoint: '/api/v1/apps', label: 'App Create (write)', probeLabel: 'Applications', method: 'POST' },
  { parentType: 'authServers', endpoint: '/api/v1/authorizationServers', label: 'Auth Server Create (write)', probeLabel: 'Auth Servers', method: 'POST' },
  { parentType: 'idps', endpoint: '/api/v1/idps', label: 'IDP Create (write)', probeLabel: 'Identity Providers', method: 'POST' },
  { parentType: 'networkZones', endpoint: '/api/v1/zones', label: 'Zone Create (write)', probeLabel: 'Network Zones', method: 'POST' },
  { parentType: 'trustedOrigins', endpoint: '/api/v1/trustedOrigins', label: 'Trusted Origin Create (write)', probeLabel: 'Trusted Origins', method: 'POST' },
  { parentType: 'authenticators', endpoint: '/api/v1/authenticators', label: 'Authenticator Create (write)', probeLabel: 'Authenticators', method: 'POST' },
  { parentType: 'behaviors', endpoint: '/api/v1/behaviors', label: 'Behavior Create (write)', probeLabel: 'Behaviors', method: 'POST' },
  { parentType: 'domains', endpoint: '/api/v1/domains', label: 'Domain Create (write)', probeLabel: 'Domains', method: 'POST' },
  { parentType: 'emailDomains', endpoint: '/api/v1/email-domains', label: 'Email Domain Create (write)', probeLabel: 'Email Domains', method: 'POST' },
  { parentType: 'eventHooks', endpoint: '/api/v1/eventHooks', label: 'Event Hook Create (write)', probeLabel: 'Event Hooks', method: 'POST' },
  { parentType: 'inlineHooks', endpoint: '/api/v1/inlineHooks', label: 'Inline Hook Create (write)', probeLabel: 'Inline Hooks', method: 'POST' },
  { parentType: 'logStreams', endpoint: '/api/v1/logStreams', label: 'Log Stream Create (write)', probeLabel: 'Log Streams', method: 'POST' },
  { parentType: 'customRoles', endpoint: '/api/v1/iam/roles', label: 'Custom Role Create (write)', probeLabel: 'Custom Roles', method: 'POST' },
  { parentType: 'realms', endpoint: '/api/v1/realms', label: 'Realm Create (write)', probeLabel: 'Realms', method: 'POST' },
];

// Terraform resource type mappings for import block generation (v6.6.1)
export interface TerraformResourceMapping {
  managedType: ManagedResourceType;
  terraformType: string;
  dataSource?: string;
}

export const TERRAFORM_RESOURCE_MAPPINGS: TerraformResourceMapping[] = [
  { managedType: 'users', terraformType: 'okta_user' },
  { managedType: 'groups', terraformType: 'okta_group' },
  { managedType: 'applications', terraformType: 'okta_app_oauth' },
  { managedType: 'authServers', terraformType: 'okta_auth_server' },
  { managedType: 'policies', terraformType: 'okta_policy_signon' },
  { managedType: 'idps', terraformType: 'okta_idp_oidc' },
  { managedType: 'networkZones', terraformType: 'okta_network_zone' },
  { managedType: 'trustedOrigins', terraformType: 'okta_trusted_origin' },
  { managedType: 'authenticators', terraformType: 'okta_authenticator' },
  { managedType: 'behaviors', terraformType: 'okta_behavior' },
  { managedType: 'captchas', terraformType: 'okta_captcha' },
  { managedType: 'domains', terraformType: 'okta_domain' },
  { managedType: 'emailDomains', terraformType: 'okta_email_domain' },
  { managedType: 'brands', terraformType: 'okta_brand' },
  { managedType: 'eventHooks', terraformType: 'okta_event_hook' },
  { managedType: 'inlineHooks', terraformType: 'okta_inline_hook' },
  { managedType: 'logStreams', terraformType: 'okta_log_stream' },
  { managedType: 'devices', terraformType: 'okta_device' },
  { managedType: 'profileMappings', terraformType: 'okta_profile_mapping' },
  { managedType: 'customRoles', terraformType: 'okta_admin_role_custom' },
  { managedType: 'realms', terraformType: 'okta_realm' },
  { managedType: 'features', terraformType: 'okta_feature' },
  { managedType: 'pushProviders', terraformType: 'okta_push_provider' },
  { managedType: 'orgSettings', terraformType: 'okta_org_configuration' },
  { managedType: 'governance', terraformType: 'okta_campaign' },
];

// Sub-resource sync configuration for cross-org migration
// Maps sub-resource terraform types to their parent relationships and API endpoints
export interface SubResourceSyncDef {
  parentTerraformType: string;
  parentIdField: string;          // attribute name in tfstate that references the parent ID
  listEndpoint: string;           // API endpoint pattern with {parentId} placeholder
  level: number;                  // 1 = child, 2 = grandchild
  grandparentIdField?: string;    // for level 2: attribute referencing the grandparent ID
}

export const SUB_RESOURCE_SYNC_CONFIG: Record<string, SubResourceSyncDef> = {
  // ─── Auth Server children (level 1) ───
  okta_auth_server_policy: {
    parentTerraformType: 'okta_auth_server',
    parentIdField: 'auth_server_id',
    listEndpoint: '/api/v1/authorizationServers/{parentId}/policies',
    level: 1,
  },
  okta_auth_server_scope: {
    parentTerraformType: 'okta_auth_server',
    parentIdField: 'auth_server_id',
    listEndpoint: '/api/v1/authorizationServers/{parentId}/scopes',
    level: 1,
  },
  okta_auth_server_claim: {
    parentTerraformType: 'okta_auth_server',
    parentIdField: 'auth_server_id',
    listEndpoint: '/api/v1/authorizationServers/{parentId}/claims',
    level: 1,
  },
  // ─── Auth Server grandchildren (level 2) ───
  okta_auth_server_policy_rule: {
    parentTerraformType: 'okta_auth_server_policy',
    parentIdField: 'policy_id',
    listEndpoint: '/api/v1/authorizationServers/{grandparentId}/policies/{parentId}/rules',
    level: 2,
    grandparentIdField: 'auth_server_id',
  },
  // ─── Policy rules (level 1 — children of global policies) ───
  okta_policy_rule_signon: {
    parentTerraformType: 'okta_policy_signon',
    parentIdField: 'policy_id',
    listEndpoint: '/api/v1/policies/{parentId}/rules',
    level: 1,
  },
  okta_policy_rule_password: {
    parentTerraformType: 'okta_policy_password',
    parentIdField: 'policy_id',
    listEndpoint: '/api/v1/policies/{parentId}/rules',
    level: 1,
  },
  okta_policy_rule_mfa: {
    parentTerraformType: 'okta_policy_mfa',
    parentIdField: 'policy_id',
    listEndpoint: '/api/v1/policies/{parentId}/rules',
    level: 1,
  },
  okta_policy_rule_profile_enrollment: {
    parentTerraformType: 'okta_policy_profile_enrollment',
    parentIdField: 'policy_id',
    listEndpoint: '/api/v1/policies/{parentId}/rules',
    level: 1,
  },
  okta_policy_rule_idp_discovery: {
    parentTerraformType: 'okta_policy_signon',
    parentIdField: 'policy_id',
    listEndpoint: '/api/v1/policies/{parentId}/rules',
    level: 1,
  },
  // ─── App assignments (level 1 — children of apps) ───
  okta_app_user: {
    parentTerraformType: 'okta_app_oauth',
    parentIdField: 'app_id',
    listEndpoint: '/api/v1/apps/{parentId}/users',
    level: 1,
  },
  okta_app_group_assignment: {
    parentTerraformType: 'okta_app_oauth',
    parentIdField: 'app_id',
    listEndpoint: '/api/v1/apps/{parentId}/groups',
    level: 1,
  },
  okta_app_group_assignments: {
    parentTerraformType: 'okta_app_oauth',
    parentIdField: 'app_id',
    listEndpoint: '/api/v1/apps/{parentId}/groups',
    level: 1,
  },
  // ─── Group memberships (level 1 — children of groups) ───
  okta_group_memberships: {
    parentTerraformType: 'okta_group',
    parentIdField: 'group_id',
    listEndpoint: '/api/v1/groups/{parentId}/users',
    level: 1,
  },
};
