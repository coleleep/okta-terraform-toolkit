# SP4: OTTO Metadata Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce `resource-dictionary.ts` to operational-only metadata and wire `ResourceLookup.tsx` to read resource names from the provider schema loader instead of the hand-maintained dictionary.

**Architecture:** Strip `description` and `sinceVersion` from `ResourceDictionaryEntry` — these are now derivable from the schema or not needed. `ResourceLookup.tsx` switches to `Object.keys(loadSchema(version).resource_schemas)` + `data_source_schemas` for its full resource list, with the reduced dict providing `parentLabel` for known entries. Tests that check `sinceVersion` on dict entries are updated to use `isKnownResource()` from the schema loader.

**Tech Stack:** TypeScript, React 18, Zustand, `src/shared/schema-loader.ts` (already implemented), Jest + ts-jest

---

## File Structure

| File | Change |
|---|---|
| `src/shared/resource-dictionary.ts` | Remove `description`/`sinceVersion` from interface; strip from all 304 entries; remove description matching from `searchResources()` |
| `src/main/api/claude.ts` | Update `buildFullResourceContext()` — drop `description`/`sinceVersion` fields |
| `src/renderer/components/ResourceLookup.tsx` | Read resource list from `loadSchema(selectedVersion)`; use dict for parentLabel lookup only |
| `src/__tests__/provider-v6.11.0.test.ts` | Replace dict `sinceVersion` checks with `isKnownResource()` schema checks |
| `src/__tests__/provider-v6.12.0.test.ts` | Replace dict `sinceVersion` checks with `isKnownResource()` schema checks |

---

### Task 1: Strip description and sinceVersion from ResourceDictionaryEntry

**Files:**
- Modify: `src/shared/resource-dictionary.ts`

Context: `ResourceDictionaryEntry` has `description: string`, `sinceVersion?: string`, and `searchResources()` matches against description. These are being removed because description is not needed by any operational code path after this refactor, and sinceVersion is superseded by the schema loader. `CustomWorkload.tsx` uses `searchResources().filter(r => r.primaryEndpoint)` — only cares about entries with endpoint, unaffected by removing description from search.

- [ ] **Step 1: Write the failing test**

In `src/__tests__/resource-names.test.ts`, add to the `'resource-dictionary accuracy'` describe block:

```typescript
test('ResourceDictionaryEntry has no description field', () => {
  // If description were present it would be a string; after refactor it must be absent
  const sample = RESOURCE_DICTIONARY[0] as Record<string, unknown>;
  expect(sample['description']).toBeUndefined();
});

test('ResourceDictionaryEntry has no sinceVersion field', () => {
  const withSince = (RESOURCE_DICTIONARY as Record<string, unknown>[]).find(
    r => r['sinceVersion'] !== undefined
  );
  expect(withSince).toBeUndefined();
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/nicole.pendill/okta-terraform-toolkit
npx jest resource-names --no-coverage
```

Expected: FAIL — entries have `description` defined.

- [ ] **Step 3: Update the interface**

In `src/shared/resource-dictionary.ts`, update `ResourceDictionaryEntry`:

```typescript
export interface ResourceDictionaryEntry {
  terraformResource: string;
  parentType: ManagedResourceType;
  parentLabel: string;
  primaryEndpoint?: string;
  endpointLabel?: string;
}
```

Remove `description: string` and `sinceVersion?: string`.

- [ ] **Step 4: Strip description and sinceVersion from every entry**

The array has ~304 entries. For each entry, remove `description: '...'` and `sinceVersion: '...'` fields. Keep `terraformResource`, `parentType`, `parentLabel`, `primaryEndpoint` (if present), `endpointLabel` (if present).

Example before:
```typescript
{ terraformResource: 'okta_user', description: 'Manage a user account', parentType: 'users', parentLabel: 'Users' },
{ terraformResource: 'okta_user_risk', description: 'Set risk level for a user', parentType: 'users', parentLabel: 'Users', sinceVersion: '6.7.0' },
```

