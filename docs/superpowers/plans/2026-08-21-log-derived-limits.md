# Log-Derived Limits Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the rate limit headers already sitting in a customer's TF_LOG into a usable limit source, so no extra ask is needed when a debug log exists.

**Architecture:** `log-parser.ts` already extracts `minRateLimit` per `(method, pattern)` bucket and throws it away after display. This phase maps those rows into `EndpointProbeResult[]` with `source: 'log'` and feeds them through the existing `setLimitSource` → `mergeLimitSources` path. No new consumers; Phase 6's coverage accounting picks it up for free.

**Tech Stack:** TypeScript, React 18 + Tailwind (dark theme tokens), Zustand, Jest with `ts-jest` in a **node** environment.

**Phase:** 4 of 6 from `docs/superpowers/specs/2026-08-19-rate-limit-sources-design.md`. Phases 1-3 and 6 are merged.

---

## The label problem, and why it needs review

`target-analyzer` matches workloads to limits by **label string**. The log parser and the probe use different vocabularies, so log-derived limits need an explicit mapping or they silently match nothing.

Eight log labels already match probe labels exactly and need no entry: `App User Assignments`, `App Group Assignments`, `Group (single)`, `Group Members`, `User (single)`, `User Groups`, `Org Settings`, `User Types`.

Eight need mapping. **These pairings are domain judgial — Nicole should sanity-check them**, since a wrong pairing attributes a real measured limit to the wrong bucket, which is worse than having no limit at all:

| Log label | → Probe label | Reasoning |
|---|---|---|
| `Application` | `App (single)` | Both are `/api/v1/apps/{id}` |
| `App User (single)` | `App User Assignments` | `/apps/{id}/users/{id}` shares the collection's bucket |
| `App Group (single)` | `App Group Assignments` | Same reasoning |
| `Auth Server` | `Auth Server (single)` | Both are `/authorizationServers/{id}` |
| `Policy` | `Policies` | No `Policy (single)` label exists probe-side |
| `Network Zone` | `Network Zones` | No `Network Zone (single)` label exists |
| `Current User` | `Users` | `/users/me` is served by the users bucket |
| `User Roles` | `User Admin Roles` | Same endpoint, different label wording |

Three log labels are **deliberately left unmapped**:

- `Schema` — ambiguous between `User Schema (default)`, `Group Schema (default)`, and `App User Schema`. Guessing would attribute a limit to the wrong bucket.
- `Token Endpoint` and `OAuth2` — the OAuth2 token endpoint is a different rate limit family from the management API. Mapping it into a management bucket would be actively wrong.

Unmapped labels are carried through and displayed with their limit, but excluded from bottleneck matching. They show up as a bucket the analysis has data for but can't attribute — visible, not silently dropped.

## File structure

| File | Responsibility | Change |
|------|---------------|--------|
| `src/shared/limit-sources.ts` | Pure limit-source logic | `LOG_LABEL_TO_PROBE_LABEL`, `logDerivedLimits()` |
| `src/renderer/components/LogAnalyzer.tsx` | Debug tab log results | "Use these rate limits" action |
| `src/__tests__/limit-sources.test.ts` | Tests | Mapping and conversion coverage |

---

### Task 1: Map log rows into limit entries

**Files:**
- Modify: `src/shared/limit-sources.ts`
- Test: `src/__tests__/limit-sources.test.ts`

- [ ] **Step 1: Write the failing tests**

Add `logDerivedLimits` and `LOG_LABEL_TO_PROBE_LABEL` to the test file's `limit-sources` import, add `LogEndpointStats` to the `../shared/types` import, then append:

