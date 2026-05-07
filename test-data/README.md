# Test Data for Cross-Org Migration (Sub-Resource Sync)

## Purpose
These Terraform configs seed two Okta orgs with test data to validate OTTO's cross-org sync feature, including sub-resource matching for auth server children.

## What's Covered

| Resource Type | Source Org | Target Org | Expected Status |
|---|---|---|---|
| `okta_group` (Engineering) | Yes | Yes | matched |
| `okta_group` (QA) | Yes | No | missing |
| `okta_app_oauth` (Internal API) | Yes | Yes | matched |
| `okta_trusted_origin` (Dev Portal) | Yes | Yes | matched |
| `okta_auth_server` (Custom API Server) | Yes | Yes | matched |
| `okta_auth_server_policy` (Standard Access) | Yes | Yes | matched |
| `okta_auth_server_policy` (Restricted Access) | Yes | No | missing |
| `okta_auth_server_policy_rule` (Allow Standard) | Yes | Yes | matched |
| `okta_auth_server_policy_rule` (Allow Restricted) | Yes | No | missing (parent also missing) |
| `okta_auth_server_scope` (read:data) | Yes | Yes | matched |
| `okta_auth_server_scope` (write:data) | Yes | Yes | matched |
| `okta_auth_server_scope` (admin:data) | Yes | No | missing |
| `okta_auth_server_claim` (department) | Yes | Yes | matched |
| `okta_auth_server_claim` (team_role) | Yes | No | missing |

## Setup

### 1. Seed the Source Org

```bash
cd test-data/source-org

# Create terraform.tfvars with your source org credentials
cat > terraform.tfvars <<EOF
org_name  = "your-source-org"
api_token = "your-source-api-token"
EOF

terraform init
terraform apply

# Export state file for use with OTTO
terraform state pull > ../source.tfstate
```

### 2. Seed the Target Org

```bash
cd test-data/target-org

# Create terraform.tfvars with your target org credentials
cat > terraform.tfvars <<EOF
org_name  = "your-target-org"
api_token = "your-target-api-token"
EOF

terraform init
terraform apply
```

### 3. Test with OTTO

1. Open OTTO and connect to the **target** org
2. Go to **Org Sync**
3. Upload `source-org/main.tf` and `source.tfstate`
4. Verify the **Compare** step shows:
   - 14 total resources
   - Auth server matched, with children nested below
   - Policies, scopes, claims show correct matched/missing statuses
   - Policy rule under missing parent shows as missing
   - Sub-resource count shows 9 in the summary
5. Click **Convert Config** and verify:
   - Import blocks generated for all matched resources (including sub-resources)
   - `auth_server_id` references use interpolation, not hardcoded IDs
   - Warnings flag missing resources
6. Export and review

## Cleanup

```bash
# Source org
cd test-data/source-org && terraform destroy

# Target org
cd test-data/target-org && terraform destroy
```