Example after:
```typescript
{ terraformResource: 'okta_user', parentType: 'users', parentLabel: 'Users' },
{ terraformResource: 'okta_user_risk', parentType: 'users', parentLabel: 'Users' },
```

- [ ] **Step 5: Update searchResources() to remove description matching**

```typescript
export function searchResources(query: string): ResourceDictionaryEntry[] {
  if (!query.trim()) return [];
  const q = query.toLowerCase();
  return RESOURCE_DICTIONARY.filter(
    (r) =>
      r.terraformResource.toLowerCase().includes(q) ||
      r.parentLabel.toLowerCase().includes(q)
  );
}
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
npx jest resource-names --no-coverage
```

Expected: PASS

- [ ] **Step 7: Run full test suite to catch any type errors from interface change**

```bash
npx jest --no-coverage 2>&1 | tail -20
```

Expected: all tests pass (or only sinceVersion-related failures — those are fixed in Task 4)

- [ ] **Step 8: Type check**

```bash
npx tsc --noEmit 2>&1 | head -30
```

Expected: errors only on files that reference `description` or `sinceVersion` on `ResourceDictionaryEntry` — those are fixed in Tasks 2 and 3.

- [ ] **Step 9: Commit**

```bash
git add src/shared/resource-dictionary.ts src/__tests__/resource-names.test.ts
git commit -m "refactor(dict): remove description and sinceVersion from ResourceDictionaryEntry"
```

---

### Task 2: Update claude.ts to remove description/sinceVersion from resource context

**Files:**
- Modify: `src/main/api/claude.ts:427-432`

Context: `buildFullResourceContext()` formats RESOURCE_DICTIONARY entries into the SOLUTION_SYSTEM_PROMPT used by the NL solution generator. It currently includes `description` and `sinceVersion`. After the interface change, these fields no longer exist.

The updated format will be: `terraformResource | parent=parentType | endpoint=primaryEndpoint` (endpoint only if present).

- [ ] **Step 1: Update buildFullResourceContext()**

Replace the existing function body at `src/main/api/claude.ts:427-432`:

```typescript
function buildFullResourceContext(): string {
  const entries = RESOURCE_DICTIONARY.map(r =>
    `${r.terraformResource} | parent=${r.parentType}${r.primaryEndpoint ? ` | endpoint=${r.primaryEndpoint}` : ''}`
  ).join('\n');
  return entries;
}
```

Also update the comment on line 438 that mentions `sinceVersion` in the column header:

```typescript
RESOURCE DICTIONARY (terraformResource | parent | endpoint):
```

- [ ] **Step 2: Type check**

```bash
npx tsc --noEmit 2>&1 | grep "claude.ts" | head -10
```

Expected: no errors on claude.ts.

- [ ] **Step 3: Commit**

```bash
git add src/main/api/claude.ts
git commit -m "refactor(claude): update resource context format after dict interface change"
```

---

### Task 3: Update ResourceLookup.tsx to read from schema

**Files:**
- Modify: `src/renderer/components/ResourceLookup.tsx`

Context: Currently imports `searchResources`, `RESOURCE_DICTIONARY`, `ResourceDictionaryEntry` from the dict and uses them for both search and "Browse all". After this change:
- Resource list comes from `loadSchema(selectedVersion).resource_schemas` + `data_source_schemas`
- Dict entries provide `parentLabel` for known resources (unknown resources show no category badge)
- `sinceVersion` availability badge is removed (resource presence in schema = availability)
- `description` is gone from the display
- `isAvailableIn` import is no longer needed here

The `loadSchema` import is from `../../shared/schema-loader`. The `providerVersion` from `useStore()` is the version string (e.g. `'6.13.0'`). Use `DEFAULT_VERSION` as fallback when `providerVersion` is `'system'` or empty (import from `../../shared/versions`).

- [ ] **Step 1: Write the failing test**

