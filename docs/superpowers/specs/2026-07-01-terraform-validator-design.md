# Terraform Validator — Design Spec

**Date:** 2026-07-01
**Status:** Approved by Nicole, ready for implementation planning

## Problem

A customer demo revealed OTTO's AI can hallucinate Terraform resources that don't exist. Beyond that specific fix (already addressed via the v6.13 provider audit), there's no feature in OTTO for a DSE to upload an existing customer's Terraform project and get it validated against best practices — correctness issues (wrong attributes, missing `depends_on`, priority conflicts, bad import IDs) and optimization opportunities (reducing API calls, avoiding deprecated attributes). Any such feature must never send a customer's real hardcoded PII (Okta IDs, API tokens, emails, org URLs, client secrets) to the LLM.

## Goal

A new **Validate** tab where a user uploads their Terraform project (`.tf` + `.tfstate` + `.tfvars`), OTTO masks any hardcoded PII before AI analysis, runs a deep correctness + optimization review, and on export restores real values — promoted to `variables.tf` rather than re-inlined, enforcing a best practice by default.

## Non-Goals (this pass)

- Per-finding accept/reject UI — export applies all findings (locked decision)
- Map-reduce / multi-call analysis for very large projects — documented as a future scaling path, not built now
- Persisting the PII vault to disk in any form
- HCL-parser-based static pre-analysis (Option B, rejected — AI accuracy for cross-file issues comes from single-pass context, not from a static pre-pass)

## Architecture

**New renderer component:** `src/renderer/components/ValidatorSection.tsx` — new top-level tab. Follows `DashboardPage.tsx`'s existing pattern: add `'validate'` to the `Section` union type, add an icon to the icon map, add to `NAV_ITEMS`.

**New main-process module:** `src/main/api/validator.ts` — houses the PII vault engine and AI analysis orchestration. This is **not** a reuse of `src/main/api/redact.ts` — `redact.ts` is one-way/lossy, built for safe outbound logging. The validator needs a **reversible** vault: store the real value + a generated token, restore on export.

```typescript
interface VaultEntry {
  token: string;        // e.g. "{{OKTA_ID_1}}"
  value: string;        // original hardcoded value
  kind: 'okta_id' | 'org_url' | 'token' | 'client_secret' | 'email' | 'jwt' | 'pem_key' | 'hcl_pii_attr';
  sourceFile: string;
  sourceAttr: string;   // e.g. "app_id" — used to derive a variable name on export
}

interface VaultResult {
  maskedFiles: Record<string, string>;  // filename -> masked content
  entries: VaultEntry[];
}

interface Finding {
  id: string;
  category: 'correctness' | 'optimization';
  severity: 'error' | 'warning' | 'suggestion';
  file: string;
  resourceAddress: string;   // e.g. "okta_app_oauth.my_app"
  title: string;
  explanation: string;
  fixedSnippet: string;      // masked HCL after fix
}
```

**Pipeline (single-pass, Option A):**

