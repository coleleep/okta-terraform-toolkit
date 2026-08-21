# Manual Limit Entry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a support engineer produce full rate limit analysis with no org connection, by entering limits they've looked up internally or pasting response headers from a case.

**Architecture:** Phase 2 gave every limit a `source` and built `mergeLimitSources()`. This phase adds the first non-probe producer. Manual entries live in new `limitSources` store state, get merged into the same `probeResult` every consumer already reads, and are cleared by the existing `clearedLimitState()`. Nothing is written to disk.

**Tech Stack:** TypeScript, React 18 + Tailwind (dark theme tokens in `DashboardPage`/modals; `RateLimitTable` is on the old light palette), Zustand, Jest with `ts-jest` in a **node** environment.

**Phase:** 3 of 6 from `docs/superpowers/specs/2026-08-19-rate-limit-sources-design.md`. Phases 1 and 2 are merged.

---

## Why this is the phase that matters

Everything so far has been foundation. This is the one that changes what the tool can do: today the entire rate limit half of OTTO is unavailable on any case where the customer won't share credentials, which is most of them. The engineer usually already knows the limits — they can look them up internally. They just had no way to tell OTTO.

## The label trap — read before Task 1

`target-analyzer.ts` matches a workload's resources to their rate limits **by label string**. The real vocabulary lives in two constants:

- `PROBE_ENDPOINTS` in `src/shared/constants.ts` — ~35 GET entries (`'Users'`, `'Applications'`, `'Org Settings'`)
- `SUB_RESOURCE_ENDPOINTS` in the same file — ~90 entries with their own labels and an optional `method`, including POST write probes (`'App User Assignments'`, `'User Create (write)'`)

If the manual entry dropdown offers labels that don't exactly match these, manual limits will merge fine, render fine in the table, and then silently match **nothing** in the target runtime analysis. No error, just "no rate limit data available for selected resources."

So the bucket list must be **derived from those constants**, never hand-written.

## Testing constraint

Unchanged from Phase 2: `testEnvironment: 'node'`, `testMatch` covers `*.test.ts` only, no jsdom, no react-testing-library. **Do not write component tests and do not add test infrastructure.** Logic goes in pure functions; the modal and chooser are verified by hand.

## File structure

| File | Responsibility | Change |
|------|---------------|--------|
| `src/shared/limit-sources.ts` | Pure limit-source logic | Add `KNOWN_LIMIT_BUCKETS`, `parseRateLimitHeaders`, `manualEntry`; extend `clearedLimitState` |
| `src/renderer/hooks/useStore.ts` | Zustand store | `limitSources` state, `setLimitSource`, recompute `probeResult` on change |
| `src/renderer/components/ManualLimitsModal.tsx` | **New.** Manual entry UI | Row editor + header paste |
| `src/renderer/components/ClearSourcesButton.tsx` | **New.** Clear action | Button + confirm step |
| `src/renderer/pages/DashboardPage.tsx` | Dashboard shell | Source chooser empty state; source-aware stat cards; wire both new components |
| `src/__tests__/limit-sources.test.ts` | Tests | Extend for the three new pure functions |

---

### Task 1: Derive the bucket vocabulary from the real constants

**Files:**
- Modify: `src/shared/limit-sources.ts`
- Test: `src/__tests__/limit-sources.test.ts`

- [ ] **Step 1: Write the failing tests**

Add `KNOWN_LIMIT_BUCKETS` to the existing `../shared/limit-sources` import at the top of the test file, and add a new import line beside it (imports must stay at the top of the file, not inline with the describe block):

```typescript
import { PROBE_ENDPOINTS, SUB_RESOURCE_ENDPOINTS } from '../shared/constants';
```

Then append:

```typescript
describe('KNOWN_LIMIT_BUCKETS', () => {
  it('offers every label the probe uses, so manual entry can match a probed bucket', () => {
    const labels = new Set(KNOWN_LIMIT_BUCKETS.map(b => b.label));
    for (const def of PROBE_ENDPOINTS) {
      expect(labels.has(def.label)).toBe(true);
    }
  });

  it('offers every sub-resource label, including the POST write buckets', () => {
    const keys = new Set(KNOWN_LIMIT_BUCKETS.map(b => `${b.method}|${b.label}`));
    for (const def of SUB_RESOURCE_ENDPOINTS) {
      expect(keys.has(`${def.method ?? 'GET'}|${def.label}`)).toBe(true);
    }
  });

  it('has no duplicate method+label pairs', () => {
    const keys = KNOWN_LIMIT_BUCKETS.map(b => `${b.method}|${b.label}`);
    expect(keys.length).toBe(new Set(keys).size);
  });

  it('is sorted by label so the dropdown is scannable', () => {
    const labels = KNOWN_LIMIT_BUCKETS.map(b => b.label);
    expect(labels).toEqual([...labels].sort((a, b) => a.localeCompare(b)));
  });

  it('carries the endpoint path for display', () => {
    const users = KNOWN_LIMIT_BUCKETS.find(b => b.label === 'Users' && b.method === 'GET');
    expect(users?.endpoint).toContain('/api/v1/users');
  });
});
```

