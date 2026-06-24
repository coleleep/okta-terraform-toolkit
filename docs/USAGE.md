# OTTO — How to Use Each Feature

A step-by-step guide for each OTTO feature. If you are new to OTTO, start with [Connecting an Org](#connecting-an-org) and work through the sections in order.

---

## Contents

- [Connecting an Org](#connecting-an-org)
- [Debug & Log Analysis](#debug--log-analysis)
- [Rate Limit Probing](#rate-limit-probing)
- [Code Generation](#code-generation)
- [Target Runtime Planner](#target-runtime-planner)
- [Cross-Org Sync](#cross-org-sync)
- [AI Features](#ai-features)

---

## Connecting an Org

**What it's for** — Required before running probes, generating code, or syncing resources. You can launch OTTO and use the Debug tab without connecting first.

**Before you start** — Have your org URL and a Super Admin API token ready.

**Steps**

1. Click **Connect Org** in the top-right header.
2. Enter your org URL (e.g., `https://dev-123456.okta.com`).
3. Enter a Super Admin API token.
4. Click **Connect & Analyze**.

The header updates to show your org URL once connected. Click **Disconnect** to switch orgs.

**Tips**

- The URL field accepts input with or without the `https://` prefix — OTTO normalizes it.
- Your token must be set to **100% rate limit capacity** or probe results will be inaccurate. See [API Token Rate Limit Violation](https://support.okta.com/help/s/article/API-Token-Rate-Limit-Violation?language=en_US) for how to adjust this.

---

## Debug & Log Analysis

**What it's for** — Diagnose failed or slow Terraform runs. Upload a debug log to get a breakdown of what happened, or paste an Okta API error to get a plain-English explanation and fix.

**Before you start** — No org connection required. Have your `TF_LOG` output file ready, or an Okta error message to decode.

**Steps — TF_LOG Analysis**

1. Navigate to the **Debug** tab (the default tab on launch), then select the **TF_LOG Analyzer** sub-tab.
2. Click to select a log file and choose your debug log.
3. Review the parsed breakdown: per-endpoint request counts, rate-limit hits, and errors detected.
4. Click **Explain with AI** for a plain-English explanation and recommended fixes.

**Steps — Error Decoder**

1. Navigate to the **Debug** tab, then select the **Error Decoder** sub-tab (this is the default sub-tab on load).
2. Paste an Okta API error message and click **Decode**.

**Tips**

- To generate a `TF_LOG` file: `TF_LOG=DEBUG terraform apply 2>&1 | tee terraform-debug.log`
- AI interpretation requires a configured AI key — see [AI Features](#ai-features).
- The Error Decoder works without an org connection and without an AI key for common errors.

---

## Rate Limit Probing

**What it's for** — Measure how much rate limit capacity your org has across Terraform-relevant API endpoints. A probe runs automatically when you connect an org. Use the Rate Limits tab to review results and re-run at any time.

**Before you start** — Connect to the target org (see [Connecting an Org](#connecting-an-org)).

**Steps**

1. Connect to an org — the probe runs automatically on connection.
2. Navigate to the **Rate Limits** tab to see the results table. Endpoints are color-coded by remaining capacity.
3. Click **Re-scan** in the top-right header to re-run the probe at any time.
4. To configure workload details and get provider recommendations, navigate to the **Plan** tab and select the **Workload** sub-tab.

**Tips**

- Re-scan after major Terraform runs — remaining capacity changes.
- Probe during off-peak hours or when no Terraform runs are active for the most accurate baseline.
- The sidebar summary shows your bottleneck endpoint and probe stats at a glance.

---

## Code Generation

**What it's for** — Generate production-ready `provider.tf`, `versions.tf`, and `variables.tf` files optimized for your org's measured rate limits.

**Before you start** — Run a rate limit probe (see [Rate Limit Probing](#rate-limit-probing)). Code generation uses the probe results.

**Steps**

1. Navigate to the **Plan** tab, then select the **Export** sub-tab.
2. Review the generated files — tabs across the top of the code block let you switch between `provider.tf`, `versions.tf`, `variables.tf`, and any resource or import files.
3. Click **Copy File** to copy the currently visible file to your clipboard, or **Save File** to save it to disk.
4. Click **Export Full Project** to save all generated files to a directory at once.

**Tips**

- Generated config reflects the current probe results. Re-scan before exporting if your workload has changed significantly.
- The `variables.tf` uses secure defaults. Review the authentication method section before applying in a new environment.
- For an AI-generated complete solution from a plain-English description, use the **Solution Builder** sub-tab in the **Plan** tab instead.

---

## Target Runtime Planner

**What it's for** — Find out if a desired Terraform run duration is achievable with your current rate limits, and identify which endpoints are the bottleneck if not.

**Before you start** — Connect to the target org (see [Connecting an Org](#connecting-an-org)).

**Steps**

1. Navigate to the **Plan** tab, then select **Target Planner**.
2. Select a preset duration or enter a custom value (in minutes).
3. Ensure your workload is configured — go to the **Workload** sub-tab and run **Count & Optimize** if you haven't already.
4. Click **Analyze for [N] min target** where [N] is your chosen duration.
5. Review the bottleneck report: which endpoints are limiting you and what rate limit increases would be needed to hit your target.

**Tips**

- The bottleneck report gives specific endpoint-level numbers to include in a JIRA for a rate limit increase request.
- If the target duration is achievable without changes, the report confirms it.

---

## Cross-Org Sync

**What it's for** — Replicate Terraform-managed Okta configurations between orgs (e.g., dev → staging, org migration, environment parity check).

**Before you start** — Connect to the target org. For live mode, have a Super Admin API token for the source org. For file upload mode, have the source `.tf` and `.tfstate` files.

**Steps — Live Org Mode (Org Comparison)**

1. Navigate to the **Sync** tab and select **Org Comparison** mode.
2. Enter the source org URL and API token, then click **Connect**.
3. Select the resource types to compare.
4. Click **Run Comparison** — OTTO enumerates and compares resources between both orgs.
5. Review the **Match & Diff** view — resources are matched by name against the target org with field-level differences shown.
6. Select which resources to include using the checkboxes (selective sync).
7. Click **Proceed to Convert** — OTTO generates HCL with target org IDs substituted.
8. Review the generated HCL and import blocks.
9. Click **Export Project Files**, then click **Run Terraform** to run `terraform init`, `plan`, and `apply` in-app, or export the files to run manually.

**Steps — File Upload Mode**

1. Navigate to the **Sync** tab.
2. Click **Upload Source Files** and select your `.tf` and `.tfstate` files.
3. Continue from step 3 in the Live Org steps above.

**Tips**

- Always review the Terraform plan before applying — use the in-app plan output to verify what will change.
- OTTO saves a rollback bundle before each apply. Use it under **Rollback** if you need to undo.
- Deterministic convert mode handles most ID substitutions without an AI key. AI conversion adds intelligence for complex cross-resource mappings.
- Use the **swap** button (⇅) between the org panels to swap source and target and verify parity in both directions.

---

## AI Features

**What it's for** — AI-powered features throughout OTTO accelerate workload analysis, config conversion, log interpretation, and error diagnosis.

**Before you start** — An AI API key or OCM token is required. See Setup below.

### Setup

**Option 1 — OCM (recommended for Okta employees on macOS):**

```bash
ocm auth litellm
```

Open OTTO, go to **Settings**, and click **Reload** on the AI Configuration card. It should show green. Tokens refresh automatically.

**Option 2 — Static API key (Windows or non-OCM users):**

1. In OTTO, open **Settings**, then expand **Advanced settings**
2. Enter your API key and optionally a custom endpoint URL
3. Click **Save static override**

### Where Each AI Feature Lives

| Feature | Tab | What it does |
|---------|-----|--------------|
| AI Workload Builder | Plan (Workload) | Parses a plain-English workload description into resource selections |
| Solution Builder | Plan | Generates a complete Terraform solution from a plain-English workload description |
| Log Interpretation | Debug | Explains a failed Terraform run and gives remediation steps |
| Error Decoder | Debug | Translates Okta API errors into actionable fixes |
| AI Config Conversion | Sync | Regenerates HCL for the target org with correct IDs and attribute mapping |
