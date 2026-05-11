terraform {
  required_providers {
    okta = {
      source  = "okta/okta"
      version = "~> 6.10"
    }
  }
}

provider "okta" {
  org_name  = "your-source-org"   # Replace with your source org subdomain
  base_url  = "okta.com"          # or "oktapreview.com" for preview orgs
  api_token = var.okta_api_token
}

variable "okta_api_token" {
  type      = string
  sensitive = true
}

# ─── Auth Server ──────────────────────────────────────────────

resource "okta_auth_server" "api" {
  name        = "authFUN!"
  description = "API auth server with multiple policies and rules"
  audiences   = ["https://api.example.com"]
  status      = "ACTIVE"
}

# ─── Auth Server Policies (multiple, with priority) ───────────

resource "okta_auth_server_policy" "internal_apps" {
  auth_server_id   = okta_auth_server.api.id
  name             = "Internal Apps"
  description      = "Policy for internal applications"
  priority         = 1
  status           = "ACTIVE"
  client_whitelist = ["ALL_CLIENTS"]
}

resource "okta_auth_server_policy" "external_apps" {
  auth_server_id   = okta_auth_server.api.id
  name             = "External Apps"
  description      = "Policy for external/partner applications"
  priority         = 2
  status           = "ACTIVE"
  client_whitelist = ["ALL_CLIENTS"]
}

resource "okta_auth_server_policy" "service_accounts" {
  auth_server_id   = okta_auth_server.api.id
  name             = "Service Accounts"
  description      = "Policy for machine-to-machine flows"
  priority         = 3
  status           = "ACTIVE"
  client_whitelist = ["ALL_CLIENTS"]
}

# ─── Internal Apps Policy Rules (3 rules, priority-ordered) ───

resource "okta_auth_server_policy_rule" "internal_admin" {
  auth_server_id                = okta_auth_server.api.id
  policy_id                     = okta_auth_server_policy.internal_apps.id
  name                          = "Admin Access"
  priority                      = 1
  status                        = "ACTIVE"
  grant_type_whitelist          = ["authorization_code"]
  group_whitelist               = ["EVERYONE"]
  scope_whitelist               = ["*"]
  access_token_lifetime_minutes = 15
}

resource "okta_auth_server_policy_rule" "internal_standard" {
  auth_server_id                = okta_auth_server.api.id
  policy_id                     = okta_auth_server_policy.internal_apps.id
  name                          = "Standard Access"
  priority                      = 2
  status                        = "ACTIVE"
  grant_type_whitelist          = ["authorization_code"]
  group_whitelist               = ["EVERYONE"]
  scope_whitelist               = ["*"]
  access_token_lifetime_minutes = 60
}

resource "okta_auth_server_policy_rule" "internal_readonly" {
  auth_server_id                = okta_auth_server.api.id
  policy_id                     = okta_auth_server_policy.internal_apps.id
  name                          = "Read-Only Access"
  priority                      = 3
  status                        = "ACTIVE"
  grant_type_whitelist          = ["authorization_code"]
  group_whitelist               = ["EVERYONE"]
  scope_whitelist               = ["*"]
  access_token_lifetime_minutes = 120
}

# ─── External Apps Policy Rules (2 rules) ─────────────────────

resource "okta_auth_server_policy_rule" "external_oauth" {
  auth_server_id                = okta_auth_server.api.id
  policy_id                     = okta_auth_server_policy.external_apps.id
  name                          = "OAuth Flow"
  priority                      = 1
  status                        = "ACTIVE"
  grant_type_whitelist          = ["authorization_code"]
  group_whitelist               = ["EVERYONE"]
  scope_whitelist               = ["*"]
  access_token_lifetime_minutes = 30
}

resource "okta_auth_server_policy_rule" "external_limited" {
  auth_server_id                = okta_auth_server.api.id
  policy_id                     = okta_auth_server_policy.external_apps.id
  name                          = "Limited Access"
  priority                      = 2
  status                        = "ACTIVE"
  grant_type_whitelist          = ["authorization_code"]
  group_whitelist               = ["EVERYONE"]
  scope_whitelist               = ["*"]
  access_token_lifetime_minutes = 15
}

# ─── Service Accounts Policy Rule (1 rule) ────────────────────

resource "okta_auth_server_policy_rule" "service_m2m" {
  auth_server_id                = okta_auth_server.api.id
  policy_id                     = okta_auth_server_policy.service_accounts.id
  name                          = "M2M Flow"
  priority                      = 1
  status                        = "ACTIVE"
  grant_type_whitelist          = ["client_credentials"]
  scope_whitelist               = ["*"]
  access_token_lifetime_minutes = 5
}

# ─── Global Sign-On Policies ──────────────────────────────────

resource "okta_policy_signon" "mfa_required" {
  name            = "MFA Required"
  status          = "ACTIVE"
  description     = "Require MFA for sensitive groups"
  priority        = 1
  groups_included = ["EVERYONE"]
}

resource "okta_policy_signon" "standard_access" {
  name            = "Standard Access"
  status          = "ACTIVE"
  description     = "Standard sign-on policy"
  priority        = 2
  groups_included = ["EVERYONE"]
}

# ─── Sign-On Policy Rules ─────────────────────────────────────

resource "okta_policy_rule_signon" "mfa_always" {
  policy_id          = okta_policy_signon.mfa_required.id
  name               = "Always MFA"
  priority           = 1
  status             = "ACTIVE"
  access             = "ALLOW"
  mfa_required       = false
  session_lifetime   = 120
  session_idle       = 60
  session_persistent = false
}

resource "okta_policy_rule_signon" "mfa_new_device" {
  policy_id          = okta_policy_signon.mfa_required.id
  name               = "MFA on New Device"
  priority           = 2
  status             = "ACTIVE"
  access             = "ALLOW"
  mfa_required       = false
  session_lifetime   = 480
  session_idle       = 120
  session_persistent = true
}

resource "okta_policy_rule_signon" "mfa_catch_all" {
  policy_id          = okta_policy_signon.mfa_required.id
  name               = "Catch All"
  priority           = 3
  status             = "ACTIVE"
  access             = "ALLOW"
  mfa_required       = false
  session_lifetime   = 120
  session_idle       = 60
}

resource "okta_policy_rule_signon" "standard_allow" {
  policy_id          = okta_policy_signon.standard_access.id
  name               = "Allow All"
  priority           = 1
  status             = "ACTIVE"
  access             = "ALLOW"
  session_lifetime   = 720
  session_idle       = 120
  session_persistent = true
}
