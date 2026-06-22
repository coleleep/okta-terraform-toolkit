# OTTO — Features & Architecture

## Features

### Rate Limit Probing

OTTO tests 50+ Okta API endpoints (including sub-resource paths) and classifies each by remaining capacity. Results drive concrete, actionable provider configuration recommendations:

- `max_retries`, `backoff`, `min_wait_seconds`, `max_wait_seconds`
- `request_timeout`, `max_api_capacity`, `parallelism`
- Prevention options (`skip_app_users`, `include_user_roles`, etc.)

**Volume-aware recommendations:** Configuration for 100 users differs substantially from 10,000. OTTO adjusts suggestions based on your workload scale.

**Deep probe capability:** Tests not just primary endpoints but also sub-resource paths (e.g., users → user roles, app → app users) to catch hidden bottlenecks.

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

Comprehensive diagnostic tools for troubleshooting Terraform runs:

- **TF_LOG parsing** — extracts per-endpoint request stats, rate-limit hits, and error breakdowns from `TF_LOG=DEBUG` output
- **Validation error detection** — identifies provider/schema mismatches even when no HTTP requests were made
- **AI-powered root cause analysis** — explains failures with actionable config fix recommendations
- **Okta API error decoder** — translates native Okta API errors into remediation suggestions
- **Request profiling** — visualizes which endpoints consumed the most time and capacity

### Code Generation

Produces production-ready Terraform files with best-practice configurations:

- **`provider.tf`** — optimized provider block with computed rate limit settings, authentication method selection (token/OAuth), and performance tuning parameters
- **`versions.tf`** — required provider version constraints with minimum and recommended versions
- **`variables.tf`** — input variables for authentication (API token or OAuth client credentials) with secure defaults
- **Import blocks** — pre-generated import statements for state migration with correct hierarchical IDs
- **Type-aware field mapping** — automatic camelCase → snake_case conversion with schema validation

## Supported Provider Versions

6.6.1 through 6.12.0 (default). Version-specific resource additions and attribute changes are tracked automatically.

## Architecture

```
src/
├── main/               # Electron main process & API layer
│   ├── api/
│   │   ├── auth.ts              # Target org connection & credential management
│   │   ├── source-auth.ts       # Source org connection for cross-org sync
│   │   ├── probe.ts             # Rate limit probing (primary endpoints)
│   │   ├── deep-probe.ts        # Sub-resource endpoint probing
│   │   ├── analyzer.ts          # Rate limit analysis & recommendations
│   │   ├── resource-counter.ts  # Okta API resource inventory
│   │   ├── target-analyzer.ts   # Target org capacity analysis
│   │   ├── sync.ts              # Resource discovery, matching, diffing
│   │   ├── sync-convert.ts      # Deterministic HCL conversion
│   │   ├── claude.ts            # AI-powered conversion & analysis (Claude 3)
│   │   ├── terraform.ts         # In-app terraform runner with live output
│   │   ├── rollback.ts          # Tfstate rollback bundle management
│   │   ├── okta-provider-manager.ts  # Provider version download & mirror
│   │   ├── log-parser.ts        # TF_LOG debug file parser & interpreter
│   │   ├── redact.ts            # Sensitive data redaction
│   │   └── write-probe-test.ts  # Test fixture generation
│   ├── logger.ts       # Structured audit logging with rotation
│   ├── ipc-handlers.ts # IPC command registry (50+ handlers)
│   └── index.ts        # Electron app initialization
├── renderer/           # React UI (Electron renderer process)
│   ├── pages/
│   │   └── DashboardPage.tsx  # Main application view with tabbed sections
│   ├── components/
│   │   ├── ConnectOrgModal.tsx       # Org connection dialog
│   │   ├── ProbeProgress.tsx         # Rate limit probe UI with live progress
│   │   ├── RateLimitTable.tsx        # Endpoint capacity visualization
│   │   ├── ProviderBlock.tsx         # Generated provider.tf preview
│   │   ├── SyncSection.tsx           # Cross-org sync pipeline UI
│   │   ├── ResourceSelector.tsx      # Resource type & instance selection
│   │   ├── ResourceLookup.tsx        # Search & filter for resources
│   │   ├── DiffView.tsx              # Field-level attribute comparison
│   │   ├── LogAnalyzer.tsx           # TF_LOG upload & analysis
│   │   ├── ErrorDecoder.tsx          # Okta error explanation UI
│   │   ├── DebugSection.tsx          # Internal diagnostics & logs
│   │   ├── ConfigComparison.tsx      # Provider config side-by-side view
│   │   ├── TargetRuntime.tsx         # Runtime estimation UI
│   │   ├── SolutionBuilder.tsx       # AI-powered config recommendations
│   │   ├── AuthRecommendations.tsx   # Auth strategy selection
│   │   ├── BestPractices.tsx         # Best practice guidelines
│   │   ├── LearnSection.tsx          # Educational resources
│   │   ├── SettingsModal.tsx         # App preferences & AI config
│   │   ├── ContextualTip.tsx         # Inline help tooltips
│   │   ├── CustomWorkload.tsx        # User workload input
│   │   └── PlanSection.tsx           # Terraform plan staging
│   ├── pages/          # Main dashboard page
│   └── hooks/
│       └── useStore.ts # Zustand state management
├── shared/             # Types, constants, & utilities
│   ├── terraform-gen.ts   # HCL generation with type-aware field mapping
│   ├── resource-dictionary.ts  # 30+ Okta resource type definitions
│   ├── types.ts        # Shared TypeScript interfaces
│   ├── versions.ts     # Provider version metadata
│   ├── scopes.ts       # OAuth scope definitions
│   └── constants.ts    # Configuration constants
├── preload.ts          # Secure IPC bridge with whitelisted commands
└── __tests__/          # Jest unit tests
    ├── claude-config.test.ts       # AI config management
    ├── provider-v6.*.test.ts       # Version-specific provider tests
    └── redact.test.ts              # Sensitive data redaction
test-data/              # Reusable Terraform fixtures
├── sync-priority/      # Policy rule priority ordering test
└── sync-comprehensive/ # Groups, apps, auth servers test
```

