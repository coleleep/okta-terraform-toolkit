# Okta Terraform Provider v6.12.0 + AI Prompt Audit — Design Spec

**Date:** 2026-06-10
**Author:** Nicole Pendill (with Claude)
**Status:** Approved for plan-writing

## Summary

Add support for Okta Terraform Provider v6.12.0 to OTTO, and audit all Claude-powered features so they provide version-aware, up-to-date insight that stays sustainable as the provider evolves. Delivered in three incremental phases.

## Goals

1. OTTO recognizes v6.12.0 as a supported provider version and surfaces its new resources/attributes in the resource picker, solution builder, and conversion features.
2. AI prompts know what bugs were fixed in which versions and can recommend upgrades when the user hits a known issue.
3. Future provider releases require only adding entries to a structured data file — no prompt rewrites.

## Non-Goals (YAGNI)

- Backfilling bug fixes prior to v6.10.0. Customers running ≤ v6.9 are advised to upgrade unconditionally; per-bug detection adds little value there.
- Source-vs-target version compatibility checking in `convertConfig`. Worth doing later, but adds significant prompt complexity for marginal current-day payoff.
- Auto-detection of the provider version from log content. Renderer pushes the user-selected version through; if unset, prompts degrade gracefully.
- Refactoring the existing base prompts. We layer version context onto them, not rewrite them.

## v6.12.0 Changelog (Released 2026-06-10)

**New data sources:**
- `okta_signon_policy_rule`
- `okta_auth_server_policy_rule` (data-source variant; resource version exists)
- `okta_assignees_users`

**New attributes:**
- `okta_app_oauth.backchannel_custom_authenticator_id` (CIBA support)
- `okta_app_signon_policy_rules.keep_me_signed_in`