1. **Upload** — `dialog.showOpenDialog` filtered to `.tf`/`.tfstate`/`.tfvars`, `multiSelections: true`, same pattern as `sync:open-files` in `ipc-handlers.ts`. `.tf` is required (at least one file); `.tfstate` and `.tfvars` are optional additions. Files read into `Record<string, string>` in memory.
2. **Vault** — `vaultProject(files): VaultResult`. Pure pattern-based detection, in-memory only, extends the pattern list already proven in `redact.ts` but stores reversible entries instead of static placeholders. Runs against **all** uploaded file types including `.tfstate` — state files are often the most PII-dense (they hold computed real values), so they get vaulted identically to `.tf`/`.tfvars`. No AI call.
3. **Analyze** — `analyzeProject(maskedFiles): { findings: Finding[]; fixedMaskedFiles: Record<string, string> }`. One Claude call with all masked files concatenated, structured output via `tool_use` (same pattern as existing calls in `claude.ts`). System prompt cross-references `resource-dictionary.ts` (real resource names), `versions.ts` (attribute/version notes), and the `ResourceLimitations.tsx` data (import/destroy behavior). `.tfstate` (masked) is included as **read-only context** — e.g. resolving a value referenced in `.tf` but not literally present, or detecting drift-relevant mismatches — but findings and `fixedMaskedFiles` only ever apply to `.tf`/`.tfvars` content. The validator does not modify or re-export state.
4. **Review** — user sees findings grouped Correctness first, then Optimization, each with severity badge, resource address, explanation, and collapsed before/after HCL diff (masked values only).
5. **Export** — `exportProject(fixedMaskedFiles, vaultEntries)`. For each `VaultEntry` whose `sourceFile` was a `.tf` file:
   - Generates a `variable` block **declaration only** (name derived from `sourceAttr` + dedup counter, `sensitive = true`, no `default`) — appended to the project's `variables.tf` if one exists, otherwise a new one is created
   - Writes the real value as an assignment in `terraform.tfvars` (already gitignored by convention — `.gitignore:4` has `*.tfvars` in this repo, and it's the idiomatic Terraform location for secrets)
   - Replaces every token occurrence in the fixed HCL with `var.<name>`

   **Real values never land in `variables.tf`.** Putting a `default = "<real value>"` there would defeat the masking entirely, since `variables.tf` is typically committed to git while `.tfvars` is not.

   For each `VaultEntry` whose `sourceFile` was already a `.tfvars` file: **restore in place**, no promotion. It's already in the correct gitignored location — creating a new variable would be redundant and would orphan the original entry.

   Writes files to a user-selected directory (same save pattern as "Export Full Project"). `.tfstate` is never included in export output. Vault entry for the session is dropped immediately after.

**IPC channels:** `validator:open-files`, `validator:vault`, `validator:analyze` (with progress events via `webContents.send`, same pattern as probe/sync), `validator:export`, `validator:clear-session`.

## PII Vault Detection

Extends `redact.ts`'s proven pattern list, but reversible:

| Kind | Pattern | Token example |
|---|---|---|
| `okta_id` | ID prefixes: `00u`, `00g`, `0oa`, `0pr`, etc. | `{{OKTA_ID_1}}` |
| `org_url` | `*.okta.com` / `*.oktapreview.com` domains | `{{ORG_URL_1}}` |
| `token` | `SSWS ...`, `Bearer ...` | `{{API_TOKEN_1}}` |
| `client_secret` | `client_secret = "..."` | `{{CLIENT_SECRET_1}}` |
| `email` | standard email regex | `{{EMAIL_1}}` |
| `jwt` | 3-segment base64url | `{{JWT_1}}` |
| `pem_key` | PEM block | `{{PEM_KEY_1}}` |
| `hcl_pii_attr` | `firstName`, `lastName`, `login`, `phone` attribute values | `{{PII_1}}` |

Same real value reused across files → same token (so `variables.tf` promotion doesn't create duplicate variables for one app ID referenced three times).

**Vault Summary UI** — collapsible panel shown immediately after upload (vaulting is local, instant, no AI call yet). Collapsed: counts by kind, e.g. "7 Okta IDs, 2 API tokens, 3 emails masked ▾". Expanded: token + source location only (`{{OKTA_ID_1}} ← app_id in main.tf`) — real values never rendered in the renderer process.

## Vault Lifetime Policy

PII must be short-lived by design, not by accident:

- **Scope:** one validation session, bound to the `ValidatorSection` component lifecycle. A fresh upload = a fresh vault. Nothing persists across separate validation runs.
- **Storage:** main-process memory only (a `Map` keyed by session ID). Never written to disk. Explicitly excluded from `logger.ts`'s audit/debug logging so a log dump can't leak it.
- **Cleared immediately on:**
  - Successful export (entries consumed and discarded right after restore/promote)
  - User clicks Discard / Start Over
  - Renderer unmounts the Validate tab (`validator:clear-session` IPC call on unmount)
- **Idle timeout:** 15 minutes of no analyze/export activity while a vault is active → auto-clear, require re-upload.
- **App quit:** moot (memory-only) but stated explicitly for clarity.

## AI Analysis Checks

**Correctness:**
- Wrong resource/data-source names (cross-reference `resource-dictionary.ts` — directly addresses the hallucination problem from the customer demo)
- Missing required attributes, deprecated attributes (cross-reference `versions.ts`)
- Missing `depends_on` where Terraform can't infer ordering (implicit string interpolation vs. explicit resource reference)
- Priority/ordering conflicts (policy rules, auth server rules, etc. with colliding priority values)
- Import ID correctness, non-importable resources (cross-reference `ResourceLimitations.tsx` data)
- Provider/version misalignment (attribute used but not available in the project's declared provider version)

**Optimization** (always `suggestion` severity, kept visually separate from correctness):
- Near-identical repeated resource blocks that could collapse into `for_each`/`count`
- **`skip_authentication_policy`** on app resources (SAML/OIDC) where the authentication policy isn't independently Terraform-managed — undocumented attribute, reduces `/policies` API calls and avoids requesting policy-read permissions the token doesn't need
- Hardcoded value duplication where a `data` source lookup (e.g. lookup an existing group by name) would be more maintainable than repeating a value
- Provider config tuning (`max_retries`, `parallelism`, etc.) against OTTO's own generation defaults in `terraform-gen.ts`, when `provider.tf` is included in the upload

**Explicitly excluded:** `skip_users` / `skip_groups` — deprecated, must never appear as an optimization suggestion.

## UI Flow

`ValidatorSection.tsx`, mirroring `SyncSection.tsx`'s staged UI pattern:

1. **Upload** — file picker, shows selected file list
2. **Vault Summary** — collapsible, appears immediately after upload
3. **Analyze** button — triggers AI call, streams progress
4. **Findings Report** — Correctness section, then Optimization section; each finding shows severity badge, resource address, title, explanation, collapsed before/after diff (masked only)
5. **Export** — "Export Fixed Project" button, prompts save directory, writes fixed `.tf` files + updated `variables.tf` (declarations only) + updated `terraform.tfvars` (real values), clears vault immediately after
6. **Discard / Start Over** — available at every stage, clears vault and resets to Upload

## Future Scaling (v2, not built now)

If a customer project's combined `.tf` size approaches context limits, switch from single-pass to **map-reduce**:
1. **Map** — one call per file, extracts structured metadata only (resource addresses, `depends_on`, priority values — no raw HCL, no cross-file knowledge needed)
2. **Reduce** — one final call reasons over the compact metadata set from every file for cross-file issues (missing `depends_on`, priority conflicts, dangling references)

This preserves cross-file accuracy that naive per-file chunking would lose (rejected as Option C during design — chunking blinds each analysis pass to relationships living in other files). Trigger: a file-size/token-count heuristic on upload. Not implemented in this pass — single-pass (Option A) is sufficient for the small-to-medium customer projects OTTO actually handles.

## Key Decisions Log

| Decision | Choice | Why |
|---|---|---|
| Tab placement | New top-level "Validate" tab | Distinct workflow, not a sub-mode of Plan/Debug |
| File types accepted | `.tf` + `.tfstate` + `.tfvars` | Full project context, catches hardcoded values in tfvars too |
| Export restore behavior | Promote `.tf`-sourced values to `variables.tf` (declaration) + `terraform.tfvars` (value); restore `.tfvars`-sourced values in place | Enforces best practice by default without ever writing real values into a typically-committed file; avoids redundant promotion for values already in the gitignored location |
| Finding application | Apply all on export | Simpler UX; no per-finding accept/reject state to manage |
| Vault visibility | Show collapsible summary before analysis | Trust — user sees what's protected without exposing raw values |
| Analysis architecture | Single-pass (Option A) over static-pre-analysis (B) or chunked (C) | Full cross-file context is what makes `depends_on`/priority findings accurate; static pre-pass doesn't improve AI accuracy, chunking actively harms it |
| Vault storage | Memory-only, session-scoped, 15-min idle timeout | PII must be short-lived by design |
