# Developing OTTO

Notes for anyone changing this codebase, including future-you. Everything here cost real debugging time to learn once.

---

## Running it

```bash
npm install
npm run dev     # watches src/, restarts the app on rebuild
npm start       # one-off build and launch, no watching
```

`npm run dev` uses `electronmon`, not `electron`, so both main-process and renderer changes take effect without quitting. This matters: with plain `electron .` the app launches once, and edits under `src/main/` silently ran stale code while `dist/` on disk was current. That failure mode is badly misleading — a working change looks like it did nothing — and it wasted three debugging cycles before being fixed.

If a change still appears to do nothing, check the build before debugging the code:

```bash
stat -f '%Sm' dist/main/index.js dist/renderer/index.js
grep -c "some-distinctive-string-from-your-change" dist/renderer/index.js
```

## The verification gate

```bash
npx jest          # 319 tests as of 2026-08-21
npx tsc --noEmit  # must be silent, exit 0
```

Both must pass before any commit. There is no CI enforcing this.

## Commit conventions

Conventional commits with a substantive body explaining **why**, not just what. The bodies are long on purpose — they're the durable record of reasoning. See `6118ead` or `7ec8bdb` for the expected shape.

**Never add `Co-Authored-By` or any AI attribution trailer.** Some commits in the history do carry one; do not infer consent from that. An Okta-issued `prepare-commit-msg` hook (`okta-ai-attribution`) was injecting them and has been disabled via `git config --unset core.hooksPath`. If trailers reappear, that hook is active again in your clone.

Signing is disabled repo-locally (`commit.gpgsign false`) because gpg's pinentry can't prompt from an agent shell. Global signing is deliberately left on for org repos with signature-requiring branch protection.

## This repo is public

`github.com/coleleep/okta-terraform-toolkit` is **public**, on a personal account.

- Never commit customer rate limits, org URLs, tokens, or anything from internal Okta tooling.
- Fixtures use obvious placeholders: `dev-123456.okta.com`, `acme.okta.com`, `00abcDEFGHIJ...`.
- "OTTO never leaves this machine" in the specs refers to the running app and its data, not the source. Public code, local-only customer data.

---

## Traps

**1. Component tests are not possible.** `jest.config.js` sets `testEnvironment: 'node'` and `testMatch` covers `**/*.test.ts` only — not `.tsx`. No jsdom, no `@testing-library/react`, zero component tests exist.

Don't add that infrastructure casually. Instead push logic into pure functions and verify rendering by hand. This is why `src/shared/limit-sources.ts` exists and why the store's reset is a pure function the store spreads rather than logic living in the action — `useStore.ts` reaches `window.oktaTerraform` and isn't testable in a node env.

**2. Two Tailwind palettes coexist.** `tailwind.config.js` defines dark theme tokens (`surface-0` is `#0B0E14`, `accent-*`). Most components use them. But `RateLimitTable.tsx`, `PlanSection.tsx`, and `TargetRuntime.tsx` are still on the old light palette (`bg-green-100`, `text-gray-600`).

Match the file you're editing. Don't migrate them as a side quest. This already caused one bug: a badge specced with `bg-emerald-100`, copied from `RateLimitTable`, rendered as a pale mint chip glaring against a near-black row in `LogAnalyzer.tsx`.

**3. Rate limit buckets are per HTTP method.** A path's read and write limits are separate buckets, and writes are typically far lower — `Applications` is 100 while `App (single)` is 600. `mergeLimitSources` keys by `(method, label)` for this reason. Collapsing them reintroduces a bug that made the log parser report a path's write limit as its read limit.

**4. Labels are the join key, and mismatches fail silently.** `target-analyzer.ts` matches workload resources to limits **by label string**. Three vocabularies exist: `PROBE_ENDPOINTS`/`SUB_RESOURCE_ENDPOINTS` in `constants.ts`, `labelForPattern` in `log-parser.ts`, and `RESOURCE_DICTIONARY`.

A mismatch merges fine, renders fine, and then matches nothing — reporting "no rate limit data" with no error explaining why. `LOG_LABEL_TO_PROBE_LABEL` and `effectiveEndpoint()` exist to bridge them.

**5. Never invent a rate limit.** `target-analyzer` used to substitute `100` for any bucket without a limit (`?? 100`, `|| 100`). With sparse manual entry that turned a skipped bucket into a confident wrong verdict, and those figures go into customer-facing increase requests. Missing buckets are now reported through `coverage` and named in the summary. Don't reintroduce a default.

**6. Derive lists, don't hand-maintain them.** This has bitten three times. `KNOWN_LIMIT_BUCKETS` is computed from the probe constants; `effectiveEndpoint()` derives a resource's bucket from `parentType` rather than the 15 entries that happen to declare one explicitly; `scripts/capture-rate-limits.js` parses `constants.ts` at runtime. A hand-copied list drifts, and the failure is always silent.

**7. Okta collections aren't consistently shaped.** Some endpoints return a bare array, others wrap it — `/api/v1/domains` returns `{ domains: [...] }`, `/api/v1/iam/roles` returns `{ roles: [...] }`. Testing `Array.isArray` reported populated orgs as empty.

**8. Rate limit buckets are attributed by path, not by resolved resource.** A request to `/api/v1/domains/{bogus-id}` returns 404 **with the correct bucket's rate limit header**. Verified: two independent captures, one using real sample IDs and one using a placeholder, agreed on every overlapping bucket. This is why `probe.ts` reads headers off error responses, and why the capture script needs no real resource IDs.

**9. Count attempts, not inputs.** The capture script guarded that it parsed enough endpoint definitions, then silently probed only two thirds of them because its phase filters didn't partition the set. A parse-count check passed happily. Assert on what was actually attempted.

## Decisions not to relitigate

- **Manual limits are session-only.** No disk persistence. They come from privileged internal lookups against a specific customer's org, so the less durable the footprint the better. `Start Over` covers multi-case sessions.
- **`Start Over` clears the whole case,** including the workload. A partial clear is worse than either extreme: it leaves the target planner without a workload while stale grid selections remain on screen.
- **Baselines are measured, never published.** Okta publishes no per-org-type rate limit table — `rl-global-mgmt` defers elsewhere and `reference/rate-limits` gives only illustrative examples, directing you to observe your own org. `src/shared/rate-limit-baselines.json` is a capture from an org with no multipliers. Reproducible and defensible, but never describe it as Okta-published.
- **Baselines gap-fill only** and count as `estimated` in coverage, so an analysis leaning on them renders as provisional.

## Where the design lives

- `docs/superpowers/specs/2026-08-19-rate-limit-sources-design.md` — the rate limit source design, all six phases
- `docs/superpowers/plans/` — per-phase implementation plans, with full code
- `docs/FEATURES.md`, `docs/USAGE.md` — what it does and how to use it

## Open items

- **Eight log label pairings need SME review** — see the Phase 4 plan. A wrong pairing attributes a real measured limit to the wrong bucket, which is worse than no limit.
- **No real log has exercised a read and a write on the same path.** Phase 1's method split is proven by tests only. A log from an apply that creates app user assignments would close it — Terraform GETs the app then POSTs the assignments, so `/api/v1/apps/{id}/users` should appear as two rows with different limits.
- **`Domain Certificate` is the one uncaptured bucket** of 100. It returned no rate limit header; coverage reports it as missing rather than guessing.
