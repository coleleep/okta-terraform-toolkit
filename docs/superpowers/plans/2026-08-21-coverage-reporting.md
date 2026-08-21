# Coverage Reporting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the target runtime analysis from silently inventing rate limits, and state plainly how much of the workload it actually had data for.

**Architecture:** `analyzeTargetRuntime` currently substitutes `100` for any bucket with no limit (`?? 100`, `|| 100`). With manual entry now deliberately sparse, that turns a skipped bucket into a confident wrong verdict. This phase replaces the fallbacks with explicit coverage accounting, surfaces it on `TargetRuntimeAnalysis`, and makes the UI refuse to render a green "achievable" badge when the data behind it is incomplete.

**Tech Stack:** TypeScript, React 18 + Tailwind (`TargetRuntime.tsx` is on the old light palette), Jest with `ts-jest` in a **node** environment.

**Phase:** 6 of 6 from `docs/superpowers/specs/2026-08-19-rate-limit-sources-design.md`. Phases 1-3 merged; 4 (log-derived) and 5 (baselines) deliberately deferred until this lands.

---

## Why this before Phases 4 and 5

Phase 3 shipped the feature and left a live hazard. Enter a limit for `Users`, skip `Apps`, and if `Apps` is the real constraint the analysis reports the target as achievable — no warning, no asterisk. The number then goes into a rate limit increase request.

Phases 4 and 5 make the feature broader. This one makes it trustworthy. Broad-but-wrong is the worse place to sit, so this goes first.

## The three places a number gets invented today

All in `src/main/api/target-analyzer.ts`:

1. **`analyzeTargetRuntime`, custom workload branch:** `const limit = probed?.limit ?? cw.rateLimit ?? 100;` — a bucket with no data becomes 100.
2. **`calculateEstimate`, custom workload branch:** `const limit = cw.rateLimit || 100;` — same, and note `||` also swallows a legitimately-cached 0.
3. **`calculateEstimate`, grid branch:** `Math.min(...)` over a filtered array that can be empty, yielding `Infinity`, which then propagates into the estimate rather than being reported as "no data".

Replacing these with honest accounting is the whole task.

## Testing note

`analyzeTargetRuntime` is a pure function in the main process — fully testable in the node environment, unlike the renderer components. All the coverage math gets real tests. The one UI change is verified by hand.

## File structure

| File | Responsibility | Change |
|------|---------------|--------|
| `src/shared/types.ts` | Shared types | `LimitCoverage` interface; `coverage` on `TargetRuntimeAnalysis` |
| `src/main/api/target-analyzer.ts` | Target runtime math | Coverage accounting; remove the three invented fallbacks; coverage in the summary |
| `src/renderer/components/TargetRuntime.tsx` | Target planner UI | Coverage banner; withhold the green badge when coverage is incomplete |
| `src/__tests__/target-analyzer.test.ts` | **New.** Tests | Coverage counts, no-invention, summary wording, degraded verdict |

---

### Task 1: Add the coverage type

**Files:**
- Modify: `src/shared/types.ts`

- [ ] **Step 1: Add `LimitCoverage` and put it on the analysis**

In `src/shared/types.ts`, find:

```typescript
export interface TargetRuntimeAnalysis {
  targetMinutes: number;
  achievable: boolean;
```

Insert the new interface directly above it, and add the field:

```typescript
/**
 * How much of the workload the analysis actually had rate limit data for.
 *
 * Manual entry is deliberately sparse, so an unentered bucket could be the real
 * bottleneck. Reporting this is what keeps an optimistic verdict from reading as
 * a measured one in a rate limit increase request.
 */
export interface LimitCoverage {
  /** Distinct rate limit buckets this workload touches. */
  relevant: number;
  /** Buckets resolved from a probe, a log, or manual entry. */
  measured: number;
  /** Buckets resolved from a published baseline — an estimate, not a measurement. */
  estimated: number;
  /** Bucket labels with no limit data at all. */
  missingLabels: string[];
}

export interface TargetRuntimeAnalysis {
  targetMinutes: number;
  achievable: boolean;
```

