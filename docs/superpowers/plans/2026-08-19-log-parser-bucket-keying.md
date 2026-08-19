# Log Parser Bucket Keying Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the log parser from merging a path's read and write rate limit buckets into one number, so log-derived limits reflect the bucket they actually came from.

**Architecture:** `parseLogFile` keys its endpoint accumulator by normalized path alone, so every GET and POST to the same path shares one entry and `minRateLimit` takes `Math.min` across both. Okta's write buckets are typically far lower than read buckets, so one POST drags the whole path's reported limit down to the write value. The HTTP method is already present in the log line and discarded. This plan captures it, keys the accumulator by `method|pattern`, and surfaces the method in the two places these rows are consumed.

**Tech Stack:** TypeScript, Node `readline` streaming parser, Jest, React 18 + Tailwind (renderer).

**Phase:** 1 of 6 from `docs/superpowers/specs/2026-08-19-rate-limit-sources-design.md`. Independently shippable — it makes the existing Debug tab correct on its own, and is a prerequisite for the log-derived limit producer in a later phase.

---

## Why this matters

The conflated number feeds `analyzeTargetRuntime`, which picks the *minimum* limit as the bottleneck. An understated bottleneck produces an overstated required increase — walking into a rate limit approval asking for more than the data supports, which is worse than asking for nothing.

## File structure

| File | Responsibility | Change |
|------|---------------|--------|
| `src/shared/types.ts` | Shared type definitions | Add `method` to `LogEndpointStats` |
| `src/main/api/log-parser.ts` | Streaming TF_LOG parser | Capture `method=`, key accumulator by `method\|pattern` |
| `src/renderer/components/LogAnalyzer.tsx` | Debug tab log results UI | Method badge on the endpoint breakdown table |
| `src/main/api/claude.ts` | LLM prompt construction | Include method in the observed-rate-limits prompt block |
| `src/__tests__/log-parser.test.ts` | Parser tests | Extend with bucket-keying cases |

## Note on the `method` type

The spec wrote `method: 'GET' | 'POST'`. This plan uses `method: string` instead. Terraform issues `PUT` and `DELETE` as well, and those are real, separately-bucketed writes — forcing them into a two-value union would either lose information or lie about it. `EndpointProbeResult` keeps its `'GET' | 'POST'` union; the later phase that converts log stats into probe results maps `GET → 'GET'` and everything else → `'POST'` (the write bucket). The spec has been updated to match.

---

### Task 1: Capture the HTTP method and key endpoint stats by method + path

**Files:**
- Modify: `src/shared/types.ts` — `LogEndpointStats` interface
- Modify: `src/main/api/log-parser.ts` — `EndpointAccumulator`, request tracking, four `endpointMap` read sites, output loop
- Test: `src/__tests__/log-parser.test.ts`

- [ ] **Step 1: Write the failing tests**

Append this `describe` block to `src/__tests__/log-parser.test.ts`. It reuses the existing `writeLog` helper and `PREFIX` constant already at the top of that file — do not redefine them.