```typescript
function logStat(
  label: string,
  minRateLimit: number,
  method = 'GET',
  lowestRemaining = -1,
): LogEndpointStats {
  return {
    pattern: `/api/v1/${label.toLowerCase().replace(/\s+/g, '')}`,
    method,
    label,
    totalCalls: 10,
    rateLimited: 0,
    errors: 0,
    minRateLimit,
    lowestRemaining,
  };
}

describe('logDerivedLimits', () => {
  it('converts a log row into a log-sourced limit entry', () => {
    const [entry] = logDerivedLimits([logStat('Users', 600, 'GET', 550)]);

    expect(entry.label).toBe('Users');
    expect(entry.method).toBe('GET');
    expect(entry.limit).toBe(600);
    expect(entry.remaining).toBe(550);
    expect(entry.source).toBe('log');
  });

  it('drops rows with no observed limit rather than emitting a zero', () => {
    expect(logDerivedLimits([logStat('Users', 0)])).toEqual([]);
  });

  it('omits remaining when the log never showed one', () => {
    const [entry] = logDerivedLimits([logStat('Users', 600, 'GET', -1)]);

    // -1 is the parser's "never seen" marker, not a real zero
    expect(entry.remaining).toBeUndefined();
    expect(entry.status).toBe('unknown');
  });

  it('collapses non-GET methods to the write bucket', () => {
    const entries = logDerivedLimits([
      logStat('Users', 600, 'GET'),
      logStat('Users', 100, 'POST'),
      logStat('Users', 60, 'DELETE'),
    ]);

    const writes = entries.filter(e => e.method === 'POST');
    // POST and DELETE are both writes; EndpointProbeResult models only GET/POST
    expect(writes).toHaveLength(2);
    expect(entries.filter(e => e.method === 'GET')).toHaveLength(1);
  });

  it('translates log labels to the probe vocabulary so bottlenecks can match', () => {
    const [entry] = logDerivedLimits([logStat('User Roles', 400)]);
    expect(entry.label).toBe('User Admin Roles');
  });

  it('carries an unmapped label through instead of dropping the measurement', () => {
    const [entry] = logDerivedLimits([logStat('Token Endpoint', 300)]);
    // Deliberately unmapped — a different rate limit family from the management API
    expect(entry.label).toBe('Token Endpoint');
    expect(entry.limit).toBe(300);
  });

  it('maps every label the log parser can emit, or deliberately declines to', () => {
    // Guards against a labelForPattern addition silently going unmapped.
    const known = new Set([
      ...Object.keys(LOG_LABEL_TO_PROBE_LABEL),
      // exact matches, no mapping needed
      'App User Assignments', 'App Group Assignments', 'Group (single)', 'Group Members',
      'User (single)', 'User Groups', 'Org Settings', 'User Types',
      // deliberately unmapped
      'Schema', 'Token Endpoint', 'OAuth2',
    ]);
    const emitted = [
      'App Group (single)', 'App Group Assignments', 'App User (single)', 'App User Assignments',
      'Application', 'Auth Server', 'Current User', 'Group (single)', 'Group Members',
      'Network Zone', 'OAuth2', 'Org Settings', 'Policy', 'Schema', 'Token Endpoint',
      'User (single)', 'User Groups', 'User Roles', 'User Types',
    ];
    expect(emitted.filter(l => !known.has(l))).toEqual([]);
  });
});
```

- [ ] **Step 2: Run, verify FAIL**

Run: `npx jest src/__tests__/limit-sources.test.ts`

Expected: compile failure — neither export exists.

- [ ] **Step 3: Implement**

Append to `src/shared/limit-sources.ts`, adding `LogEndpointStats` to the existing `./types` import:

```typescript
/**
 * log-parser's labelForPattern and the probe's PROBE_ENDPOINTS use different
 * vocabularies, and target-analyzer matches workloads to limits by label string.
 * Without translation, log-derived limits merge and render but match nothing in
 * the runtime analysis, with no error to explain why.
 *
 * Labels absent from this table either already match the probe vocabulary
 * exactly, or are deliberately not mapped:
 *   'Schema'                    ambiguous across user/group/app schemas
 *   'Token Endpoint', 'OAuth2'  a different rate limit family from the
 *                               management API — mapping into a management
 *                               bucket would attribute a real limit wrongly
 */
export const LOG_LABEL_TO_PROBE_LABEL: Record<string, string> = {
  'Application': 'App (single)',
  'App User (single)': 'App User Assignments',
  'App Group (single)': 'App Group Assignments',
  'Auth Server': 'Auth Server (single)',
  'Policy': 'Policies',
  'Network Zone': 'Network Zones',
  'Current User': 'Users',
  'User Roles': 'User Admin Roles',
};

/**
 * Convert parsed log endpoint stats into limit entries.
 *
 * These are real measurements from the customer's own run, so they outrank
 * published defaults — but they describe the org at capture time, not now, which
 * is why they sit below a live probe in the merge precedence.
 */
export function logDerivedLimits(stats: LogEndpointStats[]): EndpointProbeResult[] {
  return stats
    .filter(s => s.minRateLimit > 0)
    .map(s => {
      // EndpointProbeResult models only read and write buckets. PUT and DELETE
      // are writes, so they collapse to POST.
      const method: 'GET' | 'POST' = s.method.toUpperCase() === 'GET' ? 'GET' : 'POST';
      // The parser uses -1 for "no remaining header ever seen"; a real 0 means
      // the bucket was exhausted, and hasLiveCapacity() must tell them apart.
      const remaining = s.lowestRemaining >= 0 ? s.lowestRemaining : undefined;
      return {
        endpoint: s.pattern,
        label: LOG_LABEL_TO_PROBE_LABEL[s.label] ?? s.label,
        method,
        limit: s.minRateLimit,
        resetWindowSecs: 60,
        status: remaining === undefined ? 'unknown' : deriveStatus(remaining, s.minRateLimit),
        source: 'log' as const,
        ...(remaining !== undefined ? { remaining } : {}),
      };
    });
}
```