Then add `coverage` to the same interface, after `bottlenecks`:

```typescript
  bottlenecks: EndpointBottleneck[];
  coverage: LimitCoverage;
  recommendedConfig?: TerraformProviderConfig; // config if increases granted
  summary: string;
```

- [ ] **Step 2: Verify it fails to compile in the right place**

Run: `npx tsc --noEmit`

Expected: errors in `src/main/api/target-analyzer.ts` at each `return` that builds a `TargetRuntimeAnalysis` without `coverage`. That's your worklist for Task 2.

No commit yet — Task 2 makes this compile.

---

### Task 2: Account for coverage instead of inventing limits

**Files:**
- Modify: `src/main/api/target-analyzer.ts`
- Test: `src/__tests__/target-analyzer.test.ts` (new)

- [ ] **Step 1: Write the failing tests**

Create `src/__tests__/target-analyzer.test.ts`:

```typescript
import { analyzeTargetRuntime } from '../main/api/target-analyzer';
import {
  EndpointProbeResult, LimitSource, ProbeResult, ResourceWorkload,
  DEFAULT_PREVENTION_OPTIONS,
} from '../shared/types';

function ep(
  label: string,
  limit: number,
  source: LimitSource = 'manual',
  method: 'GET' | 'POST' = 'GET',
): EndpointProbeResult {
  return {
    endpoint: `/api/v1/${label.toLowerCase().replace(/\s+/g, '')}`,
    label,
    method,
    limit,
    resetWindowSecs: 60,
    status: 'unknown',
    source,
  };
}

function probe(endpoints: EndpointProbeResult[]): ProbeResult {
  const withLimits = endpoints.filter(e => e.limit > 0);
  return {
    orgUrl: 'Manual entry',
    timestamp: '2026-08-21T00:00:00.000Z',
    endpoints,
    overallMinLimit: withLimits.length > 0 ? Math.min(...withLimits.map(e => e.limit)) : 0,
    probeDurationMs: 0,
    sources: [...new Set(endpoints.map(e => e.source))],
  };
}

function customWorkload(
  entries: Array<{ resource: string; count: number; label: string; rateLimit?: number }>,
): ResourceWorkload {
  return {
    selected: [],
    counts: [],
    totalResources: entries.reduce((s, e) => s + e.count, 0),
    orgTotalResources: 0,
    operation: 'import',
    preventionOptions: { ...DEFAULT_PREVENTION_OPTIONS },
    customWorkloads: entries.map(e => ({
      terraformResource: e.resource,
      count: e.count,
      primaryEndpoint: `/api/v1/${e.label.toLowerCase()}`,
      endpointLabel: e.label,
      rateLimit: e.rateLimit ?? 0,
    })),
  };
}

describe('analyzeTargetRuntime coverage', () => {
  it('counts every bucket the workload touches as relevant', () => {
    const result = analyzeTargetRuntime(
      probe([ep('Users', 600), ep('Applications', 100)]),
      customWorkload([
        { resource: 'okta_user', count: 1000, label: 'Users' },
        { resource: 'okta_app_saml', count: 50, label: 'Applications' },
      ]),
      30,
    );

    expect(result.coverage.relevant).toBe(2);
    expect(result.coverage.measured).toBe(2);
    expect(result.coverage.missingLabels).toEqual([]);
  });

  it('reports a bucket with no limit data as missing rather than assuming 100', () => {
    const result = analyzeTargetRuntime(
      probe([ep('Users', 600)]),
      customWorkload([
        { resource: 'okta_user', count: 1000, label: 'Users' },
        { resource: 'okta_app_saml', count: 50, label: 'Applications' },
      ]),
      30,
    );

    expect(result.coverage.relevant).toBe(2);
    expect(result.coverage.measured).toBe(1);
    expect(result.coverage.missingLabels).toEqual(['Applications']);
    // 100 must not appear as a bottleneck limit — it was never measured
    expect(result.bottlenecks.every(b => b.currentLimit !== 100)).toBe(true);
  });

  it('counts a baseline-sourced limit as estimated, not measured', () => {
    const result = analyzeTargetRuntime(
      probe([ep('Users', 600, 'manual'), ep('Applications', 100, 'baseline')]),
      customWorkload([
        { resource: 'okta_user', count: 1000, label: 'Users' },
        { resource: 'okta_app_saml', count: 50, label: 'Applications' },
      ]),
      30,
    );

    expect(result.coverage.measured).toBe(1);
    expect(result.coverage.estimated).toBe(1);
  });

  it('says so in the summary when coverage is incomplete', () => {
    const result = analyzeTargetRuntime(
      probe([ep('Users', 600)]),
      customWorkload([
        { resource: 'okta_user', count: 1000, label: 'Users' },
        { resource: 'okta_app_saml', count: 50, label: 'Applications' },
      ]),
      30,
    );

    expect(result.summary).toContain('Applications');
    expect(result.summary.toLowerCase()).toContain('no limit data');
  });

  it('warns that an achievable verdict is provisional when data is missing', () => {
    const result = analyzeTargetRuntime(
      probe([ep('Users', 600)]),
      customWorkload([
        { resource: 'okta_user', count: 10, label: 'Users' },
        { resource: 'okta_app_saml', count: 5, label: 'Applications' },
      ]),
      600, // generous target, certainly achievable on what is known
    );

    expect(result.achievable).toBe(true);
    expect(result.summary.toLowerCase()).toContain('understated');
  });

  it('returns the no-data path instead of Infinity when nothing has a limit', () => {
    const result = analyzeTargetRuntime(
      probe([ep('Users', 0)]),
      customWorkload([{ resource: 'okta_user', count: 1000, label: 'Users' }]),
      30,
    );

    expect(result.achievable).toBe(false);
    expect(Number.isFinite(result.estimatedMinutes)).toBe(true);
    expect(result.coverage.measured).toBe(0);
    expect(result.coverage.missingLabels).toEqual(['Users']);
    expect(result.bottlenecks).toEqual([]);
  });

  it('does not treat a cached rateLimit of 0 as a real limit', () => {
    const result = analyzeTargetRuntime(
      probe([]),
      customWorkload([{ resource: 'okta_user', count: 1000, label: 'Users', rateLimit: 0 }]),
      30,
    );

    expect(result.coverage.measured).toBe(0);
    expect(result.coverage.missingLabels).toEqual(['Users']);
  });
});
```

