# Feature Usage Documentation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create `docs/USAGE.md` — a step-by-step operational guide covering all seven OTTO features — and link it from `README.md` and `docs/FEATURES.md`.

**Architecture:** Single new file (`docs/USAGE.md`) with per-feature H2 sections and a consistent four-part template (What it's for / Before you start / Steps / Tips). Two existing files receive minimal link additions only.

**Tech Stack:** Markdown only. No TypeScript, no Jest, no build step.

---

## File Map

| File | Action |
|------|--------|
| `docs/USAGE.md` | Create — full content, all 7 sections |
| `README.md` | Modify — add one "How to Use" link line |
| `docs/FEATURES.md` | Modify — add one anchor link at the bottom of each of 6 feature sections |

---

## Task 1: Create worktree

- [ ] **Step 1: Create worktree**

```bash
git -C /Users/nicole.pendill/okta-terraform-toolkit worktree add .worktrees/feature-usage-docs -b docs/feature-usage-docs
```

- [ ] **Step 2: Verify clean**

```bash
git -C /Users/nicole.pendill/okta-terraform-toolkit/.worktrees/feature-usage-docs status
```

Expected: `On branch docs/feature-usage-docs` / `nothing to commit, working tree clean`

---

## Task 2: Create `docs/USAGE.md`

Work from: `/Users/nicole.pendill/okta-terraform-toolkit/.worktrees/feature-usage-docs`

- [ ] **Step 1: Create the file with full content**

Create `docs/USAGE.md` with this exact content:

```markdown
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

**Steps**

1. Click **Connect Org** in the top-right header.
2. Enter your org URL (e.g., `https://dev-123456.okta.com`).
3. Enter a Super Admin API token.
4. Click **Connect**.

The header updates to show your org URL once connected. Click **Disconnect** to switch orgs.

**Tips**

- The URL accepts with or without the `https://` prefix — OTTO normalizes it.
- Your token must be set to **100% rate limit capacity** or probe results will be inaccurate. See [API Token Rate Limit Violation](https://support.okta.com/help/s/article/API-Token-Rate-Limit-Violation?language=en_US) for how to adjust this.

---

## Debug & Log Analysis

**What it's for** — Diagnose failed or slow Terraform runs. Upload a debug log to get a breakdown of what happened, or paste an Okta API error to get a plain-English explanation and fix.

**Before you start** — No org connection required. Have your `TF_LOG` output file ready, or an Okta error message to decode.

**Steps**

1. Navigate to the **Debug** tab (the default tab on launch).
2. Click **Upload Log File** and select your debug log.
3. Review the parsed breakdown: per-endpoint request counts, rate-limit hits, and errors detected.
4. Click **Interpret with AI** for a plain-English explanation and recommended fixes.
5. For standalone Okta API errors (not Terraform logs), use the **Error Decoder** panel: paste the error text and click **Decode**.

**Tips**

- To generate a `TF_LOG` file: `TF_LOG=DEBUG terraform apply 2>&1 | tee terraform-debug.log`
- AI interpretation requires a configured AI key — see [AI Features](#ai-features).
- The Error Decoder works without an org connection and without an AI key for common errors.

---

## Rate Limit Probing

**What it's for** — Measure how much rate limit capacity your org has across Terraform-relevant API endpoints, then get provider configuration recommendations tailored to your workload scale.

**Before you start** — Connect to the target org (see [Connecting an Org](#connecting-an-org)).

**Steps**

1. Navigate to the **Rate Limits** tab.
2. Describe your Terraform workload in the text box (e.g., `2,000 users, 50 groups, OAuth apps with user assignments`), or click **AI Workload Builder** to parse a plain-English description into resource selections.
3. Click **Count & Optimize** to start the probe.
4. Review the results table — endpoints are color-coded by remaining capacity.
5. Read the generated provider configuration recommendations below the table.

**Tips**

- Enable **Deep Probe** to also test sub-resource paths (e.g., app → app users). This catches bottlenecks a basic probe misses.
- Probe during off-peak hours or when no Terraform runs are active for the most accurate baseline.
- Re-probe after major Terraform runs — remaining capacity changes.

---

## Code Generation

**What it's for** — Generate production-ready `provider.tf`, `versions.tf`, and `variables.tf` files optimized for your org's measured rate limits.

**Before you start** — Run a rate limit probe (see [Rate Limit Probing](#rate-limit-probing)). Code generation uses the probe results.

**Steps**

1. After a probe completes in the **Rate Limits** tab, click **Generate Config**.
2. Review the generated files in the preview pane.
3. Click **Copy** or **Download** for each file you need.

**Tips**

- Generated config reflects the current probe results. Re-probe before regenerating if your workload has changed significantly.
- The `variables.tf` uses secure defaults. Review the authentication method section before applying in a new environment.

---

## Target Runtime Planner

**What it's for** — Find out if a desired Terraform run duration is achievable with your current rate limits, and identify which endpoints are the bottleneck if not.

**Before you start** — Connect to the target org (see [Connecting an Org](#connecting-an-org)).

**Steps**

1. Navigate to the **Plan** tab.
2. Enter your desired run duration (e.g., `30 minutes`).
3. Describe your workload (resource types and approximate counts).
4. Click **Analyze**.
5. Review the bottleneck report: which endpoints are limiting you and what rate limit increases would be needed to hit your target.

**Tips**

- The bottleneck report gives specific endpoint-level numbers to include in a JIRA for a rate limit increase request.
- If the target duration is achievable without changes, the report confirms it.

---

## Cross-Org Sync

**What it's for** — Replicate Terraform-managed Okta configurations between orgs (e.g., dev → staging, org migration, environment parity check).

**Before you start** — Connect to the target org. For live mode, have a Super Admin API token for the source org. For file upload mode, have the source `.tf` and `.tfstate` files.

**Steps — Live Org Mode**

1. Navigate to the **Sync** tab.
2. Click **Connect Source Org** and enter the source org URL and API token.
3. Select the resource types to sync.
4. Click **Discover** — OTTO enumerates resources from the source org.
5. Review the **Match & Diff** view — resources are matched by name against the target org with field-level differences shown.
6. Select which resources to include using the checkboxes (selective sync).
7. Click **Convert** — OTTO generates HCL with target org IDs substituted.
8. Review the generated HCL and import blocks.
9. Click **Apply** to run `terraform init`, `plan`, and `apply` in-app, or export the files to run manually.

**Steps — File Upload Mode**

1. Navigate to the **Sync** tab.
2. Click **Upload Source Files** and select your `.tf` and `.tfstate` files.
3. Continue from step 3 in the Live Org steps above.

**Tips**

- Always review the Terraform plan before applying — use the in-app plan output to verify what will change.
- OTTO saves a rollback bundle before each apply. Use it under **Rollback** if you need to undo.
- Deterministic convert mode handles most ID substitutions without an AI key. AI conversion adds intelligence for complex cross-resource mappings.
- Use the **Flip** button to swap source and target and verify parity in both directions.

---

## AI Features

**What it's for** — AI-powered features throughout OTTO accelerate workload analysis, config conversion, log interpretation, and error diagnosis.

### Setup

**Option 1 — OCM (recommended for Okta employees on macOS):**

```bash
ocm auth litellm
```

Open OTTO, go to **Settings**, and click **Reload** on the AI Configuration card. It should show green. Tokens refresh automatically.

**Option 2 — Static API key (Windows or non-OCM users):**

1. In OTTO, open **Settings** → **Advanced settings**
2. Enter your API key and optionally a custom endpoint URL
3. Click **Save static override**

### Where Each AI Feature Lives

| Feature | Tab | What it does |
|---------|-----|--------------|
| AI Workload Builder | Rate Limits | Parses a plain-English workload description into resource selections |
| Solution Builder | Rate Limits | Analyzes probe results and suggests volume-specific optimizations |
| Log Interpretation | Debug | Explains a failed Terraform run and gives remediation steps |
| Error Decoder | Debug | Translates Okta API errors into actionable fixes |
| AI Config Conversion | Sync | Regenerates HCL for the target org with correct IDs and attribute mapping |
```

- [ ] **Step 2: Verify file was created**

```bash
wc -l docs/USAGE.md
```

Expected: 150+ lines

- [ ] **Step 3: Commit**

```bash
git add docs/USAGE.md
git commit -m "docs: add USAGE.md with step-by-step guide for all features"
```

---

## Task 3: Update `README.md`

Work from: `/Users/nicole.pendill/okta-terraform-toolkit/.worktrees/feature-usage-docs`

- [ ] **Step 1: Add USAGE.md link**

In `README.md`, find this line:

```markdown
For the full feature reference, see **[docs/FEATURES.md](docs/FEATURES.md)**.
```

Replace with:

```markdown
For the full feature reference, see **[docs/FEATURES.md](docs/FEATURES.md)**.  
For step-by-step how-to guides, see **[docs/USAGE.md](docs/USAGE.md)**.
```

- [ ] **Step 2: Verify**

```bash
grep -n "USAGE.md" README.md
```

Expected: one line containing `docs/USAGE.md`

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: link USAGE.md from README"
```

---

## Task 4: Update `docs/FEATURES.md`

Work from: `/Users/nicole.pendill/okta-terraform-toolkit/.worktrees/feature-usage-docs`

Add one anchor link line at the bottom of each feature section. The line format is:

```markdown
→ [How to use: <Feature Name>](USAGE.md#<anchor>)
```

- [ ] **Step 1: Add link to Rate Limit Probing section**

Find the end of the `### Rate Limit Probing` section (just before `### Cross-Org Sync`). The last line of that section is:

```markdown
**Deep probe capability:** Tests not just primary endpoints but also sub-resource paths (e.g., users → user roles, app → app users) to catch hidden bottlenecks.
```

Add a blank line and then:

```markdown
→ [How to use: Rate Limit Probing](USAGE.md#rate-limit-probing)
```

- [ ] **Step 2: Add link to Cross-Org Sync section**

Find the end of the `### Cross-Org Sync` section (just before `### Target Runtime Planner`). The last line of that section is:

```markdown
- System zone and computed field exclusion to prevent apply errors
```

Add a blank line and then:

```markdown
→ [How to use: Cross-Org Sync](USAGE.md#cross-org-sync)
```

- [ ] **Step 3: Add link to Target Runtime Planner section**

Find the end of the `### Target Runtime Planner` section (just before `### Debug & Log Analysis`). The section ends after:

```markdown
Specify a desired Terraform run duration (e.g., 30 minutes) and OTTO identifies which endpoints are bottlenecks, whether the target is achievable, and what limit increases would be needed.
```

Add a blank line and then:

```markdown
→ [How to use: Target Runtime Planner](USAGE.md#target-runtime-planner)
```

- [ ] **Step 4: Add link to Debug & Log Analysis section**

Find the end of the `### Debug & Log Analysis` section (just before `### Code Generation`). The last line of that section is:

```markdown
- **Request profiling** — visualizes which endpoints consumed the most time and capacity
```

Add a blank line and then:

```markdown
→ [How to use: Debug & Log Analysis](USAGE.md#debug--log-analysis)
```

- [ ] **Step 5: Add link to Code Generation section**

Find the end of the `### Code Generation` section (just before `## Supported Provider Versions`). The last line of that section is:

```markdown
- **Type-aware field mapping** — automatic camelCase → snake_case conversion with schema validation
```

Add a blank line and then:

```markdown
→ [How to use: Code Generation](USAGE.md#code-generation)
```

- [ ] **Step 6: Add link to AI Features section**

Find the `## AI Features` section. It ends with the `#### Advanced: Static API Key Override` subsection. The last line before the next `##` section is:

```markdown
**Note:** Using a static key bypasses OCM token refresh. Monitor key expiration manually.
```

Add a blank line and then:

```markdown
→ [How to use: AI Features](USAGE.md#ai-features)
```

- [ ] **Step 7: Verify all links were added**

```bash
grep -n "USAGE.md" docs/FEATURES.md
```

Expected: 6 lines, one per feature section.

- [ ] **Step 8: Commit**

```bash
git add docs/FEATURES.md
git commit -m "docs: link each feature section to USAGE.md how-to guide"
```

---

## Task 5: Verify anchors and merge to main

Work from: `/Users/nicole.pendill/okta-terraform-toolkit/.worktrees/feature-usage-docs`

- [ ] **Step 1: Verify anchor consistency**

The H2 headers in `docs/USAGE.md` generate these GitHub anchors. Confirm every `USAGE.md#` link in FEATURES.md maps to an actual H2 in USAGE.md:

| FEATURES.md link | Expected H2 in USAGE.md |
|------------------|------------------------|
| `USAGE.md#rate-limit-probing` | `## Rate Limit Probing` |
| `USAGE.md#cross-org-sync` | `## Cross-Org Sync` |
| `USAGE.md#target-runtime-planner` | `## Target Runtime Planner` |
| `USAGE.md#debug--log-analysis` | `## Debug & Log Analysis` |
| `USAGE.md#code-generation` | `## Code Generation` |
| `USAGE.md#ai-features` | `## AI Features` |

Run this to confirm all H2 headers exist:

```bash
grep "^## " docs/USAGE.md
```

Expected output:
```
## Contents
## Connecting an Org
## Debug & Log Analysis
## Rate Limit Probing
## Code Generation
## Target Runtime Planner
## Cross-Org Sync
## AI Features
```

- [ ] **Step 2: Switch to main and pull**

```bash
git -C /Users/nicole.pendill/okta-terraform-toolkit checkout main
git -C /Users/nicole.pendill/okta-terraform-toolkit pull
```

- [ ] **Step 3: Merge feature branch**

```bash
git -C /Users/nicole.pendill/okta-terraform-toolkit merge docs/feature-usage-docs
```

- [ ] **Step 4: Push and clean up**

```bash
git -C /Users/nicole.pendill/okta-terraform-toolkit push origin main
git -C /Users/nicole.pendill/okta-terraform-toolkit worktree remove .worktrees/feature-usage-docs
git -C /Users/nicole.pendill/okta-terraform-toolkit branch -d docs/feature-usage-docs
```
