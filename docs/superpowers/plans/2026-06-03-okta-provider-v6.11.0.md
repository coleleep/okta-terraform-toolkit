# Okta Provider v6.11.0 Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Register Okta Terraform provider v6.11.0 as the new default version, add all new and updated resource attribute configs, and introduce `identitySources` as a new managed resource type in the picker.

**Architecture:** All version metadata lives in `src/shared/versions.ts` (version list, per-version HCL snippets, per-version notes). The new `identitySources` type threads through `types.ts` → `constants.ts` → `resource-dictionary.ts` → `ProviderBlock.tsx` following the exact same pattern as every existing type.

**Tech Stack:** TypeScript, Electron, React, Jest + ts-jest

---

## File Map

| File | Change |
|---|---|
| `src/shared/versions.ts` | Add `'6.11.0'` to `SUPPORTED_VERSIONS`, new `DEFAULT_VERSION`, new additions + notes entries |
| `src/shared/types.ts` | Add `'identitySources'` to `ManagedResourceType` union |
| `src/shared/constants.ts` | Add `identitySources` entry to `RESOURCE_TYPES[]` |
| `src/shared/resource-dictionary.ts` | Add `okta_identity_source` resource + data source entries |
| `src/renderer/components/ProviderBlock.tsx` | Add `RESOURCE_CONFIGS['identitySources']` HCL template |
| `jest.config.js` | **Create** — minimal ts-jest config |
| `src/__tests__/provider-v6.11.0.test.ts` | **Create** — tests for all new entries |

---

## Task 1: Create jest config

**Files:**
- Create: `jest.config.js`

- [ ] **Step 1: Create jest.config.js**

```javascript
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/src/__tests__/**/*.test.ts'],
  moduleFileExtensions: ['ts', 'tsx', 'js'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: 'tsconfig.json' }],
  },
};
```

- [ ] **Step 2: Verify jest can find the config**

Run: `npx jest --listTests`
Expected: no error output (empty list is fine — no tests exist yet)

- [ ] **Step 3: Commit**

```bash
git add jest.config.js
git commit -m "chore: add jest config for ts-jest"
```

---

## Task 2: Write failing tests

**Files:**
- Create: `src/__tests__/provider-v6.11.0.test.ts`

- [ ] **Step 1: Create the test file**

```typescript
import {
  SUPPORTED_VERSIONS,
  DEFAULT_VERSION,
  VERSION_RESOURCE_ADDITIONS,
  VERSION_ATTRIBUTE_NOTES,
  getAdditionsForVersion,
  isAvailableIn,
} from '../shared/versions';
import { RESOURCE_TYPES } from '../shared/constants';
import { RESOURCE_DICTIONARY } from '../shared/resource-dictionary';

describe('v6.11.0 version registration', () => {
  it('includes 6.11.0 in SUPPORTED_VERSIONS', () => {
    expect(SUPPORTED_VERSIONS).toContain('6.11.0');
  });

  it('sets DEFAULT_VERSION to 6.11.0', () => {
    expect(DEFAULT_VERSION).toBe('6.11.0');
  });

  it('has VERSION_RESOURCE_ADDITIONS entry for 6.11.0', () => {
    expect(VERSION_RESOURCE_ADDITIONS['6.11.0']).toBeDefined();
    expect(VERSION_RESOURCE_ADDITIONS['6.11.0'].length).toBeGreaterThan(0);
  });

  it('has identitySources in 6.11.0 additions', () => {
    const types = VERSION_RESOURCE_ADDITIONS['6.11.0'].map((a) => a.type);
    expect(types).toContain('identitySources');
  });

  it('has policies in 6.11.0 additions (breached password)', () => {
    const types = VERSION_RESOURCE_ADDITIONS['6.11.0'].map((a) => a.type);
    expect(types).toContain('policies');
  });

  it('has VERSION_ATTRIBUTE_NOTES entry for 6.11.0', () => {
    expect(VERSION_ATTRIBUTE_NOTES['6.11.0']).toBeDefined();
    expect(VERSION_ATTRIBUTE_NOTES['6.11.0'].length).toBeGreaterThan(0);
  });

  it('includes okta_policy_password note in 6.11.0', () => {
    const notes = VERSION_ATTRIBUTE_NOTES['6.11.0'];
    expect(notes.some((n) => n.includes('okta_policy_password'))).toBe(true);
  });

  it('getAdditionsForVersion includes 6.11.0 additions when version is 6.11.0', () => {
    const additions = getAdditionsForVersion('6.11.0');
    const types = additions.map((a) => a.type);
    expect(types).toContain('identitySources');
  });

  it('isAvailableIn returns true for 6.11.0 in 6.11.0', () => {
    expect(isAvailableIn('6.11.0', '6.11.0')).toBe(true);
  });

  it('isAvailableIn returns false for 6.11.0 in 6.10.0', () => {
    expect(isAvailableIn('6.11.0', '6.10.0')).toBe(false);
  });
});

describe('identitySources resource type', () => {
  it('exists in RESOURCE_TYPES', () => {
    const entry = RESOURCE_TYPES.find((r) => r.type === 'identitySources');
    expect(entry).toBeDefined();
    expect(entry!.label).toBe('Identity Sources');
    expect(entry!.category).toBe('advanced');
  });
});

describe('okta_identity_source resource dictionary', () => {
  it('has okta_identity_source resource entry', () => {
    const entry = RESOURCE_DICTIONARY.find(
      (r) => r.terraformResource === 'okta_identity_source' && r.description.includes('resource'),
    );
    expect(entry).toBeDefined();
    expect(entry!.parentType).toBe('identitySources');
    expect(entry!.sinceVersion).toBe('6.11.0');
  });

  it('has okta_identity_source data source entry', () => {
    const entry = RESOURCE_DICTIONARY.find(
      (r) => r.terraformResource === 'okta_identity_source' && r.description.includes('data source'),
    );
    expect(entry).toBeDefined();
    expect(entry!.parentType).toBe('identitySources');
    expect(entry!.sinceVersion).toBe('6.11.0');
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx jest src/__tests__/provider-v6.11.0.test.ts --no-coverage`

