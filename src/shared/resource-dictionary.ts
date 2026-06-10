import { ManagedResourceType } from './types';

export interface ResourceDictionaryEntry {
  terraformResource: string;
  description: string;
  parentType: ManagedResourceType;
  parentLabel: string;
  sinceVersion?: string;
  /** The probed endpoint pattern this resource primarily hits for rate limits */
  primaryEndpoint?: string;
  /** Display label for the endpoint (matches probe labels) */
  endpointLabel?: string;
}

export const RESOURCE_DICTIONARY: ResourceDictionaryEntry[] = [
  // ─── Users ───
  { terraformResource: 'okta_user', description: 'Manage a user account', parentType: 'users', parentLabel: 'Users' },
  { terraformResource: 'okta_user_type', description: 'Custom user type definition', parentType: 'users', parentLabel: 'Users' },
  { terraformResource: 'okta_user_base_schema_property', description: 'Base user profile attribute override', parentType: 'users', parentLabel: 'Users' },
  { terraformResource: 'okta_user_custom_schema_property', description: 'Custom user profile schema attribute', parentType: 'users', parentLabel: 'Users' },
  { terraformResource: 'okta_user_admin_roles', description: 'Assign admin roles to a user', parentType: 'users', parentLabel: 'Users' },
  { terraformResource: 'okta_user_factor_question', description: 'Security question factor for a user', parentType: 'users', parentLabel: 'Users' },
  { terraformResource: 'okta_user_group_memberships', description: 'Manage group memberships for a user', parentType: 'users', parentLabel: 'Users' },
  { terraformResource: 'okta_user_risk', description: 'Set risk level for a user', parentType: 'users', parentLabel: 'Users', sinceVersion: '6.7.0' },
  { terraformResource: 'okta_factor', description: 'Activate an org-wide MFA factor', parentType: 'users', parentLabel: 'Users' },
  { terraformResource: 'okta_factor_totp', description: 'Custom TOTP factor configuration', parentType: 'users', parentLabel: 'Users' },
  { terraformResource: 'okta_link_definition', description: 'Linked object definition (manager/subordinate)', parentType: 'users', parentLabel: 'Users' },
  { terraformResource: 'okta_link_value', description: 'Linked object value between two users', parentType: 'users', parentLabel: 'Users' },
  { terraformResource: 'okta_template_sms', description: 'Custom SMS template (API key only)', parentType: 'users', parentLabel: 'Users' },

  // ─── Groups ───
  { terraformResource: 'okta_group', description: 'Manage an Okta group', parentType: 'groups', parentLabel: 'Groups' },
  { terraformResource: 'okta_group_rule', description: 'Auto-assign users to groups based on conditions', parentType: 'groups', parentLabel: 'Groups' },
  { terraformResource: 'okta_group_memberships', description: 'Manage members of a group', parentType: 'groups', parentLabel: 'Groups', primaryEndpoint: '/api/v1/groups/<id>/users', endpointLabel: 'Group Members' },
  { terraformResource: 'okta_group_custom_schema_property', description: 'Custom group profile attribute', parentType: 'groups', parentLabel: 'Groups' },
  { terraformResource: 'okta_group_owner', description: 'Single group owner assignment', parentType: 'groups', parentLabel: 'Groups' },
  { terraformResource: 'okta_group_owners', description: 'Manage multiple group owners', parentType: 'groups', parentLabel: 'Groups', sinceVersion: '6.8.0' },
  { terraformResource: 'okta_group_role', description: 'Assign admin role to a group', parentType: 'groups', parentLabel: 'Groups' },

  // ─── Applications ───
  { terraformResource: 'okta_app_oauth', description: 'OAuth 2.0 / OIDC application', parentType: 'applications', parentLabel: 'Applications' },
  { terraformResource: 'okta_app_saml', description: 'SAML 2.0 application', parentType: 'applications', parentLabel: 'Applications' },
  { terraformResource: 'okta_app_swa', description: 'Secure Web Authentication (SWA) app', parentType: 'applications', parentLabel: 'Applications' },
  { terraformResource: 'okta_app_basic_auth', description: 'Basic auth application', parentType: 'applications', parentLabel: 'Applications' },
  { terraformResource: 'okta_app_bookmark', description: 'Bookmark application (chiclet link)', parentType: 'applications', parentLabel: 'Applications' },
  { terraformResource: 'okta_app_auto_login', description: 'Auto-login (SWA) application', parentType: 'applications', parentLabel: 'Applications' },
  { terraformResource: 'okta_app_shared_credentials', description: 'Shared credentials application', parentType: 'applications', parentLabel: 'Applications' },
  { terraformResource: 'okta_app_secure_password_store', description: 'Secure password store application', parentType: 'applications', parentLabel: 'Applications' },
  { terraformResource: 'okta_app_three_field', description: 'Three-field SWA application', parentType: 'applications', parentLabel: 'Applications' },
  { terraformResource: 'okta_app_group_assignment', description: 'Assign a group to an application', parentType: 'applications', parentLabel: 'Applications', primaryEndpoint: '/api/v1/apps/<id>/groups', endpointLabel: 'App Group Assignments' },
  { terraformResource: 'okta_app_group_assignments', description: 'Bulk group assignments for an application', parentType: 'applications', parentLabel: 'Applications', primaryEndpoint: '/api/v1/apps/<id>/groups', endpointLabel: 'App Group Assignments' },
  { terraformResource: 'okta_app_user', description: 'Assign a user to an application', parentType: 'applications', parentLabel: 'Applications', primaryEndpoint: '/api/v1/apps/<id>/users', endpointLabel: 'App User Assignments' },
  { terraformResource: 'okta_app_signon_policy', description: 'App-level sign-on policy', parentType: 'applications', parentLabel: 'Applications', primaryEndpoint: '/api/v1/apps/<id>', endpointLabel: 'Applications' },
  { terraformResource: 'okta_app_signon_policy_rule', description: 'Rule within an app sign-on policy', parentType: 'applications', parentLabel: 'Applications', primaryEndpoint: '/api/v1/apps/<id>', endpointLabel: 'Applications' },
  { terraformResource: 'okta_app_signon_policy_rules', description: 'Bulk rules for an app sign-on policy', parentType: 'applications', parentLabel: 'Applications', primaryEndpoint: '/api/v1/apps/<id>', endpointLabel: 'Applications' },
  { terraformResource: 'okta_app_access_policy_assignment', description: 'Assign access policy to an application', parentType: 'applications', parentLabel: 'Applications' },
  { terraformResource: 'okta_app_oauth_api_scope', description: 'Grant Okta API scopes to an OAuth app', parentType: 'applications', parentLabel: 'Applications' },
  { terraformResource: 'okta_app_oauth_redirect_uri', description: 'Manage redirect URIs for an OAuth app', parentType: 'applications', parentLabel: 'Applications' },
  { terraformResource: 'okta_app_oauth_post_logout_redirect_uri', description: 'Post-logout redirect URI for OAuth app', parentType: 'applications', parentLabel: 'Applications' },
  { terraformResource: 'okta_app_oauth_role_assignment', description: 'Assign admin role to an OAuth app', parentType: 'applications', parentLabel: 'Applications' },
  { terraformResource: 'okta_app_saml_app_settings', description: 'SAML app settings configuration', parentType: 'applications', parentLabel: 'Applications' },
  { terraformResource: 'okta_app_user_base_schema_property', description: 'Base schema property for app user profile', parentType: 'applications', parentLabel: 'Applications' },
  { terraformResource: 'okta_app_user_custom_schema_property', description: 'Custom schema property for app user profile', parentType: 'applications', parentLabel: 'Applications' },
  { terraformResource: 'okta_app_connection', description: 'App provisioning connection settings', parentType: 'applications', parentLabel: 'Applications' },
  { terraformResource: 'okta_app_features', description: 'App provisioning feature flags', parentType: 'applications', parentLabel: 'Applications' },
  { terraformResource: 'okta_app_federated_claim', description: 'Federated claim for an application', parentType: 'applications', parentLabel: 'Applications' },
  { terraformResource: 'okta_app_token', description: 'App OAuth token configuration', parentType: 'applications', parentLabel: 'Applications' },
  { terraformResource: 'okta_push_group', description: 'Push group to downstream app (SCIM provisioning)', parentType: 'applications', parentLabel: 'Applications', primaryEndpoint: '/api/v1/apps/<id>', endpointLabel: 'Applications' },

  // ─── Auth Servers ───
  { terraformResource: 'okta_auth_server', description: 'Custom authorization server', parentType: 'authServers', parentLabel: 'Auth Servers' },
  { terraformResource: 'okta_auth_server_default', description: 'Org authorization server settings', parentType: 'authServers', parentLabel: 'Auth Servers', sinceVersion: '6.8.0' },
  { terraformResource: 'okta_auth_server_claim', description: 'Custom claim on an auth server', parentType: 'authServers', parentLabel: 'Auth Servers', primaryEndpoint: '/api/v1/authorizationServers/<id>/claims', endpointLabel: 'Auth Servers' },
  { terraformResource: 'okta_auth_server_claim_default', description: 'Override a default claim', parentType: 'authServers', parentLabel: 'Auth Servers' },
  { terraformResource: 'okta_auth_server_policy', description: 'Access policy on an auth server', parentType: 'authServers', parentLabel: 'Auth Servers', primaryEndpoint: '/api/v1/authorizationServers/<id>/policies', endpointLabel: 'Auth Servers' },
  { terraformResource: 'okta_auth_server_policy_rule', description: 'Rule within an auth server policy', parentType: 'authServers', parentLabel: 'Auth Servers', primaryEndpoint: '/api/v1/authorizationServers/<id>/policies', endpointLabel: 'Auth Servers' },
  { terraformResource: 'okta_auth_server_scope', description: 'OAuth scope on an auth server', parentType: 'authServers', parentLabel: 'Auth Servers', primaryEndpoint: '/api/v1/authorizationServers/<id>/scopes', endpointLabel: 'Auth Servers' },
  { terraformResource: 'okta_trusted_server', description: 'Trusted auth server relationship', parentType: 'authServers', parentLabel: 'Auth Servers' },

  // ─── Policies ───
  { terraformResource: 'okta_policy_sign_on', description: 'Global sign-on policy', parentType: 'policies', parentLabel: 'Policies' },
  { terraformResource: 'okta_policy_rule_sign_on', description: 'Rule within a sign-on policy', parentType: 'policies', parentLabel: 'Policies' },
  { terraformResource: 'okta_policy_password', description: 'Password policy', parentType: 'policies', parentLabel: 'Policies' },
  { terraformResource: 'okta_policy_password_default', description: 'Default password policy settings', parentType: 'policies', parentLabel: 'Policies' },
  { terraformResource: 'okta_policy_rule_password', description: 'Rule within a password policy', parentType: 'policies', parentLabel: 'Policies' },
  { terraformResource: 'okta_policy_mfa', description: 'MFA enrollment policy', parentType: 'policies', parentLabel: 'Policies' },
  { terraformResource: 'okta_policy_mfa_default', description: 'Default MFA policy settings', parentType: 'policies', parentLabel: 'Policies' },
  { terraformResource: 'okta_policy_rule_mfa', description: 'Rule within an MFA policy', parentType: 'policies', parentLabel: 'Policies' },
  { terraformResource: 'okta_policy_profile_enrollment', description: 'Profile enrollment (self-service registration) policy', parentType: 'policies', parentLabel: 'Policies' },
  { terraformResource: 'okta_policy_profile_enrollment_apps', description: 'Apps assigned to profile enrollment policy', parentType: 'policies', parentLabel: 'Policies' },
  { terraformResource: 'okta_policy_rule_profile_enrollment', description: 'Rule in profile enrollment policy', parentType: 'policies', parentLabel: 'Policies' },
  { terraformResource: 'okta_policy_rule_idp_discovery', description: 'IdP discovery routing rule', parentType: 'policies', parentLabel: 'Policies' },
  { terraformResource: 'okta_device_assurance_policy_android_os', description: 'Android device assurance policy', parentType: 'policies', parentLabel: 'Policies' },
  { terraformResource: 'okta_device_assurance_policy_chromeos_os', description: 'ChromeOS device assurance policy', parentType: 'policies', parentLabel: 'Policies' },
  { terraformResource: 'okta_device_assurance_policy_ios_os', description: 'iOS device assurance policy', parentType: 'policies', parentLabel: 'Policies' },
  { terraformResource: 'okta_device_assurance_policy_macos_os', description: 'macOS device assurance policy', parentType: 'policies', parentLabel: 'Policies' },
  { terraformResource: 'okta_device_assurance_policy_windows_os', description: 'Windows device assurance policy', parentType: 'policies', parentLabel: 'Policies' },
  { terraformResource: 'okta_post_auth_session_policy_rule', description: 'Post-auth session policy rule (ITP)', parentType: 'policies', parentLabel: 'Policies', sinceVersion: '6.7.0' },
  { terraformResource: 'okta_entity_risk_policy_rule', description: 'Entity risk policy rule', parentType: 'policies', parentLabel: 'Policies', sinceVersion: '6.8.0' },
  { terraformResource: 'okta_session_violation_policy_rule', description: 'Session violation policy rule', parentType: 'policies', parentLabel: 'Policies', sinceVersion: '6.8.0' },

  // ─── Identity Providers ───
  { terraformResource: 'okta_idp_oidc', description: 'OIDC identity provider', parentType: 'idps', parentLabel: 'Identity Providers' },
  { terraformResource: 'okta_idp_saml', description: 'SAML identity provider', parentType: 'idps', parentLabel: 'Identity Providers' },
  { terraformResource: 'okta_idp_saml_key', description: 'Signing key for SAML IdP', parentType: 'idps', parentLabel: 'Identity Providers' },
  { terraformResource: 'okta_idp_social', description: 'Social identity provider (Google, Facebook, etc.)', parentType: 'idps', parentLabel: 'Identity Providers' },

  // ─── Network Zones ───
  { terraformResource: 'okta_network_zone', description: 'IP or dynamic network zone', parentType: 'networkZones', parentLabel: 'Network Zones' },

  // ─── Trusted Origins ───
  { terraformResource: 'okta_trusted_origin', description: 'CORS or redirect trusted origin', parentType: 'trustedOrigins', parentLabel: 'Trusted Origins' },

  // ─── Authenticators ───
  { terraformResource: 'okta_authenticator', description: 'MFA authenticator (Okta Verify, SMS, etc.)', parentType: 'authenticators', parentLabel: 'Authenticators' },

  // ─── Behaviors ───
  { terraformResource: 'okta_behavior', description: 'Behavior detection rule (anomalous device, location)', parentType: 'behaviors', parentLabel: 'Behaviors' },
  { terraformResource: 'okta_threat_insight_settings', description: 'Threat Insight configuration (API key only)', parentType: 'behaviors', parentLabel: 'Behaviors' },

  // ─── CAPTCHAs ───
  { terraformResource: 'okta_captcha', description: 'CAPTCHA integration (hCaptcha, reCAPTCHA)', parentType: 'captchas', parentLabel: 'CAPTCHAs' },
  { terraformResource: 'okta_captcha_org_wide_settings', description: 'Org-wide CAPTCHA enablement', parentType: 'captchas', parentLabel: 'CAPTCHAs' },

  // ─── Domains ───
  { terraformResource: 'okta_domain', description: 'Custom domain for Okta-hosted pages', parentType: 'domains', parentLabel: 'Domains' },
  { terraformResource: 'okta_domain_certificate', description: 'TLS certificate for a custom domain', parentType: 'domains', parentLabel: 'Domains' },
  { terraformResource: 'okta_domain_verification', description: 'DNS verification for a custom domain', parentType: 'domains', parentLabel: 'Domains' },

  // ─── Email Domains ───
  { terraformResource: 'okta_email_domain', description: 'Custom email sender domain', parentType: 'emailDomains', parentLabel: 'Email Domains' },
  { terraformResource: 'okta_email_domain_verification', description: 'DNS verification for email domain', parentType: 'emailDomains', parentLabel: 'Email Domains' },
  { terraformResource: 'okta_email_sender', description: 'Custom email sender configuration', parentType: 'emailDomains', parentLabel: 'Email Domains' },
  { terraformResource: 'okta_email_sender_verification', description: 'Verify a custom email sender', parentType: 'emailDomains', parentLabel: 'Email Domains' },
  { terraformResource: 'okta_email_smtp_servers', description: 'SMTP server configuration for email', parentType: 'emailDomains', parentLabel: 'Email Domains' },

  // ─── Brands & Themes ───
  { terraformResource: 'okta_brand', description: 'Brand configuration (org-level branding)', parentType: 'brands', parentLabel: 'Brands' },
  { terraformResource: 'okta_theme', description: 'Theme for sign-in pages and dashboard', parentType: 'brands', parentLabel: 'Brands' },
  { terraformResource: 'okta_email_customization', description: 'Customize email templates per brand', parentType: 'brands', parentLabel: 'Brands' },
  { terraformResource: 'okta_email_template_settings', description: 'Email template settings per brand', parentType: 'brands', parentLabel: 'Brands' },
  { terraformResource: 'okta_customized_signin_page', description: 'Customized sign-in page per brand', parentType: 'brands', parentLabel: 'Brands' },
  { terraformResource: 'okta_preview_signin_page', description: 'Preview sign-in page customization', parentType: 'brands', parentLabel: 'Brands' },
  { terraformResource: 'okta_ui_schema', description: 'Enrollment form UI schema (field ordering)', parentType: 'brands', parentLabel: 'Brands' },

  // ─── Event Hooks ───
  { terraformResource: 'okta_event_hook', description: 'Webhook triggered by Okta system events', parentType: 'eventHooks', parentLabel: 'Event Hooks' },
  { terraformResource: 'okta_event_hook_verification', description: 'Verify an event hook endpoint', parentType: 'eventHooks', parentLabel: 'Event Hooks' },
  { terraformResource: 'okta_hook_key', description: 'Key used for hook signing/verification', parentType: 'eventHooks', parentLabel: 'Event Hooks' },

  // ─── Inline Hooks ───
  { terraformResource: 'okta_inline_hook', description: 'Inline hook (token transform, import, SAML assertion)', parentType: 'inlineHooks', parentLabel: 'Inline Hooks' },

  // ─── Log Streams ───
  { terraformResource: 'okta_log_stream', description: 'Stream system logs to AWS EventBridge or Splunk', parentType: 'logStreams', parentLabel: 'Log Streams' },

  // ─── Devices ───
  { terraformResource: 'okta_device', description: 'Device management', parentType: 'devices', parentLabel: 'Devices' },

  // ─── Profile Mappings ───
  { terraformResource: 'okta_profile_mapping', description: 'Map attributes between user profiles', parentType: 'profileMappings', parentLabel: 'Profile Mappings' },

  // ─── Custom Roles ───
  { terraformResource: 'okta_admin_role_custom', description: 'Custom admin role with specific permissions', parentType: 'customRoles', parentLabel: 'Custom Roles' },
  { terraformResource: 'okta_admin_role_custom_assignments', description: 'Assign custom role to users/groups', parentType: 'customRoles', parentLabel: 'Custom Roles' },
  { terraformResource: 'okta_admin_role_targets', description: 'Scope standard admin role to targets', parentType: 'customRoles', parentLabel: 'Custom Roles' },
  { terraformResource: 'okta_resource_set', description: 'Resource set for custom role scoping', parentType: 'customRoles', parentLabel: 'Custom Roles' },
  { terraformResource: 'okta_role_subscription', description: 'Admin role notification subscription', parentType: 'customRoles', parentLabel: 'Custom Roles' },

  // ─── Realms ───
  { terraformResource: 'okta_realm', description: 'Realm for user population segmentation', parentType: 'realms', parentLabel: 'Realms' },
  { terraformResource: 'okta_realm_assignment', description: 'Assign users/groups to a realm', parentType: 'realms', parentLabel: 'Realms' },

  // ─── Features ───
  { terraformResource: 'okta_feature', description: 'Enable or disable an org feature flag', parentType: 'features', parentLabel: 'Features' },

  // ─── Push Providers ───
  { terraformResource: 'okta_push_provider', description: 'Push notification provider (APNs, FCM)', parentType: 'pushProviders', parentLabel: 'Push Providers' },

  // ─── Org Settings ───
  { terraformResource: 'okta_org_configuration', description: 'Org-wide settings (name, website, support)', parentType: 'orgSettings', parentLabel: 'Org Settings' },
  { terraformResource: 'okta_org_support', description: 'Okta support access settings', parentType: 'orgSettings', parentLabel: 'Org Settings' },
  { terraformResource: 'okta_security_notification_emails', description: 'Security notification email settings', parentType: 'orgSettings', parentLabel: 'Org Settings' },
  { terraformResource: 'okta_security_events_provider', description: 'Security events provider (SSF receiver)', parentType: 'orgSettings', parentLabel: 'Org Settings' },
  { terraformResource: 'okta_rate_limiting', description: 'Org rate limiting settings', parentType: 'orgSettings', parentLabel: 'Org Settings' },
  { terraformResource: 'okta_rate_limit_admin_notification_settings', description: 'Rate limit admin notification config', parentType: 'orgSettings', parentLabel: 'Org Settings' },
  { terraformResource: 'okta_rate_limit_warning_threshold_percentage', description: 'Rate limit warning threshold', parentType: 'orgSettings', parentLabel: 'Org Settings' },
  { terraformResource: 'okta_principal_rate_limits', description: 'Principal-specific rate limit overrides', parentType: 'orgSettings', parentLabel: 'Org Settings' },
  { terraformResource: 'okta_api_service_integration', description: 'API service integration (OAuth for Okta)', parentType: 'orgSettings', parentLabel: 'Org Settings' },
  { terraformResource: 'okta_api_token', description: 'API token management', parentType: 'orgSettings', parentLabel: 'Org Settings' },
  { terraformResource: 'okta_agent_pool_update', description: 'Agent pool update configuration', parentType: 'orgSettings', parentLabel: 'Org Settings' },

  // ─── Governance (Okta Identity Governance) ───
  { terraformResource: 'okta_campaign', description: 'Access certification campaign', parentType: 'governance', parentLabel: 'Governance' },
  { terraformResource: 'okta_review', description: 'Access certification review', parentType: 'governance', parentLabel: 'Governance' },
  { terraformResource: 'okta_entitlement', description: 'Entitlement definition for governance', parentType: 'governance', parentLabel: 'Governance' },
  { terraformResource: 'okta_entitlement_bundle', description: 'Bundle of entitlements', parentType: 'governance', parentLabel: 'Governance' },
  { terraformResource: 'okta_request_condition', description: 'Access request approval condition', parentType: 'governance', parentLabel: 'Governance' },
  { terraformResource: 'okta_request_sequence', description: 'Access request approval sequence', parentType: 'governance', parentLabel: 'Governance' },
  { terraformResource: 'okta_request_setting_organization', description: 'Org-level access request settings', parentType: 'governance', parentLabel: 'Governance' },
  { terraformResource: 'okta_request_setting_resource', description: 'Resource-level access request settings', parentType: 'governance', parentLabel: 'Governance' },
  { terraformResource: 'okta_request_v2', description: 'Access request (v2 API)', parentType: 'governance', parentLabel: 'Governance' },
  { terraformResource: 'okta_end_user_my_requests', description: 'End-user self-service access requests', parentType: 'governance', parentLabel: 'Governance' },

  // ─── Identity Sources ───
  {
    terraformResource: 'okta_identity_source',
    description: 'Manage an identity source resource for profile sourcing',
    parentType: 'identitySources',
    parentLabel: 'Identity Sources',
    sinceVersion: '6.11.0',
    primaryEndpoint: '/api/v1/identity-sources',
    endpointLabel: 'Identity Sources',
  },
  {
    terraformResource: 'okta_identity_source',
    description: 'Look up an identity source data source',
    parentType: 'identitySources',
    parentLabel: 'Identity Sources',
    sinceVersion: '6.11.0',
    primaryEndpoint: '/api/v1/identity-sources',
    endpointLabel: 'Identity Sources',
  },

  // ─── v6.12.0 data sources ───
  {
    terraformResource: 'okta_signon_policy_rule',
    description: 'Look up an existing sign-on policy rule data source',
    parentType: 'policies',
    parentLabel: 'Policies',
    sinceVersion: '6.12.0',
    primaryEndpoint: '/api/v1/policies',
    endpointLabel: 'Policies',
  },
  {
    terraformResource: 'okta_auth_server_policy_rule',
    description: 'Look up an existing auth server policy rule data source',
    parentType: 'authServers',
    parentLabel: 'Auth Servers',
    sinceVersion: '6.12.0',
    primaryEndpoint: '/api/v1/authorizationServers',
    endpointLabel: 'Auth Servers',
  },
  {
    terraformResource: 'okta_assignees_users',
    description: 'List users assignable to a resource data source',
    parentType: 'users',
    parentLabel: 'Users',
    sinceVersion: '6.12.0',
    primaryEndpoint: '/api/v1/users',
    endpointLabel: 'Users',
  },
];

/**
 * Search the resource dictionary. Matches against terraform resource name and description.
 */
export function searchResources(query: string): ResourceDictionaryEntry[] {
  if (!query.trim()) return [];
  const q = query.toLowerCase();
  return RESOURCE_DICTIONARY.filter(
    (r) =>
      r.terraformResource.toLowerCase().includes(q) ||
      r.description.toLowerCase().includes(q) ||
      r.parentLabel.toLowerCase().includes(q)
  );
}
