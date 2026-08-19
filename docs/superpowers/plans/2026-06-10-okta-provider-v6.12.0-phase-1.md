# Okta Provider v6.12.0 + Version Data Foundation — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add v6.12.0 provider support to OTTO and lay down the version-aware data structures (`VERSION_BUG_FIXES`, `VERSION_DEPRECATIONS`, `VERSION_KNOWN_ISSUES`) plus pure helper functions that Phases 2 and 3 will consume. No AI prompt behavior changes in this phase.

**Architecture:** Extend the existing single-source-of-truth pattern in `src/shared/versions.ts` with three new typed records. Add a new pure module `src/shared/version-context.ts` exposing five helper functions that prompts in later phases will call. Add three v6.12.0 data-source entries to `resource-dictionary.ts`.

**Tech Stack:** TypeScript, Jest (ts-jest), Electron, Node 18+

**Spec reference:** `docs/superpowers/specs/2026-06-10-okta-provider-v6.12.0-and-prompt-audit-design.md`

---

## File Structure

**Modified:**
- `src/shared/versions.ts` — extends `SUPPORTED_VERSIONS`, adds new types/records, new entries
- `src/shared/resource-dictionary.ts` — three data-source entries appended
- `README.md` — version line update

**New:**
- `src/shared/version-context.ts` — five pure helper functions
- `src/__tests__/provider-v6.12.0.test.ts` — version registration tests
- `src/__tests__/version-context.test.ts` — helper unit tests
- `src/__tests__/fixtures/error-signatures.ts` — shared test fixtures (synthetic errors mapped to known bug signatures)

---

## Task 1: Add v6.12.0 to SUPPORTED_VERSIONS + DEFAULT_VERSION

**Files:**
- Modify: `src/shared/versions.ts:1-3`
- Test: `src/__tests__/provider-v6.12.0.test.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/provider-v6.12.0.test.ts`:

```typescript
import {
  SUPPORTED_VERSIONS,
  DEFAULT_VERSION,
  VERSION_RESOURCE_ADDITIONS,
  VERSION_ATTRIBUTE_NOTES,
  getAdditionsForVersion,
  isAvailableIn,
} from '../shared/versions';
import { RESOURCE_DICTIONARY } from '../shared/resource-dictionary';

describe('v6.12.0 version registration', () => {
  it('includes 6.12.0 in SUPPORTED_VERSIONS', () => {
    expect(SUPPORTED_VERSIONS).toContain('6.12.0');
  });

  it('sets DEFAULT_VERSION to 6.12.0', () => {
    expect(DEFAULT_VERSION).toBe('6.12.0');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/__tests__/provider-v6.12.0.test.ts -t "v6.12.0 version registration"`
Expected: FAIL — "expected '6.11.0' to be '6.12.0'" or "Type '\"6.12.0\"' is not assignable…"

- [ ] **Step 3: Update versions.ts**

In `src/shared/versions.ts`, modify lines 1–3:

```typescript
export const SUPPORTED_VERSIONS = ['6.6.1', '6.7.0', '6.8.0', '6.9.0', '6.10.0', '6.11.0', '6.12.0'] as const;
export type ProviderVersion = (typeof SUPPORTED_VERSIONS)[number];
export const DEFAULT_VERSION: ProviderVersion = '6.12.0';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/__tests__/provider-v6.12.0.test.ts -t "v6.12.0 version registration"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git checkout -b feat/okta-provider-v6.12.0
git add src/shared/versions.ts src/__tests__/provider-v6.12.0.test.ts
git commit -m "feat(versions): register v6.12.0 as supported and default"
```

---

## Task 2: Add VERSION_RESOURCE_ADDITIONS['6.12.0']

**Files:**
- Modify: `src/shared/versions.ts:41-276` (add new entry to record)
- Test: `src/__tests__/provider-v6.12.0.test.ts`

- [ ] **Step 1: Add tests**

Append to `src/__tests__/provider-v6.12.0.test.ts`:

```typescript
describe('v6.12.0 resource additions', () => {
  it('has VERSION_RESOURCE_ADDITIONS entry for 6.12.0', () => {
    expect(VERSION_RESOURCE_ADDITIONS['6.12.0']).toBeDefined();
    expect(VERSION_RESOURCE_ADDITIONS['6.12.0'].length).toBeGreaterThan(0);
  });

  it('has applications addition for 6.12.0 (CIBA + keep_me_signed_in)', () => {
    const apps = VERSION_RESOURCE_ADDITIONS['6.12.0'].find((a) => a.type === 'applications');
    expect(apps).toBeDefined();
    expect(apps!.config).toMatch(/backchannel_custom_authenticator_id/);
    expect(apps!.config).toMatch(/keep_me_signed_in/);
  });

  it('getAdditionsForVersion includes 6.12.0 additions when version is 6.12.0', () => {
    const additions = getAdditionsForVersion('6.12.0');
    expect(additions.some((a) => a.config.includes('backchannel_custom_authenticator_id'))).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/__tests__/provider-v6.12.0.test.ts -t "v6.12.0 resource additions"`
Expected: FAIL — "VERSION_RESOURCE_ADDITIONS['6.12.0'] is undefined"

- [ ] **Step 3: Add 6.12.0 entry to VERSION_RESOURCE_ADDITIONS**

