# Limit Source Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every rate limit value a tracked provenance, add the merge algorithm that combines limits from multiple sources, and stop stale derived state from surviving a source change.

**Architecture:** Every rate limit feature reads `store.probeResult`. A live org probe is currently the only producer. This phase teaches `EndpointProbeResult` to record *where* a limit came from, adds a pure `mergeLimitSources()` that combines producers by precedence, and introduces a single shared definition of "reset everything derived from limits" that both `disconnect()` and a new `clearLimitSources()` use. No new producers yet — those are Phase 3 onward.

**Tech Stack:** TypeScript, React 18 + Tailwind (dark theme tokens), Zustand, Jest with `ts-jest` in a **node** environment.

**Phase:** 2 of 6 from `docs/superpowers/specs/2026-08-19-rate-limit-sources-design.md`. Phase 1 (log parser bucket keying) is merged.

---

## Testing constraint — read this first

`jest.config.js` sets `testEnvironment: 'node'` and `testMatch: ['<rootDir>/src/__tests__/**/*.test.ts']` — note `.ts`, not `.tsx`. There is no jsdom, no `@testing-library/react`, and no existing component test anywhere in the repo.

**Do not write React component tests, and do not add testing infrastructure to make them possible.** That is a separate decision the user has not made.

The consequence shapes the design: all logic worth testing goes into pure functions in `src/shared/limit-sources.ts`, and `RateLimitTable.tsx` becomes a thin caller. Rendering is verified manually.

Store actions are also untestable in this setup (`useStore.ts` reaches `window.oktaTerraform`). That is why the reset logic becomes a pure function the store spreads, rather than logic living inside the action.

## File structure

| File | Responsibility | Change |
|------|---------------|--------|
| `src/shared/types.ts` | Shared types | `LimitSource`, `source` on `EndpointProbeResult`, `sources` on `ProbeResult`, optional `remaining`/`resetAt`, `'unknown'` status |
| `src/shared/limit-sources.ts` | **New.** Pure limit-source logic | `mergeLimitSources`, `hasLiveCapacity`, `sourceLabel`, `clearedLimitState` |
| `src/main/api/probe.ts` | Live org probe | Stamp `source: 'probe'` on 3 result literals |
| `src/main/api/deep-probe.ts` | Sub-resource probe | Stamp `source: 'probe'` on 6 result literals |
| `src/renderer/components/RateLimitTable.tsx` | Rate limit table | Source column; dash Remaining/Reset for unknown-capacity rows |
| `src/renderer/hooks/useStore.ts` | Zustand store | `clearLimitSources()` action; `disconnect()` reuses the same reset |
| `src/__tests__/limit-sources.test.ts` | **New.** Tests | Covers all four pure functions |

## Note on scope

`mergeLimitSources()` lands here with tests but **no caller** — Phase 3 (manual entry) is its first consumer. This is deliberate: it is the core algorithm, it is far easier to get right in isolation with tests than wired into UI, and the spec sequences it here. Do not build any producer for it in this phase.

---

### Task 1: Add provenance to the limit types

No test in this task. It is a type change plus mechanical stamping, and `tsc` is the verification — it will name every construction site you miss. Later tasks carry the tests.

**Pre-verified:** making `remaining` and `resetAt` optional is safe. The only read of `remaining` in the entire codebase is `RateLimitTable.tsx:56`, which Task 3 rewrites; `resetAt` has no readers at all outside construction. Nothing performs arithmetic on either. The `rl.remaining` passed to `determineStatus` in both probe files comes from a local `extractRateLimits` object, not an `EndpointProbeResult`, so it is unaffected.

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/main/api/probe.ts`
- Modify: `src/main/api/deep-probe.ts`

- [ ] **Step 1: Add the `LimitSource` type and extend `EndpointProbeResult`**

In `src/shared/types.ts`, find:

```typescript
// Probing
export interface EndpointProbeResult {
  endpoint: string;
  label: string;
  method: 'GET' | 'POST';
  limit: number;
  remaining: number;
  resetAt: number;
  resetWindowSecs: number;
  status: 'ok' | 'warning' | 'critical' | 'error' | 'skipped';
  httpStatus?: number;
  error?: string;
}
```

Replace with:

```typescript
// Probing

