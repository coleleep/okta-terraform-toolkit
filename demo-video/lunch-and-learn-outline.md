# OTTO Lunch & Learn — Outline

**Duration:** 60 minutes — 42 min demo, 15 min Q&A, 3 min buffer
**Audience:** Cross-functional / partners. Mixed Terraform familiarity; assume little to none.
**Takeaway:** Awareness + async setup. No live install; link `README.md` and `docs/USAGE.md` in the follow-up.

---

## Design principles for this room

1. **Outcome depth, not mechanism depth.** For each feature: what goes in, what comes out, what it saves. Internals live in the appendix and only surface if asked.
2. **Every feature gets a customer sentence.** Not "this probes 50 endpoints" but "this answers the question the customer actually asked."
3. **No unexplained jargon.** First use of *rate limit bucket*, *TF_LOG*, *tfstate*, and *provider* gets one plain sentence.
4. **Nothing on screen you can't explain.** If a tab isn't part of the story, don't open it.
5. **Two attention resets.** A cross-functional room fades around minute 20 and minute 32. Planned interaction points below.

---

## Running order

| Time | Segment | Minutes |
|------|---------|---------|
| 0:00 | The problem, in customer terms | 5 |
| 0:05 | What OTTO is — orientation | 3 |
| 0:08 | **Debug: log analysis** (hero demo) | 7 |
| 0:15 | Debug: error decoder | 3 |
| 0:18 | Rate limit probing | 5 |
| 0:23 | **Target runtime planner** (money feature) | 6 |
| 0:29 | Code generation | 4 |
| 0:33 | Terraform validator | 5 |
| 0:38 | Cross-org sync (video) | 4 |
| 0:42 | Impact, roadmap, where to get it | 3 |
| 0:45 | Q&A | 15 |

---

## 0:00 — The problem (5 min)

**No slides for the first 90 seconds.** Tell one case story from memory. Specificity beats abstraction.

Beats:
- A customer automates Okta with Terraform. Their apply used to take 20 minutes; now it takes four hours, or fails halfway and leaves things half-configured.
- They open a support case. What arrives is a 40 MB debug log and "it's slow."
- *Plain-language sentence on rate limits:* Okta caps how many API calls you can make per minute. Terraform makes thousands. Exceed the cap and Okta starts refusing requests — Terraform retries, backs off, and crawls.
- Today diagnosing that means reading the log by hand, counting failures, and guessing at seven interacting config knobs.
- Cost: multi-day round trips, repeated "please send another log," and a customer who has lost confidence.

**Land this line:** *"The information needed to answer this is already in the log. We just had no way to read it at scale."*

Slide (one, sparse): the seven provider settings that interact — `max_retries`, `backoff`, `min_wait_seconds`, `max_wait_seconds`, `request_timeout`, `max_api_capacity`, `parallelism`. Don't explain them. The point is that it's too many to tune by intuition.

## 0:05 — What OTTO is (3 min)

One slide, then the app.

- A desktop tool for the people who work these cases. Built in-house.
- Six areas, named as questions they answer:
  - **Debug** — what went wrong?
  - **Rate Limits** — what is this org actually allowed to do?
  - **Plan** — what config should they run, and how long will it take?
  - **Sync** — how do we promote config between orgs safely?
  - **Validator** — is this config correct before they apply it?
  - **Learn** — what does the provider support?
- Say plainly: **Debug, Validator, and Learn need no org connection at all.** That matters for anyone imagining a credentials problem.

Open the app. Show the tab bar. Do not click into anything yet.

## 0:08 — Debug: log analysis (7 min) — HERO DEMO

This is the strongest opening demo: universally legible, no credentials, immediate payoff.

**Setup (pre-staged):** a real TF_LOG with 429s and errors, already on the desktop.