In `src/shared/versions.ts`, inside the `VERSION_RESOURCE_ADDITIONS` object literal (after the closing `]` of the `'6.11.0'` entry, before the `};` on line 276), add:

```typescript
  '6.12.0': [
    {
      type: 'applications',
      config: `
# CIBA backchannel authenticator support (v6.12.0+)
# resource "okta_app_oauth" "ciba_app" {
#   label                                 = "CIBA App"
#   type                                  = "service"
#   grant_types                           = ["urn:openid:params:grant-type:ciba"]
#   backchannel_custom_authenticator_id   = okta_authenticator.custom.id
# }

# Stay-signed-in option on app sign-on policy rule (v6.12.0+)
# resource "okta_app_signon_policy_rules" "example" {
#   policy_id          = okta_app_signon_policy.example.id
#   name               = "Default Rule"
#   keep_me_signed_in  = true   # Allow users to stay signed in (v6.12.0+)
# }
`,
    },
    {
      type: 'policies',
      config: `
# New data source: read existing sign-on policy rule by ID (v6.12.0+)
# data "okta_signon_policy_rule" "existing" {
#   policy_id = "<policy_id>"
#   id        = "<rule_id>"
# }

# New data source: read existing auth server policy rule by ID (v6.12.0+)
# data "okta_auth_server_policy_rule" "existing" {
#   auth_server_id = "<auth_server_id>"
#   policy_id      = "<policy_id>"
#   id             = "<rule_id>"
# }
`,
    },
    {
      type: 'users',
      config: `
# New data source: list users assignable to a resource (v6.12.0+)
# data "okta_assignees_users" "candidates" {
#   resource_id   = "<resource_id>"
#   resource_type = "APP"
# }
`,
    },
  ],
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/__tests__/provider-v6.12.0.test.ts -t "v6.12.0 resource additions"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/shared/versions.ts src/__tests__/provider-v6.12.0.test.ts
git commit -m "feat(versions): add v6.12.0 resource additions (CIBA, keep_me_signed_in, new data sources)"
```

---

## Task 3: Add VERSION_ATTRIBUTE_NOTES['6.12.0']

**Files:**
- Modify: `src/shared/versions.ts:281-316` (extend VERSION_ATTRIBUTE_NOTES record)
- Test: `src/__tests__/provider-v6.12.0.test.ts`

- [ ] **Step 1: Add tests**

Append to `src/__tests__/provider-v6.12.0.test.ts`:

```typescript
describe('v6.12.0 attribute notes', () => {
  it('has VERSION_ATTRIBUTE_NOTES entry for 6.12.0', () => {
    expect(VERSION_ATTRIBUTE_NOTES['6.12.0']).toBeDefined();
    expect(VERSION_ATTRIBUTE_NOTES['6.12.0'].length).toBeGreaterThan(0);
  });

  it('mentions DPoP rate limit deferral in 6.12.0 notes', () => {
    const notes = VERSION_ATTRIBUTE_NOTES['6.12.0'];
    expect(notes.some((n) => /DPoP/i.test(n))).toBe(true);
  });

  it('mentions backchannel_custom_authenticator_id in 6.12.0 notes', () => {
    const notes = VERSION_ATTRIBUTE_NOTES['6.12.0'];
    expect(notes.some((n) => n.includes('backchannel_custom_authenticator_id'))).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/__tests__/provider-v6.12.0.test.ts -t "v6.12.0 attribute notes"`
Expected: FAIL

- [ ] **Step 3: Add 6.12.0 entry to VERSION_ATTRIBUTE_NOTES**

In `src/shared/versions.ts`, inside `VERSION_ATTRIBUTE_NOTES` (before the closing `};` after the `'6.11.0'` entry):

```typescript
  '6.12.0': [
    'okta_app_oauth: backchannel_custom_authenticator_id attribute added (CIBA support)',
    'okta_app_signon_policy_rules: keep_me_signed_in attribute added',
    'New data source: okta_signon_policy_rule (read sign-on policy rules)',
    'New data source: okta_auth_server_policy_rule (read auth server policy rules)',
    'New data source: okta_assignees_users (list users assignable to a resource)',
    'Provider: 429 retries deferred to SDK for DPoP requests (improved rate-limit handling for DPoP-bound traffic)',
    'okta_idp_saml/social/oidc: nil pointer fix when accountLink.filter.groups is null',
    'okta_authenticator: WebAuthn update validation error fixed',
    'okta_policy_password: groups_included field is now respected',
    'okta_app_signon_policy_rules: now works in orgs without Risk Scoring enabled',
  ],
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/__tests__/provider-v6.12.0.test.ts -t "v6.12.0 attribute notes"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/shared/versions.ts src/__tests__/provider-v6.12.0.test.ts
git commit -m "feat(versions): add v6.12.0 attribute notes covering DPoP, CIBA, bug fixes"
```

---

## Task 4: Add three new data-source entries to resource-dictionary.ts

**Files:**
- Modify: `src/shared/resource-dictionary.ts` (insert before the closing `];` around line 224)
- Test: `src/__tests__/provider-v6.12.0.test.ts`

- [ ] **Step 1: Add tests**

Append to `src/__tests__/provider-v6.12.0.test.ts`:

```typescript
describe('v6.12.0 data source entries', () => {
  it('has okta_signon_policy_rule data source with sinceVersion 6.12.0', () => {
    const entry = RESOURCE_DICTIONARY.find(
      (r) => r.terraformResource === 'okta_signon_policy_rule' && r.description.toLowerCase().includes('data source'),
    );
    expect(entry).toBeDefined();
    expect(entry!.parentType).toBe('policies');
    expect(entry!.sinceVersion).toBe('6.12.0');
  });

  it('has okta_auth_server_policy_rule data source with sinceVersion 6.12.0', () => {
    const entry = RESOURCE_DICTIONARY.find(
      (r) => r.terraformResource === 'okta_auth_server_policy_rule' && r.description.toLowerCase().includes('data source'),
    );
    expect(entry).toBeDefined();
    expect(entry!.parentType).toBe('authServers');
    expect(entry!.sinceVersion).toBe('6.12.0');
  });

  it('has okta_assignees_users data source with sinceVersion 6.12.0', () => {
    const entry = RESOURCE_DICTIONARY.find(
      (r) => r.terraformResource === 'okta_assignees_users',
    );
    expect(entry).toBeDefined();
    expect(entry!.parentType).toBe('users');
    expect(entry!.sinceVersion).toBe('6.12.0');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/__tests__/provider-v6.12.0.test.ts -t "v6.12.0 data source entries"`
Expected: FAIL

- [ ] **Step 3: Add entries to resource-dictionary.ts**

In `src/shared/resource-dictionary.ts`, before the closing `];` at line 224 (after the `okta_identity_source` data source entry), append:

```typescript
  // ─── v6.12.0 data sources ───
  {
    terraformResource: 'okta_signon_policy_rule',
    description: 'Look up an existing sign-on policy rule data source',
    parentType: 'policies',
    parentLabel: 'Policies',
    sinceVersion: '6.12.0',
    primaryEndpoint: '/api/v1/policies',
    endpointLabel: 'Policies',
  },
  {
    terraformResource: 'okta_auth_server_policy_rule',
    description: 'Look up an existing auth server policy rule data source',
    parentType: 'authServers',
    parentLabel: 'Auth Servers',
    sinceVersion: '6.12.0',
    primaryEndpoint: '/api/v1/authorizationServers',
    endpointLabel: 'Auth Servers',
  },
  {
    terraformResource: 'okta_assignees_users',
    description: 'List users assignable to a resource data source',
    parentType: 'users',
    parentLabel: 'Users',
    sinceVersion: '6.12.0',
    primaryEndpoint: '/api/v1/users',
    endpointLabel: 'Users',
  },
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/__tests__/provider-v6.12.0.test.ts -t "v6.12.0 data source entries"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/shared/resource-dictionary.ts src/__tests__/provider-v6.12.0.test.ts
git commit -m "feat(dict): add v6.12.0 data sources (signon_policy_rule, auth_server_policy_rule, assignees_users)"
```

---

## Task 5: Add new types to versions.ts

**Files:**
- Modify: `src/shared/versions.ts` (add types after `getAttributeNotesForVersion` near line 343, before any new exports)

- [ ] **Step 1: Add type definitions**

In `src/shared/versions.ts`, append at the end of the file:

```typescript
/**
 * Structured shape for matching errors against known bug signatures.
 *
 * Multiple ErrorSignatures on a single bug are OR'd together (any can match).
 * All specified fields within a single ErrorSignature must match (AND).
 * Empty/undefined fields are wildcards.
 *
 * Constraint: a valid signature must have at least 2 specified fields.
 * This is enforced at runtime by `validateSignatures()`.
 */
export interface ErrorSignature {
  status?: number;
  pathPattern?: RegExp;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  oktaErrorCode?: string;
  messagePattern?: RegExp;
  resourceType?: string;
  operation?: 'create' | 'read' | 'update' | 'delete' | 'import' | 'plan' | 'apply';
  stackFragment?: string;
  providerErrorPattern?: RegExp;
}

export interface VersionBugFix {
  id: string;
  description: string;
  resourceTypes: string[];
  signatures?: ErrorSignature[];
  fixedIn: string;
  introducedIn?: string;
  workaround?: string;
}

export interface VersionDeprecation {
  resource?: string;
  attribute?: string;
  deprecatedIn: string;
  removedIn?: string;
  replacement?: string;
  description: string;
}

export interface VersionKnownIssue {
  id: string;
  description: string;
  affectedVersions: string[];
  errorSignatures?: ErrorSignature[];
  workaround?: string;
}

/**
 * Validate that every signature on every bug fix has at least 2 specified fields.
 * Throws on construction-time violations to prevent loose signatures landing in production.
 */
export function validateSignatures(fixes: VersionBugFix[]): void {
  for (const fix of fixes) {
    for (const sig of fix.signatures ?? []) {
      const specified = Object.values(sig).filter((v) => v !== undefined).length;
      if (specified < 2) {
        throw new Error(
          `VersionBugFix "${fix.id}" has a signature with only ${specified} specified field(s). At least 2 required.`,
        );
      }
    }
  }
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/shared/versions.ts
git commit -m "feat(versions): add ErrorSignature, VersionBugFix, VersionDeprecation, VersionKnownIssue types"
```

---

## Task 6: Add VERSION_BUG_FIXES with v6.12.0 entries

**Files:**
- Modify: `src/shared/versions.ts` (append below the new types from Task 5)

