# Rate Limit Sources — Design Spec

**Date:** 2026-08-19
**Status:** Approved, ready for planning

---

## Problem

Rate limit analysis in OTTO requires a live org connection. The probe reads `x-rate-limit-*` headers from ~35 endpoints and everything downstream — the Rate Limits table, config recommendations, and the Target Runtime planner's bottleneck and increase-percentage math — consumes that result.

A support engineer sizing a rate limit increase usually cannot connect to the customer's org. Credentials aren't shared, and asking for artifacts costs a round trip that may never come back. Today that means the entire rate-limit half of OTTO is unavailable on exactly the cases where the increase question is being asked.

Separately, the engineer often *already knows* the customer's limits — custom and granted limits are visible internally. The blocker was never discovery; it was that OTTO offers no way to enter what is already known.

---

## Goals

- Produce rate limit analysis from sources other than a live probe: manual entry, a parsed `TF_LOG`, and published per-org-type defaults
- Keep the org connection working exactly as it does today, as one source among several
- Make provenance visible everywhere a limit is displayed or used in a calculation
- Never present an estimate as a measurement, especially in numbers destined for an increase justification
- Fix the endpoint bucket conflation in the log parser that makes log-derived limits inaccurate

## Non-Goals

- **No curated internal limit table.** There is no master list of rate limits by org type beyond public documentation. Baselines ship as published values only, never inferred or crowd-sourced from cases.
- **No solution for resource counts.** Counting resources still needs the org. See Known Limitations.
- **No changes to write probing, and no new IPC surface at all.** Manual limits live in renderer state only, so no file-persistence handlers are needed.
- **No persistence of manual limits across launches.** Session-only by decision — see Session Lifetime.
- **No method-awareness for `errorDetailMap`.** Worth doing eventually; out of scope here.
- **No renaming of `ProbeResult`.** The type name stays to avoid churning ~10 consumer files. Only user-facing wording changes to "Rate Limit Source."

---

## Distribution constraint

OTTO runs on Nicole's machine only and is never shared with customers.

Even so, manually-entered limits are **not** persisted to disk. Those values are often sourced from privileged internal lookups against a specific customer's org, and the less durable that footprint the better. Session-only storage means closing OTTO leaves nothing behind, which keeps the feature safe by construction rather than by policy — no decision to revisit if OTTO is ever distributed.

---

## Architecture

### The central idea

Every rate-limit feature reads `store.probeResult`. `analyzer.ts`, `target-analyzer.ts`, `CustomWorkload`, and `RateLimitTable` consume that shape and nothing else. The org connection is one *producer* of it.

So this feature adds producers, not a parallel engine. Every producer emits `ProbeResult`, and consumer logic is untouched apart from coverage reporting.

```
┌─ probeEndpoints()          (live org)        ─┐
├─ probeResultFromLog()      (TF_LOG)          ─┤
├─ manual entry / header paste                 ─┼─► mergeLimitSources() ─► store.probeResult ─► all consumers
└─ published baselines       (gap-fill only)   ─┘
```

### Type changes (`src/shared/types.ts`)

`EndpointProbeResult`:

- add `source: LimitSource` where `type LimitSource = 'probe' | 'log' | 'manual' | 'baseline'`
- `remaining` and `resetAt` become optional
- `status` gains `'unknown'`

`ProbeResult`:

- add `sources: LimitSource[]` — which producers contributed
- `orgUrl` becomes a display label, not necessarily a URL. Manual entry uses `'Manual entry'`; log-derived uses the log filename. Consumers already treat it as a display string (e.g. `PlanSection` passes it through), so no logic change.

`LogEndpointStats`:

- add `method: 'GET' | 'POST'` (see Log parser fix)

`TargetRuntimeAnalysis`:

- add `coverage: { relevant: number; measured: number; estimated: number; missingLabels: string[] }`

### The status trap

`determineStatus` derives status from `remaining / limit`. Manual and baseline entries have no `remaining`, and passing `0` yields ratio 0 → `'critical'`, painting a healthy org's table entirely red.

Entries without a `remaining` value get `status: 'unknown'` and are never routed through `determineStatus`. `resetWindowSecs` defaults to `60` for non-probe sources, matching what `calculateEstimate` already assumes when a probed window is absent.

### Merge

One pure function in `src/shared/limit-sources.ts`:

```
mergeLimitSources(sources: Partial<Record<LimitSource, EndpointProbeResult[]>>): ProbeResult
```

Keyed by `(label, method)`. Precedence, highest first:

1. `manual` — entered from privileged internal lookup; the most authoritative thing available
2. `probe` — measured live, right now
3. `log` — measured, but at some point in the past
4. `baseline` — published default, a guess

Baseline entries only ever fill keys no other source provided.

---

## Producers

### Manual entry (primary)

The workhorse, because the engineer typically already knows the answer.