/**
 * Where a rate limit value came from. Precedence when merging, highest first:
 * manual (entered from a privileged internal lookup) > probe (measured now) >
 * log (measured at capture time) > baseline (published default, an estimate).
 */
export type LimitSource = 'probe' | 'log' | 'manual' | 'baseline';

export interface EndpointProbeResult {
  endpoint: string;
  label: string;
  method: 'GET' | 'POST';
  limit: number;
  /** Live capacity. Absent for manual and baseline sources, which know the limit but not current usage. */
  remaining?: number;
  /** Absent for manual and baseline sources. */
  resetAt?: number;
  resetWindowSecs: number;
  /** 'unknown' means the limit is known but live capacity is not — never rendered as critical. */
  status: 'ok' | 'warning' | 'critical' | 'error' | 'skipped' | 'unknown';
  source: LimitSource;
  httpStatus?: number;
  error?: string;
}
```

- [ ] **Step 2: Add `sources` to `ProbeResult`**

In the same file, find:

```typescript
export interface ProbeResult {
  orgUrl: string;
  timestamp: string;
  endpoints: EndpointProbeResult[];
  overallMinLimit: number;
  probeDurationMs: number;
}
```

Replace with:

```typescript
export interface ProbeResult {
  /** Display label for the limit set. An org URL for a live probe; a log filename or 'Manual entry' otherwise. */
  orgUrl: string;
  timestamp: string;
  endpoints: EndpointProbeResult[];
  overallMinLimit: number;
  probeDurationMs: number;
  /** Which producers contributed to this result. */
  sources: LimitSource[];
}
```

- [ ] **Step 3: Run `tsc` to enumerate every site that needs updating**

Run: `npx tsc --noEmit`

Expected: errors listing each object literal missing `source`, plus each `ProbeResult` literal missing `sources`. Write the list down — it is your worklist for steps 4 and 5. Expect sites in `src/main/api/probe.ts` and `src/main/api/deep-probe.ts`.

- [ ] **Step 4: Stamp `source: 'probe'` in `probe.ts`**

`src/main/api/probe.ts` has three `results.push({...})` literals — the success path, the error-with-rate-limit-headers path, and the skipped/error fallback. Add `source: 'probe',` as the last property of each, and add `sources: ['probe'],` to the final returned `ProbeResult`.

The success path becomes:

```typescript
      results.push({
        endpoint: endpoint.split('?')[0],
        label,
        method: 'GET',
        limit,
        remaining,
        resetAt,
        resetWindowSecs,
        status: determineStatus(remaining, limit),
        source: 'probe',
      });
```

The error-with-headers path becomes:

```typescript
          results.push({
            endpoint: endpoint.split('?')[0],
            label,
            method: 'GET',
            limit,
            remaining,
            resetAt,
            resetWindowSecs,
            status: determineStatus(remaining, limit),
            source: 'probe',
          });
```

The fallback path becomes:

```typescript
      results.push({
        endpoint: endpoint.split('?')[0],
        label,
        method: 'GET',
        limit: 0,
        remaining: 0,
        resetAt: 0,
        resetWindowSecs: 0,
        httpStatus,
        status: skipStatus,
        error: skipError,
        source: 'probe',
      });
```

And the final return becomes:

```typescript
  return {
    orgUrl,
    timestamp: new Date().toISOString(),
    endpoints: results,
    overallMinLimit,
    probeDurationMs: Date.now() - startTime,
    sources: ['probe'],
  };
```

- [ ] **Step 5: Stamp `source: 'probe'` in `deep-probe.ts`**

`src/main/api/deep-probe.ts` has six result literals inside `probeOne` and its caller loop: the success return, the rate-limit-from-error return, the 401/403/404/405 skipped return, the generic error return, the max-retries-exceeded return, and a `results.push({...})` for the pre-skipped case. Add `source: 'probe',` as the last property of each.

For example, the success return becomes:

```typescript
      return {
        endpoint: resolved.display,
        label: def.label,
        method,
        ...rl,
        httpStatus: response.status,
        status: determineStatus(rl.remaining, rl.limit),
        source: 'probe',
      };
