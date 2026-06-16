# OTTO — Okta Terraform Toolkit

Desktop tool for Okta Support Engineers. Probes API rate limits, recommends Terraform provider settings, and syncs configurations across orgs.

→ **[Full feature reference, architecture, and AI setup](docs/FEATURES.md)**

## Setup

**Prerequisites:** Node.js 18+, npm, OCM

```bash
git clone https://github.com/coleleep/okta-terraform-toolkit
cd okta-terraform-toolkit
npm install
npm run dev
```

## Getting Started

1. Enter your **target** org URL and a Super Admin API token, then click **Connect & Analyze**
2. Run `ocm auth litellm` in your terminal — OTTO picks up the key automatically
3. For cross-org sync, connect a **source** org in the Sync tab

## License

ISC
