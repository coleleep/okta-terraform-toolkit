# OTTO Knowledge Accuracy Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all inaccurate Okta provider knowledge in OTTO's HCL templates, AI prompts, and UI — reconciled against provider v6.13.0 source.

**Architecture:** Six targeted changes across shared data (`versions.ts`), AI prompts (`claude.ts`), the Electron IPC layer (`ipc-handlers.ts`, `preload.ts`, `LogAnalyzer.tsx`), and a new Learn tab UI component. No new data models. Rate limit context is built per-call using data already flowing through the system.

**Tech Stack:** TypeScript, React, Zustand, Electron IPC, Jest.

---

## File Map

| File | Role |
|---|---|
| `src/shared/versions.ts` | HCL template snippets + attribute notes shown to users. Contains 3 wrong attribute names and missing WebAuthn examples. |
| `src/main/api/claude.ts` | AI system prompts. Needs: remove hardcoded rate limits, add import IDs, add non-deletable resource documentation. |
| `src/main/ipc-handlers.ts` | Electron IPC handlers. Update `claude:interpret-log` to accept optional probe result. |
| `src/preload.ts` | Exposes IPC to renderer. Update `interpretLog` signature. |
| `src/renderer/components/LogAnalyzer.tsx` | Log analysis UI. Update to pass probe result from store when calling interpretLog. |
| `src/renderer/components/LearnSection.tsx` | Tab container. Add "Resource Limitations" tab. |
| `src/renderer/components/ResourceLimitations.tsx` | New component. Three sections: import support, destroy behavior, OIE vs Classic. |
| `src/__tests__/provider-v6.11.0.test.ts` | Add tests for correct attribute names in v6.11.0 templates. |
| `src/__tests__/provider-v6.12.0.test.ts` | Add test verifying keep_me_signed_in is a block, not boolean. |

---

## Ground Truth Reference

These are the correct attribute names from provider v6.13.0 source (confirmed by reading Go resource files):

| Wrong (OTTO has) | Correct |
|---|---|
| `stay_signed_in_consent = "ALLOWED"` | `keep_me_signed_in { post_auth = "ALLOWED"; post_auth_prompt_frequency = "P30D" }` |
| `password_breached_action = "WARN"` | `breached_password_logout_enabled = true`, `breached_password_expire_after_days = 0`, `breached_password_delegated_workflow_id = ""` |
| `keep_me_signed_in = true` (boolean) | Same block as above |

---

## Task 1: Write failing tests for versions.ts attribute fixes

**Files:**
- Modify: `src/__tests__/provider-v6.11.0.test.ts`
- Modify: `src/__tests__/provider-v6.12.0.test.ts`

- [ ] **Step 1: Add failing tests to `src/__tests__/provider-v6.11.0.test.ts`**

Add this describe block at the end of the file:

```typescript
describe('v6.11.0 correct attribute names in HCL templates', () => {
  it('does NOT use stay_signed_in_consent in applications config', () => {
    const apps = VERSION_RESOURCE_ADDITIONS['6.11.0'].find((a) => a.type === 'applications');
    expect(apps).toBeDefined();
    expect(apps!.config).not.toContain('stay_signed_in_consent');
  });

  it('uses keep_me_signed_in block in applications config', () => {
    const apps = VERSION_RESOURCE_ADDITIONS['6.11.0'].find((a) => a.type === 'applications');
    expect(apps).toBeDefined();
    expect(apps!.config).toContain('keep_me_signed_in');
    expect(apps!.config).toContain('post_auth');
    expect(apps!.config).toContain('post_auth_prompt_frequency');
  });

  it('does NOT use password_breached_action in policies config', () => {
    const policies = VERSION_RESOURCE_ADDITIONS['6.11.0'].find((a) => a.type === 'policies');
    expect(policies).toBeDefined();
    expect(policies!.config).not.toContain('password_breached_action');
  });

  it('uses correct breached password attributes in policies config', () => {
    const policies = VERSION_RESOURCE_ADDITIONS['6.11.0'].find((a) => a.type === 'policies');
    expect(policies).toBeDefined();
    expect(policies!.config).toContain('breached_password_logout_enabled');
    expect(policies!.config).toContain('breached_password_expire_after_days');
  });

  it('includes okta_authenticator_webauthn_custom_aaguid example in authenticators config', () => {
    const auth = VERSION_RESOURCE_ADDITIONS['6.11.0'].find((a) => a.type === 'authenticators');
    expect(auth).toBeDefined();
    expect(auth!.config).toContain('okta_authenticator_webauthn_custom_aaguid');
    expect(auth!.config).toContain('okta_authenticator_method_webauthn');
  });

  it('VERSION_ATTRIBUTE_NOTES does not contain stay_signed_in_consent', () => {
    const notes = VERSION_ATTRIBUTE_NOTES['6.11.0'];
    expect(notes.some((n) => n.includes('stay_signed_in_consent'))).toBe(false);
  });

  it('VERSION_ATTRIBUTE_NOTES does not contain password_breached_action', () => {
    const notes = VERSION_ATTRIBUTE_NOTES['6.11.0'];
    expect(notes.some((n) => n.includes('password_breached_action'))).toBe(false);
  });

  it('VERSION_ATTRIBUTE_NOTES mentions keep_me_signed_in', () => {
    const notes = VERSION_ATTRIBUTE_NOTES['6.11.0'];
    expect(notes.some((n) => n.includes('keep_me_signed_in'))).toBe(true);
  });

  it('VERSION_ATTRIBUTE_NOTES mentions breached_password_logout_enabled', () => {
    const notes = VERSION_ATTRIBUTE_NOTES['6.11.0'];
    expect(notes.some((n) => n.includes('breached_password_logout_enabled'))).toBe(true);
  });
});
```