```

and the skipped return becomes:

```typescript
        return {
          endpoint: resolved.display,
          label: def.label,
          method,
          limit: 0, remaining: 0, resetAt: 0, resetWindowSecs: 0,
          httpStatus,
          status: 'skipped',
          error: `${reason} (x-okta-request-id: ${reqId})`,
          source: 'probe',
        };
```

Apply the same one-line addition to the remaining four. Do not restructure these functions — a single added property each.

- [ ] **Step 6: Verify**

Run: `npx tsc --noEmit && npx jest`

Expected: `tsc` silent, exit 0. All 258 tests pass — no behavior changed, only types.

If `tsc` still reports missing `source`, a literal was missed. Find them: `grep -n "status: '" src/main/api/*.ts`

- [ ] **Step 7: Commit**

```bash
git add src/shared/types.ts src/main/api/probe.ts src/main/api/deep-probe.ts
git commit -F - <<'EOF'
feat(types): track where each rate limit value came from

Rate limit analysis currently assumes a live org probe is the only source.
Later phases add manual entry, log-derived limits, and published baselines,
and a number destined for a rate limit increase justification must never be
mistaken for a measurement when it is an estimate.

Adds a LimitSource union and a required source field on EndpointProbeResult,
plus sources on ProbeResult. remaining and resetAt become optional because
manual and baseline entries know the limit but not current usage, and status
gains 'unknown' for exactly that case — passing remaining=0 through the
ratio-based status derivation would render a healthy org entirely critical.

Both probe producers stamp source: 'probe'. No behavior change.
EOF
```

---

### Task 2: The merge algorithm

**Files:**
- Create: `src/shared/limit-sources.ts`
- Test: `src/__tests__/limit-sources.test.ts` (new)

- [ ] **Step 1: Write the failing tests**

Create `src/__tests__/limit-sources.test.ts`:

```typescript
import { mergeLimitSources } from '../shared/limit-sources';
import { EndpointProbeResult, LimitSource } from '../shared/types';

function ep(
  label: string,
  limit: number,
  source: LimitSource,
  method: 'GET' | 'POST' = 'GET',
): EndpointProbeResult {
  return {
    endpoint: `/api/v1/${label.toLowerCase()}`,
    label,
    method,
    limit,
    resetWindowSecs: 60,
    status: 'unknown',
    source,
  };
}

describe('mergeLimitSources', () => {
  it('prefers manual over every other source', () => {
    const result = mergeLimitSources({
      baseline: [ep('Users', 100, 'baseline')],
      log: [ep('Users', 200, 'log')],
      probe: [ep('Users', 300, 'probe')],
      manual: [ep('Users', 400, 'manual')],
    }, 'Manual entry');

    expect(result.endpoints).toHaveLength(1);
    expect(result.endpoints[0].limit).toBe(400);
    expect(result.endpoints[0].source).toBe('manual');
  });

  it('prefers probe over log and baseline', () => {
    const result = mergeLimitSources({
      baseline: [ep('Users', 100, 'baseline')],
      log: [ep('Users', 200, 'log')],
      probe: [ep('Users', 300, 'probe')],
    }, 'acme.okta.com');

    expect(result.endpoints[0].limit).toBe(300);
    expect(result.endpoints[0].source).toBe('probe');
  });

  it('prefers log over baseline', () => {
    const result = mergeLimitSources({
      baseline: [ep('Users', 100, 'baseline')],
      log: [ep('Users', 200, 'log')],
    }, 'run.log');

    expect(result.endpoints[0].limit).toBe(200);
    expect(result.endpoints[0].source).toBe('log');
  });

  it('uses baseline only to fill keys no other source provided', () => {
    const result = mergeLimitSources({
      baseline: [ep('Users', 100, 'baseline'), ep('Apps', 50, 'baseline')],
      manual: [ep('Users', 400, 'manual')],
    }, 'Manual entry');

    expect(result.endpoints).toHaveLength(2);
    const users = result.endpoints.find(e => e.label === 'Users');
    const apps = result.endpoints.find(e => e.label === 'Apps');
    expect(users?.limit).toBe(400);
    expect(users?.source).toBe('manual');
    expect(apps?.limit).toBe(50);
    expect(apps?.source).toBe('baseline');
  });

  it('keys by label AND method so read and write buckets never collide', () => {
    const result = mergeLimitSources({
      manual: [ep('App Users', 600, 'manual', 'GET'), ep('App Users', 100, 'manual', 'POST')],
    }, 'Manual entry');

    expect(result.endpoints).toHaveLength(2);
    const get = result.endpoints.find(e => e.method === 'GET');
    const post = result.endpoints.find(e => e.method === 'POST');
    expect(get?.limit).toBe(600);
    expect(post?.limit).toBe(100);
  });

  it('reports which sources actually contributed, not which were offered', () => {
    const result = mergeLimitSources({
      baseline: [ep('Users', 100, 'baseline')],
      manual: [ep('Users', 400, 'manual')],
    }, 'Manual entry');

    // baseline was supplied but entirely overridden, so it contributed nothing
    expect(result.sources).toEqual(['manual']);
  });

  it('computes overallMinLimit across contributing entries, ignoring zero limits', () => {
    const result = mergeLimitSources({
      manual: [ep('Users', 600, 'manual'), ep('Apps', 100, 'manual'), ep('Groups', 0, 'manual')],
    }, 'Manual entry');

    expect(result.overallMinLimit).toBe(100);
  });

  it('returns an empty result rather than throwing when given nothing', () => {
    const result = mergeLimitSources({}, 'Manual entry');

    expect(result.endpoints).toEqual([]);
    expect(result.sources).toEqual([]);
    expect(result.overallMinLimit).toBe(0);
    expect(result.orgUrl).toBe('Manual entry');
  });
});
```

- [ ] **Step 2: Run the tests, verify they FAIL**

Run: `npx jest src/__tests__/limit-sources.test.ts`

Expected: the whole suite fails to compile — `Cannot find module '../shared/limit-sources'`. Confirm before continuing.

- [ ] **Step 3: Implement `mergeLimitSources`**

Create `src/shared/limit-sources.ts`:

```typescript
import { EndpointProbeResult, LimitSource, ProbeResult } from './types';

/**
 * Precedence, lowest first — later entries win. Manual outranks a live probe
 * because a support engineer enters limits from a privileged internal lookup,
 * which reflects granted increases and custom multipliers that a probe of a
 * different org would not.
 */
