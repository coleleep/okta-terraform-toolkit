export const SUPPORTED_VERSIONS = ['6.6.1', '6.7.0', '6.8.0', '6.9.0', '6.10.0'] as const;
export type ProviderVersion = (typeof SUPPORTED_VERSIONS)[number];
export const DEFAULT_VERSION: ProviderVersion = '6.10.0';

/**
 * Compare two semver strings. Returns -1 if a < b, 0 if equal, 1 if a > b.
 */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const va = pa[i] || 0;
    const vb = pb[i] || 0;
    if (va < vb) return -1;
    if (va > vb) return 1;
  }
  return 0;
}

/**
 * Check if a feature introduced in `sinceVersion` is available in `selectedVersion`.
 */
export function isAvailableIn(sinceVersion: string, selectedVersion: string): boolean {
  return compareVersions(selectedVersion, sinceVersion) >= 0;
}

/**
 * Get the Terraform version constraint for a provider version.
 * e.g., '6.8.0' → '~> 6.8', '6.6.1' → '~> 6.6'
 */
export function getVersionConstraint(version: string): string {
  const parts = version.split('.');
  return `~> ${parts[0]}.${parts[1]}.0`;
}

/**
 * Version-specific resource config additions (HCL templates).
 * These get appended to the base RESOURCE_CONFIGS for the relevant resource type
 * when the selected version is >= the version they were introduced in.
 */
export const VERSION_RESOURCE_ADDITIONS: Record<ProviderVersion, { type: string; config: string }[]> = {
  '6.6.1': [], // baseline — all base configs apply

  '6.7.0': [
    {
      type: 'users',
      config: `
# User risk level (v6.7.0+)
# resource "okta_user_risk" "example" {
#   user_id    = okta_user.example.id
#   risk_level = "LOW"  # HIGH, LOW, or NONE
# }
`,
    },
    {
      type: 'policies',
      config: `
# Post-auth session policy (v6.7.0+ / Identity Threat Protection)
# resource "okta_post_auth_session_policy" "example" {
#   name        = "Post-Auth Session Policy"
#   description = "Continuous access evaluation"
#   status      = "ACTIVE"
# }
#
# resource "okta_post_auth_session_policy_rule" "example" {
#   name      = "Evaluate risk continuously"
#   policy_id = okta_post_auth_session_policy.example.id
#   status    = "ACTIVE"
# }
`,
    },
    {
      type: 'applications',
      config: `
# Preconfigured app from Okta catalog (v6.7.0+)
# resource "okta_app_oauth" "preconfigured" {
#   label             = "Slack"
#   preconfigured_app = "slack"  # Use Okta catalog name
#   grant_types       = ["authorization_code"]
#   redirect_uris     = ["https://slack.com/callback"]
# }

# SWA app with app_settings_json (v6.7.0+)
# resource "okta_app_swa" "example" {
#   label            = "Custom SWA App"
#   button_field     = "btn-login"
#   password_field   = "txtbox-password"
#   username_field   = "txtbox-username"
#   url              = "https://app.example.com/login"
#   app_settings_json = jsonencode({
#     setting_key = "setting_value"
#   })
# }
`,
    },
    {
      type: 'networkZones',
      config: `
# Default blocklist zone can now be modified (v6.7.0+)
# Import with: terraform import okta_network_zone.blocklist <zone_id>
# The "system" attribute (computed) indicates system-managed zones.
`,
    },
  ],

  '6.8.0': [
    {
      type: 'policies',
      config: `
# Entity risk policy (v6.8.0+)
# resource "okta_entity_risk_policy" "example" {
#   name        = "Entity Risk Policy"
#   description = "Risk-based access decisions"
#   status      = "ACTIVE"
# }
#
# resource "okta_entity_risk_policy_rule" "example" {
#   name      = "High Risk Block"
#   policy_id = okta_entity_risk_policy.example.id
#   status    = "ACTIVE"
# }

# Session violation policy (v6.8.0+)
# resource "okta_session_violation_policy" "example" {
#   name        = "Session Violation Policy"
#   description = "Detect and respond to session violations"
#   status      = "ACTIVE"
# }
#
# resource "okta_session_violation_policy_rule" "example" {
#   name      = "Terminate on violation"
#   policy_id = okta_session_violation_policy.example.id
#   status    = "ACTIVE"
# }
`,
    },
    {
      type: 'groups',
      config: `
# Group owners (v6.8.0+)
# resource "okta_group_owners" "example" {
#   group_id = okta_group.example.id
#   type     = "USER"
#   id_of_group_owner = okta_user.admin.id
# }
`,
    },
    {
      type: 'authServers',
      config: `
# Org authorization server data source (v6.8.0+)
# data "okta_auth_server_default" "org" {}
`,
    },
  ],

  '6.9.0': [
    {
      type: 'applications',
      config: `
# skip_authentication_policy attribute (v6.9.0+)
# Allows skipping the authentication policy assignment for apps.
# Supported on okta_app_bookmark, okta_app_oauth, and okta_app_saml:
#
# resource "okta_app_oauth" "example" {
#   label                      = "My App"
#   type                       = "web"
#   skip_authentication_policy = true  # Skip auth policy assignment
#   # ...
# }
`,
    },
    {
      type: 'policies',
      config: `
# Dynamic IdP rules in IdP discovery policy (v6.9.0+)
# resource "okta_policy_rule_idp_discovery" "dynamic" {
#   policy_id = okta_policy_sign_on.example.id
#   name      = "Dynamic IdP Routing"
#   priority  = 1
#   # Dynamic IdP rules now supported for flexible routing
# }
`,
    },
  ],

  '6.10.0': [
    {
      type: 'policies',
      config: `
# Self-service password requirements (v6.10.0+)
# resource "okta_policy_rule_password" "example" {
#   policy_id = okta_policy_password.example.id
#   name      = "Password Rule"
#   status    = "ACTIVE"
#   self_service_password_requirements = jsonencode({
#     complexity = {
#       min_length = 12
#     }
#   })
# }
`,
    },
  ],
};