**Stack:** Electron 33 · React 18 · TypeScript 5.6 · Tailwind CSS 3 · Zustand 4 · Webpack 5 · Jest · Anthropic Claude 3

## Authentication

OTTO requires an Okta API token with Super Admin permissions. Some endpoints used for rate limit probing and resource discovery are not accessible via OAuth client credentials, so an API token is the only supported auth method.

**Important:** For accurate probing and configuration recommendations, the API token must be set to **100% rate limit capacity**. By default, Okta may throttle individual tokens below the org-wide limit. See [API Token Rate Limit Violation](https://support.okta.com/help/s/article/API-Token-Rate-Limit-Violation?language=en_US) for instructions on adjusting this setting.

## AI Features

OTTO uses Claude 3 (via OCM-managed LiteLLM) to power advanced troubleshooting and configuration workflows:

- **Workload description** — describe your Terraform use case in plain English and get parsed resource selections with recommendations
- **Config conversion** — regenerate HCL for a different org with correct IDs, handling complex cross-org ID mappings
- **Log interpretation** — explain what went wrong in a failed Terraform run with step-by-step remediation
- **Error decoding** — translate Okta API errors into actionable fixes and configuration adjustments
- **Custom recommendations** — analyze your probing results and suggest volume-specific optimization strategies

### Setup

OTTO uses an OCM-managed LiteLLM key by default — no manual API key setup required.

1. Run `ocm auth litellm` in your terminal to authenticate with OCM
2. Open OTTO and click **Reload** on the AI Configuration card — it should show green (key auto-detected)
3. Tokens refresh automatically; if OTTO shows red, re-run `ocm auth litellm`

#### Advanced: Static API Key Override

If you need to point OTTO at a different endpoint or use a custom API key (e.g., for testing or air-gapped environments):

1. On the **Connect** page, expand **Advanced settings** under AI Configuration
2. Enter a static API key and optional custom endpoint URL
3. Click **Save static override** — this takes precedence over OCM until you click **Use OCM key**

**Note:** Using a static key bypasses OCM token refresh. Monitor key expiration manually.

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

The `test-data/` folder contains reusable Terraform fixtures for validating the cross-org sync feature. Each test scenario includes:

- **`main.tf`** — source org Terraform configuration with realistic resource relationships
- **`source.tfstate`** — synthetic state file with fake Okta IDs matching the config

**Test Scenarios:**

| Scenario | Focus | Coverage |
|----------|-------|----------|
| `sync-priority` | Policy rule priority ordering and dependency chains | `okta_app_*` resources, policy rule sequencing, `depends_on` generation |
| `sync-comprehensive` | Full cross-org sync with complex hierarchies | Users, groups, memberships, applications, assignments, trusted origins, auth server scopes/claims, policies, IdP discovery |

**Running Tests:**

```bash
npm test                           # Run all Jest unit tests
npm test -- claude-config         # Test AI config management
npm test -- provider-v6.12.0      # Test version-specific provider handling
```

Test fixtures are useful for:
- Validating sync logic against realistic Okta configurations
- Testing ID substitution across different resource types
- Verifying import block generation with correct hierarchies
- Reproducing edge cases in controlled environments

## Logging & Audit

OTTO maintains comprehensive structured logs for debugging and compliance:

- **Debug mode** — configurable logging levels (debug, info, warn, error) accessible from UI Settings
- **Audit logging** — structured logs for all auth, sync, and Terraform operations
- **Log rotation** — automatic log archival to prevent unbounded disk usage
- **Redaction** — automatic masking of sensitive data (API tokens, org URLs, resource IDs) in exported logs
- **Internal diagnostics** — Debug Section in UI provides real-time log inspection and filtering
- **Request tracing** — correlates API calls, Terraform operations, and UI interactions

## Best Practices & Security

### Rate Limit Token Configuration

For accurate probing and recommendations, ensure your API token has **100% rate limit capacity**:

1. Log in as an Okta Super Admin
2. Navigate to **API** → **Tokens**
3. Select your token and verify **Rate Limit Capacity** is set to 100%
4. By default, Okta may throttle tokens to a percentage of the org limit

See [API Token Rate Limit Violation](https://support.okta.com/help/s/article/API-Token-Rate-Limit-Violation?language=en_US) for detailed instructions.

### Cross-Org Sync Safety

- **Dry-run mode** — always review generated HCL and the Terraform plan before applying
- **Selective sync** — choose individual resources to include; don't blindly sync everything
- **Rollback bundle** — OTTO automatically saves a tfstate rollback bundle before each apply; use it to undo if needed
- **ID validation** — OTTO validates ID substitutions; check generated import blocks for correctness
- **Test first** — validate in a dev org before syncing to staging or production

### Provider Version Management

- OTTO pins provider versions in `versions.tf` to ensure reproducible Terraform runs
- Version-specific resource additions and attributes are tracked automatically
- Upgrade provider versions incrementally and test thoroughly before production deployments

### Sensitive Data Handling

- API tokens, OAuth secrets, and org URLs are never logged to disk
- All sensitive data is automatically redacted in exported diagnostics
- Use OS-level credential managers (macOS Keychain, Windows Credential Manager) for long-term token storage
- OTTO stores credentials in memory only; restart the app to clear session data