Expected: multiple FAIL lines — `'6.11.0'` not in `SUPPORTED_VERSIONS`, `identitySources` not in `RESOURCE_TYPES`, etc.

- [ ] **Step 3: Commit the failing tests**

```bash
git add src/__tests__/provider-v6.11.0.test.ts
git commit -m "test: add failing tests for v6.11.0 provider support"
```

---

## Task 3: Update versions.ts

**Files:**
- Modify: `src/shared/versions.ts:1-3` (SUPPORTED_VERSIONS, DEFAULT_VERSION)
- Modify: `src/shared/versions.ts:41-205` (VERSION_RESOURCE_ADDITIONS)
- Modify: `src/shared/versions.ts:210-235` (VERSION_ATTRIBUTE_NOTES)

- [ ] **Step 1: Add 6.11.0 to SUPPORTED_VERSIONS and update DEFAULT_VERSION**

Replace lines 1-3:

```typescript
export const SUPPORTED_VERSIONS = ['6.6.1', '6.7.0', '6.8.0', '6.9.0', '6.10.0', '6.11.0'] as const;
export type ProviderVersion = (typeof SUPPORTED_VERSIONS)[number];
export const DEFAULT_VERSION: ProviderVersion = '6.11.0';
```

- [ ] **Step 2: Add VERSION_RESOURCE_ADDITIONS entry for 6.11.0**

After the `'6.10.0'` block (after line 204, before the closing `};` on line 205), add:

```typescript
  '6.11.0': [
    {
      type: 'identitySources',
      config: `
# Identity source resource (v6.11.0+)
# resource "okta_identity_source" "example" {
#   name = "My Identity Source"
#   type = "SAML2"
#   # protocol and policy blocks depend on source type
# }
#
# Data source: look up an existing identity source
# data "okta_identity_source" "example" {
#   id = "<identity_source_id>"
# }
`,
    },
    {
      type: 'policies',
      config: `
# Breached password protection on password policy (v6.11.0+)
# resource "okta_policy_password" "example" {
#   name   = "Password Policy"
#   status = "ACTIVE"
#   password_breached_action = "WARN"  # NONE, WARN, or BLOCK
# }
`,
    },
    {
      type: 'authenticators',
      config: `
# WebAuthn custom AAGUID support (v6.11.0+)
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
`,
    },
    {
      type: 'applications',
      config: `
# Push group with AD destination support (v6.11.0+)
# resource "okta_push_group" "ad_example" {
#   app_id         = okta_app_auto_login.ad_app.id
#   group_id       = okta_group.example.id
#   group_push_rule = "SAME_NAME"
#   # AD apps can now be used as push destinations
# }