/**
 * Version-specific attribute notes (for display in UI, not code generation).
 */
export const VERSION_ATTRIBUTE_NOTES: Record<ProviderVersion, string[]> = {
  '6.6.1': [],
  '6.7.0': [
    'okta_app_oauth: preconfigured_app attribute added',
    'okta_app_swa: app_settings_json attribute added',
    'okta_network_zone: default blocklist zone can now be modified',
  ],
  '6.8.0': [
    'okta_app_oauth: network attribute added',
    'okta_campaign: now supports update operations',
    'okta_app_signon_policy_rules: chains argument added',
  ],
  '6.9.0': [
    'okta_app_bookmark: skip_authentication_policy attribute added',
    'okta_app_oauth: skip_authentication_policy attribute added',
    'okta_app_saml: skip_authentication_policy attribute added',
    'okta_policy_rule_idp_discovery: dynamic IdP rules support added',
  ],
  '6.10.0': [
    'okta_policy_rule_password: self_service_password_requirements attribute added',
    'okta_app_signon_policy_rules: status=INACTIVE fix',
    'okta_request_condition: 409 conflict on update fix',
    'okta_request_condition: resource_id change now triggers replacement',
    'okta_app_signon_policy_rules: LINUX/OTHER os_expression consistency fix',
  ],
};

/**
 * Get all version additions applicable for a given version (cumulative).
 * For v6.8.0, returns additions from 6.7.0 + 6.8.0.
 */
export function getAdditionsForVersion(version: string): { type: string; config: string }[] {
  const additions: { type: string; config: string }[] = [];
  for (const v of SUPPORTED_VERSIONS) {
    if (compareVersions(v, version) <= 0 && v !== '6.6.1') {
      additions.push(...VERSION_RESOURCE_ADDITIONS[v]);
    }
  }
  return additions;
}

/**
 * Get all attribute notes applicable for a given version (cumulative).
 */
export function getAttributeNotesForVersion(version: string): string[] {
  const notes: string[] = [];
  for (const v of SUPPORTED_VERSIONS) {
    if (compareVersions(v, version) <= 0) {
      notes.push(...VERSION_ATTRIBUTE_NOTES[v]);
    }
  }
  return notes;
}