- [ ] **Step 2: Add failing test to `src/__tests__/provider-v6.12.0.test.ts`**

Add to the `'v6.12.0 resource additions'` describe block:

```typescript
  it('keep_me_signed_in in 6.12.0 applications config is a block (not boolean)', () => {
    const apps = VERSION_RESOURCE_ADDITIONS['6.12.0'].find((a) => a.type === 'applications');
    expect(apps).toBeDefined();
    // Boolean syntax would be: "keep_me_signed_in  = true"
    // Correct block syntax starts with "keep_me_signed_in {"
    expect(apps!.config).not.toMatch(/keep_me_signed_in\s*=\s*true/);
    expect(apps!.config).toContain('keep_me_signed_in {');
    expect(apps!.config).toContain('post_auth');
  });
```

Also add to VERSION_ATTRIBUTE_NOTES describe block:

```typescript
  it('keep_me_signed_in note mentions block not attribute', () => {
    const notes = VERSION_ATTRIBUTE_NOTES['6.12.0'];
    const kmsiNote = notes.find((n) => n.includes('keep_me_signed_in'));
    expect(kmsiNote).toBeDefined();
    // Should describe block fields, not just say "attribute added"
    expect(kmsiNote).toMatch(/block|post_auth/);
  });
```

- [ ] **Step 3: Run tests to confirm they fail**

```bash
npm test -- --testPathPattern "provider-v6.11|provider-v6.12" --no-coverage
```

Expected: 11 new failures. The wrong attribute names and missing WebAuthn examples cause them.

---

## Task 2: Fix versions.ts — wrong attributes + full HCL examples

**Files:**
- Modify: `src/shared/versions.ts`

Read the file first: the changes are at lines 235–315 (HCL templates) and lines 391–405 (attribute notes).

- [ ] **Step 1: Fix v6.11.0 policies config — replace `password_breached_action`**

Find this block (around line 235):
```typescript
      config: `
# Breached password protection on password policy (v6.11.0+)
# resource "okta_policy_password" "example" {
#   name   = "Password Policy"
#   status = "ACTIVE"
#   password_breached_action = "WARN"  # NONE, WARN, or BLOCK
# }
`,
```

Replace with:
```typescript
      config: `
# Breached password protection on password policy (v6.11.0+)
# resource "okta_policy_password" "example" {
#   name   = "Password Policy"
#   status = "ACTIVE"
#   breached_password_logout_enabled        = true  # terminate sessions immediately on breach
#   breached_password_expire_after_days     = 0      # 0 = immediate expiry; range 0–10
#   breached_password_delegated_workflow_id = ""     # optional: Okta Workflow ID to trigger
# }
`,
```

- [ ] **Step 2: Fix v6.11.0 authenticators config — add WebAuthn custom AAGUID and method examples**

Find the authenticators config block (around line 246). Currently it only shows an `okta_authenticator` example with `aaguidGroups` settings. **Replace the entire config string** with:

```typescript
      config: `
# WebAuthn authenticator with custom AAGUID groups (v6.11.0+)
# resource "okta_authenticator" "webauthn" {
#   key    = "webauthn"
#   name   = "WebAuthn"
#   status = "ACTIVE"
#   settings = jsonencode({
#     userVerification = "PREFERRED"
#     aaguidGroups     = [
#       {
#         name    = "YubiKey"
#         aaguids = ["fa2b99dc-9e39-4257-8f92-4a30d23c4118"]
#       }
#     ]
#   })
# }
#
# Manage individual AAGUID allowlist entries (v6.11.0+)
# resource "okta_authenticator_webauthn_custom_aaguid" "yubikey" {
#   authenticator_id = okta_authenticator.webauthn.id
#   aaguid           = "fa2b99dc-9e39-4257-8f92-4a30d23c4118"
#   name             = "YubiKey 5"
#   # Import: terraform import okta_authenticator_webauthn_custom_aaguid.yubikey <authenticator_id>/<aaguid>
# }
#
# Configure WebAuthn authenticator method settings (v6.11.0+)
# resource "okta_authenticator_method_webauthn" "example" {
#   authenticator_id = okta_authenticator.webauthn.id
#   status           = "ACTIVE"
#   # Import: terraform import okta_authenticator_method_webauthn.example <authenticator_id>
# }
`,
```

- [ ] **Step 3: Fix v6.11.0 applications config — replace `stay_signed_in_consent`**

Find the applications config block that contains `stay_signed_in_consent` (around line 266). **Replace the entire config string** with:

```typescript
      config: `
# Push group with AD destination support (v6.11.0+)
# resource "okta_push_group" "ad_example" {
#   app_id          = okta_app_auto_login.ad_app.id
#   group_id        = okta_group.example.id
#   group_push_rule = "SAME_NAME"
#   # AD apps can now be used as push destinations
# }

# App sign-on policy rule: keep me signed in (v6.11.0+)
# resource "okta_app_signon_policy_rule" "example" {
#   policy_id   = okta_app_signon_policy.example.id
#   name        = "Default Rule"
#   factor_mode = "1FA"
#   type        = "ASSURANCE"
#
#   keep_me_signed_in {
#     post_auth                  = "ALLOWED"   # ALLOWED or NOT_ALLOWED
#     post_auth_prompt_frequency = "P30D"       # ISO 8601 duration (e.g. P7D, P30D)
#   }
# }
`,
```

