
# --- main.tf ---
terraform {
  required_providers {
    okta = {
      source  = "okta/okta"
      version = "~> 6.10"
    }
  }
}

provider "okta" {
  org_name  = var.org_name
  base_url  = var.base_url
  api_token = var.api_token
}

variable "org_name" {
  type = string
}

variable "base_url" {
  type    = string
  default = "okta.com"
}

variable "api_token" {
  type      = string
  sensitive = true
}

# ── Top-level resources ─────────────────────────────────────

# MISSING in target org — will be created on apply
resource "okta_group" "engineering" {
  name        = "Engineering"
  description = "Engineering team"
}

# MISSING in target org — will be created on apply
resource "okta_group" "qa" {
  name        = "QA"
  description = "Quality assurance team"
}

# MISSING in target org — will be created on apply
resource "okta_app_oauth" "internal_api" {
  label                      = "Internal API"
  type                       = "service"
  grant_types                = ["client_credentials"]
  token_endpoint_auth_method = "client_secret_basic"
}

# MISSING in target org — will be created on apply
resource "okta_trusted_origin" "dev_portal" {
  name   = "Dev Portal"
  origin = "https://dev.example.com"
  scopes = ["CORS", "REDIRECT"]
}

# ── Auth Server ─────────────────────────────────────────────

# MISSING in target org — will be created on apply
resource "okta_auth_server" "custom_api" {
  name        = "Custom API Server"
  description = "Auth server for custom API"
  audiences   = ["https://api.example.com"]
}

# ── Auth Server Policies ────────────────────────────────────

# MISSING in target org — will be created on apply
resource "okta_auth_server_policy" "standard_access" {
  auth_server_id   = okta_auth_server.custom_api.id
  name             = "Standard Access Policy"
  description      = "Policy for standard API access"
  priority         = 1
  client_whitelist = ["ALL_CLIENTS"]
}

# MISSING in target org — will be created on apply
resource "okta_auth_server_policy" "restricted_access" {
  auth_server_id   = okta_auth_server.custom_api.id
  name             = "Restricted Access Policy"
  description      = "Policy for restricted endpoints"
  priority         = 2
  client_whitelist = ["ALL_CLIENTS"]
}

# ── Auth Server Policy Rules ───────────────────────────────

# MISSING in target org — will be created on apply
resource "okta_auth_server_policy_rule" "allow_standard" {
  auth_server_id                = okta_auth_server.custom_api.id
  policy_id                     = okta_auth_server_policy.standard_access.id
  name                          = "Allow Standard Tokens"
  priority                      = 1
  grant_type_whitelist          = ["client_credentials"]
  access_token_lifetime_minutes = 60
}

# MISSING in target org — will be created on apply
resource "okta_auth_server_policy_rule" "allow_restricted" {
  auth_server_id                = okta_auth_server.custom_api.id
  policy_id                     = okta_auth_server_policy.restricted_access.id
  name                          = "Allow Restricted Tokens"
  priority                      = 1
  grant_type_whitelist          = ["client_credentials"]
  access_token_lifetime_minutes = 15
}

# ── Auth Server Scopes ──────────────────────────────────────

# MISSING in target org — will be created on apply
resource "okta_auth_server_scope" "read_data" {
  auth_server_id = okta_auth_server.custom_api.id
  name           = "read:data"
  description    = "Read access to data"
  consent        = "IMPLICIT"
}

# MISSING in target org — will be created on apply
resource "okta_auth_server_scope" "write_data" {
  auth_server_id = okta_auth_server.custom_api.id
  name           = "write:data"
  description    = "Write access to data"
  consent        = "IMPLICIT"
}

# MISSING in target org — will be created on apply
resource "okta_auth_server_scope" "admin_data" {
  auth_server_id = okta_auth_server.custom_api.id
  name           = "admin:data"
  description    = "Admin access to data"
  consent        = "REQUIRED"
}

# ── Auth Server Claims ──────────────────────────────────────

# MISSING in target org — will be created on apply
resource "okta_auth_server_claim" "department" {
  auth_server_id = okta_auth_server.custom_api.id
  name           = "department"
  value          = "user.department"
  claim_type     = "RESOURCE"
  value_type     = "EXPRESSION"
}

# MISSING in target org — will be created on apply
resource "okta_auth_server_claim" "team_role" {
  auth_server_id = okta_auth_server.custom_api.id
  name           = "team_role"
  value          = "user.title"
  claim_type     = "RESOURCE"
  value_type     = "EXPRESSION"
}