- [ ] **Step 2: Run, verify FAIL**

Run: `npx jest src/__tests__/limit-sources.test.ts`

Expected: compile failure — `KNOWN_LIMIT_BUCKETS` is not exported.

- [ ] **Step 3: Implement it**

Append to `src/shared/limit-sources.ts`, and add the constants import at the top of the file:

```typescript
import { PROBE_ENDPOINTS, SUB_RESOURCE_ENDPOINTS } from './constants';
```

```typescript
export interface LimitBucket {
  label: string;
  method: 'GET' | 'POST';
  endpoint: string;
}

/**
 * Every rate limit bucket a limit can be entered for.
 *
 * Derived from PROBE_ENDPOINTS and SUB_RESOURCE_ENDPOINTS rather than written by
 * hand, because target-analyzer.ts matches workload resources to limits by label
 * string. A hand-maintained list would drift, and the failure is silent: the
 * limit merges, renders, and then matches nothing in the runtime analysis.
 */
export const KNOWN_LIMIT_BUCKETS: LimitBucket[] = (() => {
  const seen = new Map<string, LimitBucket>();

  for (const def of PROBE_ENDPOINTS) {
    const bucket: LimitBucket = {
      label: def.label,
      method: 'GET',
      endpoint: def.endpoint.split('?')[0],
    };
    seen.set(`GET|${def.label}`, bucket);
  }

  for (const def of SUB_RESOURCE_ENDPOINTS) {
    const method = def.method ?? 'GET';
    const bucket: LimitBucket = {
      label: def.label,
      method,
      endpoint: def.endpoint.split('?')[0],
    };
    seen.set(`${method}|${def.label}`, bucket);
  }

  return [...seen.values()].sort((a, b) => a.label.localeCompare(b.label));
})();
```

- [ ] **Step 4: Run, verify PASS**

Run: `npx jest src/__tests__/limit-sources.test.ts`

Expected: PASS, 17 tests.

- [ ] **Step 5: Commit**

```bash
git add src/shared/limit-sources.ts src/__tests__/limit-sources.test.ts
git commit -F - <<'EOF'
feat(limits): derive the enterable rate limit bucket list from probe constants

target-analyzer.ts matches a workload's resources to their limits by label
string, so manual entry has to offer exactly the labels the probe uses. A
hand-written list would drift, and the failure mode is silent: the limit
merges, renders in the table, and then matches nothing in the runtime
analysis with no error to explain why.

KNOWN_LIMIT_BUCKETS is therefore computed from PROBE_ENDPOINTS and
SUB_RESOURCE_ENDPOINTS, deduped by method and label so read and write
buckets stay distinct, and sorted for a scannable dropdown. Tests assert
every constant label is offered, which fails if the constants gain an entry
the derivation misses.
EOF
```

---

### Task 2: Parse pasted response headers

Lets the engineer paste `curl` output or a snippet from a case instead of retyping numbers.

**Files:**
- Modify: `src/shared/limit-sources.ts`
- Test: `src/__tests__/limit-sources.test.ts`

- [ ] **Step 1: Write the failing tests**

Add `parseRateLimitHeaders` to the test file import, then append:

```typescript
describe('parseRateLimitHeaders', () => {
  it('parses a standard curl header dump', () => {
    const result = parseRateLimitHeaders([
      'HTTP/2 200',
      'x-rate-limit-limit: 600',
      'x-rate-limit-remaining: 599',
      'x-rate-limit-reset: 1755792000',
    ].join('\n'));

    expect(result).toEqual({ limit: 600, remaining: 599, resetAt: 1755792000 });
  });

  it('is case insensitive, since header casing varies by client', () => {
    const result = parseRateLimitHeaders('X-Rate-Limit-Limit: 100');
    expect(result?.limit).toBe(100);
  });

  it('tolerates surrounding log noise', () => {
    const result = parseRateLimitHeaders(
      '2026-08-11T12:39:22 [DEBUG] provider.terraform-provider-okta: X-Rate-Limit-Limit: 250'
    );
    expect(result?.limit).toBe(250);
  });

  it('returns the limit alone when capacity headers are absent', () => {
    const result = parseRateLimitHeaders('x-rate-limit-limit: 600');
    expect(result).toEqual({ limit: 600 });
  });

  it('returns null when there is no limit header, so the caller can reject the paste', () => {
    expect(parseRateLimitHeaders('HTTP/2 200\ncontent-type: application/json')).toBeNull();
    expect(parseRateLimitHeaders('')).toBeNull();
  });

  it('returns null for a non-numeric or zero limit rather than a useless entry', () => {
    expect(parseRateLimitHeaders('x-rate-limit-limit: abc')).toBeNull();
    expect(parseRateLimitHeaders('x-rate-limit-limit: 0')).toBeNull();
  });

  it('keeps a remaining of zero, which means exhausted rather than missing', () => {
    const result = parseRateLimitHeaders('x-rate-limit-limit: 600\nx-rate-limit-remaining: 0');
    expect(result).toEqual({ limit: 600, remaining: 0 });
  });
});
```

- [ ] **Step 2: Run, verify FAIL**

Run: `npx jest src/__tests__/limit-sources.test.ts`

Expected: compile failure — `parseRateLimitHeaders` is not exported.

- [ ] **Step 3: Implement it**

Append to `src/shared/limit-sources.ts`:

```typescript
/** Bounded to avoid a pathological match on a large pasted blob. */
function headerValue(blob: string, name: string): number | undefined {
  const re = new RegExp(`${name}\\s*:\\s*(\\d{1,12})`, 'i');
  const m = blob.match(re);
  return m ? parseInt(m[1], 10) : undefined;
}

/**
 * Pull rate limit headers out of pasted text — a curl dump, a snippet from a
 * support case, or a log line. Returns null when no usable limit is present so
 * the caller can reject the paste rather than create a zero-limit entry.
 */
export function parseRateLimitHeaders(
  blob: string,
): { limit: number; remaining?: number; resetAt?: number } | null {
  const limit = headerValue(blob, 'x-rate-limit-limit');
  if (limit === undefined || limit === 0) return null;

  const remaining = headerValue(blob, 'x-rate-limit-remaining');
  const resetAt = headerValue(blob, 'x-rate-limit-reset');

  return {
    limit,
    // Omit rather than default — absent means unknown, 0 means exhausted, and
    // hasLiveCapacity() distinguishes them.
    ...(remaining !== undefined ? { remaining } : {}),
    ...(resetAt !== undefined ? { resetAt } : {}),
  };
}
```

- [ ] **Step 4: Run, verify PASS**

Run: `npx jest src/__tests__/limit-sources.test.ts`

Expected: PASS, 24 tests.

- [ ] **Step 5: Commit**

```bash
git add src/shared/limit-sources.ts src/__tests__/limit-sources.test.ts
git commit -F - <<'EOF'
feat(limits): parse rate limit headers out of pasted text

Asking a customer for a curl dump is a far cheaper request than a full
TF_LOG, and case notes often already contain the response headers. Parsing
a pasted blob avoids retyping numbers, which is where transcription errors
would enter a figure that ends up in an increase justification.

Case insensitive and tolerant of log-line prefixes. Returns null for a
missing, non-numeric, or zero limit so the caller can reject the paste
instead of creating a useless entry. A remaining of zero is preserved,
since exhausted is real data and distinct from unknown.
EOF
```

---

### Task 3: Hold manual limits in the store and merge them

**Files:**
- Modify: `src/shared/limit-sources.ts`
- Modify: `src/renderer/hooks/useStore.ts`
- Test: `src/__tests__/limit-sources.test.ts`

- [ ] **Step 1: Write the failing tests**

Add `manualEntry` to the test file import, then append:

```typescript
describe('manualEntry', () => {
  it('builds an unknown-status entry from a bucket and a limit', () => {
    const bucket = { label: 'Users', method: 'GET' as const, endpoint: '/api/v1/users' };
    const entry = manualEntry(bucket, 600);

    expect(entry).toEqual({
      endpoint: '/api/v1/users',
      label: 'Users',
      method: 'GET',
      limit: 600,
      resetWindowSecs: 60,
      status: 'unknown',
      source: 'manual',
    });
  });

  it('carries capacity through when a paste supplied it', () => {
    const bucket = { label: 'Users', method: 'GET' as const, endpoint: '/api/v1/users' };
    const entry = manualEntry(bucket, 600, { remaining: 599, resetAt: 1755792000 });

    expect(entry.remaining).toBe(599);
    expect(entry.resetAt).toBe(1755792000);
    // capacity is known, so the ratio-based status is meaningful again
    expect(entry.status).toBe('ok');
  });
});
```