const PRECEDENCE: LimitSource[] = ['baseline', 'log', 'probe', 'manual'];

/** A path's read and write limits are separate buckets and must never collide. */
function keyOf(ep: EndpointProbeResult): string {
  return `${ep.method}|${ep.label}`;
}

/**
 * Combine rate limits from multiple producers into a single ProbeResult.
 * Every consumer reads ProbeResult, so this is the only place provenance
 * precedence is decided.
 */
export function mergeLimitSources(
  sources: Partial<Record<LimitSource, EndpointProbeResult[]>>,
  displayLabel: string,
): ProbeResult {
  const merged = new Map<string, EndpointProbeResult>();

  for (const source of PRECEDENCE) {
    for (const ep of sources[source] ?? []) {
      merged.set(keyOf(ep), ep);
    }
  }

  const endpoints = [...merged.values()];

  // Report sources that survived the merge, not sources that were offered — a
  // baseline fully overridden by manual entry contributed nothing, and saying
  // otherwise would imply the result rests partly on an estimate when it does not.
  const contributed = PRECEDENCE.filter(s => endpoints.some(ep => ep.source === s));

  const withLimits = endpoints.filter(ep => ep.limit > 0);

  return {
    orgUrl: displayLabel,
    timestamp: new Date().toISOString(),
    endpoints,
    overallMinLimit: withLimits.length > 0 ? Math.min(...withLimits.map(ep => ep.limit)) : 0,
    probeDurationMs: 0,
    sources: contributed,
  };
}
```

- [ ] **Step 4: Run the tests, verify they PASS**

Run: `npx jest src/__tests__/limit-sources.test.ts`

Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add src/shared/limit-sources.ts src/__tests__/limit-sources.test.ts
git commit -F - <<'EOF'
feat(limits): add mergeLimitSources to combine limits by provenance

Later phases produce rate limits from manual entry, parsed logs, and
published baselines alongside the live probe. This is the single place the
precedence between them is decided: manual > probe > log > baseline. Manual
outranks a live probe because it comes from a privileged internal lookup
reflecting granted increases a probe cannot see.

Keyed by method and label so a path's read and write buckets never collide.
Reports the sources that survived the merge rather than those offered, so a
baseline fully overridden by manual entry does not make a measured result
look partly estimated.

Lands with tests but no caller — Phase 3 (manual entry) is the first consumer.
EOF
```