- A row editor: pick a bucket from a dropdown of known labels, choose GET/POST, type the limit. Sparse by design — nobody fills 35 rows.
- A paste box accepting a raw header blob, extracting `x-rate-limit-limit`, `-remaining`, and `-reset`. Handles both a customer's `curl` output and a snippet lifted from a case, without retyping.
- Held in session state only, with an explicit Clear action (see Session Lifetime).

Guidance to surface in the UI for capturing headers, since `curl -I` sends HEAD and most Okta endpoints reject it with a 405 carrying no rate limit headers:

```
curl -sD - -o /dev/null -H "Authorization: SSWS $TOKEN" \
  "https://org.okta.com/api/v1/users?limit=1"
```

Rate limit headers are present on 429, 403, and 404 responses because the request was attributed to the org's bucket. They are unreliable on 401 — an invalid token never gets attributed — which is why `diagnoseProbeFailure` already classifies 401/403 as `skipped` rather than trusting the numbers.

### Log-derived (free when a log exists)

`probeResultFromLogAnalysis(analysis: LogAnalysis): ProbeResult` in `src/main/api/limit-from-log.ts`, mapping `LogEndpointStats` → `EndpointProbeResult` using the `minRateLimit` the parser already computes. Entries with `minRateLimit === 0` are skipped.

Two prerequisites, both real work:

**1. Label vocabulary mismatch.** `labelForPattern` emits `'Application'`, `'User (single)'`, `'App User Assignments'`. `PROBE_ENDPOINTS` emits `'Applications'`, `'Users'`. `target-analyzer` matches resources to limits *by label*, so log-derived limits would silently match nothing and every workload would report no data. Requires an explicit `LOG_LABEL_TO_PROBE_LABEL` mapping table. Unmapped log labels are carried through and displayed, but excluded from bottleneck matching.

**2. Bucket keying.** See below.

### Published baselines (last resort)

`src/shared/rate-limit-baselines.json`, mirroring the existing `provider-schemas/` convention:

```json
{
  "sourceUrl": "https://developer.okta.com/docs/reference/rl-global-mgmt/",
  "lastVerified": "2026-08-19",
  "orgTypes": {
    "developer": { "/api/v1/users": 100, ... }
  }
}
```

Published values only. Selected by an org-type dropdown, used solely to gap-fill, every row badged as an estimate. OTTO warns when `lastVerified` is more than six months old.

Its value is not accuracy — it's letting the math complete and giving a citable floor a customer can verify themselves.

---

## Log parser fix: bucket keying

`endpointMap` in `parseLogFile` is keyed by normalized path alone. Every GET and every POST to `/api/v1/apps/{id}/users` accumulates into one entry, and `minRateLimit` is `Math.min(...)` across all of them. Okta's write buckets on a path are typically much lower than its read buckets, so one POST response drags the reported limit for the whole path down to the write value.

This is not cosmetic. That number feeds `target-analyzer`, which picks the *minimum* limit as the bottleneck. An understated bottleneck produces an overstated required increase — walking into a rate limit approval asking for more than the data supports, which is worse than asking for nothing.

The method is already in the log and currently discarded:

```
[DEBUG] performing request: method=POST url=https://unconv.okta.com/oauth2/v1/token
```

The request-tracking branch matches only `url=(...)`.

Changes, all in `src/main/api/log-parser.ts`:

1. Capture `method=(\w+)` alongside the URL, defaulting to `GET` when absent — older provider versions may not log it, and that default reproduces today's behavior, so no regression.
2. Store `pattern` and `method` on `EndpointAccumulator`; key the map by `` `${method}|${pattern}` ``.
3. Add a `currentKey` variable alongside `currentEndpoint`. All five `endpointMap` access sites move to `currentKey` — the insert in the request branch, the 429 branch, the `>= 400` branch, and both rate-limit-header branches. `currentEndpoint` stays, because `errorDetailMap` and `labelForPattern` still want the bare path.
4. Emit `method` on `LogEndpointStats`, iterating `endpointMap.values()` rather than destructuring the composite key.
5. `labelForPattern` is untouched — labels stay method-agnostic, method rides as its own field. This is what lets results drop into `RateLimitTable`, which already splits GET from POST.
6. `LogAnalyzer.tsx` gains a method badge on the endpoint table. Without it, a path hit by both methods renders as two visually identical rows and reads like a bug.

---

## Coverage reporting

Sparse input breaks an assumption. `target-analyzer` picks the bottleneck as the minimum limit across relevant endpoints. Enter Users=600, skip Apps, and if Apps is really 100, OTTO reports the target as achievable when it isn't — silently, in the number that goes into the justification.

`analyzeTargetRuntime` therefore computes coverage across the labels relevant to the selected workload:

- `relevant` — how many buckets the workload touches
- `measured` — resolved from `probe`, `log`, or `manual`
- `estimated` — resolved from `baseline`
- `missingLabels` — resolved from nothing