Then **update the existing `clearedLimitState` test** to expect the new key — it will fail until you do, which is the mechanism working as designed:

```typescript
    expect(cleared).toEqual({
      probeResult: null,
      baselineProbeResult: null,
      probeProgress: null,
      recommendation: null,
      targetAnalysis: null,
      targetMinutes: null,
      customWorkloads: [],
      limitSources: {},
    });
```

- [ ] **Step 2: Run, verify FAIL**

Run: `npx jest src/__tests__/limit-sources.test.ts`

Expected: compile failure on `manualEntry`, plus the `clearedLimitState` test failing on the missing `limitSources` key.

- [ ] **Step 3: Implement `manualEntry` and extend `clearedLimitState`**

Append to `src/shared/limit-sources.ts`:

```typescript
/**
 * Build a manual entry for a bucket. Status is 'unknown' unless a paste supplied
 * live capacity, in which case the ratio-based derivation is meaningful again.
 * resetWindowSecs defaults to 60, which is the standard Okta window and what
 * calculateEstimate already assumes when no probed window is available.
 */
export function manualEntry(
  bucket: LimitBucket,
  limit: number,
  capacity?: { remaining?: number; resetAt?: number },
): EndpointProbeResult {
  const remaining = capacity?.remaining;
  return {
    endpoint: bucket.endpoint,
    label: bucket.label,
    method: bucket.method,
    limit,
    resetWindowSecs: 60,
    status: remaining === undefined ? 'unknown' : deriveStatus(remaining, limit),
    source: 'manual',
    ...(remaining !== undefined ? { remaining } : {}),
    ...(capacity?.resetAt !== undefined ? { resetAt: capacity.resetAt } : {}),
  };
}

/**
 * Mirrors determineStatus in the probe modules. Duplicated rather than imported
 * because those live in the main process and this file is bundled into the
 * renderer.
 */
function deriveStatus(remaining: number, limit: number): 'ok' | 'warning' | 'critical' {
  if (limit === 0) return 'critical';
  const ratio = remaining / limit;
  if (ratio > 0.5) return 'ok';
  if (ratio > 0.1) return 'warning';
  return 'critical';
}
```

Then extend `clearedLimitState` — add `limitSources` to both the return type and the returned object:

```typescript
export function clearedLimitState(): {
  probeResult: ProbeResult | null;
  baselineProbeResult: ProbeResult | null;
  probeProgress: ProbeProgress | null;
  recommendation: ConfigRecommendation | null;
  targetAnalysis: TargetRuntimeAnalysis | null;
  targetMinutes: number | null;
  customWorkloads: CustomWorkloadEntry[];
  limitSources: Partial<Record<LimitSource, EndpointProbeResult[]>>;
} {
  return {
    probeResult: null,
    baselineProbeResult: null,
    probeProgress: null,
    recommendation: null,
    targetAnalysis: null,
    targetMinutes: null,
    // Custom workloads cache a rateLimit per entry, so they are derived state too
    customWorkloads: [],
    limitSources: {},
  };
}
```

- [ ] **Step 4: Run, verify PASS**

Run: `npx jest src/__tests__/limit-sources.test.ts`

Expected: PASS, 26 tests.

- [ ] **Step 5: Add the store state and action**

In `src/renderer/hooks/useStore.ts`, extend the import:

```typescript
import { clearedLimitState, mergeLimitSources } from '../../shared/limit-sources';
```

Add to the store interface, directly after `clearLimitSources`:

```typescript
  clearLimitSources: () => void;
  limitSources: Partial<Record<LimitSource, EndpointProbeResult[]>>;
  setLimitSource: (source: LimitSource, endpoints: EndpointProbeResult[], displayLabel: string) => void;
```

Add `LimitSource` to the existing `../../shared/types` import list.

Add the initial state next to `probeResult`:

```typescript
  limitSources: {},
```

Add the action immediately after `clearLimitSources`:

```typescript
  // Replaces one source's entries and recomputes the merged probeResult that
  // every consumer reads. Derived state is dropped because it was computed from
  // the previous limits — see clearedLimitState for why that matters.
  setLimitSource: (source, endpoints, displayLabel) => {
    const limitSources = { ...get().limitSources, [source]: endpoints };
    set({
      limitSources,
      probeResult: mergeLimitSources(limitSources, displayLabel),
      recommendation: null,
      targetAnalysis: null,
      targetMinutes: null,
    });
  },
```

