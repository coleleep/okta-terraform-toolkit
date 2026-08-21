import { ManagedResourceType } from './types';
import { RESOURCE_TYPES } from './constants';

export interface ResourceDictionaryEntry {
  terraformResource: string;
  parentType: ManagedResourceType;
  parentLabel: string;
  /** The probed endpoint pattern this resource primarily hits for rate limits */
  primaryEndpoint?: string;
  /** Display label for the endpoint (matches probe labels) */
  endpointLabel?: string;
}

export const RESOURCE_DICTIONARY: ResourceDictionaryEntry[] = [
  // ─── Users ───
  { terraformResource: 'okta_user', parentType: 'users', parentLabel: 'Users' },
  { terraformResource: 'okta_user_type', parentType: 'users', parentLabel: 'Users' },
  { terraformResource: 'okta_user_base_schema_property', parentType: 'users', parentLabel: 'Users' },
  { terraformResource: 'okta_user_schema_property', parentType: 'users', parentLabel: 'Users' },
  { terraformResource: 'okta_user_admin_roles', parentType: 'users', parentLabel: 'Users' },
  { terraformResource: 'okta_user_factor_question', parentType: 'users', parentLabel: 'Users' },
  { terraformResource: 'okta_user_group_memberships', parentType: 'users', parentLabel: 'Users' },
  { terraformResource: 'okta_user_risk', parentType: 'users', parentLabel: 'Users' },
  { terraformResource: 'okta_factor', parentType: 'users', parentLabel: 'Users' },
  { terraformResource: 'okta_factor_totp', parentType: 'users', parentLabel: 'Users' },
  { terraformResource: 'okta_link_definition', parentType: 'users', parentLabel: 'Users' },
  { terraformResource: 'okta_link_value', parentType: 'users', parentLabel: 'Users' },
  { terraformResource: 'okta_template_sms', parentType: 'users', parentLabel: 'Users' },

  // ─── Groups ───
  { terraformResource: 'okta_group', parentType: 'groups', parentLabel: 'Groups' },
  { terraformResource: 'okta_group_rule', parentType: 'groups', parentLabel: 'Groups' },
  { terraformResource: 'okta_group_memberships', parentType: 'groups', parentLabel: 'Groups', primaryEndpoint: '/api/v1/groups/<id>/users', endpointLabel: 'Group Members' },
  { terraformResource: 'okta_group_schema_property', parentType: 'groups', parentLabel: 'Groups' },
  { terraformResource: 'okta_group_owner', parentType: 'groups', parentLabel: 'Groups' },
  { terraformResource: 'okta_group_owners', parentType: 'groups', parentLabel: 'Groups' },
  { terraformResource: 'okta_group_role', parentType: 'groups', parentLabel: 'Groups' },

  // ─── Applications ───
  { terraformResource: 'okta_app_oauth', parentType: 'applications', parentLabel: 'Applications' },
  { terraformResource: 'okta_app_saml', parentType: 'applications', parentLabel: 'Applications' },
  { terraformResource: 'okta_app_swa', parentType: 'applications', parentLabel: 'Applications' },
  { terraformResource: 'okta_app_basic_auth', parentType: 'applications', parentLabel: 'Applications' },
  { terraformResource: 'okta_app_bookmark', parentType: 'applications', parentLabel: 'Applications' },
  { terraformResource: 'okta_app_auto_login', parentType: 'applications', parentLabel: 'Applications' },
  { terraformResource: 'okta_app_shared_credentials', parentType: 'applications', parentLabel: 'Applications' },
  { terraformResource: 'okta_app_secure_password_store', parentType: 'applications', parentLabel: 'Applications' },
  { terraformResource: 'okta_app_three_field', parentType: 'applications', parentLabel: 'Applications' },
  { terraformResource: 'okta_app_group_assignment', parentType: 'applications', parentLabel: 'Applications', primaryEndpoint: '/api/v1/apps/<id>/groups', endpointLabel: 'App Group Assignments' },
  { terraformResource: 'okta_app_group_assignments', parentType: 'applications', parentLabel: 'Applications', primaryEndpoint: '/api/v1/apps/<id>/groups', endpointLabel: 'App Group Assignments' },
  { terraformResource: 'okta_app_user', parentType: 'applications', parentLabel: 'Applications', primaryEndpoint: '/api/v1/apps/<id>/users', endpointLabel: 'App User Assignments' },
  { terraformResource: 'okta_app_signon_policy', parentType: 'applications', parentLabel: 'Applications', primaryEndpoint: '/api/v1/apps/<id>', endpointLabel: 'Applications' },
  { terraformResource: 'okta_app_signon_policy_rule', parentType: 'applications', parentLabel: 'Applications', primaryEndpoint: '/api/v1/apps/<id>', endpointLabel: 'Applications' },
  { terraformResource: 'okta_app_signon_policy_rules', parentType: 'applications', parentLabel: 'Applications', primaryEndpoint: '/api/v1/apps/<id>', endpointLabel: 'Applications' },
  { terraformResource: 'okta_app_access_policy_assignment', parentType: 'applications', parentLabel: 'Applications' },
  { terraformResource: 'okta_app_oauth_api_scope', parentType: 'applications', parentLabel: 'Applications' },
  { terraformResource: 'okta_app_oauth_redirect_uri', parentType: 'applications', parentLabel: 'Applications' },
  { terraformResource: 'okta_app_oauth_post_logout_redirect_uri', parentType: 'applications', parentLabel: 'Applications' },
  { terraformResource: 'okta_app_oauth_role_assignment', parentType: 'applications', parentLabel: 'Applications' },
  { terraformResource: 'okta_app_saml_app_settings', parentType: 'applications', parentLabel: 'Applications' },
  { terraformResource: 'okta_app_user_base_schema_property', parentType: 'applications', parentLabel: 'Applications' },
  { terraformResource: 'okta_app_user_schema_property', parentType: 'applications', parentLabel: 'Applications' },
  { terraformResource: 'okta_app_connection', parentType: 'applications', parentLabel: 'Applications' },
  { terraformResource: 'okta_app_features', parentType: 'applications', parentLabel: 'Applications' },
  { terraformResource: 'okta_app_federated_claim', parentType: 'applications', parentLabel: 'Applications' },
  { terraformResource: 'okta_app_token', parentType: 'applications', parentLabel: 'Applications' },
  { terraformResource: 'okta_push_group', parentType: 'applications', parentLabel: 'Applications', primaryEndpoint: '/api/v1/apps/<id>', endpointLabel: 'Applications' },

  // ─── Auth Servers ───
  { terraformResource: 'okta_auth_server', parentType: 'authServers', parentLabel: 'Auth Servers' },
  { terraformResource: 'okta_auth_server_default', parentType: 'authServers', parentLabel: 'Auth Servers' },
  { terraformResource: 'okta_auth_server_claim', parentType: 'authServers', parentLabel: 'Auth Servers', primaryEndpoint: '/api/v1/authorizationServers/<id>/claims', endpointLabel: 'Auth Servers' },
  { terraformResource: 'okta_auth_server_claim_default', parentType: 'authServers', parentLabel: 'Auth Servers' },
  { terraformResource: 'okta_auth_server_policy', parentType: 'authServers', parentLabel: 'Auth Servers', primaryEndpoint: '/api/v1/authorizationServers/<id>/policies', endpointLabel: 'Auth Servers' },
  { terraformResource: 'okta_auth_server_policy_rule', parentType: 'authServers', parentLabel: 'Auth Servers', primaryEndpoint: '/api/v1/authorizationServers/<id>/policies', endpointLabel: 'Auth Servers' },
  { terraformResource: 'okta_auth_server_scope', parentType: 'authServers', parentLabel: 'Auth Servers', primaryEndpoint: '/api/v1/authorizationServers/<id>/scopes', endpointLabel: 'Auth Servers' },
  { terraformResource: 'okta_trusted_server', parentType: 'authServers', parentLabel: 'Auth Servers' },

  // ─── Policies ───
  { terraformResource: 'okta_policy_signon', parentType: 'policies', parentLabel: 'Policies' },
  { terraformResource: 'okta_policy_rule_signon', parentType: 'policies', parentLabel: 'Policies' },
  { terraformResource: 'okta_policy_password', parentType: 'policies', parentLabel: 'Policies' },
  { terraformResource: 'okta_policy_password_default', parentType: 'policies', parentLabel: 'Policies' },
  { terraformResource: 'okta_policy_rule_password', parentType: 'policies', parentLabel: 'Policies' },
  { terraformResource: 'okta_policy_mfa', parentType: 'policies', parentLabel: 'Policies' },
  { terraformResource: 'okta_policy_mfa_default', parentType: 'policies', parentLabel: 'Policies' },
  { terraformResource: 'okta_policy_rule_mfa', parentType: 'policies', parentLabel: 'Policies' },
  { terraformResource: 'okta_policy_profile_enrollment', parentType: 'policies', parentLabel: 'Policies' },
  { terraformResource: 'okta_policy_profile_enrollment_apps', parentType: 'policies', parentLabel: 'Policies' },
  { terraformResource: 'okta_policy_rule_profile_enrollment', parentType: 'policies', parentLabel: 'Policies' },
  { terraformResource: 'okta_policy_rule_idp_discovery', parentType: 'policies', parentLabel: 'Policies' },
  { terraformResource: 'okta_policy_device_assurance_android', parentType: 'policies', parentLabel: 'Policies' },
  { terraformResource: 'okta_policy_device_assurance_chromeos', parentType: 'policies', parentLabel: 'Policies' },
  { terraformResource: 'okta_policy_device_assurance_ios', parentType: 'policies', parentLabel: 'Policies' },
  { terraformResource: 'okta_policy_device_assurance_macos', parentType: 'policies', parentLabel: 'Policies' },
  { terraformResource: 'okta_policy_device_assurance_windows', parentType: 'policies', parentLabel: 'Policies' },
  { terraformResource: 'okta_post_auth_session_policy_rule', parentType: 'policies', parentLabel: 'Policies' },
  { terraformResource: 'okta_entity_risk_policy_rule', parentType: 'policies', parentLabel: 'Policies' },
  { terraformResource: 'okta_session_violation_policy_rule', parentType: 'policies', parentLabel: 'Policies' },

  // ─── Identity Providers ───
  { terraformResource: 'okta_idp_oidc', parentType: 'idps', parentLabel: 'Identity Providers' },
  { terraformResource: 'okta_idp_saml', parentType: 'idps', parentLabel: 'Identity Providers' },
  { terraformResource: 'okta_idp_saml_key', parentType: 'idps', parentLabel: 'Identity Providers' },
  { terraformResource: 'okta_idp_social', parentType: 'idps', parentLabel: 'Identity Providers' },

  // ─── Network Zones ───
  { terraformResource: 'okta_network_zone', parentType: 'networkZones', parentLabel: 'Network Zones' },

  // ─── Trusted Origins ───
  { terraformResource: 'okta_trusted_origin', parentType: 'trustedOrigins', parentLabel: 'Trusted Origins' },

  // ─── Authenticators ───
  { terraformResource: 'okta_authenticator', parentType: 'authenticators', parentLabel: 'Authenticators' },
  { terraformResource: 'okta_authenticator_webauthn_custom_aaguid', parentType: 'authenticators', parentLabel: 'Authenticators' },
  { terraformResource: 'okta_authenticator_method_webauthn', parentType: 'authenticators', parentLabel: 'Authenticators' },
  { terraformResource: 'okta_authenticator_webauthn_custom_aaguids', parentType: 'authenticators', parentLabel: 'Authenticators' },

  // ─── Behaviors ───
  { terraformResource: 'okta_behavior', parentType: 'behaviors', parentLabel: 'Behaviors' },
  { terraformResource: 'okta_threat_insight_settings', parentType: 'behaviors', parentLabel: 'Behaviors' },

  // ─── CAPTCHAs ───
  { terraformResource: 'okta_captcha', parentType: 'captchas', parentLabel: 'CAPTCHAs' },
  { terraformResource: 'okta_captcha_org_wide_settings', parentType: 'captchas', parentLabel: 'CAPTCHAs' },

  // ─── Domains ───
  { terraformResource: 'okta_domain', parentType: 'domains', parentLabel: 'Domains' },
  { terraformResource: 'okta_domain_certificate', parentType: 'domains', parentLabel: 'Domains' },
  { terraformResource: 'okta_domain_verification', parentType: 'domains', parentLabel: 'Domains' },

  // ─── Email Domains ───
  { terraformResource: 'okta_email_domain', parentType: 'emailDomains', parentLabel: 'Email Domains' },
  { terraformResource: 'okta_email_domain_verification', parentType: 'emailDomains', parentLabel: 'Email Domains' },
  { terraformResource: 'okta_email_sender', parentType: 'emailDomains', parentLabel: 'Email Domains' },
  { terraformResource: 'okta_email_sender_verification', parentType: 'emailDomains', parentLabel: 'Email Domains' },
  { terraformResource: 'okta_email_smtp_server', parentType: 'emailDomains', parentLabel: 'Email Domains' },

  // ─── Brands & Themes ───
  { terraformResource: 'okta_brand', parentType: 'brands', parentLabel: 'Brands' },
  { terraformResource: 'okta_theme', parentType: 'brands', parentLabel: 'Brands' },
  { terraformResource: 'okta_email_customization', parentType: 'brands', parentLabel: 'Brands' },
  { terraformResource: 'okta_email_template_settings', parentType: 'brands', parentLabel: 'Brands' },
  { terraformResource: 'okta_customized_signin_page', parentType: 'brands', parentLabel: 'Brands' },
  { terraformResource: 'okta_preview_signin_page', parentType: 'brands', parentLabel: 'Brands' },
  { terraformResource: 'okta_ui_schema', parentType: 'brands', parentLabel: 'Brands' },

  // ─── Event Hooks ───
  { terraformResource: 'okta_event_hook', parentType: 'eventHooks', parentLabel: 'Event Hooks' },
  { terraformResource: 'okta_event_hook_verification', parentType: 'eventHooks', parentLabel: 'Event Hooks' },
  { terraformResource: 'okta_hook_key', parentType: 'eventHooks', parentLabel: 'Event Hooks' },

  // ─── Inline Hooks ───
  { terraformResource: 'okta_inline_hook', parentType: 'inlineHooks', parentLabel: 'Inline Hooks' },

  // ─── Log Streams ───
  { terraformResource: 'okta_log_stream', parentType: 'logStreams', parentLabel: 'Log Streams' },

  // ─── Devices ───
  { terraformResource: 'okta_device', parentType: 'devices', parentLabel: 'Devices' },

  // ─── Profile Mappings ───
  { terraformResource: 'okta_profile_mapping', parentType: 'profileMappings', parentLabel: 'Profile Mappings' },

  // ─── Custom Roles ───
  { terraformResource: 'okta_admin_role_custom', parentType: 'customRoles', parentLabel: 'Custom Roles' },
  { terraformResource: 'okta_admin_role_custom_assignments', parentType: 'customRoles', parentLabel: 'Custom Roles' },
  { terraformResource: 'okta_admin_role_targets', parentType: 'customRoles', parentLabel: 'Custom Roles' },
  { terraformResource: 'okta_resource_set', parentType: 'customRoles', parentLabel: 'Custom Roles' },
  { terraformResource: 'okta_role_subscription', parentType: 'customRoles', parentLabel: 'Custom Roles' },

  // ─── Realms ───
  { terraformResource: 'okta_realm', parentType: 'realms', parentLabel: 'Realms' },
  { terraformResource: 'okta_realm_assignment', parentType: 'realms', parentLabel: 'Realms' },

  // ─── Features ───
  { terraformResource: 'okta_feature', parentType: 'features', parentLabel: 'Features' },

  // ─── Push Providers ───
  { terraformResource: 'okta_push_provider', parentType: 'pushProviders', parentLabel: 'Push Providers' },

  // ─── Org Settings ───
  { terraformResource: 'okta_org_configuration', parentType: 'orgSettings', parentLabel: 'Org Settings' },
  { terraformResource: 'okta_org_support', parentType: 'orgSettings', parentLabel: 'Org Settings' },
  { terraformResource: 'okta_security_notification_emails', parentType: 'orgSettings', parentLabel: 'Org Settings' },
  { terraformResource: 'okta_security_events_provider', parentType: 'orgSettings', parentLabel: 'Org Settings' },
  { terraformResource: 'okta_rate_limiting', parentType: 'orgSettings', parentLabel: 'Org Settings' },
  { terraformResource: 'okta_rate_limit_admin_notification_settings', parentType: 'orgSettings', parentLabel: 'Org Settings' },
  { terraformResource: 'okta_rate_limit_warning_threshold_percentage', parentType: 'orgSettings', parentLabel: 'Org Settings' },
  { terraformResource: 'okta_principal_rate_limits', parentType: 'orgSettings', parentLabel: 'Org Settings' },
  { terraformResource: 'okta_api_service_integration', parentType: 'orgSettings', parentLabel: 'Org Settings' },
  { terraformResource: 'okta_api_token', parentType: 'orgSettings', parentLabel: 'Org Settings' },
  { terraformResource: 'okta_agent_pool_update', parentType: 'orgSettings', parentLabel: 'Org Settings' },

  // ─── Governance (Okta Identity Governance) ───
  { terraformResource: 'okta_campaign', parentType: 'governance', parentLabel: 'Governance' },
  { terraformResource: 'okta_review', parentType: 'governance', parentLabel: 'Governance' },
  { terraformResource: 'okta_entitlement', parentType: 'governance', parentLabel: 'Governance' },
  { terraformResource: 'okta_entitlement_bundle', parentType: 'governance', parentLabel: 'Governance' },
  { terraformResource: 'okta_request_condition', parentType: 'governance', parentLabel: 'Governance' },
  { terraformResource: 'okta_request_sequence', parentType: 'governance', parentLabel: 'Governance' },
  { terraformResource: 'okta_request_setting_organization', parentType: 'governance', parentLabel: 'Governance' },
  { terraformResource: 'okta_request_setting_resource', parentType: 'governance', parentLabel: 'Governance' },
  { terraformResource: 'okta_request_v2', parentType: 'governance', parentLabel: 'Governance' },
  { terraformResource: 'okta_end_user_my_requests', parentType: 'governance', parentLabel: 'Governance' },

  // ─── Identity Sources ───
  { terraformResource: 'okta_identity_source_group', parentType: 'identitySources', parentLabel: 'Identity Sources' },
  { terraformResource: 'okta_identity_source_group_membership', parentType: 'identitySources', parentLabel: 'Identity Sources' },
  { terraformResource: 'okta_identity_source_import', parentType: 'identitySources', parentLabel: 'Identity Sources' },
  { terraformResource: 'okta_identity_source_user', parentType: 'identitySources', parentLabel: 'Identity Sources' },
  { terraformResource: 'okta_identity_source_group_memberships', parentType: 'identitySources', parentLabel: 'Identity Sources' },
  { terraformResource: 'okta_identity_source_groups', parentType: 'identitySources', parentLabel: 'Identity Sources' },
  { terraformResource: 'okta_identity_source_sessions', parentType: 'identitySources', parentLabel: 'Identity Sources' },
  { terraformResource: 'okta_identity_source_users', parentType: 'identitySources', parentLabel: 'Identity Sources' },

  // ─── v6.12.0 data sources ───
  {
    terraformResource: 'okta_app_sign_on_policy_rule',
    parentType: 'policies',
    parentLabel: 'Policies',
    primaryEndpoint: '/api/v1/apps',
    endpointLabel: 'Applications',
  },
  {
    terraformResource: 'okta_authorization_servers_policies_rule',
    parentType: 'authServers',
    parentLabel: 'Auth Servers',
    primaryEndpoint: '/api/v1/authorizationServers',
    endpointLabel: 'Auth Servers',
  },
  {
    terraformResource: 'okta_iam_assignees_user',
    parentType: 'users',
    parentLabel: 'Users',
    primaryEndpoint: '/api/v1/iam',
    endpointLabel: 'Custom Roles',
  },

  // ─── v6.13.0 Governance additions ───
  {
    terraformResource: 'okta_label',
    parentType: 'governance',
    parentLabel: 'Governance',
  },
  {
    terraformResource: 'okta_resource_owner',
    parentType: 'governance',
    parentLabel: 'Governance',
  },
  {
    terraformResource: 'okta_resource_label',
    parentType: 'governance',
    parentLabel: 'Governance',
  },
  {
    terraformResource: 'okta_resource_owners_catalog_resource',
    parentType: 'governance',
    parentLabel: 'Governance',
  },
  {
    terraformResource: 'okta_principal_entitlements',
    parentType: 'governance',
    parentLabel: 'Governance',
  },
  {
    terraformResource: 'okta_catalog_entry_default',
    parentType: 'governance',
    parentLabel: 'Governance',
  },
  {
    terraformResource: 'okta_catalog_entry_user_access_request_fields',
    parentType: 'governance',
    parentLabel: 'Governance',
  },
  {
    terraformResource: 'okta_iam_resource_set',
    parentType: 'customRoles',
    parentLabel: 'Custom Roles',
  },
];

