# Feature Usage Documentation Design

**Date:** 2026-06-24  
**Goal:** Create a step-by-step operational guide for all OTTO features, linked from README and FEATURES.md, targeted at DSEs who have seen a limited demo and are operating the tool on their own for the first time.

---

## Problem

`docs/FEATURES.md` covers what each feature does but contains no step-by-step operational guidance. DSEs downloading OTTO after a limited demo have no resource to orient themselves beyond the README's install instructions.

---

## Audience

Okta Developer Support Engineers (DSEs). They have seen a brief demo but have not used the tool independently. They need guided walkthroughs, not reference cards.

---

## Approach

Single file: `docs/USAGE.md`, organized with H2 sections per feature and anchor links. README and FEATURES.md both link into it. Each feature section follows a consistent four-part template.

Rejected alternatives:
- **Flat linear narrative** — loses anchor-linking capability, making cross-references from FEATURES.md less useful
- **Per-feature files in `docs/how-to/`** — more files than an internal tool at this stage warrants; adds navigation overhead for new users

---

## File Map

| File | Action |
|------|--------|
| `docs/USAGE.md` | Create |
| `README.md` | Modify — add link to USAGE.md |
| `docs/FEATURES.md` | Modify — add "→ How to use" anchor link at the bottom of each feature section |

---

## `docs/USAGE.md` Structure

### Section Template (applied to every feature)

```
## <Feature Name>

**What it's for** — 1-2 sentences on when a DSE reaches for this.

**Before you start** — Prerequisites specific to this feature (omit if none beyond org connection).

**Steps**
1. ...

**Tips**
- ...
```

### Section Order

Ordered by how likely a first-time DSE is to reach for each feature:

1. **Connecting an Org** — prerequisite for most features; short
2. **Debug & Log Analysis** — default landing tab; lowest barrier to entry
3. **Rate Limit Probing** — core DSE use case
4. **Code Generation** — naturally follows a probe
5. **Target Runtime Planner** — useful but less frequently reached
6. **Cross-Org Sync** — most complex; saved for last
7. **AI Features** — setup + map of where AI features live in the UI

---

## Per-Section Content Scope

### 1. Connecting an Org
- **Steps:** Click "Connect Org" in the header → enter org URL + API token → Connect
- **Tips:** Token must be set to 100% rate limit capacity (link to Okta KB) or probe results will be inaccurate; URL format accepted with or without `https://`

### 2. Debug & Log Analysis
- **Steps:** Upload a `TF_LOG=DEBUG` file → read parsed breakdown → optionally trigger AI interpretation; Error Decoder as a separate path for Okta API errors
- **Tips:** How to generate a proper `TF_LOG` file; difference between log analysis and the Error Decoder

### 3. Rate Limit Probing
- **Steps:** Connect org → describe workload or use AI workload builder → run probe → read capacity table
- **Tips:** Deep probe for sub-resource paths; what "remaining capacity" means in context; why probe with 100% token capacity

### 4. Code Generation
- **Steps:** Run a probe → generate `provider.tf` / `versions.tf` / `variables.tf` → copy or download
- **Tips:** Generation uses probe results; re-probe after org changes before regenerating

### 5. Target Runtime Planner
- **Steps:** Set desired run duration → read bottleneck report
- **Tips:** Useful before submitting a rate limit increase JIRA to quantify the gap

### 6. Cross-Org Sync
- **Steps:** Two input modes (live API vs. file upload) → Discover → Match & Diff → Convert → Apply; selective sync; rollback bundle
- **Tips:** Always review the Terraform plan before applying; use rollback bundle if apply goes wrong; deterministic convert mode works without an AI key

### 7. AI Features
- **Sub-sections:**
  - Setup: OCM path (`ocm auth litellm` + Reload) and static key fallback (Settings → Advanced settings) for Windows/non-OCM users
  - Where each AI feature lives: workload builder (Rate Limits tab), config conversion (Sync tab), log interpretation (Debug tab), error decoding (Debug tab), solution builder (Rate Limits tab)

---

## Cross-Linking

### README.md

Add a "How to Use" line in the existing docs reference section, pointing to `docs/USAGE.md`.

### docs/FEATURES.md

Add one line at the bottom of each feature section:

```markdown
→ [How to use: Rate Limit Probing](USAGE.md#rate-limit-probing)
```

No other changes to FEATURES.md.

---

## Success Criteria

- A DSE with no prior OTTO experience can complete a rate limit probe and generate a `provider.tf` using only USAGE.md
- Cross-org sync section is detailed enough to complete a sync without asking for help
- Links from README and FEATURES.md resolve correctly to the right anchors