- [ ] **Step 1: Add v6.12.0 bug-fix data**

In `src/shared/versions.ts`, after the `validateSignatures` function:

```typescript
/**
 * Known bugs by version they were fixed in. The key is the `fixedIn` version.
 *
 * Sourced from Okta provider release notes:
 * https://github.com/okta/terraform-provider-okta/blob/master/CHANGELOG.md
 */
export const VERSION_BUG_FIXES: Record<string, VersionBugFix[]> = {
  '6.12.0': [
    {
      id: 'PR-2843',
      description: 'Nil pointer dereference in IdP resources when accountLink.filter.groups is null',
      resourceTypes: ['okta_idp_saml', 'okta_idp_social', 'okta_idp_oidc'],
      signatures: [
        {
          stackFragment: 'nil pointer',
          messagePattern: /accountLink.*filter.*groups/i,
        },
        {
          stackFragment: 'nil pointer dereference',
          resourceType: 'okta_idp_saml',
        },
      ],
      fixedIn: '6.12.0',
      workaround: 'Set accountLink.filter.groups to an empty list ([]) instead of null.',
    },
    {
      id: 'PR-2763',
      description: 'Validation error when updating WebAuthn authenticators',
      resourceTypes: ['okta_authenticator'],
      signatures: [
        {
          operation: 'update',
          messagePattern: /WebAuthn|webauthn/,
          resourceType: 'okta_authenticator',
        },
        {
          operation: 'update',
          status: 400,
          resourceType: 'okta_authenticator',
        },
      ],
      fixedIn: '6.12.0',
    },
    {
      id: 'PR-2856',
      description: 'groups_included field being ignored in okta_policy_password',
      resourceTypes: ['okta_policy_password'],
      signatures: [
        {
          resourceType: 'okta_policy_password',
          messagePattern: /groups_included/,
        },
      ],
      fixedIn: '6.12.0',
      workaround: 'Verify group assignments via the Okta admin console after apply.',
    },
    {
      id: 'PR-2858',
      description: 'okta_app_signon_policy_rules failing in orgs without Risk Scoring enabled',
      resourceTypes: ['okta_app_signon_policy_rules'],
      signatures: [
        {
          resourceType: 'okta_app_signon_policy_rules',
          messagePattern: /risk.scor/i,
        },
        {
          resourceType: 'okta_app_signon_policy_rules',
          status: 400,
          messagePattern: /risk/i,
        },
      ],
      fixedIn: '6.12.0',
    },
  ],
  '6.11.0': [],
  '6.10.0': [],
};

// Validate signatures at module load time. Throws if any signature has < 2 fields.
validateSignatures(Object.values(VERSION_BUG_FIXES).flat());
```

- [ ] **Step 2: Verify the file compiles and validation passes**

Run: `npx tsc --noEmit`
Expected: No errors. If `validateSignatures` throws on import, fix the offending signature before proceeding.

- [ ] **Step 3: Backfill v6.11.0 and v6.10.0 entries**

Fetch the full changelog and identify bug fixes for v6.11.0 and v6.10.0:

```bash
curl -s https://raw.githubusercontent.com/okta/terraform-provider-okta/master/CHANGELOG.md | sed -n '/^## 6\.11\.0/,/^## 6\.10\.0/p'
curl -s https://raw.githubusercontent.com/okta/terraform-provider-okta/master/CHANGELOG.md | sed -n '/^## 6\.10\.0/,/^## 6\.9/p'
```

For each bug fix in those changelogs (look for "BUG FIXES" sections), populate an entry in the `'6.11.0'` or `'6.10.0'` array following the same shape as v6.12.0 entries above.

For each entry:
- `id`: PR# from changelog (e.g., `'PR-2789'`) or descriptive slug
- `description`: copy the bug fix line
- `resourceTypes`: array of affected `okta_*` resource names mentioned
- `signatures`: at least one ErrorSignature with at least 2 specified fields. Patterns to use: regex on the error message text, status codes, resource type. Be conservative — when in doubt, omit.
- `fixedIn`: `'6.11.0'` or `'6.10.0'`
- `workaround`: optional, only when an obvious manual workaround exists

Target: ~5–10 entries for v6.11.0, ~5–10 for v6.10.0.

- [ ] **Step 4: Run tsc and validation**

Run: `npx tsc --noEmit`
Expected: No errors. Re-run if `validateSignatures` rejects any signature.

- [ ] **Step 5: Commit**

```bash
git add src/shared/versions.ts
git commit -m "feat(versions): backfill VERSION_BUG_FIXES for v6.10.0, v6.11.0, v6.12.0"
```

---

## Task 7: Initialize empty VERSION_DEPRECATIONS and VERSION_KNOWN_ISSUES

**Files:**
- Modify: `src/shared/versions.ts` (append after VERSION_BUG_FIXES)

- [ ] **Step 1: Add the records**

In `src/shared/versions.ts`, append at end of file:

```typescript
/**
 * Deprecated resources or attributes by version. Empty for v6.6.1–v6.12.0;
 * populated as the provider deprecates things in future releases.
 */
export const VERSION_DEPRECATIONS: VersionDeprecation[] = [];

/**
 * Known unfixed issues affecting one or more versions. Populate ad-hoc as
 * customer escalations surface bugs that haven't been fixed in any release.
 */
export const VERSION_KNOWN_ISSUES: VersionKnownIssue[] = [];
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/shared/versions.ts
git commit -m "feat(versions): initialize VERSION_DEPRECATIONS and VERSION_KNOWN_ISSUES (empty for now)"
```