- [ ] **Step 4: Fix v6.12.0 applications config — replace boolean `keep_me_signed_in`**

Find the v6.12.0 applications config (around line 296) that has `keep_me_signed_in  = true`. Replace that resource block with:

```typescript
# Stay-signed-in option on app sign-on policy rules bulk resource (v6.12.0+)
# resource "okta_app_signon_policy_rules" "example" {
#   policy_id = okta_app_signon_policy.example.id
#   name      = "Default Rule"
#
#   keep_me_signed_in {
#     post_auth                  = "ALLOWED"   # ALLOWED or NOT_ALLOWED
#     post_auth_prompt_frequency = "P30D"       # ISO 8601 duration (e.g. P7D, P30D)
#   }
# }
```

(Keep the `okta_app_oauth` CIBA example above it unchanged.)

- [ ] **Step 5: Fix VERSION_ATTRIBUTE_NOTES '6.11.0' — replace two wrong entries**

Find these two lines (around 391, 394):
```typescript
    'okta_policy_password: password_breached_action attribute added (NONE, WARN, BLOCK)',
    ...
    'okta_app_signon_policy_rule: stay_signed_in_consent attribute added',
```

Replace them with:
```typescript
    'okta_policy_password: breached_password_logout_enabled, breached_password_expire_after_days, breached_password_delegated_workflow_id attributes added (breach detection)',
    ...
    'okta_app_signon_policy_rule: keep_me_signed_in block added (post_auth: ALLOWED|NOT_ALLOWED, post_auth_prompt_frequency: ISO 8601 duration)',
```

- [ ] **Step 6: Fix VERSION_ATTRIBUTE_NOTES '6.12.0' — update keep_me_signed_in note**

Find (around line 405):
```typescript
    'okta_app_signon_policy_rules: keep_me_signed_in attribute added',
```

Replace with:
```typescript
    'okta_app_signon_policy_rules: keep_me_signed_in block added (post_auth: ALLOWED|NOT_ALLOWED, post_auth_prompt_frequency: ISO 8601 duration)',
```

- [ ] **Step 7: Add v6.13.0 customRoles entry to VERSION_RESOURCE_ADDITIONS**

Find the `'6.13.0': [` block in VERSION_RESOURCE_ADDITIONS. Add a `customRoles` entry alongside the existing governance entry:

```typescript
  '6.13.0': [
    {
      type: 'customRoles',
      config: `
# IAM resource set data source (v6.13.0+)
# data "okta_iam_resource_set" "example" {
#   id = "<resource_set_id>"
# }
# # Use in resource set assignment:
# resource "okta_resource_set" "example" {
#   label       = "My Resource Set"
#   description = "Custom role scope"
#   resources   = ["https://<org>.okta.com/api/v1/apps"]
# }
`,
    },
    {
      type: 'governance',
      config: `...`, // existing governance entry unchanged
    },
  ],
```

- [ ] **Step 8: Run tests to confirm they pass**

```bash
npm test -- --testPathPattern "provider-v6.11|provider-v6.12" --no-coverage
```

Expected: All tests pass. No failures.

- [ ] **Step 9: Commit**

```bash
git add src/shared/versions.ts src/__tests__/provider-v6.11.0.test.ts src/__tests__/provider-v6.12.0.test.ts
git commit -m "fix: correct HCL attribute names and add full v6.13 examples to versions.ts"
```

---

## Task 3: Fix claude.ts — import IDs, non-deletable section, remove hardcoded rate limits

**Files:**
- Modify: `src/main/api/claude.ts`

This task modifies the AI system prompt strings. No automated tests — verify by grep after applying.

- [ ] **Step 1: Add new import IDs and non-importable section to `convertConfig` prompt**

In `src/main/api/claude.ts`, find the "Import ID formats for sub-resources" section in the `convertConfig` system prompt (around line 598). It currently ends with:

```
- okta_group_memberships: group_id
```

Append after that line:
```
- okta_authenticator_webauthn_custom_aaguid: authenticator_id/aaguid
- okta_authenticator_method_webauthn: authenticator_id
- okta_identity_source_group: identity_source_id/id
- okta_identity_source_group_membership: identity_source_id/group_or_external_id/id  ← 3-part ID, unusual format
- okta_identity_source_user: identity_source_id/id
- okta_app_signon_policy_rules: policy_id
- okta_app_signon_policy: id
- okta_label: id
```

Then add a new section immediately after:
```
Resources that do NOT support terraform import (never generate import blocks for these):
- okta_trusted_server — ImportState explicitly disabled in provider
- okta_resource_owner — no import support
- okta_identity_source_import — no import support (trigger-only resource)
```

- [ ] **Step 2: Add non-deletable resource section to `SOLUTION_SYSTEM_PROMPT`**

In `src/main/api/claude.ts`, find the `SOLUTION_SYSTEM_PROMPT` string. After the `POLICY RULE PRIORITY MANAGEMENT:` section and before `RULES:`, insert:

