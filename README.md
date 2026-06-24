# OTTO — Okta Terraform Toolkit

A desktop tool for Okta Support Engineers and employees. OTTO probes your org's API rate limits, recommends Terraform provider settings, and provides AI-assisted cross-org state migration.

For the full feature reference, see **[docs/FEATURES.md](docs/FEATURES.md)**.

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

## Connect to Your Org

1. Launch the app
2. Enter your **target** org URL (e.g., `https://dev-123456.okta.com`)
3. Enter a Super Admin API token
4. For cross-org sync: connect a **source** org in the Sync tab

## AI Features

AI-powered features require a configured key. Two options:

**Option 1 — OCM (recommended for Okta employees on macOS):**

```bash
ocm auth litellm
```

OTTO picks up your OCM-managed key automatically. Click **Reload** on the AI Configuration card if it shows red. Tokens refresh silently — no action needed after the initial auth.

**Option 2 — Static API key (Windows or non-OCM users):**

1. Obtain an API key for a compatible LLM endpoint (e.g., a direct Anthropic API key or a LiteLLM proxy key)
2. In OTTO, open **Settings** → **Advanced settings**
3. Enter your API key and optionally a custom endpoint URL
4. Click **Save static override**

## Production Build

```bash
npm start
```

## License

ISC