---

## Task 8: Create version-context.ts with getBugsFixedSinceVersion

**Files:**
- Create: `src/shared/version-context.ts`
- Create: `src/__tests__/version-context.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/version-context.test.ts`:

```typescript
import { getBugsFixedSinceVersion } from '../shared/version-context';

describe('getBugsFixedSinceVersion', () => {
  it('returns bugs fixed in versions newer than the given one', () => {
    const bugs = getBugsFixedSinceVersion('6.10.0');
    expect(bugs.length).toBeGreaterThan(0);
    // every returned bug must be fixed in a version newer than 6.10.0
    expect(bugs.every((b) => b.fixedIn !== '6.10.0')).toBe(true);
  });

  it('returns empty array when current version is the latest', () => {
    const bugs = getBugsFixedSinceVersion('6.12.0');
    expect(bugs).toEqual([]);
  });

  it('returns all known bugs when version is unknown/older than tracked', () => {
    const bugs = getBugsFixedSinceVersion('6.0.0');
    expect(bugs.length).toBeGreaterThan(0);
    // includes 6.12.0 fixes
    expect(bugs.some((b) => b.fixedIn === '6.12.0')).toBe(true);
  });

  it('handles non-semver gracefully (returns all bugs)', () => {
    const bugs = getBugsFixedSinceVersion('not-a-version');
    expect(bugs.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest src/__tests__/version-context.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Create version-context.ts with the helper**

Create `src/shared/version-context.ts`:

```typescript
import {
  VERSION_BUG_FIXES,
  VERSION_DEPRECATIONS,
  VERSION_KNOWN_ISSUES,
  VersionBugFix,
  VersionDeprecation,
  VersionKnownIssue,
  ErrorSignature,
  compareVersions,
} from './versions';

/**
 * Returns all known bugs fixed in versions strictly newer than `currentVersion`.
 * If `currentVersion` is not parseable as semver, returns all known bugs.
 */
