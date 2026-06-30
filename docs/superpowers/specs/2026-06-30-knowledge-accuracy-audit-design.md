# OTTO Knowledge Accuracy Audit — Design Spec

**Goal:** Fix all inaccurate provider knowledge embedded in OTTO's AI prompts, HCL templates, and UI — reconciled against provider v6.13.0 source.

**Architecture:** Six targeted file changes. No new data models. Rate limit context is built per-call in the IPC handler using a 3-tier priority based on data already flowing through the system.

**Tech Stack:** TypeScript, React, Electron IPC.

---

## Problem Summary

After reconciling against the provider v6.13.0 Go source, the following inaccuracies were found:

### Wrong attribute names that generate broken HCL
| OTTO has | Correct (from provider source) |
|---|---|
| `stay_signed_in_consent = "ALLOWED"` on `okta_app_signon_policy_rule` | `keep_me_signed_in` block with `post_auth` (ALLOWED\|NOT_ALLOWED) and `post_auth_prompt_frequency` (ISO 8601 duration) |
| `password_breached_action = "WARN"` on `okta_policy_password` | Three attributes: `breached_password_logout_enabled` (bool), `breached_password_expire_after_days` (int 0–10), `breached_password_delegated_workflow_id` (string) |
| `keep_me_signed_in = true` (boolean) in v6.12 template | Block syntax, same structure as above |

### Missing import ID formats in convert prompt
Eight new resources added in v6.11–v6.13 have no import ID documentation in the AI prompt.

### Non-importable and non-deletable resources undocumented
Three resources don't support `terraform import`. Nine resources have no-op `terraform destroy`. Two more reset to defaults instead of deleting. None of this is surfaced to users.

### Rate limit numbers are hardcoded and wrong
LOG_SYSTEM_PROMPT hardcodes "600/min for most endpoints, 100/min for app user/group endpoints." These numbers are Okta developer-tier defaults, don't appear anywhere in the provider source, and vary by org tier. Rate limit headers ARE captured in TF_LOG=DEBUG output and already parsed by the log parser — they should drive the analysis.

---

## Design

### 1. `src/shared/versions.ts` — Fix wrong attributes + full HCL examples

**Fix `stay_signed_in_consent` (v6.11.0 applications config):**
```hcl
# App sign-on policy rule: keep me signed in (v6.11.0+)
# resource "okta_app_signon_policy_rule" "example" {
#   policy_id   = okta_app_signon_policy.example.id
#   name        = "Default Rule"
#   factor_mode = "1FA"
#   type        = "ASSURANCE"
#
#   keep_me_signed_in {
#     post_auth                  = "ALLOWED"    # ALLOWED or NOT_ALLOWED
#     post_auth_prompt_frequency = "P30D"        # ISO 8601 duration (e.g. P7D, P30D)
#   }
# }
```

**Fix `keep_me_signed_in = true` (v6.12.0 applications config):**
```hcl
# keep_me_signed_in {
#   post_auth                  = "ALLOWED"
#   post_auth_prompt_frequency = "P30D"
# }
```

**Fix `password_breached_action` (v6.11.0 policies config):**
```hcl
# resource "okta_policy_password" "example" {
#   name   = "Password Policy"
#   status = "ACTIVE"
#   breached_password_logout_enabled       = true   # terminate sessions immediately on breach
#   breached_password_expire_after_days    = 0       # 0 = immediate expiry (0–10)
#   breached_password_delegated_workflow_id = ""     # optional: Okta Workflow ID to trigger
# }
```

**Fix attribute notes:**
- `'okta_app_signon_policy_rule: stay_signed_in_consent attribute added'` → `'okta_app_signon_policy_rule: keep_me_signed_in block added (post_auth: ALLOWED|NOT_ALLOWED, post_auth_prompt_frequency: ISO 8601 duration)'`
- `'okta_policy_password: password_breached_action attribute added (NONE, WARN, BLOCK)'` → `'okta_policy_password: breached_password_logout_enabled, breached_password_expire_after_days, breached_password_delegated_workflow_id attributes added'`

**Add full HCL examples for new resources (v6.11.0 authenticators config):**
```hcl
# WebAuthn custom AAGUID allowlist entry (v6.11.0+)
# resource "okta_authenticator_webauthn_custom_aaguid" "yubikey" {
#   authenticator_id = okta_authenticator.webauthn.id
#   aaguid           = "fa2b99dc-9e39-4257-8f92-4a30d23c4118"
#   name             = "YubiKey 5"
# }
# # Import: terraform import okta_authenticator_webauthn_custom_aaguid.yubikey <authenticator_id>/<aaguid>
#
# WebAuthn authenticator method settings (v6.11.0+)
# resource "okta_authenticator_method_webauthn" "example" {
#   authenticator_id = okta_authenticator.webauthn.id
#   status           = "ACTIVE"
# }
# # Import: terraform import okta_authenticator_method_webauthn.example <authenticator_id>
```