```
RESOURCES WHERE TERRAFORM DESTROY HAS NO EFFECT:
These have no-op delete implementations — terraform destroy only removes from state, no API call:
- okta_org_configuration (singleton — manages existing org settings, no delete endpoint)
- okta_policy_mfa_default (default policy — Okta does not allow deleting default policies)
- okta_policy_password_default (default policy — same as above)
- okta_rate_limiting (provider emits warning: "This resource cannot be deleted via Terraform")
- okta_rate_limit_admin_notification_settings (provider emits warning: "Delete Not Supported")
- okta_rate_limit_warning_threshold_percentage (provider emits warning: "Delete Not Supported")
- okta_resource_owner (governance resource — provider emits warning: "Delete Not Supported")
- okta_request_setting_organization (governance — provider emits warning: "Delete Not Supported")
- okta_request_setting_resource (governance — provider emits warning: "Delete Not Supported")

RESOURCES WHERE DESTROY RESETS TO DEFAULTS (API call, but underlying singleton survives):
- okta_security_notification_emails — destroy resets all notification flags to true (Okta defaults)
- okta_threat_insight_settings — destroy resets threat insight action to 'none'

When generating solutions with these resources: note in warnings that terraform destroy will not remove the configuration from Okta — it only removes the resource from Terraform state.
```

- [ ] **Step 3: Remove hardcoded rate limit numbers from `LOG_SYSTEM_PROMPT`**

Find this section in `LOG_SYSTEM_PROMPT` (around line 165):
```
RATE LIMITING & BACKOFF:
- Okta rate limits are per-endpoint, typically 600 req/min for most endpoints, 100 req/min for app user/group assignment endpoints
- 429 responses mean the rate limit was hit; the provider retries with exponential backoff (min_wait → max_wait)
- max_api_capacity (0-100) controls proactive throttling: provider sleeps when Remaining/Limit < capacity%. Prevents 429s but can cause deadline errors if request_timeout is too low
- Known-good config for ~100 req/window endpoints: max_api_capacity=70, request_timeout=120, parallelism=4, min_wait_seconds=17, max_wait_seconds=90
```

Replace with:
```
RATE LIMITING & BACKOFF:
- Org-specific rate limits are provided below — use these actual values, not generic estimates
- Rate limits vary by org tier; the numbers below come from (1) X-Rate-Limit-Limit headers in this log run, (2) a probe of this org, or (3) documented Okta developer-tier defaults as a last resort — the source is labeled in the data
- 429 responses mean the rate limit was hit; the provider retries with exponential backoff (min_wait → max_wait)
- max_api_capacity (0-100) controls proactive throttling: provider sleeps when Remaining/Limit < capacity%. Prevents 429s but can cause deadline errors if request_timeout is too low
- For endpoints with limits under 200/window: max_api_capacity=70, request_timeout=120, parallelism=4, min_wait_seconds=17, max_wait_seconds=90
- If log was captured with TF_LOG=INFO instead of TF_LOG=DEBUG, rate limit headers will be absent from the log — note this in your analysis if using probe/default data
```

- [ ] **Step 4: Verify by grep — confirm no wrong strings remain**

```bash
node -e "
const fs = require('fs');
const c = fs.readFileSync('src/main/api/claude.ts', 'utf8');
const checks = [
  ['600 req/min', 'hardcoded rate limit still present'],
  ['100 req/min', 'hardcoded rate limit still present'],
  ['stay_signed_in_consent', 'wrong attribute still in prompt'],
  ['okta_identity_source_group_membership: identity_source_id/group_or_external_id/id', 'new import ID missing'],
  ['okta_trusted_server', 'non-importable list missing'],
  ['no-op delete', 'non-deletable section missing'],
];
let pass = true;
checks.forEach(([term, msg]) => {
  const found = c.includes(term);
  if (msg.includes('missing')) {
    if (!found) { console.error('MISSING:', term, '-', msg); pass = false; }
  } else {
    if (found) { console.error('STILL PRESENT:', term, '-', msg); pass = false; }
  }
});
if (pass) console.log('All checks passed');
"
```

Expected: `All checks passed`

- [ ] **Step 5: Commit**

```bash
git add src/main/api/claude.ts
git commit -m "fix: update AI prompts with correct import IDs, non-deletable resources, and dynamic rate limits"
```

---

## Task 4: Rate limit context — IPC layer update

**Files:**
- Modify: `src/main/api/claude.ts` (add `buildRateLimitContext` function, update `interpretLog` signature)
- Modify: `src/main/ipc-handlers.ts` (update `claude:interpret-log` handler)
- Modify: `src/preload.ts` (update `interpretLog` bridge signature)
- Modify: `src/renderer/components/LogAnalyzer.tsx` (pass probe result from store)

- [ ] **Step 1: Add `buildRateLimitContext` to `src/main/api/claude.ts`**

Add this function just before `export async function interpretLog`. It imports `ProbeResult` from shared types:

