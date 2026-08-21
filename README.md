# OTTO — Okta Terraform Toolkit

A desktop tool for Okta Support Engineers and employees. OTTO analyses API rate limits and recommends Terraform provider settings, diagnoses failed runs from `TF_LOG` output, validates Terraform files, and performs AI-assisted cross-org state migration.

Rate limit analysis does **not** require an org connection: limits can be entered by hand, pulled from a customer's debug log, or filled from a bundled standard-org baseline — which is what makes it usable on support cases where the customer won't share credentials.

For the full feature reference, see **[docs/FEATURES.md](docs/FEATURES.md)**.  
For step-by-step how-to guides, see **[docs/USAGE.md](docs/USAGE.md)**.  
Before changing the code, read **[docs/DEVELOPING.md](docs/DEVELOPING.md)** — conventions, constraints, and the traps that cost real debugging time.

## Prerequisites

- Node.js 18+
- npm

## Install & Run

```bash
git clone https://github.com/coleleep/okta-terraform-toolkit
cd okta-terraform-toolkit
npm install
npm run dev
```

`npm run dev` watches `src/` and restarts the app whenever a rebuild lands in `dist/`, so both main-process and renderer changes take effect without quitting. Use `npm start` for a one-off build and launch with no watching.

## Connect to Your Org (optional)

Only needed to probe an org's live rate limits, count its resources, or sync between orgs. Debug, Validate, Learn, and Rate Limits all work without it.

1. Launch the app
2. Click **Connect Org** and enter your **target** org URL (e.g., `https://dev-123456.okta.com`)
3. Enter a Super Admin API token — set to 100% rate limit capacity, or probe results understate your limits
4. For cross-org sync: connect a **source** org in the Sync tab

Tokens are never written to disk.

## AI Features

AI-powered features require a configured key. Two options:

**Option 1 — OCM (recommended for Okta employees on macOS):**

```bash
ocm auth litellm
```

OTTO picks up your OCM-managed key automatically. On startup, OTTO checks your OCM token in the background — if it's expired, an amber banner will appear prompting you to re-run `ocm auth litellm` and relaunch.

**Option 2 — Static API key (Windows or non-OCM users):**

1. Obtain an API key for a compatible LLM endpoint (e.g., a direct Anthropic API key or a LiteLLM proxy key)
2. In OTTO, open **Settings** → **Advanced settings**
3. Enter your API key and optionally a custom endpoint URL
4. Click **Save static override**

## Build & Launch Without Watching

```bash
npm start
```

Builds once and launches. There is no packaging step — OTTO is run from source, not distributed as a signed app.

## Tests

```bash
npx jest          # unit tests
npx tsc --noEmit  # typecheck
```

## License

ISC