- [ ] **Step 2: Run, verify FAIL**

Run: `npx jest src/__tests__/target-analyzer.test.ts`

Expected: compile failure — `coverage` doesn't exist on the returned object yet.

- [ ] **Step 3: Add the coverage helper**

At the top of `src/main/api/target-analyzer.ts`, after the imports, add:

```typescript
import { LimitCoverage } from '../../shared/types';

/** A limit only counts if it was actually resolved — never substitute a default. */
function resolveLimit(
  probeResult: ProbeResult,
  label: string,
): { limit: number; source: LimitSource } | null {
  const match = probeResult.endpoints.find(ep =>
    ep.label === label && ep.status !== 'error' && ep.status !== 'skipped' && ep.limit > 0
  );
  return match ? { limit: match.limit, source: match.source } : null;
}

function buildCoverage(
  probeResult: ProbeResult,
  labels: string[],
): LimitCoverage {
  const relevant = [...new Set(labels)];
  let measured = 0;
  let estimated = 0;
  const missingLabels: string[] = [];

  for (const label of relevant) {
    const resolved = resolveLimit(probeResult, label);
    if (!resolved) missingLabels.push(label);
    else if (resolved.source === 'baseline') estimated++;
    else measured++;
  }

  return { relevant: relevant.length, measured, estimated, missingLabels };
}

/** Appended to every summary so an optimistic verdict can never read as a measured one. */
function coverageNote(coverage: LimitCoverage): string {
  if (coverage.missingLabels.length === 0 && coverage.estimated === 0) return '';

  const parts: string[] = [];
  if (coverage.missingLabels.length > 0) {
    parts.push(
      `${coverage.missingLabels.length} of ${coverage.relevant} buckets have no limit data ` +
      `(${coverage.missingLabels.join(', ')}) — the bottleneck may be understated.`
    );
  }
  if (coverage.estimated > 0) {
    parts.push(
      `${coverage.estimated} bucket${coverage.estimated > 1 ? 's' : ''} used a published default ` +
      `rather than a measured limit.`
    );
  }
  return ` ${parts.join(' ')}`;
}
```