export function getBugsFixedSinceVersion(currentVersion: string): VersionBugFix[] {
  const result: VersionBugFix[] = [];
  for (const [fixedIn, bugs] of Object.entries(VERSION_BUG_FIXES)) {
    let isNewer: boolean;
    try {
      isNewer = compareVersions(fixedIn, currentVersion) > 0;
    } catch {
      isNewer = true; // graceful degradation: include if comparison fails
    }
    if (isNewer) {
      result.push(...bugs);
    }
  }
  return result;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest src/__tests__/version-context.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/shared/version-context.ts src/__tests__/version-context.test.ts
git commit -m "feat(version-context): add getBugsFixedSinceVersion helper"
```

---

## Task 9: Add getBugsAffectingVersion

**Files:**
- Modify: `src/shared/version-context.ts`
- Modify: `src/__tests__/version-context.test.ts`

- [ ] **Step 1: Add tests**

Append to `src/__tests__/version-context.test.ts`:

```typescript
import { getBugsAffectingVersion } from '../shared/version-context';

describe('getBugsAffectingVersion', () => {
  it('returns bugs not yet fixed in this version', () => {
    const bugs = getBugsAffectingVersion('6.10.0');
    // bugs fixed in 6.11.0 and 6.12.0 still exist in 6.10.0
    expect(bugs.some((b) => b.fixedIn === '6.12.0')).toBe(true);
  });

  it('excludes bugs fixed at or before the given version', () => {
    const bugs = getBugsAffectingVersion('6.12.0');
    // 6.12.0 fixes are NOT affecting 6.12.0
    expect(bugs.every((b) => b.fixedIn !== '6.12.0')).toBe(true);
  });

  it('returns an array even when no bugs affect the version', () => {
    const bugs = getBugsAffectingVersion('99.0.0');
    expect(Array.isArray(bugs)).toBe(true);
    expect(bugs).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/__tests__/version-context.test.ts -t "getBugsAffectingVersion"`
Expected: FAIL — function not exported

- [ ] **Step 3: Implement getBugsAffectingVersion**

Append to `src/shared/version-context.ts`:

```typescript
/**
 * Returns bugs that are present in `currentVersion` (i.e., fixed in a strictly
 * newer version, AND introducedIn ≤ currentVersion when introducedIn is set).
 */
export function getBugsAffectingVersion(currentVersion: string): VersionBugFix[] {
  return getBugsFixedSinceVersion(currentVersion).filter((bug) => {
    if (!bug.introducedIn) return true;
    try {
      return compareVersions(bug.introducedIn, currentVersion) <= 0;
    } catch {
      return true;
    }
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/__tests__/version-context.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/shared/version-context.ts src/__tests__/version-context.test.ts
git commit -m "feat(version-context): add getBugsAffectingVersion helper"
```

---

## Task 10: Add findBugByErrorSignature with most-specific-wins

**Files:**
- Modify: `src/shared/version-context.ts`
- Modify: `src/__tests__/version-context.test.ts`
- Create: `src/__tests__/fixtures/error-signatures.ts`

- [ ] **Step 1: Create fixtures file**

Create `src/__tests__/fixtures/error-signatures.ts`:

```typescript
/**
 * Synthetic error texts mapped to known v6.10–v6.12 bug signatures.
 * Used for unit tests of findBugByErrorSignature.
 */
export const SYNTHETIC_ERRORS = {
  // Matches PR-2843 (idp_saml nil pointer)
  IDP_SAML_NIL_POINTER: `Error: nil pointer dereference at vendor/okta/idp.go:142
Resource: okta_idp_saml.example
Operation: read
The accountLink.filter.groups field was null when the provider tried to dereference it.`,

  // Matches PR-2763 (WebAuthn authenticator update)
  WEBAUTHN_UPDATE_FAIL: `Error: 400 Bad Request
Resource: okta_authenticator.webauthn
Operation: update
WebAuthn settings could not be validated: invalid AAGUID format.`,

  // Matches PR-2856 (groups_included ignored)
  GROUPS_INCLUDED_IGNORED: `Warning: groups_included field present in okta_policy_password.example was ignored on apply.`,

  // No bug match — generic timeout
  GENERIC_TIMEOUT: `Error: context deadline exceeded
Resource: okta_user.bulk_load
Operation: create`,
};
```

- [ ] **Step 2: Add tests**

Append to `src/__tests__/version-context.test.ts`:

```typescript
import { findBugByErrorSignature } from '../shared/version-context';
import { SYNTHETIC_ERRORS } from './fixtures/error-signatures';

describe('findBugByErrorSignature', () => {
  it('matches IdP nil pointer error to PR-2843', () => {
    const match = findBugByErrorSignature(SYNTHETIC_ERRORS.IDP_SAML_NIL_POINTER, '6.10.0');
    expect(match).not.toBeNull();
    expect(match!.id).toBe('PR-2843');
  });

  it('matches WebAuthn update error to PR-2763', () => {
    const match = findBugByErrorSignature(SYNTHETIC_ERRORS.WEBAUTHN_UPDATE_FAIL, '6.10.0');
    expect(match).not.toBeNull();
    expect(match!.id).toBe('PR-2763');
  });

  it('returns null when no signature matches', () => {
    const match = findBugByErrorSignature(SYNTHETIC_ERRORS.GENERIC_TIMEOUT, '6.10.0');
    expect(match).toBeNull();
  });

  it('returns null when bug is already fixed in currentVersion', () => {
    // PR-2843 was fixed in 6.12.0, so on 6.12.0 the user is not affected
    const match = findBugByErrorSignature(SYNTHETIC_ERRORS.IDP_SAML_NIL_POINTER, '6.12.0');
    expect(match).toBeNull();
  });

  it('without currentVersion, returns the most-specific match across all versions', () => {
    const match = findBugByErrorSignature(SYNTHETIC_ERRORS.IDP_SAML_NIL_POINTER);
    expect(match).not.toBeNull();
    expect(match!.id).toBe('PR-2843');
  });

  it('most-specific match wins when multiple bugs match', () => {
    // If two bugs match, the one with more specified fields in its matching signature wins.
    // (Test only meaningful if our DB has overlapping signatures — placeholder for future expansion)
    const match = findBugByErrorSignature(SYNTHETIC_ERRORS.IDP_SAML_NIL_POINTER, '6.10.0');
    expect(match).not.toBeNull();
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx jest src/__tests__/version-context.test.ts -t "findBugByErrorSignature"`
Expected: FAIL — function not exported

- [ ] **Step 4: Implement findBugByErrorSignature**

Append to `src/shared/version-context.ts`:

```typescript
/**
 * Score a single ErrorSignature against an error text. Returns the number of
 * specified fields that matched, or 0 if any specified field failed to match
 * (AND semantics within a signature). Higher score = more specific match.
 */
function scoreSignature(sig: ErrorSignature, errorText: string): number {
  let score = 0;
  const lower = errorText.toLowerCase();

  if (sig.stackFragment !== undefined) {
    if (!lower.includes(sig.stackFragment.toLowerCase())) return 0;
    score++;
  }
  if (sig.messagePattern !== undefined) {
    if (!sig.messagePattern.test(errorText)) return 0;
    score++;
  }
  if (sig.providerErrorPattern !== undefined) {
    if (!sig.providerErrorPattern.test(errorText)) return 0;
    score++;
  }
  if (sig.pathPattern !== undefined) {
    if (!sig.pathPattern.test(errorText)) return 0;
    score++;
  }
  if (sig.oktaErrorCode !== undefined) {
    if (!errorText.includes(sig.oktaErrorCode)) return 0;
    score++;
  }
  if (sig.resourceType !== undefined) {
    if (!errorText.includes(sig.resourceType)) return 0;
    score++;
  }
  if (sig.operation !== undefined) {
    // Match "Operation: <op>" or " <op> " in the error text.
    const opRe = new RegExp(`\\b${sig.operation}\\b`, 'i');
    if (!opRe.test(errorText)) return 0;
    score++;
  }
  if (sig.method !== undefined) {
    if (!errorText.includes(sig.method)) return 0;
    score++;
  }
  if (sig.status !== undefined) {
    if (!errorText.includes(String(sig.status))) return 0;
    score++;
  }

  return score;
}

/**
 * Find the most-specific bug whose signature matches the error text.
 *
 * - Within a signature, all specified fields must match (AND).
 * - A bug with multiple signatures matches if ANY signature matches (OR).
 * - The bug with the highest-scoring matching signature wins.
 * - Ties broken by `fixedIn` newest-first.
 * - When `currentVersion` is set, only returns bugs that affect that version
 *   (i.e., fixed in a strictly newer version).
 */
export function findBugByErrorSignature(
  errorText: string,
  currentVersion?: string,
): VersionBugFix | null {
  const candidates = currentVersion
    ? getBugsAffectingVersion(currentVersion)
    : Object.values(VERSION_BUG_FIXES).flat();

  let best: { bug: VersionBugFix; score: number } | null = null;

  for (const bug of candidates) {
    if (!bug.signatures || bug.signatures.length === 0) continue;
    let bestSigScore = 0;
    for (const sig of bug.signatures) {
      const score = scoreSignature(sig, errorText);
      if (score > bestSigScore) bestSigScore = score;
    }
    if (bestSigScore === 0) continue;

    if (
      !best ||
      bestSigScore > best.score ||
      (bestSigScore === best.score && compareVersions(bug.fixedIn, best.bug.fixedIn) > 0)
    ) {
      best = { bug, score: bestSigScore };
    }
  }

  return best?.bug ?? null;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx jest src/__tests__/version-context.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/shared/version-context.ts src/__tests__/version-context.test.ts src/__tests__/fixtures/error-signatures.ts
git commit -m "feat(version-context): add findBugByErrorSignature with most-specific-wins matching"
```

---

## Task 11: Add getDeprecationsForVersion

**Files:**
- Modify: `src/shared/version-context.ts`
- Modify: `src/__tests__/version-context.test.ts`

- [ ] **Step 1: Add test**

Append to `src/__tests__/version-context.test.ts`:

```typescript
import { getDeprecationsForVersion } from '../shared/version-context';

describe('getDeprecationsForVersion', () => {
  it('returns an empty array when no deprecations exist for the version', () => {
    const deps = getDeprecationsForVersion('6.12.0');
    expect(deps).toEqual([]);
  });

  it('returns deprecations whose deprecatedIn is at or before the version', () => {
    // VERSION_DEPRECATIONS is empty in Phase 1; this test will need expansion
    // when entries land. Stub assertion: function returns an array.
    const deps = getDeprecationsForVersion('6.10.0');
    expect(Array.isArray(deps)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/__tests__/version-context.test.ts -t "getDeprecationsForVersion"`
Expected: FAIL — function not exported

- [ ] **Step 3: Implement getDeprecationsForVersion**

Append to `src/shared/version-context.ts`:

```typescript
/**
 * Returns deprecations relevant to the given version (deprecatedIn ≤ version,
 * not yet removedIn ≤ version).
 */
export function getDeprecationsForVersion(currentVersion: string): VersionDeprecation[] {
  return VERSION_DEPRECATIONS.filter((dep) => {
    let deprecatedApplies: boolean;
    try {
      deprecatedApplies = compareVersions(dep.deprecatedIn, currentVersion) <= 0;
    } catch {
      return false;
    }
    if (!deprecatedApplies) return false;

    if (dep.removedIn) {
      try {
        if (compareVersions(dep.removedIn, currentVersion) <= 0) return false;
      } catch {
        // ignore parse errors
      }
    }
    return true;
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/__tests__/version-context.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/shared/version-context.ts src/__tests__/version-context.test.ts
git commit -m "feat(version-context): add getDeprecationsForVersion helper"
```

---

## Task 12: Add formatBugFixContext

**Files:**
- Modify: `src/shared/version-context.ts`
- Modify: `src/__tests__/version-context.test.ts`

- [ ] **Step 1: Add tests**

Append to `src/__tests__/version-context.test.ts`:

```typescript
import { formatBugFixContext } from '../shared/version-context';

describe('formatBugFixContext', () => {
  it('returns a formatted string mentioning bug IDs and fixedIn versions', () => {
    const ctx = formatBugFixContext('6.10.0');
    expect(ctx).toMatch(/PR-/);
    expect(ctx).toMatch(/6\.12\.0/);
  });

  it('returns an empty string when current version is latest', () => {
    const ctx = formatBugFixContext('6.12.0');
    expect(ctx).toBe('');
  });

  it('filters by relevantResourceTypes when provided', () => {
    const ctx = formatBugFixContext('6.10.0', ['okta_idp_saml']);
    expect(ctx).toMatch(/PR-2843/);
    // PR-2763 (okta_authenticator) should NOT appear when filter is okta_idp_saml only
    expect(ctx).not.toMatch(/PR-2763/);
  });

  it('returns empty string when filter excludes all bugs', () => {
    const ctx = formatBugFixContext('6.10.0', ['okta_nonexistent_resource']);
    expect(ctx).toBe('');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/__tests__/version-context.test.ts -t "formatBugFixContext"`
Expected: FAIL — function not exported

- [ ] **Step 3: Implement formatBugFixContext**

Append to `src/shared/version-context.ts`:

```typescript
/**
 * Build a system-prompt-ready string summarizing bugs fixed in versions newer
 * than `currentVersion`. Optionally filter to bugs touching specific resource types
 * (keeps token cost down for large prompts).
 */
export function formatBugFixContext(
  currentVersion: string,
  relevantResourceTypes?: string[],
): string {
  const bugs = getBugsFixedSinceVersion(currentVersion).filter((bug) => {
    if (!relevantResourceTypes || relevantResourceTypes.length === 0) return true;
    return bug.resourceTypes.some((rt) => relevantResourceTypes.includes(rt));
  });

  if (bugs.length === 0) return '';

  const lines = [
    `KNOWN BUGS FIXED IN VERSIONS NEWER THAN v${currentVersion} (user is on v${currentVersion}):`,
    ...bugs.map((bug) => {
      const wa = bug.workaround ? ` Workaround: ${bug.workaround}` : '';
      return `- [${bug.id}] ${bug.description} (resources: ${bug.resourceTypes.join(', ')}; fixed in v${bug.fixedIn}).${wa}`;
    }),
    '',
    `If the user's error matches one of the above and you have high confidence, recommend they upgrade to a version >= the fixedIn version.`,
  ];

  return lines.join('\n');
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/__tests__/version-context.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/shared/version-context.ts src/__tests__/version-context.test.ts
git commit -m "feat(version-context): add formatBugFixContext with optional resource-type filter"
```

---

## Task 13: Update README.md

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update supported versions line**

In `README.md`, find the line "6.6.1 through 6.11.0 (default)." (around the "Supported Provider Versions" section) and replace with:

```
6.6.1 through 6.12.0 (default). Version-specific resource additions and attribute changes are tracked automatically.
```

- [ ] **Step 2: Verify the file reads cleanly**

Run: `grep -A1 "Supported Provider Versions" README.md`
Expected: shows `6.6.1 through 6.12.0`.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs(readme): bump supported provider versions to 6.12.0"
```

---

## Task 14: Run full test suite, verify build, and smoke

**Files:** none modified

- [ ] **Step 1: Run full test suite**

Run: `npx jest`
Expected: All tests pass — both `provider-v6.11.0.test.ts` and the new v6.12 + version-context tests. Total ~40+ tests.

- [ ] **Step 2: Type-check the whole project**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Run the dev build**

Run: `npm run build`
Expected: Webpack build completes without errors.

- [ ] **Step 4: Manual smoke test (optional)**

Launch the app: `npm run dev`

Verify:
- Provider version dropdown lists `6.12.0` and it is selected by default.
- Selecting `6.12.0` and viewing the resource picker shows the new data sources (`okta_signon_policy_rule`, `okta_auth_server_policy_rule`, `okta_assignees_users`) under their respective categories.
- Existing AI features (log analyzer, error decoder, solution builder) work exactly as before — no behavior change yet.

- [ ] **Step 5: Final commit if any tweaks needed**

If any of the above surfaced an issue (e.g., a missing `parentLabel`, a broken UI binding), fix it and commit:

```bash
git add <files>
git commit -m "fix: <what was broken>"
```

- [ ] **Step 6: Open PR**

```bash
git push -u origin feat/okta-provider-v6.12.0
gh pr create --title "feat: Okta provider v6.12.0 + version-aware data foundation (Phase 1)" --body "$(cat <<'EOF'
## Summary
- Adds Okta Terraform Provider v6.12.0 to OTTO's supported versions and sets it as default.
- Introduces three v6.12.0 data-source entries (`okta_signon_policy_rule`, `okta_auth_server_policy_rule`, `okta_assignees_users`).
- Lays foundation for version-aware AI prompts: new `VERSION_BUG_FIXES`, `VERSION_DEPRECATIONS`, `VERSION_KNOWN_ISSUES` records plus pure helpers in `src/shared/version-context.ts`.
- Backfills bug-fix data for v6.10.0, v6.11.0, v6.12.0.
- No AI prompt behavior changes in this phase — Phase 2 will consume the new helpers in `decodeError` and `interpretLog`.

## Test plan
- [x] All Jest tests pass (`npx jest`)
- [x] Type-checks clean (`npx tsc --noEmit`)
- [x] `npm run build` completes
- [x] App launches, v6.12.0 selectable in version dropdown
- [x] New data sources visible in resource picker when v6.12.0 selected
EOF
)"
```

---

## Self-Review Checklist (Plan Author)

After completing all tasks above, verify:

- **Spec coverage:** every Phase 1 deliverable from the spec has a matching task. ✓ (Tasks 1–14 map to spec sections "Phase 1: v6.12 Mechanical Update + Version Data Foundation").
- **Placeholder scan:** no "TBD"/"TODO"/"implement later" — every step contains actual code or commands. ✓
- **Type consistency:** `ErrorSignature`, `VersionBugFix`, `VersionDeprecation`, `VersionKnownIssue` referenced consistently across Tasks 5, 6, 7, 8, 9, 10, 11, 12. Helper signatures match between tests and implementations. ✓
- **No phantom symbols:** every type and function used in a later task is defined in an earlier task. ✓

## Notes for Phase 2 / Phase 3 Planning

This plan stops at the foundation. After it merges:
- Phase 2 plan will be written separately, covering `decodeError` and `interpretLog` refactors plus IPC/UI plumbing for `currentVersion`.
- Phase 3 plan will follow Phase 2, covering `generateSolution` and `convertConfig`.

Each phase plan can be written in a fresh session once Phase 1 is shipped, so any learnings from real-world testing inform the next plan.