Demo steps:
1. Debug tab → TF_LOG Analyzer → select the log file.
2. Let the summary cards land. Narrate: duration, total requests, how many were refused, time lost to waiting.
3. Endpoint breakdown. Point out that read and write limits are tracked separately — *"creating an assignment and reading one have different caps, and conflating them is how you get the wrong answer."*
4. Issues list. Read one critical issue aloud verbatim — title, detail, recommendation. This is the payoff moment: it names the cause and the fix.
5. **Explain with AI.** Narrate what's happening: the log is redacted first, then summarized in plain English with concrete config changes.

**Say this while the AI call runs** (fills the dead air and pre-empts the security question):
> "Before any of this leaves the machine, tokens, org URLs, resource IDs, emails, and secrets are stripped out. That's a hard requirement, not a setting."

**Attention reset:** ask the room — *"How long would reading this log by hand have taken you?"* Take one answer.

**Risk:** AI latency. Run it once before the session to warm the path. Keep a screenshot of the output as fallback and move on within 15 seconds if it stalls.

## 0:15 — Debug: error decoder (3 min)

Fast, high-relatability win.

1. Debug → Error Decoder.
2. Paste a genuinely cryptic Okta API error. `E0000011` or an `invalid_dpop_proof` is ideal.
3. Show the plain-English explanation and remediation.

**Point to make:** works with no org connection and no AI key for common errors. Anyone in the room could use this today.

## 0:18 — Rate limit probing (5 min)

Now the audience needs the domain concept, and they've earned it.

**Setup (pre-staged):** org already connected. Do not type a token on screen.

1. Rate Limits tab → show results from a completed probe.
2. Explain what happened: ~50 endpoints tested, each reporting its own cap and current headroom.
3. Read/write tabs — reinforce the separate-buckets point from the Debug demo.
4. Point out the lowest-capacity endpoints. *"This is the ceiling on the whole run. One endpoint decides how long everything takes."*

**Sentence that makes it click:** *"It's not one speed limit. It's dozens, and the slowest one wins."*

**Risk:** do not run a live probe. It takes time, can fail on network, and burns real capacity. Show completed results.

## 0:23 — Target runtime planner (6 min) — MONEY FEATURE

For a partner and PM audience, this is the segment that justifies the tool. Give it the extra minute.

1. Plan tab → workload sizing. Show resource counts and the operation type.
2. Set a target: *"the customer needs this done in 30 minutes."*
3. Show the verdict: achievable or not, with the estimated runtime.
4. When not achievable — show the bottleneck: which endpoint, its current limit, the required limit, the percentage increase.

**The line that lands:**
> "This turns 'it feels slow' into 'this specific endpoint needs to go from 100 to 340 per minute, and here's the arithmetic.' That's a request someone can actually approve or decline."

**Be honest about the current limitation** — it's a credibility move, not a weakness:
> "Right now this needs a live connection to the customer's org, which on most cases we don't get. That's the single biggest gap, and it's what's being built next."

## 0:29 — Code generation (4 min)

1. Plan → Config / provider block.
2. Show the generated `provider.tf` — the seven settings from the opening slide, now filled in with values derived from *this* org's measured capacity.
3. Callback: *"Remember the seven knobs nobody could tune by hand? That's them, computed."*
4. Mention briefly: `versions.tf`, `variables.tf`, and import blocks come with it.

Keep this tight. Cross-functional viewers don't need to read HCL — they need to see that the output is ready to hand over.

## 0:33 — Terraform validator (5 min)

Strong cross-functional segment because the security story is legible to everyone.

**Setup (pre-staged):** a `.tf` file containing an obvious fake secret.

1. Validator tab → upload the file.
2. **Show the PII masking summary first.** Every masked value and which file it came from. This is the trust moment.
3. Show the findings grouped by severity.
4. Mention the export gate: masked secrets get promoted into `variables.tf` and `terraform.tfvars` on export rather than being pasted back inline.
5. Note the session expires after 15 minutes with nothing retained.

**Point to make:** *"The tool assumes the files contain secrets, because they do."*

## 0:38 — Cross-org sync (4 min)