Add `LimitSource` to the existing `../../shared/types` import if it isn't already there.

- [ ] **Step 4: Use it in the custom workload branch and stop inventing 100**

In `analyzeTargetRuntime`, replace the custom workload bottleneck loop:

```typescript
  if (hasCustom) {
    // Custom workloads know their exact endpoint
    const callsPerResource = writeFactor === 0 ? 1.15 : writeFactor <= 0.5 ? 2.5 : writeFactor <= 0.8 ? 2 : 3;
    for (const cw of workload.customWorkloads) {
      totalApiCalls += Math.ceil(cw.count * callsPerResource);
      // Find the probed rate limit for this endpoint
      const probed = probeResult.endpoints.find(ep =>
        ep.label === cw.endpointLabel && ep.status !== 'error' && ep.status !== 'skipped' && ep.limit > 0
      );
      const limit = probed?.limit ?? cw.rateLimit ?? 100;
      if (bottleneckLimit === 0 || limit < bottleneckLimit) {
        bottleneckLimit = limit;
        bottleneckLabel = cw.endpointLabel;
        bottleneckEndpoint = cw.primaryEndpoint;
        bottleneckMethod = probed?.method ?? 'GET';
      }
    }
  } else {
```

with:

```typescript
  if (hasCustom) {
    // Custom workloads know their exact endpoint
    const callsPerResource = writeFactor === 0 ? 1.15 : writeFactor <= 0.5 ? 2.5 : writeFactor <= 0.8 ? 2 : 3;
    for (const cw of workload.customWorkloads) {
      totalApiCalls += Math.ceil(cw.count * callsPerResource);
      // No fallback limit. A bucket with no data is reported as missing coverage
      // rather than silently analysed as 100 — an invented limit produces an
      // invented bottleneck, and that figure reaches an increase request.
      const resolved = resolveLimit(probeResult, cw.endpointLabel);
      if (!resolved) continue;
      if (bottleneckLimit === 0 || resolved.limit < bottleneckLimit) {
        bottleneckLimit = resolved.limit;
        bottleneckLabel = cw.endpointLabel;
        bottleneckEndpoint = cw.primaryEndpoint;
        bottleneckMethod = probeResult.endpoints.find(
          ep => ep.label === cw.endpointLabel && ep.limit > 0
        )?.method ?? 'GET';
      }
    }
  } else {
```

- [ ] **Step 5: Compute coverage and thread it through both returns**

Still in `analyzeTargetRuntime`, immediately after the `if (hasCustom) { ... } else { ... }` block closes, add:

```typescript
  const relevantLabelsForCoverage = hasCustom
    ? workload.customWorkloads.map(cw => cw.endpointLabel)
    : workload.selected
        .map(type => RESOURCE_TYPES.find(r => r.type === type)?.probeLabel)
        .filter((l): l is string => !!l);
  const coverage = buildCoverage(probeResult, relevantLabelsForCoverage);
```

Then add `coverage` to the early no-data return:

```typescript
  if (bottleneckLimit === 0) {
    return {
      targetMinutes,
      achievable: false,
      estimatedMinutes: 0,
      requiredThroughput: 0,
      currentThroughput: 0,
      bottlenecks: [],
      coverage,
      summary: 'No rate limit data available for the selected resources.' + coverageNote(coverage),
    };
  }
```

