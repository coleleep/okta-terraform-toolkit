# OTTO — Okta Terraform Toolkit

A desktop tool for Okta Support Engineers and employees. OTTO probes your org's API rate limits, recommends Terraform provider settings, and provides AI-assisted cross-org state migration.

For the full feature reference, see **[docs/FEATURES.md](docs/FEATURES.md)**.

## Prerequisites

- Node.js 18+
- npm
- OCM (`ocm auth litellm` for AI features)

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

Run `ocm auth litellm` in your terminal before using AI-powered features. OTTO picks up your OCM-managed key automatically — click **Reload** on the AI Configuration card if it shows red.

## Production Build

```bash
npm start
```

## License

ISC