# App sign-on policy rule: option to stay signed in (v6.11.0+)
# resource "okta_app_signon_policy_rule" "example" {
#   policy_id                 = okta_app_signon_policy.example.id
#   name                      = "Default Rule"
#   factor_mode               = "1FA"
#   type                      = "ASSURANCE"
#   stay_signed_in_consent    = "ALLOWED"  # ALLOWED, REQUIRED, or DENIED (v6.11.0+)
# }
`,
    },
  ],
```

- [ ] **Step 3: Add VERSION_ATTRIBUTE_NOTES entry for 6.11.0**

After the `'6.10.0'` notes block (after the closing `]` for `'6.10.0'`), add:

```typescript
  '6.11.0': [
    'okta_policy_password: password_breached_action attribute added (NONE, WARN, BLOCK)',
    'okta_authenticator: authenticator methods and WebAuthn custom AAGUID (aaguidGroups) support added',
    'okta_push_group: AD group push destination support added',
    'okta_app_signon_policy_rule: stay_signed_in_consent attribute added',
    'okta_policy_rule_sign_on: identity_provider argument changed to TypeSet (may require state migration)',
    'okta_user: computed timestamp fields added',
    'okta_profile_mapping: terraform import support added',
    'okta_network_zone: diff suppression added (reduces false plan diffs)',
  ],
```

- [ ] **Step 4: Run affected tests**

Run: `npx jest src/__tests__/provider-v6.11.0.test.ts --no-coverage`

Expected: version registration tests pass; `identitySources` RESOURCE_TYPES and dictionary tests still fail.

- [ ] **Step 5: Commit**

```bash
git add src/shared/versions.ts
git commit -m "feat: register Okta provider v6.11.0 with resource additions and attribute notes"
```

---

## Task 4: Add `identitySources` ManagedResourceType

**Files:**
- Modify: `src/shared/types.ts:72-97`

- [ ] **Step 1: Add `identitySources` to the ManagedResourceType union**

Replace the `ManagedResourceType` union (lines 72-97 of types.ts):

```typescript
export type ManagedResourceType =
  | 'users'
  | 'groups'
  | 'applications'
  | 'authServers'
  | 'policies'
  | 'idps'
  | 'networkZones'
  | 'trustedOrigins'
  | 'authenticators'
  | 'domains'
  | 'emailDomains'
  | 'brands'
  | 'eventHooks'
  | 'inlineHooks'
  | 'logStreams'
  | 'behaviors'
  | 'captchas'
  | 'devices'
  | 'profileMappings'
  | 'customRoles'
  | 'realms'
  | 'features'
  | 'pushProviders'
  | 'orgSettings'
  | 'governance'
  | 'identitySources';
```

- [ ] **Step 2: Commit**

```bash
git add src/shared/types.ts
git commit -m "feat: add identitySources to ManagedResourceType"
```

---

## Task 5: Register `identitySources` in RESOURCE_TYPES

**Files:**
- Modify: `src/shared/constants.ts:71,80-113`

- [ ] **Step 1: Update the comment on line 71 to reference v6.11.0**

Replace:
```typescript
// Resource type definitions for selection & counting
// Covers all major resource categories in Okta Terraform Provider v6.6.1
```
With:
```typescript
// Resource type definitions for selection & counting
// Covers all major resource categories in Okta Terraform Provider v6.11.0
```

- [ ] **Step 2: Add identitySources to the Advanced section of RESOURCE_TYPES**

After the `pushProviders` line (line 108), add:

```typescript
  { type: 'identitySources', label: 'Identity Sources', countEndpoint: '/api/v1/identity-sources?limit=1', probeLabel: 'Identity Sources', category: 'advanced' },
```

So the Advanced section reads:

```typescript
  // Advanced
  { type: 'devices', label: 'Devices', countEndpoint: '/api/v1/devices?limit=1', probeLabel: 'Devices', category: 'advanced' },
  { type: 'profileMappings', label: 'Profile Mappings', countEndpoint: '/api/v1/mappings?limit=1', probeLabel: 'Profile Mappings', category: 'advanced' },
  { type: 'customRoles', label: 'Custom Roles', countEndpoint: '/api/v1/iam/roles?limit=1', probeLabel: 'Custom Roles', category: 'advanced' },
  { type: 'realms', label: 'Realms', countEndpoint: '/api/v1/realms?limit=1', probeLabel: 'Realms', category: 'advanced' },
  { type: 'features', label: 'Features', countEndpoint: '/api/v1/features?limit=1', probeLabel: 'Features', category: 'advanced' },
  { type: 'pushProviders', label: 'Push Providers', countEndpoint: '/api/v1/push-providers?limit=1', probeLabel: 'Push Providers', category: 'advanced' },
  { type: 'identitySources', label: 'Identity Sources', countEndpoint: '/api/v1/identity-sources?limit=1', probeLabel: 'Identity Sources', category: 'advanced' },
```