```typescript
function buildRateLimitContext(analysis: LogAnalysis, probeResult?: ProbeResult): string {
  // Tier 1: X-Rate-Limit-Limit headers extracted from the actual log run
  const observed = analysis.endpoints.filter(e => e.minRateLimit > 0);
  if (observed.length > 0) {
    const lines = observed.map(e =>
      `  ${e.pattern}: limit=${e.minRateLimit}/window, lowest_remaining=${e.lowestRemaining}`
    );
    return `ORG RATE LIMITS (source: X-Rate-Limit-Limit headers from this log run — org-specific):\n${lines.join('\n')}`;
  }

  // Tier 2: Probe results for the current org
  if (probeResult) {
    const lines = probeResult.endpoints
      .filter(e => e.limit > 0 && e.status !== 'error' && e.status !== 'skipped')
      .map(e => `  ${e.endpoint}: limit=${e.limit}/window`);
    if (lines.length > 0) {
      return `ORG RATE LIMITS (source: org probe — log did not include rate limit headers; re-run with TF_LOG=DEBUG for log-specific data):\n${lines.join('\n')}`;
    }
  }

  // Tier 3: Documented Okta developer-tier defaults
  return `ORG RATE LIMITS (source: documented Okta developer-tier defaults — no log headers or probe data available; re-run with TF_LOG=DEBUG for org-specific data):
  Most management endpoints: ~600/window
  App user/group assignment (/api/v1/apps/{id}/users, /api/v1/apps/{id}/groups): ~100/window
  NOTE: Actual limits vary by org tier — treat these as rough estimates only.`;
}
```

Also add `ProbeResult` to the import from shared types at the top of the file:
```typescript
import { LogAnalysis, ClaudeInterpretation, CustomWorkloadEntry, ProbeResult } from '../../shared/types';
```

- [ ] **Step 2: Update `interpretLog` signature and inject rate limit context**

Change the function signature:
```typescript
export async function interpretLog(analysis: LogAnalysis, probeResult?: ProbeResult): Promise<ClaudeInterpretation> {
```

Add rate limit context injection right after `const scopeContext = buildScopeContext();`:
```typescript
  const rateLimitContext = buildRateLimitContext(analysis, probeResult);
```

Change the `system` field in the API call from:
```typescript
    system: `${LOG_SYSTEM_PROMPT}\n\n${scopeContext}`,
```
To:
```typescript
    system: `${LOG_SYSTEM_PROMPT}\n\n${rateLimitContext}\n\n${scopeContext}`,
```

- [ ] **Step 3: Update `claude:interpret-log` in `src/main/ipc-handlers.ts`**

Find the handler (around line 217):
```typescript
  ipcMain.handle('claude:interpret-log', async (_event, analysis: LogAnalysis) => {
    try {
      const result = await interpretLog(analysis);
```

Change to:
```typescript
  ipcMain.handle('claude:interpret-log', async (_event, params: { analysis: LogAnalysis; probeResult?: ProbeResult }) => {
    try {
      const result = await interpretLog(params.analysis, params.probeResult);
```

Add `ProbeResult` to the import from shared types at the top of `ipc-handlers.ts`.

- [ ] **Step 4: Update preload bridge in `src/preload.ts`**

Find (around line 55):
```typescript
  interpretLog: (analysis: unknown) => ipcRenderer.invoke('claude:interpret-log', analysis),
```

Change to:
```typescript
  interpretLog: (params: { analysis: unknown; probeResult?: unknown }) =>
    ipcRenderer.invoke('claude:interpret-log', params),
```

