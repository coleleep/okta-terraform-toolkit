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
# Engineering group: MATCHES source
resource "okta_group" "engineering" {
  name        = "Engineering"
  description = "Engineering team"
}

# QA group: intentionally MISSING from target to test 'missing' status

# Internal API app: MATCHES source
resource "okta_app_oauth" "internal_api" {
  label                      = "Internal API"
  type                       = "service"
  grant_types                = ["client_credentials"]
  token_endpoint_auth_method = "client_secret_basic"
}

# Trusted origin: MATCHES source
resource "okta_trusted_origin" "dev_portal" {
  name   = "Dev Portal"
  origin = "https://dev.example.com"
  scopes = ["CORS", "REDIRECT"]
}

# ── Auth Server ─────────────────────────────────────────────
# MATCHES source by name
resource "okta_auth_server" "custom_api" {
  name        = "Custom API Server"
  description = "Auth server for custom API - target org"
  audiences   = ["https://api.example.com"]
}

# ── Auth Server Policies ────────────────────────────────────
# Standard Access Policy: MATCHES source
resource "okta_auth_server_policy" "standard_access" {
  auth_server_id = okta_auth_server.custom_api.id
  name           = "Standard Access Policy"
  description    = "Policy for standard API access"
  priority       = 1
  client_whitelist = ["ALL_CLIENTS"]
}

# Restricted Access Policy: intentionally MISSING to test 'missing' status

# ── Auth Server Policy Rules ───────────────────────────────
# Rule under Standard Access: MATCHES source
resource "okta_auth_server_policy_rule" "allow_standard" {
  auth_server_id = okta_auth_server.custom_api.id
  policy_id      = okta_auth_server_policy.standard_access.id
  name           = "Allow Standard Tokens"
  priority       = 1
  grant_type_whitelist = ["client_credentials"]
  access_token_lifetime_minutes = 60
}

# Rule under Restricted Access: MISSING (parent policy is also missing)

# ── Auth Server Scopes ──────────────────────────────────────
# read:data and write:data MATCH source
resource "okta_auth_server_scope" "read_data" {
  auth_server_id = okta_auth_server.custom_api.id
  name           = "read:data"
  description    = "Read access to data"
  consent        = "IMPLICIT"
}

resource "okta_auth_server_scope" "write_data" {
  auth_server_id = okta_auth_server.custom_api.id
  name           = "write:data"
  description    = "Write access to data"
  consent        = "IMPLICIT"
}

# admin:data scope: intentionally MISSING to test 'missing' status

# ── Auth Server Claims ──────────────────────────────────────
# department claim: MATCHES source
resource "okta_auth_server_claim" "department" {
  auth_server_id = okta_auth_server.custom_api.id
  name           = "department"
  value          = "user.department"
  claim_type     = "RESOURCE"
  value_type     = "EXPRESSION"
}

# team_role claim: intentionally MISSING to test 'missing' status