If the store's `create()` callback is not already destructuring `get`, change its signature from `(set) =>` to `(set, get) =>`.

- [ ] **Step 6: Verify**

Run: `npx tsc --noEmit && npx jest`

Expected: `tsc` silent, exit 0. All tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/shared/limit-sources.ts src/__tests__/limit-sources.test.ts src/renderer/hooks/useStore.ts
git commit -F - <<'EOF'
feat(store): hold limit sources and merge them into probeResult

Adds limitSources state plus setLimitSource, which replaces one producer's
entries and recomputes the merged probeResult that every consumer already
reads. No consumer changes: the merge output is the same shape a probe
produced.

manualEntry builds an entry with status 'unknown' unless a pasted header
supplied live capacity, in which case the ratio-based status is meaningful
again. resetWindowSecs defaults to 60, matching what calculateEstimate
already assumes without a probed window.

setLimitSource drops recommendation, targetAnalysis, and targetMinutes for
the same reason clearLimitSources does — they were computed from the limits
being replaced, and a stale bottleneck reads as authoritative.
EOF
```

---

### Task 4: The manual entry modal

**Files:**
- Create: `src/renderer/components/ManualLimitsModal.tsx`

No tests — this is presentation over already-tested functions. Follows the `ConnectOrgModal` structure and uses the dark theme tokens.

- [ ] **Step 1: Create the component**

```tsx
import React, { useMemo, useState } from 'react';
import { useStore } from '../hooks/useStore';
import { EndpointProbeResult } from '../../shared/types';
import {
  KNOWN_LIMIT_BUCKETS, LimitBucket, manualEntry, parseRateLimitHeaders,
} from '../../shared/limit-sources';

interface Props {
  onClose: () => void;
}

function bucketKey(b: LimitBucket): string {
  return `${b.method}|${b.label}`;
}

