export const SUPPORTED_VERSIONS = ['6.6.1', '6.7.0', '6.8.0', '6.9.0', '6.10.0', '6.11.0', '6.12.0', '6.13.0'] as const;
export type ProviderVersion = (typeof SUPPORTED_VERSIONS)[number];
export const DEFAULT_VERSION: ProviderVersion = '6.13.0';

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

  '6.11.0': [
    {
      type: 'identitySources',
      config: `
# Identity source resources (v6.11.0+)
# resource "okta_identity_source_group" "example" {
#   identity_source_id = "<identity_source_id>"
#   name               = "My Group"
# }
#
# resource "okta_identity_source_user" "example" {
#   identity_source_id = "<identity_source_id>"
#   external_id        = "user-external-id"
# }
#
# resource "okta_identity_source_import" "trigger" {
#   identity_source_id = "<identity_source_id>"
# }
#
# Data sources for identity source inspection:
# data "okta_identity_source_groups" "all" {
#   identity_source_id = "<identity_source_id>"
# }
# data "okta_identity_source_users" "all" {
#   identity_source_id = "<identity_source_id>"
# }
`,
    },
    {
      type: 'policies',
      config: `
# Breached password protection on password policy (v6.11.0+)
# resource "okta_policy_password" "example" {
#   name   = "Password Policy"
#   status = "ACTIVE"
#   password_breached_action = "WARN"  # NONE, WARN, or BLOCK
# }
`,
    },
    {
      type: 'authenticators',
      config: `
# WebAuthn custom AAGUID support (v6.11.0+)
# resource "okta_authenticator" "webauthn" {
#   key    = "webauthn"
#   name   = "WebAuthn"
#   status = "ACTIVE"
#   settings = jsonencode({
#     userVerification = "PREFERRED"
#     aaguidGroups     = [
#       {
#         name    = "YubiKey"
#         aaguids = ["fa2b99dc-9e39-4257-8f92-4a30d23c4118"]
#       }
#     ]
#   })
# }
`,
    },
    {
      type: 'applications',
      config: `
# Push group with AD destination support (v6.11.0+)
# resource "okta_push_group" "ad_example" {
#   app_id         = okta_app_auto_login.ad_app.id
#   group_id       = okta_group.example.id
#   group_push_rule = "SAME_NAME"
#   # AD apps can now be used as push destinations
# }

# App sign-on policy rule: option to stay signed in (v6.11.0+)
# resource "okta_app_signon_policy_rule" "example" {
#   policy_id                 = okta_app_signon_policy.example.id
#   name                      = "Default Rule"
#   factor_mode               = "1FA"
#   type                      = "ASSURANCE"
#   stay_signed_in_consent    = "ALLOWED"  # ALLOWED, REQUIRED, or DENIED (v6.11.0+)
# }
`,
    },
  ],

  '6.12.0': [
    {
      type: 'applications',
      config: `
# CIBA backchannel authenticator support (v6.12.0+)
# resource "okta_app_oauth" "ciba_app" {
#   label                                 = "CIBA App"
#   type                                  = "service"
#   grant_types                           = ["urn:openid:params:grant-type:ciba"]
#   backchannel_custom_authenticator_id   = okta_authenticator.custom.id
# }

# Stay-signed-in option on app sign-on policy rule (v6.12.0+)
# resource "okta_app_signon_policy_rules" "example" {
#   policy_id          = okta_app_signon_policy.example.id
#   name               = "Default Rule"
#   keep_me_signed_in  = true   # Allow users to stay signed in (v6.12.0+)
# }
`,
    },
    {
      type: 'policies',
      config: `
# New data source: read existing app sign-on policy rule (v6.12.0+)
# data "okta_app_sign_on_policy_rule" "existing" {
#   policy_id = "<policy_id>"
#   id        = "<rule_id>"
# }

# New data source: read existing auth server policy rule (v6.12.0+)
# data "okta_authorization_servers_policies_rule" "existing" {
#   auth_server_id = "<auth_server_id>"
#   policy_id      = "<policy_id>"
#   id             = "<rule_id>"
# }
`,
    },
    {
      type: 'users',
      config: `
# New data source: list users assignable to a resource (v6.12.0+)
# data "okta_iam_assignees_user" "candidates" {
#   resource_id   = "<resource_id>"
#   resource_type = "APP"
# }
`,
    },
  ],

  '6.13.0': [
    {
      type: 'governance',
      config: `
# Governance labels (v6.13.0+)
# resource "okta_label" "example" {
#   name = "My Label"
# }
#
# Assign owner to a governed resource:
# resource "okta_resource_owner" "example" {
#   resource_id   = "<resource_id>"
#   resource_type = "APP"
#   owner_id      = okta_user.admin.id
# }
#
# Data sources:
# data "okta_resource_label" "example" { resource_id = "<id>" }
# data "okta_iam_resource_set" "example" { id = "<id>" }
# data "okta_principal_entitlements" "example" { principal_id = "<id>" }
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
  '6.11.0': [
    'okta_policy_password: password_breached_action attribute added (NONE, WARN, BLOCK)',
    'okta_authenticator: authenticator methods and WebAuthn custom AAGUID (aaguidGroups) support added',
    'okta_push_group: AD group push destination support added',
    'okta_app_signon_policy_rule: stay_signed_in_consent attribute added',
    'okta_policy_rule_signon: identity_provider argument changed to TypeSet (may require state migration)',
    'New resource: okta_authenticator_webauthn_custom_aaguid (WebAuthn custom AAGUID management)',
    'New resource: okta_authenticator_method_webauthn (WebAuthn authenticator method settings)',
    'New resources: identity source group, user, import, and group membership management (v6.11.0+)',
    'okta_user: computed timestamp fields added',
    'okta_profile_mapping: terraform import support added',
    'okta_network_zone: diff suppression added (reduces false plan diffs)',
  ],
  '6.12.0': [
    'okta_app_oauth: backchannel_custom_authenticator_id attribute added (CIBA support)',
    'okta_app_signon_policy_rules: keep_me_signed_in attribute added',
    'New data source: okta_app_sign_on_policy_rule (read app sign-on policy rules)',
    'New data source: okta_authorization_servers_policies_rule (read auth server policy rules)',
    'New data source: okta_iam_assignees_user (list users assignable to a resource)',
    'Provider: 429 retries deferred to SDK for DPoP requests (improved rate-limit handling for DPoP-bound traffic)',
    'okta_idp_saml/social/oidc: nil pointer fix when accountLink.filter.groups is null',
    'okta_authenticator: WebAuthn update validation error fixed',
    'okta_policy_password: groups_included field is now respected',
    'okta_app_signon_policy_rules: now works in orgs without Risk Scoring enabled',
  ],

  '6.13.0': [
    'New resource: okta_label (governance label management)',
    'New resource: okta_resource_owner (assign owners to governed resources)',
    'New data source: okta_resource_label',
    'New data source: okta_iam_resource_set',
    'New data source: okta_resource_owners_catalog_resource',
    'New data source: okta_principal_entitlements',
    'New data source: okta_catalog_entry_default',
    'New data source: okta_catalog_entry_user_access_request_fields',
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