When `estimated > 0` or `missingLabels` is non-empty, the summary states it plainly and names the buckets. When any bottleneck candidate came from `baseline`, the summary says the increase figure rests partly on published defaults.

Also guards an existing bug: `calculateEstimate` does `Math.min(...)` over a possibly-empty array, yielding `Infinity`. Returns the no-data path instead.

---

## UI

**Rate Limits tab empty state** becomes a source chooser replacing the current "Connect Org" card:

- Connect Org — existing flow
- Enter Limits Manually — opens the manual editor
- Use Log Analysis — enabled only when a parsed log exists in session
- Use Published Defaults — org-type dropdown

**`RateLimitTable`** gains a Source column badging each row `Probed` / `Log` / `Manual` / `Default`. `'unknown'` status rows show their limit and dash Remaining and Reset, reusing the existing `noData()` dash path.

**Header** shows the active source instead of assuming a connected org.

**Clear / Start Over** sits next to the active-source indicator, visible whenever any source is loaded. Opens a confirm step, then resets to the source chooser.

---

## Session lifetime

All limit sources live in Zustand store state and die with the process. Nothing is written to disk. This matches the existing treatment of org credentials, which are already not persisted across launches.

**Clear action.** Because a session may cover more than one case, the user needs to reset without restarting the app. A `clearLimitSources()` store action drops all four source buckets and the merged `probeResult`, returning the Rate Limits tab to its source-chooser empty state.

Two requirements on it:

- **It must clear derived state too.** `recommendation`, `targetRuntimeAnalysis`, and any custom workload `rateLimit` values were computed from the old limits. Leaving those behind after a clear would show one case's numbers under another case's inputs — the worst possible failure for this feature, since it is silent and the stale figure looks authoritative. Every piece of state downstream of `probeResult` resets together.
- **It must be confirmed.** Clearing discards manual entry that cannot be recovered, since nothing is persisted. A single confirm step, consistent with the existing modal pattern.

An active org connection is left alone by Clear — disconnecting is already its own separate control.

---

## Known limitations

**Resource counts still require an org.** Manual limits solve the limits half only. The grid's "Count & Optimize" stays gated on `connection.connected`. For a disconnected workflow, counts are entered through the existing `CustomWorkload` editor, which already accepts a manual `count` per resource. Worth revisiting as a follow-on: manual counts for the resource grid.

**Baselines go stale.** Mitigated by `lastVerified` and a staleness warning, not eliminated.

**Log-derived limits are historical.** They reflect the org at log capture time. Badged as `Log`, and the log's timestamp is displayed.

---

## Testing

New unit tests:

- `mergeLimitSources` — precedence order; baseline fills only gaps; `(label, method)` keying keeps GET and POST distinct
- `probeResultFromLogAnalysis` — label mapping resolves to `PROBE_ENDPOINTS` vocabulary; unmapped labels pass through but don't match bottlenecks; zero-limit entries dropped
- Header paste parser — extracts all three headers; tolerates casing and surrounding log noise; rejects blobs with no limit header
- Manual and baseline entries produce `status: 'unknown'`, never `'critical'`
- `analyzeTargetRuntime` — coverage counts; summary names missing buckets; baseline-derived bottleneck is flagged; empty-limits case returns no-data instead of `Infinity`
- Baseline staleness warning fires past six months
- `clearLimitSources()` resets every source bucket, the merged `probeResult`, `recommendation`, `targetRuntimeAnalysis`, and custom workload `rateLimit` values — asserted field by field, so a later addition of derived state fails the test rather than silently surviving a clear
- `clearLimitSources()` leaves an active org connection intact

Extending `src/__tests__/log-parser.test.ts`:

- GET and POST to the same path produce two `LogEndpointStats` rows with independent `minRateLimit` values
- A log line without `method=` defaults to `GET`
- Existing OAuth2/DPoP assertions still pass

Verification: `npx jest` (253 tests passing at time of writing) and `npx tsc --noEmit` both clean.

---

## Sequencing

1. Log parser bucket keying + `method` on `LogEndpointStats` + `LogAnalyzer.tsx` badge — self-contained, ships value on its own by making the Debug tab's reported limits correct
2. Type changes, `mergeLimitSources`, `'unknown'` status handling, `RateLimitTable` Source column
3. Manual entry + Clear action
4. Log-derived producer + label mapping table
5. Published baselines + gap-fill + staleness warning
6. Coverage reporting in `target-analyzer`

Step 1 is independently shippable and should land first. Steps 3–5 are each usable without the others.

**Prerequisite already landed:** commit `871e8e6` (`fix(log-parser): detect OAuth2/DPoP token endpoint failures`) touched `log-parser.ts` and added `src/__tests__/log-parser.test.ts`. Step 1 modifies the same file and extends the same test file, so it builds on that commit rather than conflicting with it.