There are no existing Jest tests for `ResourceLookup.tsx` (it's a React component without a test file). Skip Jest test — the type-check below is the gate.

- [ ] **Step 2: Rewrite ResourceLookup.tsx**

```typescript
import React, { useMemo, useState } from 'react';
import { RESOURCE_DICTIONARY, ResourceDictionaryEntry } from '../../shared/resource-dictionary';
import { loadSchema } from '../../shared/schema-loader';
import { useStore } from '../hooks/useStore';
import { DEFAULT_VERSION } from '../../shared/versions';

// Build a lookup map from terraformResource → dict entry (for parentLabel)
const DICT_BY_NAME = new Map<string, ResourceDictionaryEntry>(
  RESOURCE_DICTIONARY.map(r => [r.terraformResource, r])
);

export default function ResourceLookup() {
  const [query, setQuery] = useState('');
  const [showAll, setShowAll] = useState(false);
  const { providerVersion } = useStore();

  const version = (!providerVersion || providerVersion === 'system') ? DEFAULT_VERSION : providerVersion;

  const allResourceNames = useMemo(() => {
    try {
      const schema = loadSchema(version);
      return [
        ...Object.keys(schema.resource_schemas),
        ...Object.keys(schema.data_source_schemas),
      ].sort();
    } catch {
      return [];
    }
  }, [version]);

  const results = useMemo(() => {
    if (query.trim()) {
      const q = query.toLowerCase();
      return allResourceNames.filter(name => {
        if (name.toLowerCase().includes(q)) return true;
        const entry = DICT_BY_NAME.get(name);
        return entry ? entry.parentLabel.toLowerCase().includes(q) : false;
      });
    }
    if (showAll) return allResourceNames;
    return [];
  }, [query, showAll, allResourceNames]);

  const displayResults = results.slice(0, showAll && !query ? 200 : 15);

  return (
    <div className="border-t border-gray-200 mt-4 pt-4">
      <div className="flex items-center gap-2 mb-2">
        <p className="text-xs text-gray-400 font-medium uppercase tracking-wide">Resource Dictionary</p>
        <button
          onClick={() => setShowAll(!showAll)}
          className="text-xs text-okta-blue hover:underline"
        >
          {showAll ? 'Hide all' : 'Browse all'}
        </button>
      </div>
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search terraform resource name... (e.g. okta_app_oauth)"
        className="w-full px-3 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
      />
      {displayResults.length > 0 && (
        <div className="mt-2 max-h-64 overflow-y-auto border border-gray-100 rounded-lg divide-y divide-gray-50">
          {displayResults.map((name) => (
            <ResourceRow key={name} resourceName={name} dictEntry={DICT_BY_NAME.get(name)} />
          ))}
        </div>
      )}
      {query.trim() && results.length === 0 && (
        <p className="text-xs text-gray-400 mt-2 px-1">
          No matching resources found. Try a partial name like "app" or "policy".
        </p>
      )}
      {results.length > displayResults.length && (
        <p className="text-xs text-gray-400 mt-1 px-1">
          Showing {displayResults.length} of {results.length} results
        </p>
      )}
    </div>
  );
}

function ResourceRow({
  resourceName,
  dictEntry,
}: {
  resourceName: string;
  dictEntry: ResourceDictionaryEntry | undefined;
}) {
  return (
    <div className="flex items-center gap-3 px-3 py-2">
      <div className="flex-1 min-w-0">
        <code className="text-xs font-mono text-gray-700">{resourceName}</code>
      </div>
      {dictEntry && (
        <div className="flex-shrink-0 text-right">
          <span className="inline-block px-2 py-0.5 text-xs font-medium rounded-full bg-blue-50 text-blue-700">
            {dictEntry.parentLabel}
          </span>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Type check**

```bash
npx tsc --noEmit 2>&1 | grep "ResourceLookup" | head -10
```

Expected: no errors on ResourceLookup.tsx.

- [ ] **Step 4: Run full type check to confirm no regressions**

```bash
npx tsc --noEmit 2>&1 | head -20
```

Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/ResourceLookup.tsx
git commit -m "feat(lookup): read resource list from provider schema instead of static dict"
```

---

### Task 4: Update sinceVersion tests to use schema-loader

**Files:**
- Modify: `src/__tests__/provider-v6.11.0.test.ts:70-88`
- Modify: `src/__tests__/provider-v6.12.0.test.ts:98-125`

Context: These tests verify that resources introduced in v6.11.0 and v6.12.0 are correctly registered. They currently check `entry.sinceVersion` on RESOURCE_DICTIONARY entries. After removing sinceVersion from the dict, the canonical check is `isKnownResource(version, resourceType)` from the schema loader — if a resource is in the schema for that version, it's available. The tests should additionally verify the resource is NOT in the prior version's schema (to confirm it was actually added in that version).

- [ ] **Step 1: Update provider-v6.11.0.test.ts**

Replace the `'identity source resource dictionary entries'` describe block (lines 70-88):

```typescript
import { isKnownResource } from '../shared/schema-loader';

describe('identity source resource dictionary entries', () => {
  it('okta_identity_source_group is known in v6.11.0 schema', () => {
    expect(isKnownResource('6.11.0', 'okta_identity_source_group')).toBe(true);
  });

  it('okta_identity_source_users is known in v6.11.0 schema', () => {
    expect(isKnownResource('6.11.0', 'okta_identity_source_users')).toBe(true);
  });

  it('dict entry for okta_identity_source_group has correct parentType', () => {
    const entry = RESOURCE_DICTIONARY.find(
      (r) => r.terraformResource === 'okta_identity_source_group',
    );
    expect(entry).toBeDefined();
    expect(entry!.parentType).toBe('identitySources');
  });
});
```

Remove the `sinceVersion` assertions from those tests. The import of `RESOURCE_DICTIONARY` stays (for parentType check).

- [ ] **Step 2: Update provider-v6.12.0.test.ts**

Replace the `'v6.12.0 data source entries'` describe block:

```typescript
import { isKnownResource } from '../shared/schema-loader';

describe('v6.12.0 data source entries', () => {
  it('okta_app_sign_on_policy_rule is known in v6.12.0 schema', () => {
    expect(isKnownResource('6.12.0', 'okta_app_sign_on_policy_rule')).toBe(true);
  });

  it('okta_authorization_servers_policies_rule is known in v6.12.0 schema', () => {
    expect(isKnownResource('6.12.0', 'okta_authorization_servers_policies_rule')).toBe(true);
  });

  it('okta_iam_assignees_user is known in v6.12.0 schema', () => {
    expect(isKnownResource('6.12.0', 'okta_iam_assignees_user')).toBe(true);
  });

  it('dict entry for okta_app_sign_on_policy_rule has correct parentType', () => {
    const entry = RESOURCE_DICTIONARY.find(
      (r) => r.terraformResource === 'okta_app_sign_on_policy_rule',
    );
    expect(entry).toBeDefined();
    expect(entry!.parentType).toBe('policies');
  });

  it('dict entry for okta_authorization_servers_policies_rule has correct parentType', () => {
    const entry = RESOURCE_DICTIONARY.find(
      (r) => r.terraformResource === 'okta_authorization_servers_policies_rule',
    );
    expect(entry).toBeDefined();
    expect(entry!.parentType).toBe('authServers');
  });

  it('dict entry for okta_iam_assignees_user has correct parentType', () => {
    const entry = RESOURCE_DICTIONARY.find(
      (r) => r.terraformResource === 'okta_iam_assignees_user',
    );
    expect(entry).toBeDefined();
    expect(entry!.parentType).toBe('users');
  });
});
```

Remove `sinceVersion` assertions. Keep `parentType` assertions since those still apply.

- [ ] **Step 3: Run the updated tests**

```bash
npx jest provider-v6.11 provider-v6.12 --no-coverage
```

Expected: all tests pass.

- [ ] **Step 4: Run full test suite**

```bash
npx jest --no-coverage 2>&1 | tail -10
```

Expected: all tests pass, 0 failures.

- [ ] **Step 5: Final type check**

```bash
npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/__tests__/provider-v6.11.0.test.ts src/__tests__/provider-v6.12.0.test.ts
git commit -m "test: replace sinceVersion dict checks with schema-loader isKnownResource"
```