/**
 * Search the resource dictionary. Matches against terraform resource name and parent label.
 */
export function searchResources(query: string): ResourceDictionaryEntry[] {
  if (!query.trim()) return [];
  const q = query.toLowerCase();
  return RESOURCE_DICTIONARY.filter(
    (r) =>
      r.terraformResource.toLowerCase().includes(q) ||
      r.parentLabel.toLowerCase().includes(q)
  );
}

/**
 * The rate limit bucket a resource hits.
 *
 * Only 15 of the ~162 dictionary entries carry an explicit primaryEndpoint,
 * because those fields were added for sub-resources like okta_app_user that hit
 * a path their parent type doesn't. Every other resource still has a perfectly
 * well-defined bucket — okta_user hits /api/v1/users — and it is derivable from
 * parentType via RESOURCE_TYPES.
 *
 * Deriving it matters: callers previously filtered on `primaryEndpoint`, which
 * silently hid okta_user and 146 others from both the workload search and the
 * AI's resource table. Combined with a prompt telling the model to "pick the
 * closest match", asking for 1,200 users produced 1,200 okta_app_user instead.
 */
export function effectiveEndpoint(
  entry: ResourceDictionaryEntry,
): { primaryEndpoint: string; endpointLabel: string } | null {
  if (entry.primaryEndpoint && entry.endpointLabel) {
    return { primaryEndpoint: entry.primaryEndpoint, endpointLabel: entry.endpointLabel };
  }

  const parent = RESOURCE_TYPES.find(t => t.type === entry.parentType);
  if (!parent) return null;

  return {
    primaryEndpoint: parent.countEndpoint.split('?')[0],
    endpointLabel: parent.probeLabel,
  };
}