**Use `Sync.mp4`.** Do not demo live — it's a multi-step pipeline, it's slow, and it writes to a real org.

Narrate over the video:
- The problem: promoting config from dev to staging to prod by hand, where every resource ID differs between orgs.
- Discover → match and diff → convert → apply.
- Two things worth calling out: the field-level diff, and rollback — it saves a state bundle and can generate a destroy config to undo a sync.

**Attention reset:** *"Has anyone here had to redo an environment promotion by hand?"*

## 0:42 — Impact, roadmap, where to get it (3 min)

- **Impact, honestly framed.** Lead with the time-to-diagnosis change on log analysis, since that's the one you can speak to concretely. Avoid inventing metrics you'd have to defend in Q&A.
- **What's next:** rate limit analysis without an org connection — manual entry, limits derived from customer-supplied logs, and published defaults. Say why: *"the feature that needs it most is the one we usually can't use."*
- **Where to get it:** public GitHub repo, setup in the README. *"I'll post the link and setup steps rather than walk through npm on a projector."*
- Close on the through-line: *"Every one of these started as a case I couldn't answer fast enough."*

---

## Pre-flight checklist

Do all of this **before** the room fills.

- [ ] Org connected in-app; connection modal never opened on screen
- [ ] TF_LOG file staged on desktop — must contain 429s **and** both reads and writes to the same path
- [ ] `.tf` file with a fake secret staged for the validator
- [ ] A cryptic Okta error copied to clipboard for the decoder
- [ ] AI key configured, and one AI call already run to warm the path
- [ ] `Sync.mp4` plays with sound off; confirm it doesn't need buffering
- [ ] Screenshot fallbacks saved for: AI explanation, probe results, validator findings
- [ ] Notifications and Slack silenced; no customer names visible anywhere
- [ ] Font size increased in-app; the endpoint tables are dense on a projector
- [ ] Second monitor mirrored, not extended

## Demo risk register

| Risk | Mitigation |
|------|-----------|
| AI call slow or fails | Warm it beforehand; screenshot fallback; 15-second abort rule |
| Live probe fails or is slow | Never probe live — show completed results |
| Sync too slow to demo | Pre-recorded video, already in the repo |
| Customer data visible | Scrub the staged log; verify before presenting |
| Dense tables illegible | Increase font size; zoom into specific rows rather than showing whole tables |
| Running long | Sync (4 min) and code generation (4 min) are the compressible segments — cut to 2 min each if you hit 0:36 still in the validator |

## Appendix slides — only if asked

Prepare these; do not present them.

1. **Architecture** — Electron main/renderer split, IPC layer, where AI calls originate
2. **Redaction detail** — the nine pattern classes stripped before any LLM call
3. **Rate limit bucket mechanics** — why read and write differ, what a bucket is, why `x-rate-limit-*` headers matter
4. **Provider version support** — 6.6.1 through 6.15.0 and how version-specific behavior is tracked
5. **The seven provider settings** — what each actually does
6. **Roadmap detail** — the four limit sources and their precedence

## Anticipated questions

- *"Can customers use this?"* — No. It's internal tooling for support engineers. The outputs are what customers receive.
- *"Does customer data go to an LLM?"* — Redacted first, always. Walk appendix slide 2.
- *"How accurate are the runtime estimates?"* — They're models built on measured limits, not guarantees. Be direct about that; the bottleneck identification is the durable value.
- *"Why not a web app?"* — Desktop keeps credentials and customer files local. Worth saying plainly.
- *"Who maintains it?"* — Answer honestly, including the bus-factor question if it comes up.
- *"Can I contribute?"* — Public repo. Have the link ready.

## Cut list, in order

If you're running long, sacrifice in this order:
1. Code generation → 2 min (show the output, skip the callback)
2. Cross-org sync → 2 min (first half of the video only)
3. Error decoder → merge into the log analysis segment as a 60-second aside
4. **Never cut:** the problem framing, the log analysis hero demo, or the target runtime planner
