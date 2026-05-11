# Test Data

Test fixtures for validating OTTO's cross-org sync feature. Each subfolder contains Terraform configs that represent a **source org's** configuration, ready to be synced into a separate **target org**.

## Prerequisites

- Two Okta tenants (source + target) — developer orgs or preview orgs work fine
- An API token for each org with Super Admin permissions
- Terraform >= 1.5 installed
- OTTO running locally (`npm start`)

## Folder: `sync-priority`

Tests the priority ordering and `depends_on` chain generation for policy rules. Contains:

| File | Purpose |
|------|---------|
| `main.tf` | Source org config — auth server with 3 policies, 6 rules, 2 sign-on policies with 4 rules |
| `source.tfstate` | Simulated state file representing existing resources in the source org |

### What this exercises

- Multiple auth server policies under one auth server (priority 1, 2, 3)
- Multiple rules per policy with priority ordering
- Global sign-on policies with multiple rules
- `depends_on` chain generation in ascending priority order
- Priority reordering during sync (source priorities may differ from target)

## Folder: `sync-comprehensive`

Tests a broad set of resource types including group memberships, apps, and app assignments. Contains:

| File | Purpose |
|------|---------|
| `main.tf` | Source org config — groups, group memberships, OAuth apps, app group assignments, trusted origins, auth server with scopes/claims, sign-on and password policies |
| `source.tfstate` | Simulated state file with synthetic IDs for all resources |

### What this exercises

- Group creation and group membership syncing (requires real user IDs)
- OAuth app configuration (web + SPA)
- App-to-group assignments
- Trusted origins (local dev + staging)
- Auth server with custom scopes (`test:read`, `test:write`) and group claims
- Sign-on and password policies with rules

### Setup note: Group memberships

The `okta_group_memberships` resource requires real user IDs from your source org. Before deploying, replace the placeholder IDs in `main.tf`:

```hcl
users = [
  "00uXXXXXXXXXXXXXXX01",  # Replace with a real user ID
  "00uXXXXXXXXXXXXXXX02",  # Replace with a real user ID
]
```

To find user IDs in your org:
```bash
curl -s https://{your-org}.okta.com/api/v1/users \
  -H "Authorization: SSWS {your-token}" | jq '.[].id'
```

## How to Test Cross-Org Sync

### Step 1: Deploy source config to your source org

```bash
cd test-data/sync-priority

# Point at YOUR source org
# Edit main.tf: change org_name and base_url to your source tenant

# Create a tfvars file (gitignored)
echo 'okta_api_token = "YOUR_SOURCE_API_TOKEN"' > terraform.tfvars

terraform init
terraform apply
```

This creates the resources in your source org.

### Step 2: Run the sync in OTTO

1. Open OTTO (`npm start`)
2. Go to the **Sync** section
3. Enter your **source org** URL and API token
4. Enter your **target org** URL and API token
5. Click **Discover** to scan the source org
6. Select resources to sync (or select all)
7. Click **Convert** — OTTO calls Claude to generate portable HCL with `depends_on` chains
8. Click **Export** to write the target config

### Step 3: Apply to your target org

```bash
cd <exported-folder>

# The exported main.tf already has the target provider config
# Create a tfvars file
echo 'okta_api_token = "YOUR_TARGET_API_TOKEN"' > terraform.tfvars

terraform init
terraform apply
```

### What to verify

- All resources apply without errors (no 409 conflicts)
- Policy rules are created sequentially (watch the apply output — rules under the same policy should not run in parallel)
- The exported HCL contains `depends_on` chains between rules sharing the same parent policy
- Auth server policies are also chained by priority

### Step 4: Test priority reordering (optional)

After the initial sync, modify priorities in the source org (e.g., swap "Admin Access" priority 1 with "Read-Only Access" priority 3), re-run the sync, and apply again. The `depends_on` chains ensure the priority swap applies cleanly without 409s.

## Adding New Test Scenarios

Create a new subfolder with:

1. `main.tf` — the Terraform config representing your source org state
2. `source.tfstate` — a synthetic state file with fake IDs (committed to the repo for offline testing)

Guidelines:
- Use obviously generic names prefixed with "Test" (e.g., `Test-Engineering`, `Test Web App`, `Test Sign-On Policy`)
- Use placeholder `org_name` values with a comment (e.g., `"your-source-org"  # Replace with your org`)
- For user IDs, use `00uXXXXXXXXXXXXXXX01` placeholders with comments to replace
- Never commit `.tfvars`, real `.tfstate` (only `source.tfstate`), `.terraform/`, or `.terraform.lock.hcl`
- Use `group_whitelist = ["EVERYONE"]` so configs work without creating specific groups first
- Use synthetic IDs in `source.tfstate` that are clearly fake (e.g., `00g11aaa1111111111698`)