Note `estimatedMinutes` changes from `Infinity` to `0`. `Infinity` serialises to `null` over IPC and renders as a broken value; zero with `achievable: false` and an explicit summary is honest and displayable.

Finally add `coverage` to the main return and append the note to both summary branches:

```typescript
  let summary: string;
  if (achievable) {
    summary = `Target of ${targetMinutes} min is achievable. ` +
      `Estimated runtime: ~${Math.round(estimatedMinutes)} min for ~${totalApiCalls.toLocaleString()} API calls ` +
      `against ${bottleneckLabel} (${bottleneckLimit} req/window).` + coverageNote(coverage);
  } else {
    summary = `Target of ${targetMinutes} min requires a rate limit increase. ` +
      `Estimated runtime: ~${Math.round(estimatedMinutes)} min. ` +
      `Bottleneck: ${bottleneckLabel} needs ${requiredLimitForTarget} req/window ` +
      `(currently ${bottleneckLimit}, +${bottlenecks[0]?.percentIncrease ?? 0}%).` + coverageNote(coverage);
  }

  return {
    targetMinutes,
    achievable,
    estimatedMinutes: Math.round(estimatedMinutes * 10) / 10,
    requiredThroughput: Math.round(requiredCallsPerMin),
    currentThroughput: Math.round(currentCallsPerMin),
    bottlenecks,
    coverage,
    recommendedConfig: suggestedConfig,
    summary,
  };
```

- [ ] **Step 6: Remove the remaining two invented values in `calculateEstimate`**

In `calculateEstimate`, the custom branch currently reads:

```typescript
    for (const cw of workload.customWorkloads) {
      const calls = Math.ceil(cw.count * callsPerResource);
      const limit = cw.rateLimit || 100;
      const throughput = limit * 0.9;
```

Replace with — buckets without a limit are skipped, matching the bottleneck logic:

```typescript
    for (const cw of workload.customWorkloads) {
      const calls = Math.ceil(cw.count * callsPerResource);
      // Skip rather than assume. `|| 100` also swallowed a legitimate cached 0.
      const resolved = resolveLimit(probeResult, cw.endpointLabel);
      if (!resolved) continue;
      const throughput = resolved.limit * 0.9;
```

and the line below it that reads `const windows = Math.ceil(calls / throughput);` stays as-is.

Then the grid branch's `Math.min` needs an empty guard. Replace:

```typescript
  const minLimit = Math.min(
    ...probeResult.endpoints
      .filter(e => e.status !== 'error' && e.status !== 'skipped' && e.limit > 0)
      .map(e => e.limit)
  );
```

with:

```typescript
  const limits = probeResult.endpoints
    .filter(e => e.status !== 'error' && e.status !== 'skipped' && e.limit > 0)
    .map(e => e.limit);
  // Math.min() of an empty list is Infinity, which propagated into the estimate
  // as a real number and rendered as a nonsense runtime.
  if (limits.length === 0) return 0;
  const minLimit = Math.min(...limits);
```

- [ ] **Step 7: Run, verify PASS**

Run: `npx jest src/__tests__/target-analyzer.test.ts`

Expected: PASS, 7 tests.

If the "provisional" test fails, check that `coverageNote` is appended to the *achievable* branch too — that's the case that matters most and the easiest to forget.

- [ ] **Step 8: Full verify**

Run: `npx tsc --noEmit && npx jest`

Expected: `tsc` silent, exit 0. All tests pass (291 before this plan, 298 after).

- [ ] **Step 9: Commit**