```typescript
describe('parseLogFile — rate limit bucket keying', () => {
  it('keeps GET and POST limits for the same path in separate buckets', async () => {
    const filePath = writeLog([
      `${PREFIX} performing request: method=GET url=https://acme.okta.com/api/v1/apps/0oa1b2c3d4e5f6g7h8i9/users?limit=200`,
      `${PREFIX} HTTP/2.0 200 OK`,
      `${PREFIX} X-Rate-Limit-Limit: 600`,
      `${PREFIX} X-Rate-Limit-Remaining: 599`,
      `${PREFIX} performing request: method=POST url=https://acme.okta.com/api/v1/apps/0oa1b2c3d4e5f6g7h8i9/users`,
      `${PREFIX} HTTP/2.0 200 OK`,
      `${PREFIX} X-Rate-Limit-Limit: 100`,
      `${PREFIX} X-Rate-Limit-Remaining: 12`,
    ]);

    const result = await parseLogFile(filePath);

    const rows = result.endpoints.filter(e => e.pattern === '/api/v1/apps/{id}/users');
    expect(rows).toHaveLength(2);

    const get = rows.find(r => r.method === 'GET');
    const post = rows.find(r => r.method === 'POST');
    expect(get?.minRateLimit).toBe(600);
    expect(post?.minRateLimit).toBe(100);
    expect(get?.lowestRemaining).toBe(599);
    expect(post?.lowestRemaining).toBe(12);
  });

  it('attributes 429s to the method that was rate limited', async () => {
    const filePath = writeLog([
      `${PREFIX} performing request: method=GET url=https://acme.okta.com/api/v1/users?limit=200`,
      `${PREFIX} HTTP/2.0 200 OK`,
      `${PREFIX} performing request: method=POST url=https://acme.okta.com/api/v1/users`,
      `${PREFIX} HTTP/2.0 429 Too Many Requests`,
    ]);

    const result = await parseLogFile(filePath);

    const get = result.endpoints.find(e => e.pattern === '/api/v1/users' && e.method === 'GET');
    const post = result.endpoints.find(e => e.pattern === '/api/v1/users' && e.method === 'POST');
    expect(get?.rateLimited).toBe(0);
    expect(post?.rateLimited).toBe(1);
    expect(result.rateLimited).toBe(1);
  });

  it('treats DELETE as its own bucket rather than folding it into reads', async () => {
    const filePath = writeLog([
      `${PREFIX} performing request: method=DELETE url=https://acme.okta.com/api/v1/groups/00g1b2c3d4e5f6g7h8i9`,
      `${PREFIX} HTTP/2.0 204 No Content`,
      `${PREFIX} X-Rate-Limit-Limit: 60`,
    ]);

    const result = await parseLogFile(filePath);

    const row = result.endpoints.find(e => e.pattern === '/api/v1/groups/{id}');
    expect(row?.method).toBe('DELETE');
    expect(row?.minRateLimit).toBe(60);
  });

  it('defaults to GET when the log line omits method=', async () => {
    const filePath = writeLog([
      `${PREFIX} performing request: url=https://acme.okta.com/api/v1/users?limit=200`,
      `${PREFIX} HTTP/2.0 200 OK`,
      `${PREFIX} X-Rate-Limit-Limit: 600`,
    ]);

    const result = await parseLogFile(filePath);

    expect(result.endpoints).toHaveLength(1);
    expect(result.endpoints[0].method).toBe('GET');
    expect(result.endpoints[0].minRateLimit).toBe(600);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest src/__tests__/log-parser.test.ts -v`

Expected: the four new tests fail. The first three fail on TypeScript compilation because `method` does not exist on `LogEndpointStats` (`ts-jest` reports `Property 'method' does not exist on type 'LogEndpointStats'`). The two pre-existing DPoP tests still pass.

- [ ] **Step 3: Add `method` to the `LogEndpointStats` type**

In `src/shared/types.ts`, find the `LogEndpointStats` interface and add the `method` field directly after `pattern`:

```typescript
export interface LogEndpointStats {
  pattern: string;
  method: string;            // HTTP method — read and write buckets have separate limits
  label: string;
  totalCalls: number;
  rateLimited: number;
  errors: number;
  minRateLimit: number;
  lowestRemaining: number;
  errorsByStatus?: Record<number, number>;  // per-endpoint error breakdown
}
```

- [ ] **Step 4: Add `pattern` and `method` to the accumulator**

In `src/main/api/log-parser.ts`, replace the `EndpointAccumulator` interface:

```typescript
interface EndpointAccumulator {
  pattern: string;        // normalized path, without method
  method: string;         // HTTP method this bucket belongs to
  totalCalls: number;
  rateLimited: number;
  errors: number;
  rateLimits: number[];   // X-Rate-Limit-Limit values seen
  remainings: number[];   // X-Rate-Limit-Remaining values seen
  errorsByStatus: Record<number, number>;
}
```

- [ ] **Step 5: Add the `currentKey` and `currentMethod` state variables**

In `parseLogFile`, find the existing state declarations:

```typescript
    const endpointMap = new Map<string, EndpointAccumulator>();
    let currentStatus: number | null = null;
    let currentEndpoint: string | null = null;
    let currentTimestamp: string | null = null;
```

Replace with:

```typescript
    // Keyed by `${method}|${pattern}` — a path's read and write rate limits are
    // separate buckets and must not be merged.
    const endpointMap = new Map<string, EndpointAccumulator>();
    let currentStatus: number | null = null;
    let currentEndpoint: string | null = null;
    let currentMethod = 'GET';
    let currentKey: string | null = null;
    let currentTimestamp: string | null = null;
```

`currentEndpoint` is retained deliberately: `errorDetailMap` and `labelForPattern` both want the bare path, not the composite key.

- [ ] **Step 6: Capture the method and build the composite key**

Find the request tracking block:

```typescript
      if (line.includes('performing request:')) {
        const urlMatch = line.match(/url=(https?:\/\/[^\s]+)/);
        if (urlMatch) {
          totalRequests++;
          currentEndpoint = normalizeEndpoint(urlMatch[1]);

          // Parallelism tracking
          pendingRequests++;
          if (pendingRequests > maxConcurrent) maxConcurrent = pendingRequests;

          const acc = endpointMap.get(currentEndpoint) || { totalCalls: 0, rateLimited: 0, errors: 0, rateLimits: [], remainings: [], errorsByStatus: {} };
          acc.totalCalls++;
          endpointMap.set(currentEndpoint, acc);
        }
      }
```

Replace with:

```typescript
      if (line.includes('performing request:')) {
        const urlMatch = line.match(/url=(https?:\/\/[^\s]+)/);
        if (urlMatch) {
          totalRequests++;
          currentEndpoint = normalizeEndpoint(urlMatch[1]);
          // Older provider versions may not log method=; GET is the safe default
          // because it reproduces the previous single-bucket behavior.
          const methodMatch = line.match(/method=([A-Za-z]+)/);
          currentMethod = methodMatch ? methodMatch[1].toUpperCase() : 'GET';
          currentKey = `${currentMethod}|${currentEndpoint}`;

          // Parallelism tracking
          pendingRequests++;
          if (pendingRequests > maxConcurrent) maxConcurrent = pendingRequests;

          const acc = endpointMap.get(currentKey) || {
            pattern: currentEndpoint,
            method: currentMethod,
            totalCalls: 0, rateLimited: 0, errors: 0, rateLimits: [], remainings: [], errorsByStatus: {},
          };
          acc.totalCalls++;
          endpointMap.set(currentKey, acc);
        }
      }
```

- [ ] **Step 7: Point the four remaining `endpointMap` reads at `currentKey`**

There are exactly four other `endpointMap.get(...)` call sites. Each currently reads `currentEndpoint`; each must read `currentKey`. Leave every surrounding line untouched.

In the 429 branch:

```typescript
          if (currentStatus === 429) {
            rateLimited++;
            if (currentKey) {
              const acc = endpointMap.get(currentKey);
              if (acc) acc.rateLimited++;
            }
            if (ts) last429Timestamp = timestampToMs(ts);
```

In the `>= 400` branch — note that only the `endpointMap` lookup changes; the `errorDetailMap` block below it keeps using `currentEndpoint`:

```typescript
          } else if (currentStatus >= 400) {
            errorCount++;
            errorsByStatus[currentStatus] = (errorsByStatus[currentStatus] || 0) + 1;
            if (currentKey) {
              const acc = endpointMap.get(currentKey);
              if (acc) {
                acc.errors++;
                acc.errorsByStatus[currentStatus] = (acc.errorsByStatus[currentStatus] || 0) + 1;
              }
            }
            if (currentEndpoint) {
              // Track error detail (will be enriched with error code if found)
              const detailKey = `${currentEndpoint}|${currentStatus}`;
```

The `if (currentEndpoint)` guard is split out from the `endpointMap` lookup here because the two now use different keys. Everything inside the `errorDetailMap` block stays exactly as it is.

In the two rate limit header branches:

```typescript
      // Rate limit headers
      if (line.includes('X-Rate-Limit-Limit:')) {
        const val = parseInt(line.split(':').pop()?.trim() || '0');
        if (currentKey && val > 0) {
          const acc = endpointMap.get(currentKey);
          if (acc) acc.rateLimits.push(val);
        }
      }
      if (line.includes('X-Rate-Limit-Remaining:')) {
        const val = parseInt(line.split(':').pop()?.trim() || '-1');
        if (val === 0) rateLimitExhausted++;
        if (currentKey && val >= 0) {
          const acc = endpointMap.get(currentKey);
          if (acc) acc.remainings.push(val);
        }
      }
```

- [ ] **Step 8: Emit `method` from the output loop**

Find the stats-building loop in the `rl.on('close', ...)` handler:

```typescript
      const endpoints: LogEndpointStats[] = [];
      for (const [pattern, acc] of endpointMap) {
        endpoints.push({
          pattern,
          label: labelForPattern(pattern),
          totalCalls: acc.totalCalls,
          rateLimited: acc.rateLimited,
          errors: acc.errors,
          minRateLimit: acc.rateLimits.length > 0 ? Math.min(...acc.rateLimits) : 0,
          lowestRemaining: acc.remainings.length > 0 ? Math.min(...acc.remainings) : -1,
          errorsByStatus: Object.keys(acc.errorsByStatus).length > 0 ? acc.errorsByStatus : undefined,
        });
      }
```

Replace with — iterating `.values()` so the composite key never needs splitting back apart:

```typescript
      const endpoints: LogEndpointStats[] = [];
      for (const acc of endpointMap.values()) {
        endpoints.push({
          pattern: acc.pattern,
          method: acc.method,
          label: labelForPattern(acc.pattern),
          totalCalls: acc.totalCalls,
          rateLimited: acc.rateLimited,
          errors: acc.errors,
          minRateLimit: acc.rateLimits.length > 0 ? Math.min(...acc.rateLimits) : 0,
          lowestRemaining: acc.remainings.length > 0 ? Math.min(...acc.remainings) : -1,
          errorsByStatus: Object.keys(acc.errorsByStatus).length > 0 ? acc.errorsByStatus : undefined,
        });
      }
```

- [ ] **Step 9: Run the tests to verify they pass**

Run: `npx jest src/__tests__/log-parser.test.ts -v`

Expected: PASS, 6 tests (4 new + 2 pre-existing DPoP tests).

- [ ] **Step 10: Run the full suite and typecheck**

Run: `npx jest && npx tsc --noEmit`

Expected: all suites pass. `tsc` produces no output and exits 0.

If `tsc` reports an error in `LogAnalyzer.tsx` or `claude.ts` about a missing `method` property, that is expected only if you added `method` as a *required* field and one of those files constructs a `LogEndpointStats` literal. Neither does — they only read. Any error here means a construction site was missed; find it with `grep -rn "LogEndpointStats" src/`.

- [ ] **Step 11: Commit**

```bash
git add src/shared/types.ts src/main/api/log-parser.ts src/__tests__/log-parser.test.ts
git commit -m "fix(log-parser): key endpoint stats by method so read and write limits stay separate

The endpoint accumulator was keyed by normalized path alone, so every GET
and POST to the same path shared one entry and minRateLimit took Math.min
across both. Okta's write buckets are typically far lower than read
buckets, so a single POST response dragged the reported limit for the
whole path down to the write value.

That number feeds analyzeTargetRuntime, which picks the minimum limit as
the bottleneck — an understated bottleneck produces an overstated required
increase, which is worse than asking for nothing.

The method was already present in the log line (method=GET url=...) and
discarded. Now captured, defaulting to GET when absent so older provider
logs behave as before, and carried through on LogEndpointStats."
```

---

### Task 2: Show the method on the endpoint breakdown table

Without this, a path hit by both methods renders as two visually identical rows and reads like a bug.

**Files:**
- Modify: `src/renderer/components/LogAnalyzer.tsx` — endpoint breakdown table body

- [ ] **Step 1: Add the method badge**

In `src/renderer/components/LogAnalyzer.tsx`, find the first cell of the endpoint breakdown row:

```tsx
                  <td className="px-4 py-2">
                    <span className="font-medium text-text-secondary">{ep.label}</span>
                    <span className="block font-mono text-text-muted text-xs">{ep.pattern}</span>
                  </td>
```

Replace with:

```tsx
                  <td className="px-4 py-2">
                    <span className="font-medium text-text-secondary">{ep.label}</span>
                    <span className="block font-mono text-text-muted text-xs">
                      <span className={`inline-block px-1.5 py-0.5 rounded mr-1.5 ${ep.method === 'GET' ? 'bg-accent-green/20 text-accent-green' : 'bg-accent-amber/20 text-accent-amber'}`}>
                        {ep.method}
                      </span>
                      {ep.pattern}
                    </span>
                  </td>
```

Use the `bg-accent-X/20 text-accent-X` badge idiom already defined at the top of this same file for critical/warning/info severities.

**Do not copy the badge colors from `RateLimitTable.tsx`.** That component is still on the old light Tailwind palette (`bg-green-100`, `text-gray-600`), while `LogAnalyzer.tsx` uses the dark theme tokens from `tailwind.config.js` where `surface-0` is `#0B0E14`. A `bg-emerald-100` chip is pale mint and glares against a `#161B27` row.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`

Expected: no output, exit 0.

- [ ] **Step 3: Verify visually**

Run: `npm start`

Then: Debug tab → TF_LOG Analyzer → select a debug log that contains both reads and writes. In the Endpoint Breakdown table, confirm each row shows a `GET` or `POST` badge before the path, and that a path appearing twice shows different Rate Limit values in the two rows.

If you have no such log handy, generate one:

```bash
TF_LOG=DEBUG terraform apply 2>&1 | tee terraform-debug.log
```

- [ ] **Step 4: Commit**

```bash
git add src/renderer/components/LogAnalyzer.tsx
git commit -m "feat(debug): badge the HTTP method on the endpoint breakdown table

Now that read and write limits are tracked as separate buckets, a path hit
by both methods produces two rows. Without a method badge they render as
visually identical rows with different numbers, which reads like a bug.
Uses the same emerald/amber read/write pairing as RateLimitTable."
```

---

### Task 3: Include the method in the LLM rate limit prompt block

`buildRateLimitContext` lists observed limits as `pattern: limit=N`. After the split, the same path appears twice with different numbers and reads as self-contradictory to the model.

**Files:**
- Modify: `src/main/api/claude.ts` — `buildRateLimitContext`, tier 1 branch

- [ ] **Step 1: Add the method to each prompt line**

In `src/main/api/claude.ts`, find the tier 1 branch of `buildRateLimitContext`:

```typescript
  // Tier 1: X-Rate-Limit-Limit headers extracted from the actual log run
  const observed = analysis.endpoints.filter(e => e.minRateLimit > 0);
  if (observed.length > 0) {
    const lines = observed.map(e =>
      `  ${e.pattern}: limit=${e.minRateLimit}/window, lowest_remaining=${e.lowestRemaining}`
    );
    return `ORG RATE LIMITS (source: X-Rate-Limit-Limit headers from this log run — org-specific):\n${lines.join('\n')}`;
  }
```

Replace with:

```typescript
  // Tier 1: X-Rate-Limit-Limit headers extracted from the actual log run
  const observed = analysis.endpoints.filter(e => e.minRateLimit > 0);
  if (observed.length > 0) {
    const lines = observed.map(e =>
      `  ${e.method} ${e.pattern}: limit=${e.minRateLimit}/window, lowest_remaining=${e.lowestRemaining}`
    );
    return `ORG RATE LIMITS (source: X-Rate-Limit-Limit headers from this log run — org-specific).
Read and write limits are separate buckets, so the same path may appear once per method with different limits:\n${lines.join('\n')}`;
  }
```

- [ ] **Step 2: Typecheck and run the full suite**

Run: `npx tsc --noEmit && npx jest`

Expected: `tsc` silent, exit 0. All suites pass.

- [ ] **Step 3: Commit**

```bash
git add src/main/api/claude.ts
git commit -m "fix(ai): include HTTP method in the observed rate limits prompt block

Read and write buckets are now tracked separately, so the same path can
appear twice with different limits. Listed without the method those lines
look self-contradictory to the model. Adds the method to each line and
states the read/write distinction explicitly in the block header."
```

---

### Task 4: Update the docs

**Files:**
- Modify: `docs/FEATURES.md` — Debug & Log Analysis section

- [ ] **Step 1: Amend the TF_LOG parsing bullet**

In `docs/FEATURES.md`, find:

```markdown
- **TF_LOG parsing** — extracts per-endpoint request stats, rate-limit hits, and error breakdowns from `TF_LOG=DEBUG` output
```

Replace with:

```markdown
- **TF_LOG parsing** — extracts per-endpoint request stats, rate-limit hits, and error breakdowns from `TF_LOG=DEBUG` output, tracked per HTTP method so a path's read and write rate limit buckets are reported separately
```

- [ ] **Step 2: Commit**

```bash
git add docs/FEATURES.md
git commit -m "docs: note per-method rate limit bucket tracking in log analysis"
```

---

## Verification checklist

- [ ] `npx jest` — all suites pass (253 before this plan, 257 after)
- [ ] `npx tsc --noEmit` — silent, exit 0
- [ ] `npm start` — Debug tab shows method badges, and a path hit by both GET and POST shows two rows with independent rate limits
- [ ] `grep -rn "endpointMap.get(currentEndpoint)" src/` returns nothing — every lookup moved to `currentKey`

## Out of scope

- **`errorDetailMap` stays keyed by `endpoint|status`.** Making error details method-aware would sharpen permissions diagnosis, since a 403 on POST means something different than on GET, but it is a separate improvement.
- **`labelForPattern` is unchanged.** Labels stay method-agnostic and the method rides as its own field. This is what lets these rows drop into `RateLimitTable`, which already splits GET from POST.
- **No log-derived `ProbeResult` producer.** That is a later phase and depends on a label mapping table this plan does not create.