export default function ManualLimitsModal({ onClose }: Props) {
  const { limitSources, setLimitSource } = useStore();
  const [rows, setRows] = useState<EndpointProbeResult[]>(limitSources.manual ?? []);
  const [selectedKey, setSelectedKey] = useState(bucketKey(KNOWN_LIMIT_BUCKETS[0]));
  const [limitInput, setLimitInput] = useState('');
  const [paste, setPaste] = useState('');
  const [error, setError] = useState<string | null>(null);

  const bucketsByKey = useMemo(() => {
    const m = new Map<string, LimitBucket>();
    for (const b of KNOWN_LIMIT_BUCKETS) m.set(bucketKey(b), b);
    return m;
  }, []);

  const upsert = (entry: EndpointProbeResult) => {
    setRows(prev => [
      ...prev.filter(r => !(r.label === entry.label && r.method === entry.method)),
      entry,
    ]);
  };

  const handleAdd = () => {
    setError(null);
    const bucket = bucketsByKey.get(selectedKey);
    if (!bucket) return;
    const limit = parseInt(limitInput.trim(), 10);
    if (!Number.isFinite(limit) || limit <= 0) {
      setError('Enter a limit greater than zero.');
      return;
    }
    upsert(manualEntry(bucket, limit));
    setLimitInput('');
  };

  const handlePaste = () => {
    setError(null);
    const parsed = parseRateLimitHeaders(paste);
    if (!parsed) {
      setError('No x-rate-limit-limit header found in that text.');
      return;
    }
    const bucket = bucketsByKey.get(selectedKey);
    if (!bucket) return;
    upsert(manualEntry(bucket, parsed.limit, parsed));
    setPaste('');
  };

  const handleSave = () => {
    setLimitSource('manual', rows, 'Manual entry');
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative bg-surface-1 border border-border rounded-xl w-full max-w-2xl mx-4 p-6 max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-sm font-semibold text-text-primary">Enter Rate Limits</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-text-muted hover:text-text-secondary"
            aria-label="Close"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M1 1l12 12M13 1L1 13" />
            </svg>
          </button>
        </div>

        <p className="text-xs text-text-muted mb-4">
          Enter only the buckets you care about. Anything you leave out is reported as missing
          coverage rather than guessed at. Nothing is written to disk — these values are gone when
          OTTO closes.
        </p>

        <div className="space-y-4">
          <div>
            <label htmlFor="ml-bucket" className="block text-xs font-medium text-text-secondary mb-1.5 uppercase tracking-wide">
              Bucket
            </label>
            <select
              id="ml-bucket"
              value={selectedKey}
              onChange={(e) => setSelectedKey(e.target.value)}
              className="w-full px-3 py-2.5 bg-surface-0 border border-border rounded-lg text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-teal/30"
            >
              {KNOWN_LIMIT_BUCKETS.map(b => (
                <option key={bucketKey(b)} value={bucketKey(b)}>
                  {b.method} — {b.label}
                </option>
              ))}
            </select>
          </div>

          <div className="flex gap-2 items-end">
            <div className="flex-1">
              <label htmlFor="ml-limit" className="block text-xs font-medium text-text-secondary mb-1.5 uppercase tracking-wide">
                Limit (requests per window)
              </label>
              <input
                id="ml-limit"
                type="number"
                min="1"
                value={limitInput}
                onChange={(e) => setLimitInput(e.target.value)}
                placeholder="600"
                className="w-full px-3 py-2.5 bg-surface-0 border border-border rounded-lg text-sm text-text-primary placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-accent-teal/30 font-mono"
              />
            </div>
            <button
              type="button"
              onClick={handleAdd}
              className="px-4 py-2.5 bg-accent-teal text-surface-0 text-sm font-semibold rounded-lg hover:bg-accent-teal/90 transition-colors"
            >
              Add
            </button>
          </div>

          <div>
            <label htmlFor="ml-paste" className="block text-xs font-medium text-text-secondary mb-1.5 uppercase tracking-wide">
              Or paste response headers
            </label>
            <textarea
              id="ml-paste"
              value={paste}
              onChange={(e) => setPaste(e.target.value)}
              rows={3}
              placeholder={'x-rate-limit-limit: 600\nx-rate-limit-remaining: 599'}
              className="w-full px-3 py-2.5 bg-surface-0 border border-border rounded-lg text-xs text-text-primary placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-accent-teal/30 font-mono"
            />
            <button
              type="button"
              onClick={handlePaste}
              disabled={paste.trim().length === 0}
              className="mt-2 px-3 py-1.5 text-xs font-medium border border-border text-text-secondary rounded-lg hover:bg-surface-3 disabled:opacity-40 transition-colors"
            >
              Add from headers
            </button>
            <p className="text-xs text-text-muted mt-1.5">
              Applies to the bucket selected above. Capture with:{' '}
              <code className="font-mono">curl -sD - -o /dev/null -H "Authorization: SSWS $TOKEN" "https://org.okta.com/api/v1/users?limit=1"</code>
            </p>
          </div>

          {error && (
            <div className="bg-accent-red/10 border border-accent-red/30 rounded-lg p-3 text-sm text-accent-red">
              {error}
            </div>
          )}

          {rows.length > 0 && (
            <div className="border border-border rounded-lg overflow-hidden">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-text-muted uppercase tracking-wide border-b border-border">
                    <th className="px-3 py-2 font-medium">Bucket</th>
                    <th className="px-3 py-2 font-medium text-right">Limit</th>
                    <th className="px-3 py-2 font-medium text-right">Remaining</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.map(r => (
                    <tr key={`${r.method}|${r.label}`}>
                      <td className="px-3 py-2 text-text-secondary">
                        <span className={`inline-block px-1.5 py-0.5 rounded mr-1.5 font-mono ${r.method === 'GET' ? 'bg-accent-green/20 text-accent-green' : 'bg-accent-amber/20 text-accent-amber'}`}>
                          {r.method}
                        </span>
                        {r.label}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-text-primary">{r.limit}</td>
                      <td className="px-3 py-2 text-right font-mono text-text-muted">
                        {r.remaining ?? '—'}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <button
                          type="button"
                          onClick={() => setRows(prev => prev.filter(x => !(x.label === r.label && x.method === r.method)))}
                          className="text-text-muted hover:text-accent-red"
                          aria-label={`Remove ${r.method} ${r.label}`}
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <button
            type="button"
            onClick={handleSave}
            disabled={rows.length === 0}
            className="w-full py-2.5 px-4 bg-accent-teal text-surface-0 text-sm font-semibold rounded-lg hover:bg-accent-teal/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Use these limits
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit && npx jest`

Expected: `tsc` silent, exit 0. All tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/components/ManualLimitsModal.tsx
git commit -F - <<'EOF'
feat(limits): add the manual rate limit entry modal

The primary path for the whole feature: a support engineer who already knows
a customer's limits from an internal lookup can now enter them without any
org connection.

Sparse by design — you enter the buckets you care about, and Phase 6 reports
the rest as missing coverage rather than guessing. Also accepts a pasted
header blob so a curl dump or a snippet from a case doesn't have to be
retyped, since that is where transcription errors would enter a figure bound
for an increase justification.

Says plainly in the UI that nothing is written to disk.
EOF
```

---

### Task 5: Source chooser and source-aware stat cards

**Files:**
- Modify: `src/renderer/pages/DashboardPage.tsx`

- [ ] **Step 1: Wire up the modal state**

In `src/renderer/pages/DashboardPage.tsx`, add the import:

```typescript
import ManualLimitsModal from '../components/ManualLimitsModal';
```

Add state next to the existing `showConnect`:

```typescript
  const [showManualLimits, setShowManualLimits] = useState(false);
```

Render it beside the other modals at the bottom of the component:

```tsx
      {showConnect && <ConnectOrgModal onClose={() => setShowConnect(false)} />}
      {showManualLimits && <ManualLimitsModal onClose={() => setShowManualLimits(false)} />}
```

- [ ] **Step 2: Replace the empty state with a source chooser**

Find the Rate Limits empty state block and replace it entirely:

```tsx
          {activeSection === 'rate-limits' && !probeResult && !probing && (
            <div className="bg-surface-2 rounded-xl border border-border p-8 text-center space-y-4">
              <div>
                <p className="text-text-primary font-medium">Where should rate limits come from?</p>
                <p className="text-text-secondary text-sm mt-1">
                  {connection.connected
                    ? 'Probe the connected org, or enter limits yourself.'
                    : 'No org connection required — enter limits you already have.'}
                </p>
              </div>
              <div className="flex gap-2 justify-center">
                {connection.connected ? (
                  <button
                    onClick={() => startProbe()}
                    className="px-4 py-2 text-xs font-medium bg-accent-teal text-surface-0 hover:bg-accent-teal/90 rounded-lg transition-colors"
                  >
                    Probe This Org
                  </button>
                ) : (
                  <button
                    onClick={() => setShowConnect(true)}
                    className="px-4 py-2 text-xs font-medium bg-accent-teal text-surface-0 hover:bg-accent-teal/90 rounded-lg transition-colors"
                  >
                    Connect Org
                  </button>
                )}
                <button
                  onClick={() => setShowManualLimits(true)}
                  className="px-4 py-2 text-xs font-medium border border-border text-text-secondary hover:bg-surface-3 rounded-lg transition-colors"
                >
                  Enter Limits Manually
                </button>
              </div>
            </div>
          )}
```

Add `startProbe` to the `useStore()` destructure at the top of the component if it isn't already there.

- [ ] **Step 3: Make the stat cards source-aware**

The third card reads "Scan Duration / sequential probing", which is meaningless for manual entry — it would show `0.0s`. Find the stat card grid and replace the third card:

```tsx
              <div className="grid grid-cols-3 gap-4">
                <StatCard label="Bottleneck" value={probeResult.overallMinLimit > 0 ? String(probeResult.overallMinLimit) : '—'} sub="req/window" />
                <StatCard
                  label="Endpoints"
                  value={String(probeResult.endpoints.filter(e => e.status !== 'error' && e.status !== 'skipped').length)}
                  sub={`of ${probeResult.endpoints.length} ${probeResult.sources.includes('probe') ? 'probed' : 'entered'}`}
                />
                {probeResult.sources.includes('probe') ? (
                  <StatCard label="Scan Duration" value={`${(probeResult.probeDurationMs / 1000).toFixed(1)}s`} sub="sequential probing" />
                ) : (
                  <StatCard
                    label="Source"
                    value={probeResult.sources.map(sourceLabel).join(' + ') || '—'}
                    sub={probeResult.orgUrl}
                  />
                )}
              </div>
```

Add the import:

```typescript
import { sourceLabel } from '../../shared/limit-sources';
```

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit && npx jest`

Expected: `tsc` silent, exit 0. All tests pass.

- [ ] **Step 5: Manual check**

Run: `npm run dev`

Without connecting an org: Rate Limits tab shows the chooser with "Enter Limits Manually". Add two buckets with different limits, save. The table should render them with `Manual` badges, dashes in Remaining and Reset, and the Bottleneck card should show the lower of the two.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/pages/DashboardPage.tsx
git commit -F - <<'EOF'
feat(limits): offer a source chooser instead of demanding an org connection

The Rate Limits tab previously dead-ended at "Connect to an org to probe
rate limits", which is exactly the wall a support engineer hits on any case
where the customer won't share credentials. It now offers manual entry
alongside probing, and says plainly that no connection is required.

Also makes the stat cards source-aware. The third card reported scan
duration and would have shown 0.0s for manually entered limits; it now
shows the contributing sources instead when no probe was involved, and the
endpoint count says "entered" rather than "probed".
EOF
```

---

### Task 6: Clear / Start Over

**Files:**
- Create: `src/renderer/components/ClearSourcesButton.tsx`
- Modify: `src/renderer/pages/DashboardPage.tsx`

- [ ] **Step 1: Create the component**

A session covers more than one case, so the engineer needs to reset without restarting the app. Confirmed because nothing is recoverable — none of it is persisted.

```tsx
import React, { useState } from 'react';
import { useStore } from '../hooks/useStore';

export default function ClearSourcesButton() {
  const { probeResult, clearLimitSources } = useStore();
  const [confirming, setConfirming] = useState(false);

  if (!probeResult) return null;

  if (confirming) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-xs text-text-secondary">Clear all rate limit data?</span>
        <button
          onClick={() => { clearLimitSources(); setConfirming(false); }}
          className="px-2.5 py-1 text-xs font-medium bg-accent-red text-surface-0 rounded-lg hover:bg-accent-red/90 transition-colors"
        >
          Clear
        </button>
        <button
          onClick={() => setConfirming(false)}
          className="px-2.5 py-1 text-xs font-medium border border-border text-text-secondary rounded-lg hover:bg-surface-3 transition-colors"
        >
          Cancel
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={() => setConfirming(true)}
      title="Drop all rate limit sources and start over"
      className="px-2.5 py-1 text-xs font-medium border border-border text-text-secondary rounded-lg hover:bg-surface-3 transition-colors"
    >
      Start Over
    </button>
  );
}
```

- [ ] **Step 2: Place it in the Rate Limits view**

In `DashboardPage.tsx`, add the import:

```typescript
import ClearSourcesButton from '../components/ClearSourcesButton';
```

Then put it above the table, in the populated Rate Limits branch — insert directly before the `<div className="bg-surface-2 rounded-xl border border-border overflow-hidden">` that wraps `RateLimitTable`:

```tsx
              <div className="flex justify-end">
                <ClearSourcesButton />
              </div>
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit && npx jest`

Expected: `tsc` silent, exit 0. All tests pass.

- [ ] **Step 4: Manual check — this is the important one**

Run: `npm run dev`

1. Enter manual limits, then set a target runtime in the Plan tab so `targetAnalysis` is populated.
2. Return to Rate Limits, click **Start Over**, confirm.
3. The chooser should reappear. Then go to the Plan tab and confirm the target analysis is **gone** — not showing the previous case's bottleneck.

That second check is the whole point of the task. A surviving analysis is the failure mode this feature exists to prevent.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/ClearSourcesButton.tsx src/renderer/pages/DashboardPage.tsx
git commit -F - <<'EOF'
feat(limits): add Start Over to drop all rate limit sources

One session covers more than one case, and manual limits are session-only,
so there needs to be a way to reset without restarting the app.

Confirmed before clearing because nothing is recoverable — none of it is
persisted by design. Clears through clearLimitSources, which resets the
recommendation, target analysis, and custom workloads too; leaving those
behind would show one case's computed figures under the next case's inputs,
and a stale bottleneck looks exactly as authoritative as a fresh one.

Leaves the org connection alone, since disconnecting is its own control.
EOF
```

---

## Verification checklist

- [ ] `npx jest` — all suites pass (270 before this plan, 284 after: 5 from Task 1, 7 from Task 2, 2 from Task 3)
- [ ] `npx tsc --noEmit` — silent, exit 0
- [ ] With no org connected, the Rate Limits tab offers manual entry
- [ ] Manually entered limits render with `Manual` badges and dashed Remaining/Reset
- [ ] The Bottleneck stat card reflects the lowest manually entered limit
- [ ] Pasting a curl header dump populates the selected bucket
- [ ] Pasting text with no `x-rate-limit-limit` shows an error rather than adding a zero row
- [ ] **Start Over clears the target analysis in the Plan tab, not just the table**
- [ ] Manual limits are gone after quitting and relaunching the app

## Out of scope

- **No log-derived producer.** Phase 4, and it needs the label mapping table.
- **No published baselines.** Phase 5.
- **No coverage reporting.** Phase 6 — until then, a sparse manual entry can understate the bottleneck without warning. This is the known gap at the end of this phase and the reason Phase 6 matters.
- **No persistence.** Session-only by decision; see the spec's Session Lifetime section.
- **No resource counting without an org.** Counts still need a connection; enter them through the existing `CustomWorkload` editor.
- **No component tests.** Node test environment, no jsdom.