- [ ] **Step 4: Run, verify PASS**

Run: `npx jest src/__tests__/limit-sources.test.ts`

Expected: PASS, 33 tests.

- [ ] **Step 5: Full verify and commit**

Run: `npx tsc --noEmit && npx jest`

```bash
git add src/shared/limit-sources.ts src/__tests__/limit-sources.test.ts
git commit -F - <<'EOF'
feat(limits): derive rate limits from a parsed TF_LOG

The log parser already extracts a per-bucket minRateLimit from the
X-Rate-Limit-Limit headers in a debug log and discards it after display. A
customer-attached log is the cheapest limit source available — it needs no
credentials and no extra ask.

The two sides use different label vocabularies, and target-analyzer matches
by label, so an explicit mapping table translates them. Three log labels are
deliberately unmapped: 'Schema' is ambiguous across user/group/app schemas,
and the OAuth2 token endpoint is a different rate limit family from the
management API. Unmapped labels carry through with their limit rather than
being dropped — visible but unattributed beats silently discarded.

Non-GET methods collapse to POST since EndpointProbeResult models only read
and write buckets, and the parser's -1 "never seen" marker for remaining is
preserved as undefined rather than becoming a false zero.
EOF
```

---

### Task 2: Offer the limits from the Debug tab

**Files:**
- Modify: `src/renderer/components/LogAnalyzer.tsx`

- [ ] **Step 1: Add the action**

In `src/renderer/components/LogAnalyzer.tsx`, add to the imports:

```typescript
import { logDerivedLimits } from '../../shared/limit-sources';
```

The component already reads `probeResult` via `useStore(state => state.probeResult)`. Add the setter beside it:

```typescript
  const setLimitSource = useStore(state => state.setLimitSource);
```

Then, directly above the `{analysis.endpoints.length > 0 && (` endpoint breakdown block, add:

```tsx
      {analysis.endpoints.some(e => e.minRateLimit > 0) && (
        <div className="bg-accent-teal/10 border border-accent-teal/30 rounded-xl p-4 flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-text-primary">
              This log contains {analysis.endpoints.filter(e => e.minRateLimit > 0).length} measured rate limits
            </p>
            <p className="text-xs text-text-muted mt-1">
              Use them for capacity planning without connecting to the org. They reflect the org at
              capture time, so a live probe takes precedence if you run one.
            </p>
          </div>
          <button
            onClick={() => setLimitSource('log', logDerivedLimits(analysis.endpoints), fileName ?? 'TF_LOG')}
            className="shrink-0 px-3 py-1.5 text-xs font-medium bg-accent-teal text-surface-0 rounded-lg hover:bg-accent-teal/90 transition-colors"
          >
            Use these rate limits
          </button>
        </div>
      )}
```

If the component has no `fileName` state holding the selected log's name, use the literal `'TF_LOG'` instead — the value is only a display label on the Rate Limits tab.

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit && npx jest`

Expected: `tsc` silent, exit 0. All tests pass.

- [ ] **Step 3: Manual check**

Run: `npm run dev`

1. Debug → TF_LOG Analyzer → select a log containing rate limit headers.
2. Confirm the teal banner appears above the endpoint breakdown with a plausible count.
3. Click **Use these rate limits**, then go to Rate Limits.
4. The table should show rows badged `Log`, and the Source stat card should read `Log`.
5. Go to Plan → Target Planner with a workload set and confirm the coverage line counts the log-derived buckets as measured.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/components/LogAnalyzer.tsx
git commit -F - <<'EOF'
feat(debug): offer a log's measured rate limits for capacity planning

A customer-attached debug log already contains the org's real rate limits.
Surfacing them at the point the log is parsed means no extra ask and no
credentials, which matters because most support cases never get either.

States plainly that the limits describe the org at capture time, since a
live probe outranks them in the merge precedence.
EOF
```

---

## Verification checklist

- [ ] `npx jest` — all suites pass (298 before this plan, 305 after)
- [ ] `npx tsc --noEmit` — silent, exit 0
- [ ] A parsed log offers its limits, and accepting them populates the Rate Limits table with `Log` badges
- [ ] A log with no rate limit headers shows no banner at all
- [ ] `User Roles` in a log becomes `User Admin Roles` and matches a workload's bucket in the Target Planner
- [ ] **Nicole reviews the eight label pairings above**

## Out of scope

- **Phase 5, published baselines.** Separate plan.
- **No re-parsing to recover reset windows.** Log-derived entries use the 60s default; the parser doesn't currently retain `X-Rate-Limit-Reset`.
- **No automatic adoption.** The user chooses to use a log's limits; parsing a log does not silently replace whatever source is active.