**Add full HCL examples for new resources (v6.11.0 identitySources config):**
```hcl
# resource "okta_identity_source_group" "example" {
#   identity_source_id = "<identity_source_id>"
#   name               = "My Group"
#   # Import: terraform import okta_identity_source_group.example <identity_source_id>/<id>
# }
#
# resource "okta_identity_source_user" "example" {
#   identity_source_id = "<identity_source_id>"
#   external_id        = "user-external-id"
#   # Import: terraform import okta_identity_source_user.example <identity_source_id>/<id>
# }
#
# resource "okta_identity_source_group_membership" "example" {
#   identity_source_id = "<identity_source_id>"
#   group_id           = okta_identity_source_group.example.id
#   user_id            = okta_identity_source_user.example.id
#   # Import (3-part ID): terraform import okta_identity_source_group_membership.example <identity_source_id>/<group_or_external_id>/<id>
# }
#
# resource "okta_identity_source_import" "trigger" {
#   identity_source_id = "<identity_source_id>"
#   # NOTE: does not support import or destroy
# }
```

**Add full HCL examples (v6.13.0 governance config):**
```hcl
# resource "okta_label" "example" {
#   name = "Finance Apps"
#   # Import: terraform import okta_label.example <id>
# }
#
# resource "okta_resource_owner" "example" {
#   resource_id   = okta_app_oauth.my_app.id
#   resource_type = "APP"
#   owner_id      = okta_user.admin.id
#   # NOTE: does not support import or destroy
# }
```

---

### 2. `src/main/api/claude.ts` — Rate limits, import IDs, non-importable/non-deletable

#### Rate limit context (replaces hardcoded numbers)

New function `buildRateLimitContext(analysis, probeResult?)`:

```typescript
function buildRateLimitContext(analysis: LogAnalysis, probeResult?: ProbeResult): string {
  const observed = analysis.endpoints.filter(e => e.minRateLimit > 0);
  if (observed.length > 0) {
    const lines = observed.map(e =>
      `${e.pattern}: limit=${e.minRateLimit}/window, lowest_remaining=${e.lowestRemaining}`
    );
    return `ORG RATE LIMITS (from X-Rate-Limit-Limit headers in this log run):\n${lines.join('\n')}\nUse these exact values in your analysis — they are org-specific.`;
  }
  if (probeResult) {
    const lines = probeResult.endpoints
      .filter(e => e.limit > 0)
      .map(e => `${e.endpoint}: limit=${e.limit}/window`);
    return `ORG RATE LIMITS (from org probe — log did not include rate limit headers; re-run with TF_LOG=DEBUG for log-specific data):\n${lines.join('\n')}`;
  }
  return `ORG RATE LIMITS: Not available from this log (no X-Rate-Limit-Limit headers; re-run with TF_LOG=DEBUG) and no probe data. Documented Okta developer-tier defaults: ~600/min for most management endpoints, ~100/min for app user/group assignment endpoints (/api/v1/apps/{id}/users, /api/v1/apps/{id}/groups). Actual limits vary by org tier — treat these as rough estimates only.`;
}
```

Replace the hardcoded RATE LIMITING section in `LOG_SYSTEM_PROMPT`:
```
RATE LIMITING & BACKOFF:
- Org rate limits are endpoint-specific and provided below (org-specific data takes precedence over any generic defaults)
- 429 responses mean the rate limit was hit; the provider retries with exponential backoff (min_wait → max_wait)
- max_api_capacity (0-100) controls proactive throttling: provider sleeps when Remaining/Limit < capacity%. Prevents 429s but can cause deadline errors if request_timeout is too low
- If rate limit data shows low limits (< 200/window), recommend lower parallelism and max_api_capacity=70
- Known-good config for low-limit endpoints (< 200/window): max_api_capacity=70, request_timeout=120, parallelism=4, min_wait_seconds=17, max_wait_seconds=90
```

Change `interpretLog` signature:
```typescript
export async function interpretLog(analysis: LogAnalysis, probeResult?: ProbeResult): Promise<ClaudeInterpretation>
```

Inject rate limit context in the call:
```typescript
const rateLimitContext = buildRateLimitContext(analysis, probeResult);
system: `${LOG_SYSTEM_PROMPT}\n\n${rateLimitContext}\n\n${scopeContext}`
```

#### Import ID section additions in `convertConfig` prompt

Add to the "Import ID formats for sub-resources" section:
```
- okta_authenticator_webauthn_custom_aaguid: authenticator_id/aaguid
- okta_authenticator_method_webauthn: authenticator_id
- okta_identity_source_group: identity_source_id/id
- okta_identity_source_group_membership: identity_source_id/group_or_external_id/id  (3-part — note the unusual format)
- okta_identity_source_user: identity_source_id/id
- okta_app_signon_policy_rules: policy_id
- okta_app_signon_policy: id
- okta_label: id
```