**Bug fixes:**
- `okta_idp_saml`, `okta_idp_social`, `okta_idp_oidc` — nil pointer when `accountLink.filter.groups` is null (PR #2843)
- `okta_authenticator` — validation error when updating WebAuthn authenticators (PR #2763)
- `okta_policy_password` — `groups_included` field being ignored (PR #2856)
- `okta_app_signon_policy_rules` — works in orgs without Risk Scoring (PR #2858)
- Doc fixes for `okta_request_setting_resource` and `okta_request_setting_organization`

**Provider behavior:**
- Deferred 429 retries to SDK for DPoP requests, improving rate-limit handling for DPoP-bound traffic (PR #2841)

**No deprecations. No breaking changes.**

## Architecture

### New types (in `src/shared/versions.ts`)

```typescript
interface ErrorSignature {
  status?: number;                     // HTTP status (400, 403, 429, etc.)
  pathPattern?: RegExp;                // URL path pattern
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  oktaErrorCode?: string;              // "E0000007"
  messagePattern?: RegExp;             // Error message content
  resourceType?: string;               // "okta_idp_saml"
  operation?: 'create' | 'read' | 'update' | 'delete' | 'import' | 'plan' | 'apply';
  stackFragment?: string;              // "nil pointer dereference"
  providerErrorPattern?: RegExp;       // /context deadline exceeded/
}

interface VersionBugFix {
  id: string;                          // PR# or descriptive slug
  description: string;
  resourceTypes: string[];
  signatures?: ErrorSignature[];       // Multiple = OR. Fields within one = AND.
  fixedIn: string;                     // "6.12.0"
  introducedIn?: string;
  workaround?: string;
}

interface VersionDeprecation {
  resource?: string;
  attribute?: string;
  deprecatedIn: string;
  removedIn?: string;
  replacement?: string;
  description: string;
}

interface VersionKnownIssue {
  id: string;
  description: string;
  affectedVersions: string[];
  errorSignatures?: ErrorSignature[];
  workaround?: string;
}
```

**Constraint:** signatures require at least two specified fields to be valid. Single-field signatures are rejected at construction time to avoid false positives.

**Backfill:** `VERSION_BUG_FIXES` populated for v6.10.0, v6.11.0, v6.12.0 from changelogs.
`VERSION_DEPRECATIONS` and `VERSION_KNOWN_ISSUES` initialized empty (none present in 6.10–6.12 range).

### New module (`src/shared/version-context.ts`)

Pure helper functions, no Electron dependencies, fully unit-testable:

- `getBugsFixedSinceVersion(currentVersion: string): VersionBugFix[]` — bugs fixed in versions newer than the given one.
- `getBugsAffectingVersion(currentVersion: string): VersionBugFix[]` — bugs that exist in this version (not yet fixed).
- `findBugByErrorSignature(errorText: string, currentVersion?: string): VersionBugFix | null` — pattern-match a free-text error against known signatures; when multiple bugs match, returns the one whose signature matched the most specified fields (most-specific wins). Ties broken by `fixedIn` version (newest first).
- `getDeprecationsForVersion(currentVersion: string): VersionDeprecation[]` — deprecations relevant to the given version.
- `formatBugFixContext(currentVersion: string, relevantResourceTypes?: string[]): string` — formatted system-prompt string. Optional resource filter keeps token cost down.

### Pre-screen + LLM hybrid pattern

The core pattern for `decodeError` and `interpretLog`:

1. Run user's error text through `findBugByErrorSignature` for a deterministic match.
2. Build a system prompt that includes:
   - Base prompt (existing, mostly unchanged)
   - Version context block from `formatBugFixContext`
   - Pre-screen result if any ("DETECTED BUG: …")
3. Call Claude. The LLM enriches the deterministic match (or stands alone if no match found).
4. Return the structured result with the `bugMatch` / `bugMatches` field populated when applicable.

This reduces hallucination — pre-screen provides ground truth the LLM can quote rather than recall from training.

## Phase 1: v6.12 Mechanical Update + Version Data Foundation

### Files modified

**`src/shared/versions.ts`:**
- Add `'6.12.0'` to `SUPPORTED_VERSIONS`.
- Set `DEFAULT_VERSION = '6.12.0'`.
- Add `VERSION_RESOURCE_ADDITIONS['6.12.0']` covering 3 new data sources + 2 new attributes.
- Add `VERSION_ATTRIBUTE_NOTES['6.12.0']` covering DPoP retry deferral, CIBA backchannel, keep_me_signed_in, and bug-fix highlights.
- Define `ErrorSignature`, `VersionBugFix`, `VersionDeprecation`, `VersionKnownIssue` types.
- Define `VERSION_BUG_FIXES` (Record keyed by version), backfilled for v6.10.0, v6.11.0, v6.12.0.
- Define empty `VERSION_DEPRECATIONS` and `VERSION_KNOWN_ISSUES`.

**`src/shared/resource-dictionary.ts`:**
- Add `okta_signon_policy_rule` (data source, `parentType: 'policies'`, `sinceVersion: '6.12.0'`, `primaryEndpoint: '/api/v1/policies/{policyId}/rules/{ruleId}'`).
- Add `okta_auth_server_policy_rule` (data source, `parentType: 'authServers'`, `sinceVersion: '6.12.0'`).
- Add `okta_assignees_users` (data source, `parentType: 'users'`, `sinceVersion: '6.12.0'`).

**`README.md`:**
- "6.6.1 through 6.12.0 (default)" line update.
- No new resource categories — these are data sources only.

### Files created

**`src/shared/version-context.ts`** — five helper functions described in Architecture.

**`src/__tests__/provider-v6.12.0.test.ts`** — version registration, dictionary entries, type checks (~10 tests, mirrors `provider-v6.11.0.test.ts`).

**`src/__tests__/version-context.test.ts`** — helper-function unit tests covering version comparison, signature matching across all `ErrorSignature` field combinations, edge cases for missing/unknown versions (~15 tests).

### Phase 1 acceptance

- `npm run build` compiles cleanly.
- `npm test` passes including new tests.
- Resource picker UI shows v6.12.0 in dropdown; selecting it surfaces the 3 new data sources.
- Existing AI features (interpretLog, decodeError, etc.) continue working unchanged — no behavior change yet.

## Phase 2: decodeError + interpretLog Audit

### Files modified

**`src/main/api/claude.ts`:**

`decodeError`:
- Signature changes from `(errorText: string)` to `(errorText: string, currentVersion?: string)`.
- Pre-screen via `findBugByErrorSignature` when `currentVersion` provided.
- System prompt extended with `formatBugFixContext(currentVersion)` and a "DETECTED BUG" block when pre-screen matched.
- Return type adds optional `bugMatch?: { id, description, fixedIn, workaround? }`.

`interpretLog`:
- Signature changes from `(analysis: LogAnalysis)` to `(analysis: LogAnalysis, currentVersion?: string)`.
- Iterate over parsed errors in `LogAnalysis`, run each through `findBugByErrorSignature`, collect matches. Dedupe by `bugFix.id` so the same bug appearing across multiple log lines surfaces once.
- System prompt extended with version context plus accumulated `bugMatches[]`.
- Return type `ClaudeInterpretation` adds optional `bugMatches?: Array<{ id, description, fixedIn, workaround? }>`.

DPoP rate-limit knowledge added to base `LOG_SYSTEM_PROMPT` (small, version-agnostic addition — DPoP behavior matters regardless of version).

**`src/shared/types.ts`:**
- `ClaudeInterpretation` and `ErrorDecoderResult` types updated with new optional fields.

**`src/main/ipc-handlers.ts`:**
- `claude:interpret-log` and `claude:decode-error` handlers accept and forward `currentVersion`.

**`src/preload.ts`:**
- Bridge signatures updated.

**`src/renderer/components/LogAnalyzer.tsx`** (and any error-decoder UI):
- Pull `currentVersion` from Zustand store, pass through.
- Render `bugMatch` / `bugMatches` prominently when present (e.g., callout banner: "Known bug detected — fixed in v6.X.0").

### Phase 2 acceptance

- Pasting a synthetic error matching a v6.10.0 bug signature, with `currentVersion = '6.10.0'`, produces a `bugMatch` field in the response.
- Same paste with `currentVersion = '6.12.0'` (post-fix version) does not produce a `bugMatch`.
- LogAnalyzer UI renders the "Known bug" callout when matches exist.
- Existing un-versioned callers (legacy code, tests) continue to work — backward compat verified.

## Phase 3: generateSolution + convertConfig Audit

### Files modified

**`src/main/api/claude.ts`:**

`generateSolution`:
- Already takes `providerVersion`. System prompt extended with:
  - `formatBugFixContext(providerVersion)` filtered by resources Claude is generating.
  - `getBugsAffectingVersion(providerVersion)` — bugs in user's version that touch resources in this workload.
  - `getDeprecationsForVersion(providerVersion)` — deprecated patterns to avoid.
- `SolutionResult` type adds optional `knownIssues?: Array<{ id, description, resourceTypes }>` and `deprecationsAvoided?: string[]`.

`convertConfig`:
- New optional parameter `currentVersion?: string` (target org version).
- System prompt extended with version context.
- New warnings flow into existing `warnings[]` array (no schema change).

**`src/shared/types.ts`:**
- `SolutionResult` updated.

**Renderer components calling these:**
- Pass `currentVersion` from Zustand.
- Render new `knownIssues` / `deprecationsAvoided` fields where they exist.

### Phase 3 acceptance

- `generateSolution` with v6.10.0 returns `knownIssues` populated when the requested workload uses affected resource types.
- `convertConfig` warnings include version-aware notes when target version is set.
- Token cost on `generateSolution` increases by less than ~1500 tokens per call (verified by logging input token count before/after).

## Testing Strategy

- **Unit tests (~30):** pure helper functions in `version-context.ts`. Highest coverage for the lowest cost.
- **Snapshot tests (~10):** assert system-prompt output structure for given (version, error text) inputs.
- **Integration tests (~6):** mock the Anthropic SDK, verify each prompt receives expected version context. No real API calls.
- **No E2E tests for Claude responses** — non-deterministic, expensive. Manual smoke per phase.
- **Test fixtures:** a JSON file of realistic error texts mapped to v6.10/v6.11/v6.12 bug signatures. Reused across unit and integration tests.

## Risks and Mitigations

1. **Token cost creep** — version context adds ~500–1500 tokens per call. Mitigation: `formatBugFixContext` accepts an optional `relevantResourceTypes[]` filter. Heavy-context prompts (`generateSolution`, `convertConfig`) pass only the resources their request touches.
2. **False positives in pre-screen** — loose signatures could match unrelated errors. Mitigation: signatures require at least two specified fields. Single-field signatures rejected at construction time.
3. **Stale data over time** — same problem we have today, just with more surface area. Mitigation: documented "release procedure" — when a new version ships, add `SUPPORTED_VERSIONS` entry, populate `VERSION_BUG_FIXES['x.y.z']` from the changelog, run tests. ~30-min mechanical process per release.
4. **Version detection gaps** — `interpretLog` and `decodeError` require version threaded from the renderer. Mitigation: optional parameter; prompts gracefully degrade to non-version-aware behavior when unset.
5. **LLM hallucination on bug fixes** — Claude could invent versions or fixes. Mitigation: pre-screen result is ground truth the LLM is instructed to quote rather than recall from training.

## Future Work (Deferred)

- Source/target version divergence in `convertConfig` — warn when source uses 6.12-only attributes against an older target.
- Auto-detect provider version from log content when renderer doesn't pass one.
- Crowd-sourced bug-fix entries from customer escalations (would require a separate intake process).
- Backfill bug fixes for v6.6.1 through v6.9.x (low priority; recommendation for those users is "upgrade").

## Implementation Order

1. **Phase 1** ships first. Lands the foundation. No user-visible AI behavior change.
2. **Phase 2** ships second. First user-visible payoff — known bugs surface in error decoder and log analyzer.
3. **Phase 3** ships third. Solution builder and sync conversion gain version awareness.

Each phase is independently shippable. Stopping after Phase 2 leaves a meaningful improvement; Phase 3 polishes the rest.
