# OTTO — Okta Terraform Toolkit

A professional-grade desktop application for Okta Support Engineers and administrators. OTTO streamlines Okta Terraform workflows with intelligent rate limit analysis, cross-org configuration migration, real-time API diagnostics, and AI-assisted troubleshooting.

## What OTTO Does

### 🔍 **Rate Limit Probing**
Tests 50+ Okta API endpoints (including sub-resources) and classifies each by remaining capacity. Generates concrete provider configuration recommendations:
- `max_retries`, `backoff`, `min_wait_seconds`, `max_wait_seconds`
- `request_timeout`, `max_api_capacity`, `parallelism`
- Prevention options (`skip_app_users`, `include_user_roles`, etc.)

Recommendations are volume-aware — optimal config for 100 users differs from 10,000.

### 🔄 **Cross-Org Sync Pipeline**
Replicate Terraform-managed Okta configurations between orgs (dev → staging → prod, migrations, environment parity).

**Two input modes:**
- **Live Org Connection** — connect directly to source org and auto-discover resources
- **File Upload** — upload `.tf` and `.tfstate` files for offline comparison

**Full pipeline:**
1. **Discover** — enumerate managed resources from source API or files
2. **Match & Diff** — compare against target org with field-level attribute diffs
3. **Convert** — AI-powered or deterministic ID substitution with import blocks
4. **Apply** — export HCL or run `terraform init/plan/apply` directly in-app

**Supports 30+ Okta resource types** with 3-level hierarchy resolution (auth server → policy → rule) and correct composite import IDs.

### ⏱️ **Target Runtime Planner**
Specify a desired Terraform run duration (e.g., 30 minutes) and identify:
- Which API endpoints are bottlenecks
- Whether the target is achievable
- What rate limit increases are needed

### 🐛 **Debug & Log Analysis**
- Parse `TF_LOG=DEBUG` output to extract per-endpoint request stats, rate-limit hits, and error breakdowns
- Detect Terraform validation errors (provider/schema mismatches) even without HTTP requests
- AI-powered root cause analysis with actionable config fixes
- Okta API error decoder with remediation suggestions

### 📦 **Provider Version Management**
Download, cache, and pin specific Okta provider versions (6.6.1–6.12.0). Automatic tracking of version-specific resource additions and attribute changes.

### 💾 **Code Generation**
Produces production-ready Terraform files:
- `provider.tf` — optimized provider block with rate limit settings
- `versions.tf` — required provider version constraints
- `variables.tf` — input variables for authentication (API token or OAuth)
- Import blocks for state migration

### 🔙 **Rollback Support**
Saves tfstate bundle and generates destroy config to safely undo a sync operation.

### 🤖 **AI Features** (Optional)
AI-powered capabilities via OCM-managed LiteLLM:
- **Workload description** — describe your use case in plain English and get parsed resource selections
- **Config conversion** — regenerate HCL for a different org with correct IDs
- **Log interpretation** — explain failed Terraform runs
- **Error decoding** — translate Okta API errors into fixes

## Prerequisites

- **Node.js 18+**
- **npm**
- **OCM** — for AI features only (`ocm auth litellm`)
- **Okta org** — Super Admin API token with 100% rate limit capacity

## Install & Run

```bash
git clone https://github.com/coleleep/okta-terraform-toolkit
cd okta-terraform-toolkit
npm install
npm run dev
```

## Quick Start

1. **Launch the app** — runs on `localhost` with Electron
2. **Connect to target org** — enter org URL and Super Admin API token
3. **Run rate limit probe** — test your org's API capacity
4. **Set up cross-org sync** (optional) — connect source org or upload `.tf`/`.tfstate` files
5. **Analyze logs** (optional) — upload `TF_LOG=DEBUG` output for AI-assisted troubleshooting

## AI Features Setup

To enable AI features:

```bash
ocm auth litellm
```

Then in OTTO:
1. Click **Reload** on the AI Configuration card
2. It should show green (LiteLLM key auto-detected)
3. Tokens refresh automatically

**Advanced:** Override with a static API key via **Advanced settings** on the Connect page.

## Production Build

```bash
npm start
```

## Testing

The `test-data/` folder contains reusable Terraform fixtures for validating the cross-org sync feature. See [`test-data/README.md`](test-data/README.md).

## Full Documentation

For architecture, supported resources, authentication details, and advanced configuration, see **[docs/FEATURES.md](docs/FEATURES.md)**.

## License

ISC