```bash
git add src/shared/types.ts src/main/api/target-analyzer.ts src/__tests__/target-analyzer.test.ts
git commit -F - <<'EOF'
fix(target): report coverage instead of inventing missing rate limits

Manual entry is deliberately sparse, and the analysis silently substituted
100 for any bucket without a limit — `probed?.limit ?? cw.rateLimit ?? 100`
in the bottleneck loop and `cw.rateLimit || 100` in the estimate. Enter a
limit for Users, skip Apps, and if Apps was the real constraint the verdict
came back achievable with no warning. That number goes into a rate limit
increase request.

Buckets without data are now skipped and reported through a coverage field
naming exactly which ones are missing, and the summary says the bottleneck
may be understated — including on the achievable branch, which is the case
that matters most. Baseline-sourced limits count as estimated rather than
measured, ready for Phase 5.

Also fixes two latent numeric bugs: Math.min() over an empty limit list
returned Infinity and propagated into the estimate as though it were real,
and `|| 100` swallowed a legitimately cached rateLimit of 0.
EOF
```

---

### Task 3: Withhold the confident badge when coverage is incomplete

**Files:**
- Modify: `src/renderer/components/TargetRuntime.tsx`

- [ ] **Step 1: Degrade the summary banner**

In `src/renderer/components/TargetRuntime.tsx`, find the summary banner and replace it:

```tsx
          {/* Summary banner */}
          <div className={`rounded-lg p-4 ${
            targetAnalysis.achievable
              ? 'bg-green-50 border border-green-200'
              : 'bg-red-50 border border-red-200'
          }`}>
            <div className="flex items-start gap-3">
              <span className="text-2xl">{targetAnalysis.achievable ? '✓' : '✗'}</span>
              <div>
                <p className={`text-sm font-medium ${targetAnalysis.achievable ? 'text-green-800' : 'text-red-800'}`}>
                  {targetAnalysis.achievable ? 'Target Achievable' : 'Rate Limit Increase Needed'}
                </p>
                <p className={`text-xs mt-1 ${targetAnalysis.achievable ? 'text-green-600' : 'text-red-600'}`}>
                  {targetAnalysis.summary}
                </p>
              </div>
            </div>
          </div>
```

with — an achievable verdict on incomplete data renders amber and hedged, never green and confident:

```tsx
          {/* Summary banner. An achievable verdict built on incomplete coverage is
              rendered as provisional, not confirmed — a green check on a guess is
              how a wrong figure ends up in a customer-facing request. */}
          {(() => {
            const incomplete =
              targetAnalysis.coverage.missingLabels.length > 0 ||
              targetAnalysis.coverage.estimated > 0;
            const tone = !targetAnalysis.achievable
              ? { box: 'bg-red-50 border-red-200', title: 'text-red-800', body: 'text-red-600', icon: '✗' }
              : incomplete
                ? { box: 'bg-amber-50 border-amber-200', title: 'text-amber-800', body: 'text-amber-700', icon: '!' }
                : { box: 'bg-green-50 border-green-200', title: 'text-green-800', body: 'text-green-600', icon: '✓' };
            const title = !targetAnalysis.achievable
              ? 'Rate Limit Increase Needed'
              : incomplete
                ? 'Target Appears Achievable — Incomplete Data'
                : 'Target Achievable';
            return (
              <div className={`rounded-lg p-4 border ${tone.box}`}>
                <div className="flex items-start gap-3">
                  <span className="text-2xl">{tone.icon}</span>
                  <div>
                    <p className={`text-sm font-medium ${tone.title}`}>{title}</p>
                    <p className={`text-xs mt-1 ${tone.body}`}>{targetAnalysis.summary}</p>
                  </div>
                </div>
              </div>
            );
          })()}
```

- [ ] **Step 2: Show the coverage line explicitly**

Directly after the banner, add a coverage readout so the numbers are visible without parsing prose:

```tsx
          <div className="text-xs text-gray-500">
            Coverage: {targetAnalysis.coverage.measured} measured
            {targetAnalysis.coverage.estimated > 0 && `, ${targetAnalysis.coverage.estimated} estimated`}
            {' '}of {targetAnalysis.coverage.relevant} rate limit bucket{targetAnalysis.coverage.relevant === 1 ? '' : 's'}
            {targetAnalysis.coverage.missingLabels.length > 0 && (
              <span className="text-amber-600">
                {' '}— no data for {targetAnalysis.coverage.missingLabels.join(', ')}
              </span>
            )}
          </div>
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit && npx jest`

