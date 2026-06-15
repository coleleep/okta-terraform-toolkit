# OTTO — Features & Architecture

## Features

### Rate Limit Probing

OTTO tests 50+ Okta API endpoints (including sub-resource paths) and classifies each by remaining capacity. Results drive concrete provider configuration recommendations:

- `max_retries`, `backoff`, `min_wait_seconds`, `max_wait_seconds`
- `request_timeout`, `max_api_capacity`, `parallelism`
- Prevention options (`skip_app_users`, `include_user_roles`, etc.)

Recommendations are volume-aware — the config for 100 users differs from 10,000.

### Cross-Org Sync

Replicate Terraform-managed Okta configurations between orgs (e.g., dev → staging → prod, org migration, environment parity).

**Two input modes:**

- **Live Org Connection** — connect directly to a source org via API token. OTTO discovers resources from the source API, compares against the target, and shows a field-by-field attribute diff.
- **File Upload** — upload `.tf` and `.tfstate` files from a source org for offline comparison.

**Pipeline:**

1. **Discover** — connects to source org (live API or file upload) and enumerates all managed resources
2. **Match & Diff** — matches resources by name against the target org, then fetches field-level attribute differences
3. **Convert** — AI-powered or deterministic ID substitution with import block generation
4. **Apply** — export ready-to-apply config or run `terraform init/plan/apply` directly in-app

**Capabilities:**

- 30+ Okta resource types supported
- 3-level hierarchy resolution (auth server → policy → rule) with correct composite import IDs
- Field-level attribute diff view with filtering (changed/missing/same)
- Selective sync — choose individual resources to include
- Bi-directional comparison (swap source/target with one click)
- Deterministic convert mode (no AI key required) with automatic camelCase → snake_case field mapping
- In-app Terraform runner with live output streaming
- Rollback support — saves tfstate bundle, generates destroy config to undo a sync
- Provider version management — download, cache, and pin specific Okta provider versions
- System zone and computed field exclusion to prevent apply errors

### Target Runtime Planner

Specify a desired Terraform run duration (e.g., 30 minutes) and OTTO identifies which endpoints are bottlenecks, whether the target is achievable, and what limit increases would be needed.

### Debug & Log Analysis

- Parse `TF_LOG=DEBUG` output to extract per-endpoint request stats, rate-limit hits, and error breakdowns
- Detects Terraform validation errors (provider/schema mismatches) even when no HTTP requests were made
- AI-powered root cause analysis with actionable config fix recommendations
- Okta API error decoder with remediation suggestions

### Code Generation

Produces production-ready Terraform files:

- `provider.tf` — optimized provider block with rate limit settings
- `versions.tf` — required provider version constraints
- `variables.tf` — input variables for authentication (API token or OAuth)
- Import blocks for state migration

## Supported Provider Versions

6.6.1 through 6.12.0 (default). Version-specific resource additions and attribute changes are tracked automatically.

## Architecture

```
src/
├── main/               # Electron main process
│   ├── api/
│   │   ├── auth.ts              # Target org connection
│   │   ├── source-auth.ts       # Source org connection
│   │   ├── sync.ts              # Resource discovery, matching, diffing
│   │   ├── sync-convert.ts      # Deterministic HCL conversion
│   │   ├── claude.ts            # AI-powered conversion & analysis
│   │   ├── terraform.ts         # In-app terraform runner
│   │   ├── rollback.ts          # Tfstate rollback bundles
│   │   ├── okta-provider-manager.ts  # Provider version download & mirror
│   │   ├── log-parser.ts        # TF_LOG debug file parser
│   │   └── probe.ts / deep-probe.ts  # Rate limit probing
│   ├── logger.ts       # Structured audit logging with rotation
│   └── ipc-handlers.ts
├── renderer/           # React UI
│   ├── components/
│   │   ├── SyncSection.tsx   # Cross-org sync pipeline UI
│   │   ├── DiffView.tsx      # Field-level resource comparison
│   │   ├── LogAnalyzer.tsx   # TF_LOG analysis UI
│   │   └── ...
│   ├── pages/          # Connect + Dashboard
│   └── hooks/          # Zustand state store
├── shared/             # Types, constants, code generation
│   ├── terraform-gen.ts  # HCL generation with type-aware field mapping
│   ├── types.ts
│   ├── versions.ts
│   └── constants.ts
├── preload.ts          # Secure IPC bridge
test-data/              # Reusable sync test fixtures
```

**Stack:** Electron · React 18 · TypeScript · Tailwind CSS · Zustand · Webpack 5

## Authentication

OTTO requires an Okta API token with Super Admin permissions. Some endpoints used for rate limit probing and resource discovery are not accessible via OAuth client credentials, so an API token is the only supported auth method.

**Important:** For accurate probing and configuration recommendations, the API token must be set to **100% rate limit capacity**. By default, Okta may throttle individual tokens below the org-wide limit. See [API Token Rate Limit Violation](https://support.okta.com/help/s/article/API-Token-Rate-Limit-Violation?language=en_US) for instructions on adjusting this setting.

## AI Features

OTTO uses AI (via OCM-managed LiteLLM) to power:

- **Workload description** — describe your Terraform use case in plain English and get parsed resource selections
- **Config conversion** — regenerate HCL for a different org with correct IDs and import blocks
- **Log interpretation** — explain what went wrong in a failed Terraform run
- **Error decoding** — translate Okta API errors into actionable fixes

### Setup

OTTO uses an OCM-managed LiteLLM key by default — no manual API key required.

1. Run `ocm auth litellm` in your terminal to authenticate
2. Open OTTO and click **Reload** on the AI Configuration card — it should show green
3. Tokens refresh automatically; if OTTO shows red, re-run `ocm auth litellm`

#### Advanced: Static API Key Override

If you need to point OTTO at a different endpoint (e.g., for testing):

1. On the **Connect** page, expand **Advanced settings** under AI Configuration
2. Enter a static API key and optional endpoint URL
3. Click **Save static override** — this takes precedence over OCM until you click **Use OCM key**

## Resource Coverage

30+ Okta resource categories including:

- Users, Groups, Applications (with assignments)
- Auth Servers (policies, scopes, claims, rules)
- Policies (sign-on, password, MFA, enrollment, IdP discovery)
- Network Zones, Trusted Origins, Domains
- Identity Providers, Identity Sources, Authenticators
- Event Hooks, Inline Hooks, Log Streams
- Custom Roles, Profile Mappings, Brands

## Testing

The `test-data/` folder contains reusable Terraform fixtures for validating the cross-org sync feature. Each subfolder has a `main.tf` (source org config) and `source.tfstate` (synthetic state with fake IDs). See [`test-data/README.md`](test-data/README.md) for setup instructions.

| Scenario | Focus |
|----------|-------|
| `sync-priority` | Policy rule priority ordering, `depends_on` chain generation |
| `sync-comprehensive` | Groups, memberships, apps, assignments, trusted origins, auth server scopes/claims, policies |
