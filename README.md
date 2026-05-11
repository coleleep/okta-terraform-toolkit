# OTTO — Okta Terraform Toolkit

A desktop application that optimizes Terraform configurations for the [Okta provider](https://registry.terraform.io/providers/okta/okta/latest). OTTO probes your org's API rate limits in real time, recommends provider settings to avoid throttling, and provides AI-assisted cross-org state migration.

## Features

### Rate Limit Probing

OTTO tests 50+ Okta API endpoints (including sub-resource paths) and classifies each by remaining capacity. Results drive concrete provider configuration recommendations:

- `max_retries`, `backoff`, `min_wait_seconds`, `max_wait_seconds`
- `request_timeout`, `max_api_capacity`, `parallelism`
- Prevention options (`skip_app_users`, `include_user_roles`, etc.)

Recommendations are volume-aware — the config for 100 users differs from 10,000.

### Cross-Org Sync

Migrate Terraform state between Okta orgs (e.g., dev → staging → prod):

1. **Parse** — reads your `.tfstate` and `.tf` files from the source org
2. **Match** — compares each resource against the target org's live API
3. **Convert** — AI regenerates HCL with correct target-org resource IDs
4. **Export** — produces ready-to-apply Terraform with `import` blocks, optimized provider config, and proper variable definitions

Supports parent/child/grandchild relationships: auth server → policy → rule, app → user/group assignments, group → memberships.

### Target Runtime Planner

Specify a desired Terraform run duration (e.g., 30 minutes) and OTTO identifies which endpoints are bottlenecks, whether the target is achievable, and what limit increases would be needed.

### Debug & Log Analysis

- Parse `TF_LOG=DEBUG` output to extract per-endpoint request stats, rate-limit hits, and error breakdowns
- AI-powered root cause analysis with actionable config fix recommendations
- Okta API error decoder with remediation suggestions

### Code Generation

Produces production-ready Terraform files:

- `provider.tf` — optimized provider block with rate limit settings
- `versions.tf` — required provider version constraints
- `variables.tf` — input variables for authentication (API token or OAuth)
- Import blocks for state migration

## Supported Provider Versions

6.6.1 through 6.10.0 (default). Version-specific resource additions and attribute changes are tracked automatically.

## Getting Started

### Prerequisites

- Node.js 18+
- npm

### Install & Run

```bash
git clone https://github.com/coleleep/okta-terraform-toolkit
cd okta-terraform-toolkit
npm install
npm run dev
```

### Production Build

```bash
npm start
```

### Connect to Your Org

1. Launch the app
2. Enter your Okta org URL (e.g., `https://dev-123456.okta.com`)
3. Enter an API token (Super Admin permissions required)
4. Start probing

## Testing

The `test-data/` folder contains reusable Terraform fixtures for validating the cross-org sync feature. Each subfolder has a `main.tf` (source org config) and `source.tfstate` (synthetic state with fake IDs). See [`test-data/README.md`](test-data/README.md) for setup instructions.

| Scenario | Focus |
|----------|-------|
| `sync-priority` | Policy rule priority ordering, `depends_on` chain generation |
| `sync-comprehensive` | Groups, memberships, apps, assignments, trusted origins, auth server scopes/claims, policies |

## Architecture

```
src/
├── main/           # Electron main process
│   ├── api/        # Okta API, Claude AI, probing, sync logic
│   └── ipc-handlers.ts
├── renderer/       # React UI
│   ├── components/ # Feature panels (probe, sync, debug, plan)
│   ├── pages/      # Connect + Dashboard
│   └── hooks/      # Zustand state store
├── shared/         # Types, constants, code generation
│   ├── constants.ts
│   ├── types.ts
│   ├── versions.ts
│   └── terraform-gen.ts
├── preload.ts      # Secure IPC bridge
test-data/          # Reusable sync test fixtures (see test-data/README.md)
```

**Stack:** Electron · React 18 · TypeScript · Tailwind CSS · Zustand · Webpack 5

## Authentication

OTTO requires an Okta API token with Super Admin permissions. Some endpoints used for rate limit probing and resource discovery are not accessible via OAuth client credentials, so an API token is the only supported auth method.

**Important:** For accurate probing and configuration recommendations, the API token must be set to **100% rate limit capacity**. By default, Okta may throttle individual tokens below the org-wide limit. See [API Token Rate Limit Violation](https://support.okta.com/help/s/article/API-Token-Rate-Limit-Violation?language=en_US) for instructions on adjusting this setting.

## AI Features

OTTO uses Claude to power:

- **Workload description** — describe your Terraform use case in plain English and get parsed resource selections
- **Config conversion** — regenerate HCL for a different org with correct IDs and import blocks
- **Log interpretation** — explain what went wrong in a failed Terraform run
- **Error decoding** — translate Okta API errors into actionable fixes

### Setup

1. Get a Claude API key from [console.anthropic.com](https://console.anthropic.com)
2. On the **Connect** page, expand the **AI Configuration** section and enter your API key
3. Click **Save** — the key persists across app restarts

You can also update your key later from the **gear icon** in the top bar.

### Custom Endpoint (Optional)

By default, OTTO connects to the Anthropic API (`https://api.anthropic.com`). If your organization uses a proxy or custom gateway:

1. Click **Advanced** in the AI Configuration section
2. Enter your endpoint URL (e.g., `https://your-proxy.example.com`)
3. Leave blank to use the default Anthropic endpoint

Configuration is stored locally in Electron's app data directory and never transmitted anywhere other than the configured API endpoint.

## Resource Coverage

25+ Okta resource categories including:

- Users, Groups, Applications (with assignments)
- Auth Servers (policies, scopes, claims, rules)
- Policies (sign-on, password, MFA, enrollment, IdP discovery)
- Network Zones, Trusted Origins, Domains
- Identity Providers, Authenticators
- Event Hooks, Inline Hooks, Log Streams
- Custom Roles, Profile Mappings, Brands

## License

ISC