---

### Task 3: Keep unknown-capacity rows out of the critical path

Manual and baseline entries know the limit but not current usage. `determineStatus` derives status from `remaining / limit`, so feeding it `0` yields ratio 0 → `'critical'`, which would paint a healthy org's table entirely red.

**Files:**
- Modify: `src/shared/limit-sources.ts`
- Modify: `src/renderer/components/RateLimitTable.tsx`
- Test: `src/__tests__/limit-sources.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/__tests__/limit-sources.test.ts` — and add `hasLiveCapacity` to the existing import at the top of the file:

```typescript
describe('hasLiveCapacity', () => {
  it('is false when remaining is absent, so status is never derived from a missing value', () => {
    expect(hasLiveCapacity(ep('Users', 600, 'manual'))).toBe(false);
    expect(hasLiveCapacity(ep('Users', 600, 'baseline'))).toBe(false);
  });

  it('is true when remaining is present, including a genuine zero', () => {
    expect(hasLiveCapacity({ ...ep('Users', 600, 'probe'), remaining: 599 })).toBe(true);
    // exhausted is real data, not missing data
    expect(hasLiveCapacity({ ...ep('Users', 600, 'probe'), remaining: 0 })).toBe(true);
  });
});
```

- [ ] **Step 2: Run, verify FAIL**

Run: `npx jest src/__tests__/limit-sources.test.ts`

Expected: fails to compile — `hasLiveCapacity` is not exported.

- [ ] **Step 3: Implement `hasLiveCapacity`**

Append to `src/shared/limit-sources.ts`:

```typescript
/**
 * Whether this entry carries live capacity data. Manual and baseline entries
 * know the limit but not current usage. A remaining of 0 is real data (the
 * bucket is exhausted), so test for presence rather than truthiness.
 */
export function hasLiveCapacity(ep: EndpointProbeResult): boolean {
  return ep.remaining !== undefined;
}
```

- [ ] **Step 4: Run, verify PASS**

Run: `npx jest src/__tests__/limit-sources.test.ts`

Expected: PASS, 10 tests.

- [ ] **Step 5: Dash the capacity columns for unknown rows**

In `src/renderer/components/RateLimitTable.tsx`, add to the imports at the top:

```typescript
import { hasLiveCapacity } from '../../shared/limit-sources';
```

Then find:

```tsx
      <td className="px-4 py-3 text-right font-medium text-gray-900">
        {noData(ep) ? '—' : ep.limit}
      </td>
      <td className="px-4 py-3 text-right text-gray-600">
        {noData(ep) ? '—' : ep.remaining}
      </td>
      <td className="px-4 py-3 text-right text-gray-600">
        {noData(ep) ? '—' : `${ep.resetWindowSecs}s`}
      </td>
```

Replace with — the limit still shows, only the capacity columns dash:

```tsx
      <td className="px-4 py-3 text-right font-medium text-gray-900">
        {noData(ep) ? '—' : ep.limit}
      </td>
      <td className="px-4 py-3 text-right text-gray-600">
        {noData(ep) || !hasLiveCapacity(ep) ? '—' : ep.remaining}
      </td>
      <td className="px-4 py-3 text-right text-gray-600">
        {noData(ep) || !hasLiveCapacity(ep) ? '—' : `${ep.resetWindowSecs}s`}
      </td>
```

- [ ] **Step 6: Add `'unknown'` to the status colour map**

In the same file, find:

```tsx
const statusColors: Record<string, string> = {
  ok: 'bg-green-100 text-green-700',
  warning: 'bg-yellow-100 text-yellow-700',
  critical: 'bg-red-100 text-red-700',
  error: 'bg-red-50 text-red-500',
  skipped: 'bg-gray-100 text-gray-400',
};
```

Replace with:

```tsx
const statusColors: Record<string, string> = {
  ok: 'bg-green-100 text-green-700',
  warning: 'bg-yellow-100 text-yellow-700',
  critical: 'bg-red-100 text-red-700',
  error: 'bg-red-50 text-red-500',
  skipped: 'bg-gray-100 text-gray-400',
  // Limit is known, live capacity is not — neutral, never alarming
  unknown: 'bg-gray-100 text-gray-500',
};
```

Note: this file uses the old light Tailwind palette (`bg-green-100`, `text-gray-600`) rather than the dark theme tokens used elsewhere. Match the file you are in — do not migrate it, and do not introduce `accent-*` tokens here.

- [ ] **Step 7: Verify**

Run: `npx tsc --noEmit && npx jest`

Expected: `tsc` silent, exit 0. All tests pass.

- [ ] **Step 8: Commit**

```bash
git add src/shared/limit-sources.ts src/__tests__/limit-sources.test.ts src/renderer/components/RateLimitTable.tsx
git commit -F - <<'EOF'
feat(limits): render unknown-capacity rows neutrally instead of critical

determineStatus derives status from remaining / limit. Manual and baseline
entries know the limit but not current usage, so passing remaining=0 through
it yields ratio 0 and a 'critical' verdict — a healthy org's table would
render entirely red purely because nobody measured its live capacity.

Adds hasLiveCapacity, which tests for presence rather than truthiness since
a remaining of 0 is real data (bucket exhausted) rather than missing data.
The table keeps showing the limit and dashes only Remaining and Reset.
EOF
```

---

### Task 4: Show provenance in the rate limit table

**Files:**
- Modify: `src/shared/limit-sources.ts`
- Modify: `src/renderer/components/RateLimitTable.tsx`
- Test: `src/__tests__/limit-sources.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/__tests__/limit-sources.test.ts` — and add `sourceLabel` to the import at the top:

```typescript
describe('sourceLabel', () => {
  it('labels every source, marking baseline as an estimate', () => {
    expect(sourceLabel('probe')).toBe('Probed');
    expect(sourceLabel('log')).toBe('Log');
    expect(sourceLabel('manual')).toBe('Manual');
    // must read as an estimate — this value can reach an increase justification
    expect(sourceLabel('baseline')).toBe('Default');
  });
});
```

- [ ] **Step 2: Run, verify FAIL**

Run: `npx jest src/__tests__/limit-sources.test.ts`

Expected: fails to compile — `sourceLabel` is not exported.

- [ ] **Step 3: Implement `sourceLabel`**

Append to `src/shared/limit-sources.ts`:

```typescript
const SOURCE_LABELS: Record<LimitSource, string> = {
  probe: 'Probed',
  log: 'Log',
  manual: 'Manual',
  baseline: 'Default',
};

/** Short badge text for where a limit came from. */
export function sourceLabel(source: LimitSource): string {
  return SOURCE_LABELS[source];
}
```

- [ ] **Step 4: Run, verify PASS**

Run: `npx jest src/__tests__/limit-sources.test.ts`

Expected: PASS, 11 tests.

- [ ] **Step 5: Add the Source column**

In `src/renderer/components/RateLimitTable.tsx`, extend the import you added in Task 3:

```typescript
import { hasLiveCapacity, sourceLabel } from '../../shared/limit-sources';
```

Add the badge colour map next to `statusColors`:

```tsx
const sourceColors: Record<string, string> = {
  probe: 'bg-blue-50 text-blue-600',
  log: 'bg-indigo-50 text-indigo-600',
  manual: 'bg-purple-50 text-purple-600',
  // amber so an estimate reads as provisional next to measured values
  baseline: 'bg-amber-50 text-amber-700',
};
```

Add the header cell — find:

