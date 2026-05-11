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

# ─── Groups ───────────────────────────────────────────────────

resource "okta_group" "engineering" {
  name        = "Test-Engineering"
  description = "Test engineering team group"
}

resource "okta_group" "marketing" {
  name        = "Test-Marketing"
  description = "Test marketing team group"
}

resource "okta_group" "contractors" {
  name        = "Test-Contractors"
  description = "Test contractors group"
}

resource "okta_group" "app_users" {
  name        = "Test-App-Users"
  description = "Test group for app assignments"
}

# ─── Group Memberships ────────────────────────────────────────
# Add real user IDs from your source org below.
# You can find user IDs in the Okta admin console under Directory > People,
# or via: curl -s https://{org}.okta.com/api/v1/users -H "Authorization: SSWS {token}" | jq '.[].id'

resource "okta_group_memberships" "engineering_members" {
  group_id = okta_group.engineering.id
  users = [
    "00uXXXXXXXXXXXXXXX01",  # Replace with a real user ID
    "00uXXXXXXXXXXXXXXX02",  # Replace with a real user ID
  ]
}

# ─── Applications ─────────────────────────────────────────────

resource "okta_app_oauth" "test_web_app" {
  label                      = "Test Web App"
  type                       = "web"
  grant_types                = ["authorization_code"]
  redirect_uris              = ["http://localhost:8080/callback"]
  post_logout_redirect_uris  = ["http://localhost:8080"]
  response_types             = ["code"]
  token_endpoint_auth_method = "client_secret_basic"
}

resource "okta_app_oauth" "test_spa_app" {
  label                      = "Test SPA App"
  type                       = "web"
  grant_types                = ["authorization_code"]
  redirect_uris              = ["http://localhost:3000/callback"]
  post_logout_redirect_uris  = ["http://localhost:3000"]
  response_types             = ["code"]
  token_endpoint_auth_method = "client_secret_basic"
}

# ─── App Group Assignments ────────────────────────────────────

resource "okta_app_group_assignment" "test_web_app_users" {
  app_id   = okta_app_oauth.test_web_app.id
  group_id = okta_group.app_users.id
}

# ─── Trusted Origins ─────────────────────────────────────────

resource "okta_trusted_origin" "test_local" {
  name   = "Test Local Dev"
  origin = "http://localhost:3000"
  scopes = ["CORS", "REDIRECT"]
}

resource "okta_trusted_origin" "test_staging" {
  name   = "Test Staging"
  origin = "https://staging.example.com"
  scopes = ["CORS", "REDIRECT"]
}

# ─── Auth Server ──────────────────────────────────────────────

resource "okta_auth_server" "test_api" {
  name        = "Test API Server"
  description = "Test auth server for sync validation"
  audiences   = ["https://api.example.com"]
  status      = "ACTIVE"
}

# ─── Auth Server Policy ───────────────────────────────────────

resource "okta_auth_server_policy" "test_default_policy" {
  auth_server_id   = okta_auth_server.test_api.id
  name             = "Test Default Policy"
  description      = "Default test policy"
  priority         = 1
  status           = "ACTIVE"
  client_whitelist = ["ALL_CLIENTS"]
}

# ─── Auth Server Policy Rule ─────────────────────────────────

resource "okta_auth_server_policy_rule" "test_default_rule" {
  auth_server_id       = okta_auth_server.test_api.id
  policy_id            = okta_auth_server_policy.test_default_policy.id
  name                 = "Test Default Rule"
  priority             = 1
  status               = "ACTIVE"
  grant_type_whitelist = ["authorization_code", "client_credentials"]
  group_whitelist      = ["EVERYONE"]
  scope_whitelist      = ["*"]
}

# ─── Auth Server Scopes ───────────────────────────────────────

resource "okta_auth_server_scope" "test_read" {
  auth_server_id   = okta_auth_server.test_api.id
  name             = "test:read"
  consent          = "IMPLICIT"
  default          = false
  metadata_publish = "ALL_CLIENTS"
}

resource "okta_auth_server_scope" "test_write" {
  auth_server_id   = okta_auth_server.test_api.id
  name             = "test:write"
  consent          = "REQUIRED"
  default          = false
  metadata_publish = "ALL_CLIENTS"
}

# ─── Auth Server Claims ──────────────────────────────────────

resource "okta_auth_server_claim" "test_groups_claim" {
  auth_server_id          = okta_auth_server.test_api.id
  name                    = "groups"
  value                   = "Groups.startsWith(\"OKTA\",\"Test\",100)"
  value_type              = "EXPRESSION"
  claim_type              = "RESOURCE"
  scopes                  = []
  always_include_in_token = true
}

# ─── Sign-On Policy ──────────────────────────────────────────

resource "okta_policy_signon" "test_signon" {
  name            = "Test Sign-On Policy"
  status          = "ACTIVE"
  description     = "Test sign-on policy for sync validation"
  groups_included = ["EVERYONE"]
}

# ─── Sign-On Policy Rule ─────────────────────────────────────

resource "okta_policy_rule_signon" "test_signon_rule" {
  policy_id = okta_policy_signon.test_signon.id
  name      = "Test Sign-On Rule"
  status    = "ACTIVE"
  access    = "ALLOW"
}

# ─── Password Policy ─────────────────────────────────────────

resource "okta_policy_password" "test_password" {
  name            = "Test Password Policy"
  status          = "INACTIVE"
  description     = "Test password policy for sync validation"
  groups_included = ["EVERYONE"]
}

# ─── Password Policy Rule ────────────────────────────────────

resource "okta_policy_rule_password" "test_password_rule" {
  policy_id = okta_policy_password.test_password.id
  name      = "Test Password Rule"
  status    = "ACTIVE"
}