Also update the TypeScript type declaration for `interpretLog` in the `oktaTerraform` interface exposed by preload (it's declared in the window type annotation). Find the type in `src/renderer/components/LogAnalyzer.tsx` line ~30 (the local api type) and update it there too.

- [ ] **Step 5: Update `LogAnalyzer.tsx` to pass probe result**

In `src/renderer/components/LogAnalyzer.tsx`:

1. Import `useStore` at the top:
```typescript
import { useStore } from '../hooks/useStore';
```

2. Inside the `LogAnalyzer` component function, add:
```typescript
const probeResult = useStore(state => state.probeResult);
```

3. Update the local `api` type definition (around line 28). Change:
```typescript
    interpretLog: (analysis: LogAnalysis) => Promise<{ success: boolean; data?: ClaudeInterpretation; error?: string }>;
```
To:
```typescript
    interpretLog: (params: { analysis: LogAnalysis; probeResult?: unknown }) => Promise<{ success: boolean; data?: ClaudeInterpretation; error?: string }>;
```

4. Update the `handleInterpret` call (around line 43):
```typescript
      const result = await api.interpretLog({ analysis, probeResult: probeResult ?? undefined });
```

- [ ] **Step 6: Run TypeScript compile check**

```bash
npx tsc --noEmit
```

Expected: No type errors. If there are import errors for `ProbeResult` in `ipc-handlers.ts`, verify the import path is `'../shared/types'`.

- [ ] **Step 7: Run tests to confirm no regressions**

```bash
npm test -- --no-coverage
```

Expected: All tests pass.

- [ ] **Step 8: Commit**

```bash
git add src/main/api/claude.ts src/main/ipc-handlers.ts src/preload.ts src/renderer/components/LogAnalyzer.tsx
git commit -m "feat: org-specific rate limit context in log analysis (3-tier: log headers > probe > defaults)"
```

---

## Task 5: ResourceLimitations component + LearnSection tab

**Files:**
- Create: `src/renderer/components/ResourceLimitations.tsx`
- Modify: `src/renderer/components/LearnSection.tsx`

Follow the exact same structural pattern as `src/renderer/components/BestPractices.tsx`.

- [ ] **Step 1: Create `src/renderer/components/ResourceLimitations.tsx`**

```typescript
import React, { useState, useRef, useCallback } from 'react';

const SECTIONS = [
  { id: 'import-support', title: 'Import Support' },
  { id: 'destroy-behavior', title: 'Destroy Behavior' },
  { id: 'oie-vs-classic', title: 'OIE vs Classic' },
] as const;

type SectionId = (typeof SECTIONS)[number]['id'];

function Warning({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-red-50 border-l-4 border-red-500 rounded-r p-3 my-3">
      <p className="text-xs font-medium text-red-800 mb-0.5">Important</p>
      <div className="text-xs text-red-700">{children}</div>
    </div>
  );
}
function Caution({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-amber-50 border-l-4 border-amber-500 rounded-r p-3 my-3">
      <p className="text-xs font-medium text-amber-800 mb-0.5">Caution</p>
      <div className="text-xs text-amber-700">{children}</div>
    </div>
  );
}
function H3({ children }: { children: React.ReactNode }) {
  return <h3 className="text-sm font-semibold text-gray-700 mt-4 mb-2">{children}</h3>;
}
function P({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-gray-600 leading-relaxed mb-2">{children}</p>;
}

function ImportSupportContent() {
  return (
    <>
      <P>
        Most Okta Terraform resources support <code className="bg-gray-100 px-1 rounded">terraform import</code>.
        A few do not — and several use composite IDs that are easy to get wrong.
      </P>

      <Warning>
        These resources do <strong>not</strong> support import. Do not generate{' '}
        <code className="bg-red-100 px-1 rounded">import {'{}'}</code> blocks for them:
        <ul className="mt-2 space-y-1 list-disc ml-4">
          <li><code>okta_trusted_server</code> — ImportState explicitly disabled in provider</li>
          <li><code>okta_resource_owner</code> — no import support</li>
          <li><code>okta_identity_source_import</code> — trigger-only resource, no import</li>
        </ul>
      </Warning>

      <H3>Composite Import IDs (multi-part — easy to get wrong)</H3>
      <div className="overflow-x-auto my-3">
        <table className="w-full text-xs border border-gray-200 rounded">
          <thead className="bg-gray-50">
            <tr>
              <th className="text-left p-2 font-medium text-gray-600">Resource</th>
              <th className="text-left p-2 font-medium text-gray-600">Import ID Format</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            <tr><td className="p-2 font-mono">okta_auth_server_policy</td><td className="p-2 font-mono">auth_server_id/policy_id</td></tr>
            <tr><td className="p-2 font-mono">okta_auth_server_policy_rule</td><td className="p-2 font-mono">auth_server_id/policy_id/rule_id</td></tr>
            <tr><td className="p-2 font-mono">okta_auth_server_scope</td><td className="p-2 font-mono">auth_server_id/scope_id</td></tr>
            <tr><td className="p-2 font-mono">okta_auth_server_claim</td><td className="p-2 font-mono">auth_server_id/claim_id</td></tr>
            <tr><td className="p-2 font-mono">okta_policy_rule_signon</td><td className="p-2 font-mono">policy_id/rule_id</td></tr>
            <tr><td className="p-2 font-mono">okta_policy_rule_password</td><td className="p-2 font-mono">policy_id/rule_id</td></tr>
            <tr><td className="p-2 font-mono">okta_policy_rule_mfa</td><td className="p-2 font-mono">policy_id/rule_id</td></tr>
            <tr><td className="p-2 font-mono">okta_policy_rule_profile_enrollment</td><td className="p-2 font-mono">policy_id/rule_id</td></tr>
            <tr><td className="p-2 font-mono">okta_app_user</td><td className="p-2 font-mono">app_id/user_id</td></tr>
            <tr><td className="p-2 font-mono">okta_app_group_assignment</td><td className="p-2 font-mono">app_id/group_id</td></tr>
            <tr><td className="p-2 font-mono">okta_authenticator_webauthn_custom_aaguid</td><td className="p-2 font-mono">authenticator_id/aaguid</td></tr>
            <tr className="bg-amber-50"><td className="p-2 font-mono">okta_identity_source_group_membership</td><td className="p-2 font-mono text-amber-800">identity_source_id/group_or_external_id/id <strong>(3-part)</strong></td></tr>
            <tr><td className="p-2 font-mono">okta_identity_source_group</td><td className="p-2 font-mono">identity_source_id/id</td></tr>
            <tr><td className="p-2 font-mono">okta_identity_source_user</td><td className="p-2 font-mono">identity_source_id/id</td></tr>
          </tbody>
        </table>
      </div>

      <H3>Simple Import IDs (just the resource ID)</H3>
      <P>
        All other resources import with a single ID string:{' '}
        <code className="bg-gray-100 px-1 rounded">terraform import okta_resource.name &lt;id&gt;</code>.
        Notable ones: <code>okta_authenticator_method_webauthn</code> (authenticator_id),{' '}
        <code>okta_app_signon_policy_rules</code> (policy_id),{' '}
        <code>okta_app_signon_policy</code>, <code>okta_label</code>, <code>okta_group_memberships</code> (group_id).
      </P>
    </>
  );
}

function DestroyBehaviorContent() {
  return (
    <>
      <P>
        Not all resources support <code className="bg-gray-100 px-1 rounded">terraform destroy</code>.
        Some have no-op deletes; others reset to defaults rather than truly deleting.
      </P>

      <Warning>
        <strong>No-op destroy</strong> — these resources are removed from Terraform state only.
        No API call is made. The configuration persists in Okta unchanged:
        <ul className="mt-2 space-y-1 list-disc ml-4">
          <li><code>okta_org_configuration</code> — singleton org settings, no delete endpoint</li>
          <li><code>okta_policy_mfa_default</code> — Okta prohibits deleting default policies</li>
          <li><code>okta_policy_password_default</code> — same as above</li>
          <li><code>okta_rate_limiting</code> — provider emits a warning and exits</li>
          <li><code>okta_rate_limit_admin_notification_settings</code></li>
          <li><code>okta_rate_limit_warning_threshold_percentage</code></li>
          <li><code>okta_resource_owner</code> — governance resource</li>
          <li><code>okta_request_setting_organization</code> — governance resource</li>
          <li><code>okta_request_setting_resource</code> — governance resource</li>
        </ul>
      </Warning>

      <Caution>
        <strong>Destroy resets to defaults</strong> — these make an API call, but the underlying
        resource is a singleton that cannot be removed. Destroy just reverts settings:
        <ul className="mt-2 space-y-1 list-disc ml-4">
          <li><code>okta_security_notification_emails</code> — all notification flags reset to <code>true</code></li>
          <li><code>okta_threat_insight_settings</code> — action reset to <code>none</code></li>
        </ul>
      </Caution>

      <H3>What to do instead</H3>
      <P>
        For no-op resources, removing them from your Terraform config and running{' '}
        <code className="bg-gray-100 px-1 rounded">terraform state rm</code> will drop them from
        state without touching Okta. To actually change the settings, update the resource attributes
        and apply — or manage the settings directly in the Okta Admin Console.
      </P>
    </>
  );
}

function OieVsClassicContent() {
  return (
    <>
      <P>
        Some resources only work on Okta Identity Engine (OIE) orgs. On Classic orgs, these will
        return <strong>404 errors</strong> or fail silently — not a configuration mistake.
      </P>

      <div className="overflow-x-auto my-3">
        <table className="w-full text-xs border border-gray-200 rounded">
          <thead className="bg-gray-50">
            <tr>
              <th className="text-left p-2 font-medium text-gray-600">Resource</th>
              <th className="text-left p-2 font-medium text-gray-600">OIE Only?</th>
              <th className="text-left p-2 font-medium text-gray-600">Why</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            <tr><td className="p-2 font-mono">okta_policy_device_assurance_*</td><td className="p-2 text-red-600 font-medium">OIE only</td><td className="p-2">Device assurance policies require OIE</td></tr>
            <tr><td className="p-2 font-mono">okta_app_signon_policy</td><td className="p-2 text-red-600 font-medium">OIE only</td><td className="p-2">App-level sign-on policies are OIE feature</td></tr>
            <tr><td className="p-2 font-mono">okta_app_signon_policy_rule</td><td className="p-2 text-red-600 font-medium">OIE only</td><td className="p-2">Same as above</td></tr>
            <tr><td className="p-2 font-mono">okta_app_signon_policy_rules</td><td className="p-2 text-red-600 font-medium">OIE only</td><td className="p-2">Same as above</td></tr>
            <tr><td className="p-2 font-mono">okta_entity_risk_policy</td><td className="p-2 text-red-600 font-medium">OIE only</td><td className="p-2">Entity risk requires OIE + Risk Scoring</td></tr>
            <tr><td className="p-2 font-mono">okta_entity_risk_policy_rule</td><td className="p-2 text-red-600 font-medium">OIE only</td><td className="p-2">Same as above</td></tr>
            <tr><td className="p-2 font-mono">okta_session_violation_policy</td><td className="p-2 text-red-600 font-medium">OIE only</td><td className="p-2">Session violation detection requires OIE</td></tr>
            <tr><td className="p-2 font-mono">okta_session_violation_policy_rule</td><td className="p-2 text-red-600 font-medium">OIE only</td><td className="p-2">Same as above</td></tr>
            <tr><td className="p-2 font-mono">okta_post_auth_session_policy_rule</td><td className="p-2 text-red-600 font-medium">OIE only</td><td className="p-2">Continuous access evaluation requires OIE</td></tr>
            <tr><td className="p-2 font-mono">okta_authenticator</td><td className="p-2 text-amber-600 font-medium">OIE preferred</td><td className="p-2">Works on Classic but with limited authenticator options</td></tr>
            <tr><td className="p-2 font-mono">okta_app_access_policy_assignment</td><td className="p-2 text-red-600 font-medium">OIE only</td><td className="p-2">Access policies are OIE feature</td></tr>
            <tr><td className="p-2 font-mono">okta_realm</td><td className="p-2 text-red-600 font-medium">OIE only</td><td className="p-2">Realms require OIE</td></tr>
            <tr><td className="p-2 font-mono">okta_realm_assignment</td><td className="p-2 text-red-600 font-medium">OIE only</td><td className="p-2">Same as above</td></tr>
            <tr><td className="p-2 font-mono">okta_identity_source_*</td><td className="p-2 text-red-600 font-medium">OIE only</td><td className="p-2">Profile sourcing requires OIE</td></tr>
          </tbody>
        </table>
      </div>

      <Caution>
        The provider returns <code className="bg-amber-100 px-1 rounded">404</code> or a diagnostic
        error for OIE-only resources on Classic orgs — not a Terraform bug. Verify your org type in
        the Okta Admin Console under{' '}
        <strong>Settings &rarr; Account &rarr; Okta Identity Engine</strong>.
      </Caution>
    </>
  );
}

export default function ResourceLimitations() {
  const [activeSection, setActiveSection] = useState<SectionId>('import-support');
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const scrollTo = useCallback((id: SectionId) => {
    setActiveSection(id);
    sectionRefs.current[id]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  return (
    <div className="flex gap-4">
      {/* Sidebar nav */}
      <div className="w-44 flex-shrink-0">
        <nav className="sticky top-0 space-y-0.5">
          {SECTIONS.map(section => (
            <button
              key={section.id}
              onClick={() => scrollTo(section.id)}
              className={`w-full text-left px-2 py-1.5 text-xs rounded transition-colors ${
                activeSection === section.id
                  ? 'bg-surface-3 text-accent-teal font-medium'
                  : 'text-text-muted hover:text-text-secondary hover:bg-surface-2'
              }`}
            >
              {section.title}
            </button>
          ))}
        </nav>
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0 space-y-8">
        {SECTIONS.map(section => (
          <div
            key={section.id}
            ref={el => { sectionRefs.current[section.id] = el; }}
          >
            <h2 className="text-base font-semibold text-gray-800 mb-3 pb-2 border-b border-gray-200">
              {section.title}
            </h2>
            {section.id === 'import-support' && <ImportSupportContent />}
            {section.id === 'destroy-behavior' && <DestroyBehaviorContent />}
            {section.id === 'oie-vs-classic' && <OieVsClassicContent />}
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add "Resource Limitations" tab to `src/renderer/components/LearnSection.tsx`**

Replace the entire file with:

```typescript
import React, { useState } from 'react';
import BestPractices from './BestPractices';
import ResourceLimitations from './ResourceLimitations';

type LearnTab = 'best-practices' | 'resource-limitations';

const TABS: { id: LearnTab; label: string }[] = [
  { id: 'best-practices', label: 'Best Practices' },
  { id: 'resource-limitations', label: 'Resource Limitations' },
];

export default function LearnSection() {
  const [activeTab, setActiveTab] = useState<LearnTab>('best-practices');

  return (
    <div className="space-y-4">
      {/* Tab bar */}
      <div className="flex gap-1 bg-surface-2 border border-border rounded-lg p-1 w-fit">
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-1.5 text-xs font-medium rounded-md transition-colors ${
              activeTab === tab.id
                ? 'bg-surface-4 text-accent-teal shadow-glow-sm'
                : 'text-text-muted hover:text-text-secondary'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'best-practices' && <BestPractices />}
      {activeTab === 'resource-limitations' && <ResourceLimitations />}
    </div>
  );
}
```

- [ ] **Step 3: TypeScript compile check**

```bash
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/components/ResourceLimitations.tsx src/renderer/components/LearnSection.tsx
git commit -m "feat: add Resource Limitations tab to Learn section (import IDs, destroy behavior, OIE vs Classic)"
```

---

## Task 6: Final validation

**Files:**
- No changes — verification only

- [ ] **Step 1: Run full test suite**

```bash
npm test -- --no-coverage
```

Expected: All tests pass. At minimum the new tests from Task 1 must pass.

- [ ] **Step 2: TypeScript compile check**

```bash
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 3: Verify no wrong attribute names remain anywhere**

```bash
node -e "
const fs = require('fs');
const path = require('path');
const wrong = ['stay_signed_in_consent', 'password_breached_action', '600 req/min', '100 req/min'];
const files = [
  'src/shared/versions.ts',
  'src/main/api/claude.ts',
  'src/renderer/components/ResourceLimitations.tsx',
];
let clean = true;
files.forEach(f => {
  const c = fs.readFileSync(f, 'utf8');
  wrong.forEach(w => {
    if (c.includes(w)) {
      console.error('FOUND:', w, 'in', f);
      clean = false;
    }
  });
});
if (clean) console.log('All clear');
"
```

Expected: `All clear`

- [ ] **Step 4: Git log check**

```bash
git log --oneline -6
```

Expected: 4 task commits visible (versions.ts, claude.ts prompts, IPC layer, UI component).

---

## Self-Review

**Spec coverage:**
- ✅ Wrong attribute names fixed (stay_signed_in_consent, password_breached_action, keep_me_signed_in boolean) — Task 2
- ✅ Full HCL examples for WebAuthn custom AAGUID/method — Task 2
- ✅ Full HCL examples for v6.13 IAM resource set — Task 2
- ✅ Import IDs for 8 new resources — Task 3
- ✅ Non-importable resource list — Task 3
- ✅ Non-deletable resource section in SOLUTION_SYSTEM_PROMPT — Task 3
- ✅ Hardcoded rate limits removed from LOG_SYSTEM_PROMPT — Task 3
- ✅ buildRateLimitContext with 3-tier priority — Task 4
- ✅ IPC signature updated (ipc-handlers.ts, preload.ts, LogAnalyzer.tsx) — Task 4
- ✅ ResourceLimitations component with all 3 sections — Task 5
- ✅ LearnSection tab added — Task 5
- ✅ v6.13 customRoles entry in VERSION_RESOURCE_ADDITIONS — Task 2 Step 7

**Placeholder scan:** No TBDs. All code is complete and concrete.

**Type consistency:**
- `buildRateLimitContext(analysis: LogAnalysis, probeResult?: ProbeResult)` — used consistently in Task 4
- `ProbeResult` imported from `'../../shared/types'` in claude.ts — matches existing import path for `LogAnalysis`
- `interpretLog(analysis, probeResult?)` — Task 4 Steps 1 and 2 agree
- IPC params object `{ analysis: LogAnalysis; probeResult?: ProbeResult }` — consistent across ipc-handlers.ts (Task 4 Step 3) and preload.ts (Task 4 Step 4) and LogAnalyzer.tsx (Task 4 Step 5)