```tsx
          <th className="px-4 py-3 font-medium text-right">Reset</th>
          <th className="px-4 py-3 font-medium text-center">Status</th>
```

Replace with:

```tsx
          <th className="px-4 py-3 font-medium text-right">Reset</th>
          <th className="px-4 py-3 font-medium text-center">Source</th>
          <th className="px-4 py-3 font-medium text-center">Status</th>
```

Add the body cell — find the Reset cell you edited in Task 3 and insert a Source cell directly after it, before the Status cell:

```tsx
      <td className="px-4 py-3 text-right text-gray-600">
        {noData(ep) || !hasLiveCapacity(ep) ? '—' : `${ep.resetWindowSecs}s`}
      </td>
      <td className="px-4 py-3 text-center">
        <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${sourceColors[ep.source]}`}>
          {sourceLabel(ep.source)}
        </span>
      </td>
```

- [ ] **Step 6: Fix the footer colspan**

The table grew from 6 columns to 7. Find:

```tsx
            <td colSpan={6} className="px-4 py-2 text-xs text-gray-400">{footer}</td>
```

Replace with:

```tsx
            <td colSpan={7} className="px-4 py-2 text-xs text-gray-400">{footer}</td>
```

- [ ] **Step 7: Verify**

Run: `npx tsc --noEmit && npx jest`

Expected: `tsc` silent, exit 0. All tests pass.

- [ ] **Step 8: Commit**

```bash
git add src/shared/limit-sources.ts src/__tests__/limit-sources.test.ts src/renderer/components/RateLimitTable.tsx
git commit -F - <<'EOF'
feat(limits): show a Source badge for every rate limit row

Once limits can come from manual entry, a parsed log, or published
defaults, a bare number is ambiguous — and these numbers end up in rate
limit increase justifications. Every row now states its provenance, with
baseline rendered in amber so an estimate reads as provisional next to
measured values.

Every row currently reads "Probed"; the other sources arrive in Phase 3
onward. Also widens the footer colspan, which the new column broke.
EOF
```

---

### Task 5: One shared reset for everything derived from limits

This also fixes a live bug. `disconnect()` clears `probeResult`, `recommendation`, `selectedResources`, and `resourceCounts`, but not `targetAnalysis`, `targetMinutes`, or `customWorkloads`. Disconnect from org A, connect to org B, and org A's target analysis and cached workload rate limits are still on screen — presented as if they describe org B.

**Files:**
- Modify: `src/shared/limit-sources.ts`
- Modify: `src/renderer/hooks/useStore.ts`
- Test: `src/__tests__/limit-sources.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/__tests__/limit-sources.test.ts` — and add `clearedLimitState` to the import at the top:

```typescript
describe('clearedLimitState', () => {
  it('resets every piece of state derived from rate limits', () => {
    const cleared = clearedLimitState();

    // Asserted key by key on purpose: if new derived state is added to the
    // store and not added here, this test fails instead of the stale value
    // silently surviving a clear and appearing under a different org's inputs.
    expect(cleared).toEqual({
      probeResult: null,
      baselineProbeResult: null,
      probeProgress: null,
      recommendation: null,
      targetAnalysis: null,
      targetMinutes: null,
      customWorkloads: [],
    });
  });
});
```

- [ ] **Step 2: Run, verify FAIL**

Run: `npx jest src/__tests__/limit-sources.test.ts`

Expected: fails to compile — `clearedLimitState` is not exported.

- [ ] **Step 3: Implement `clearedLimitState`**

Append to `src/shared/limit-sources.ts`:

```typescript
import { ConfigRecommendation, CustomWorkloadEntry, ProbeProgress, TargetRuntimeAnalysis } from './types';

/**
 * Every piece of store state computed from rate limits. Returned as one object
 * so `disconnect()` and `clearLimitSources()` cannot drift apart.
 *
 * Leaving any of this behind is the worst failure mode for limit sources: the
 * numbers look authoritative but describe a previous org or case, and a stale
 * bottleneck figure can reach a rate limit increase justification unnoticed.
 */
