# OTTO — Hackathon Demo Speech Script
**Target duration: ~90 seconds | Recording pace: speak clearly, not rushed**

---

## [Slide 1 — Title]
*~5 seconds*

Meet **OTTO** — the Okta Terraform Toolkit. A desktop app that makes managing Okta infrastructure with Terraform faster, safer, and smarter.

---

## [Slide 2 — The Problem]
*~10 seconds*

Okta admins managing Terraform face two painful problems every day: getting throttled by rate limits mid-run, and manually copying configurations from dev to staging to production — a slow, error-prone process with no guardrails.

---

## [Slide 3 — Solution Overview]
*~10 seconds*

OTTO solves both. It probes your org's live API capacity, recommends the perfect provider settings, and syncs configurations across orgs using AI-powered conversion — no manual editing required.

---

## [Slide 4 — Rate Limits + Plan Tab]
*~15 seconds*

The **Rate Limits** tab probes 30-plus Okta endpoints in real time and calculates exactly how to tune `max_retries`, `backoff`, `parallelism`, and `max_api_capacity` for your org's size. The **Plan tab** goes further — you describe your use case in plain English, and OTTO's AI generates ready-to-use provider config, resource definitions, import blocks, and scopes.

---

## [Slide 5 — Sync Tab — THE KEY FEATURE]
*~25 seconds*

The **Sync tab** is the heart of OTTO. Picture this: you have a fully tested Okta configuration in your dev org and you need to promote it to production. With OTTO, you connect both orgs, click Compare — and instantly see a field-by-field diff of every resource. You select what to sync, OTTO's AI rewrites all the IDs and import blocks for the target org, and you run `terraform apply` right inside the app. What used to take days of manual work now takes minutes. No typos, no missed references, no drift.

---

## [Slide 6 — Debug Tab]
*~10 seconds*

When things go wrong, the **Debug tab** has you covered. Paste any Okta API error and get an AI-powered explanation with an exact fix. Upload a `TF_LOG=DEBUG` file and OTTO parses every request, surfaces rate-limit hits, and tells you the root cause.

---

## [Slide 7 — Impact + Next Steps]
*~15 seconds*

OTTO turns hours of manual Terraform work into minutes, eliminates configuration drift between environments, and gives teams full confidence in every promotion. Next, we're adding support for multiple LLM providers, SSO login for teams, and Okta for AI Agents — so every AI agent OTTO spins up has a verified, least-privilege identity with a full audit trail.

---

## [Slide 8 — Closing]
*~5 seconds*

OTTO — faster pipelines, safer promotions, smarter Okta Terraform. Thank you.

---

**Total estimated read time: ~95 seconds at a clear, natural pace.**

### Recording Tips
- Pause briefly between slides (0.5–1 second)
- Slow down slightly on the Sync tab section — it's the key differentiator
- Emphasize: *"field-by-field diff"*, *"AI rewrites all the IDs"*, *"minutes instead of days"*