Expected: `tsc` silent, exit 0. All tests pass.

- [ ] **Step 4: Manual check**

Run: `npm run dev`

1. Enter a manual limit for `GET Users` only.
2. Add two custom workloads — `okta_user` (1000) and `okta_app_saml` (50).
3. Set a generous target, e.g. 4 hours, and analyze.

Expect an **amber** "Target Appears Achievable — Incomplete Data" banner, a coverage line reading `1 measured of 2 rate limit buckets — no data for Applications`, and the summary saying the bottleneck may be understated. Before this change that same input produced a green check.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/TargetRuntime.tsx
git commit -F - <<'EOF'
feat(target): render an achievable verdict as provisional when data is missing

A green check on an incomplete analysis is how an optimistic number ends up
in a customer-facing rate limit request. When any bucket has no limit data,
or a limit came from a published default, an achievable verdict now renders
amber as "Target Appears Achievable — Incomplete Data" instead.

Adds an explicit coverage readout — measured, estimated, and which buckets
have no data — so the numbers are visible without reading the summary prose.
EOF
```

---

### Task 4: Update the docs

**Files:**
- Modify: `docs/USAGE.md`
- Modify: `docs/FEATURES.md`

- [ ] **Step 1: Replace the sparse-entry caveat in USAGE.md**

The Rate Limit Probing tips currently warn the reader to be careful about skipped buckets. That warning is now enforced by the tool, so replace this tip:

```markdown
- Manual entry is **sparse on purpose** — enter only the buckets that matter. Be aware that a bucket you skip could be the real bottleneck, so the analysis may be optimistic until you've covered the endpoints your workload actually touches.
```

with:

```markdown
- Manual entry is **sparse on purpose** — enter only the buckets that matter. The Target Runtime Planner reports its own coverage, names any bucket it had no data for, and downgrades an "achievable" verdict to "Appears Achievable — Incomplete Data" rather than assuming a limit it was never given.
```

- [ ] **Step 2: Note it in FEATURES.md**

In the **Target Runtime Planner** section, append to the description:

```markdown
Coverage is reported alongside the verdict: how many rate limit buckets had measured limits, how many fell back to published defaults, and which had no data at all. A bucket with no limit is never assigned an assumed value — an achievable verdict built on partial data is labelled as provisional, because these figures are used to justify rate limit increase requests.
```

- [ ] **Step 3: Commit**

```bash
git add docs/USAGE.md docs/FEATURES.md
git commit -F - <<'EOF'
docs: describe target runtime coverage reporting

The sparse-manual-entry caveat told the reader to watch out for skipped
buckets themselves. The tool now enforces it — replaces the warning with
what actually happens.
EOF
```

---

## Verification checklist

- [ ] `npx jest` — all suites pass (291 before this plan, 298 after)
- [ ] `npx tsc --noEmit` — silent, exit 0
- [ ] `grep -n "|| 100\|?? 100" src/main/api/target-analyzer.ts` — returns nothing
- [ ] With one bucket entered and two in the workload, the banner is amber and names the missing bucket
- [ ] With every relevant bucket entered, the banner is green and no coverage warning appears
- [ ] A workload whose buckets have no limits at all reports "No rate limit data available", not a nonsense runtime

## Out of scope

- **Phases 4 and 5** — log-derived limits and published baselines. `coverage.estimated` will read 0 until Phase 5 exists, which is correct rather than dead code: it counts `source === 'baseline'` and there simply aren't any yet.
- **No change to the runtime estimate model itself.** Skipping unmeasured buckets changes which buckets feed the estimate, but the arithmetic is untouched.
- **No coverage reporting for resource counts.** Counts still need an org; that's a separate gap.