- [ ] **Step 3: Run affected tests**

Run: `npx jest src/__tests__/provider-v6.11.0.test.ts --no-coverage`

Expected: `identitySources resource type` describe block now passes; dictionary tests still fail.

- [ ] **Step 4: Commit**

```bash
git add src/shared/constants.ts
git commit -m "feat: add identitySources resource type to RESOURCE_TYPES"
```

---

## Task 6: Add identity source entries to RESOURCE_DICTIONARY

**Files:**
- Modify: `src/shared/resource-dictionary.ts`

- [ ] **Step 1: Add identity source section at the end of RESOURCE_DICTIONARY**

Find the closing `];` of `RESOURCE_DICTIONARY` and insert before it:

```typescript
  // ─── Identity Sources ───
  {
    terraformResource: 'okta_identity_source',
    description: 'Manage an identity source resource for profile sourcing',
    parentType: 'identitySources',
    parentLabel: 'Identity Sources',
    sinceVersion: '6.11.0',
    primaryEndpoint: '/api/v1/identity-sources',
    endpointLabel: 'Identity Sources',
  },
  {
    terraformResource: 'okta_identity_source',
    description: 'Look up an identity source data source',
    parentType: 'identitySources',
    parentLabel: 'Identity Sources',
    sinceVersion: '6.11.0',
    primaryEndpoint: '/api/v1/identity-sources',
    endpointLabel: 'Identity Sources',
  },
```

- [ ] **Step 2: Run all tests**

Run: `npx jest src/__tests__/provider-v6.11.0.test.ts --no-coverage`

Expected: all tests pass

- [ ] **Step 3: Commit**

```bash
git add src/shared/resource-dictionary.ts
git commit -m "feat: add okta_identity_source to resource dictionary (v6.11.0)"
```

---

## Task 7: Add RESOURCE_CONFIGS template for identitySources

**Files:**
- Modify: `src/renderer/components/ProviderBlock.tsx:561` (end of `RESOURCE_CONFIGS` object, before closing `};`)

- [ ] **Step 1: Add identitySources config template**

Find the closing `};` of `RESOURCE_CONFIGS` (currently after line 560) and insert before it:

```typescript
  identitySources: `# ─── Identity Sources ───
# Identity sources allow Okta to source user profiles from external systems (v6.11.0+)

# Data source: look up an existing identity source
# data "okta_identity_source" "example" {
#   id = "<identity_source_id>"
# }

# Resource: manage an identity source
# resource "okta_identity_source" "example" {
#   name = "My Identity Source"
#   type = "SAML2"
#   # protocol and policy settings vary by source type
#   # See: https://registry.terraform.io/providers/okta/okta/latest/docs/resources/identity_source
# }
`,
```

- [ ] **Step 2: Build the project to verify no TypeScript errors**

Run: `npm run build`

Expected: exits 0, no TypeScript compilation errors

- [ ] **Step 3: Run all tests one final time**

Run: `npx jest --no-coverage`

Expected: all tests pass

- [ ] **Step 4: Commit**

```bash
git add src/renderer/components/ProviderBlock.tsx
git commit -m "feat: add identitySources HCL config template to ProviderBlock"
```

---

## Self-Review Checklist

- [x] **v6.11.0 in SUPPORTED_VERSIONS** → Task 3 Step 1
- [x] **DEFAULT_VERSION updated** → Task 3 Step 1
- [x] **VERSION_RESOURCE_ADDITIONS for 6.11.0** → Task 3 Step 2 (identitySources, policies, authenticators, applications)
- [x] **VERSION_ATTRIBUTE_NOTES for 6.11.0** → Task 3 Step 3 (all 8 notes)
- [x] **ManagedResourceType union** → Task 4
- [x] **RESOURCE_TYPES entry** → Task 5
- [x] **RESOURCE_DICTIONARY entries** → Task 6 (resource + data source)
- [x] **RESOURCE_CONFIGS template** → Task 7
- [x] **Tests cover all new entries** → Task 2
- [x] **Build verification** → Task 7 Step 2