export function clearedLimitState(): {
  probeResult: ProbeResult | null;
  baselineProbeResult: ProbeResult | null;
  probeProgress: ProbeProgress | null;
  recommendation: ConfigRecommendation | null;
  targetAnalysis: TargetRuntimeAnalysis | null;
  targetMinutes: number | null;
  customWorkloads: CustomWorkloadEntry[];
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
  };
}
```

Merge this `import` with the existing one at the top of the file rather than adding a second `from './types'` line.

- [ ] **Step 4: Run, verify PASS**

Run: `npx jest src/__tests__/limit-sources.test.ts`

Expected: PASS, 12 tests.

- [ ] **Step 5: Use it in `disconnect()` and add `clearLimitSources()`**

In `src/renderer/hooks/useStore.ts`, add to the imports:

```typescript
import { clearedLimitState } from '../../shared/limit-sources';
```

Add `clearLimitSources` to the store interface, directly after the `startProbe` declaration:

```typescript
  startProbe: () => Promise<void>;
  clearLimitSources: () => void;
```

Then find `disconnect()`:

```typescript
  disconnect: () => {
    api().disconnect();
    set({
      connection: { connected: false },
      probeResult: null,
      baselineProbeResult: null,
      recommendation: null,
      probeProgress: null,
      selectedResources: [],
      resourceCounts: [],
      operation: 'import',
    });
  },
```

Replace with:

```typescript
  disconnect: () => {
    api().disconnect();
    set({
      connection: { connected: false },
      ...clearedLimitState(),
      selectedResources: [],
      resourceCounts: [],
      operation: 'import',
    });
  },
```

This is the bug fix: `targetAnalysis`, `targetMinutes`, and `customWorkloads` were surviving a disconnect and could be shown under a different org.

Then add the new action immediately after `startProbe`'s closing brace:

```typescript
  clearLimitSources: () => {
    set(clearedLimitState());
  },
```

`clearLimitSources()` deliberately leaves `connection` alone — disconnecting is already its own separate control.

- [ ] **Step 6: Verify**

Run: `npx tsc --noEmit && npx jest`

Expected: `tsc` silent, exit 0. All tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/shared/limit-sources.ts src/__tests__/limit-sources.test.ts src/renderer/hooks/useStore.ts
git commit -F - <<'EOF'
fix(store): reset all limit-derived state on disconnect, and add clearLimitSources

disconnect() cleared probeResult, recommendation, selectedResources, and
resourceCounts but left targetAnalysis, targetMinutes, and customWorkloads
behind. Disconnecting from one org and connecting to another could therefore
show the first org's target analysis and cached workload rate limits as
though they described the second.

Extracts clearedLimitState() as the single definition of "everything derived
from rate limits" so disconnect() and the new clearLimitSources() cannot
drift apart, and asserts it key by key in tests — new derived state that
isn't added there fails the test rather than silently surviving a clear.

clearLimitSources() leaves the org connection alone; disconnecting is
already a separate control. The UI that calls it arrives in Phase 3.
EOF
```

---

## Verification checklist

- [ ] `npx jest` — all suites pass (258 before this plan, 270 after)
- [ ] `npx tsc --noEmit` — silent, exit 0
- [ ] `npm run dev` — Rate Limits tab after a probe shows a Source column reading "Probed" on every row, and the table is not visually broken by the extra column
- [ ] Manual check of the disconnect fix: connect, run a probe, set a target runtime in the Target Runtime tab, disconnect. The target analysis must be gone, not still showing the previous org's numbers.
- [ ] `grep -n "colSpan" src/renderer/components/RateLimitTable.tsx` — reads 7, not 6

## Out of scope

- **No producers.** Manual entry, log-derived limits, and baselines are Phases 3-5. `mergeLimitSources` ships with no caller.
- **No `limitSources` store state.** It has no producers to hold yet; Phase 3 adds it alongside manual entry.
- **No coverage reporting** in `target-analyzer.ts`. Phase 6.
- **No source chooser UI** for the Rate Limits empty state. Phase 3.
- **No component tests and no test infrastructure changes.** The repo has no jsdom or React testing library, and adding them is a separate decision.
- **No migration of `RateLimitTable.tsx` to the dark theme tokens.** It is on the old light palette; match it and leave it.