Add new section "Resources that do NOT support import":
```
RESOURCES THAT DO NOT SUPPORT TERRAFORM IMPORT (do not generate import blocks for these):
- okta_trusted_server — ImportState explicitly disabled
- okta_resource_owner — no import support
- okta_identity_source_import — no import support
```

#### Non-deletable resources in `SOLUTION_SYSTEM_PROMPT`

Add new section after POLICY RULE PRIORITY MANAGEMENT:
```
RESOURCES WHERE TERRAFORM DESTROY HAS NO EFFECT:
These resources have no-op delete implementations — terraform destroy removes them from state only, no API call:
- okta_org_configuration (singleton — manages existing org settings)
- okta_policy_mfa_default (default policy — cannot be deleted)
- okta_policy_password_default (default policy — cannot be deleted)
- okta_rate_limiting (provider warns: "This resource cannot be deleted via Terraform")
- okta_rate_limit_admin_notification_settings (provider warns: "Delete Not Supported")
- okta_rate_limit_warning_threshold_percentage (provider warns: "Delete Not Supported")
- okta_resource_owner (governance: provider warns "Delete Not Supported")
- okta_request_setting_organization (governance: provider warns "Delete Not Supported")
- okta_request_setting_resource (governance: provider warns "Delete Not Supported")

RESOURCES WHERE DESTROY RESETS TO DEFAULTS (not a true delete):
- okta_security_notification_emails — destroy resets all notification flags to true (Okta defaults)
- okta_threat_insight_settings — destroy resets action to 'none'

When generating solutions involving these resources: note that running terraform destroy will not remove the underlying configuration from Okta — it only removes the resource from Terraform state.
```

---

### 3. `src/main/ipc-handlers.ts` — Pass probe result to interpretLog

The `claude:interpret-log` IPC handler currently receives only `LogAnalysis`. Change it to accept an optional `probeResult`:

```typescript
ipcMain.handle('claude:interpret-log', async (_event, params: { analysis: LogAnalysis; probeResult?: ProbeResult }) => {
  const result = await interpretLog(params.analysis, params.probeResult);
  ...
});
```

---

### 4. `src/renderer/components/LogAnalyzer.tsx` — Pass probe result

The renderer calls `claude:interpret-log` with just the analysis. Update the call to include `probeResult` from the component's state (already stored when probe runs).

Change:
```typescript
window.oktaTerraform.interpretLog(analysis)
```
To:
```typescript
window.oktaTerraform.interpretLog({ analysis, probeResult: storedProbeResult ?? undefined })
```

Update the preload bridge signature to match.

---

### 5. `src/renderer/components/LearnSection.tsx` — Add tab

Add `'resource-limitations'` to `LearnTab` union and `TABS` array:
```typescript
type LearnTab = 'best-practices' | 'resource-limitations';
const TABS = [
  { id: 'best-practices', label: 'Best Practices' },
  { id: 'resource-limitations', label: 'Resource Limitations' },
];
```
Add render branch: `{activeTab === 'resource-limitations' && <ResourceLimitations />}`

---

### 6. `src/renderer/components/ResourceLimitations.tsx` — New component

Three sections, same sidebar-nav pattern as `BestPractices.tsx`:

**Section: Import Support**
Full table of all resource types with import ID format. Grouped:
- Composite IDs (multi-part, easy to get wrong)
- Simple IDs (just the resource ID)
- Not importable (with explanation why)

**Section: Destroy Behavior**
Table with three categories:
- True delete (API removes the resource)
- No-op (removes from state only, warns)
- Reset to defaults (API call, but resource is a singleton that can't be removed)

For each no-op resource: explain what `terraform destroy` actually does and the workaround (e.g., "manage the settings directly in the Okta Admin console").

**Section: OIE vs Classic**
Brief table of resources that only work on OIE orgs (device assurance policies, entity risk policy, session violation policy, post-auth session policy, etc.) — prevents a common support scenario where customers get 404s on Classic orgs.

---

### Also needs updating

`src/preload.ts` — the preload bridge exposes `interpretLog` to the renderer. Update its type signature from `(analysis: LogAnalysis) => Promise<ClaudeInterpretation>` to `(params: { analysis: LogAnalysis; probeResult?: ProbeResult }) => Promise<ClaudeInterpretation>`.

---

## What's Not Changing

- `src/shared/constants.ts` — `SUB_RESOURCE_SYNC_CONFIG` already uses correct resource names from earlier fix
- `src/shared/resource-dictionary.ts` — already fixed
- Rate limit numbers in `BestPractices.tsx` — those explain provider settings, not Okta-tier-specific numbers. No change needed.

---

## Testing

- Update `src/__tests__/provider-v6.11.0.test.ts` — add tests for correct keep_me_signed_in and breached password attribute names in VERSION_RESOURCE_ADDITIONS
- Update `src/__tests__/provider-v6.12.0.test.ts` — verify keep_me_signed_in is a block not a boolean in template
- No new IPC handler tests needed (change is additive — probeResult is optional)
- Manual: verify Learn tab renders with two tabs, ResourceLimitations component renders all three sections
