# OTTO — Hackathon Demo Speech Script
**Target duration: ~90 seconds | Includes 25s live demo clip**

---

## [Slide 1 — Title]
*~5 seconds*

Meet OTTO — the Okta Terraform Toolkit. One desktop app for the entire Okta Terraform lifecycle.

---

## [Slide 2 — The Problem]
*~8 seconds*

Okta admins running Terraform hit the same walls: rate limit failures with no visibility, and no good way to promote configs from dev to staging to production without hours of manual ID mapping.

---

## [Slide 3 — Solution Overview]
*~8 seconds*

OTTO gives you live rate limit probing, AI-powered config generation, cross-org sync with field-level diffs, and a built-in debug toolkit — all in one app.

---

## [Slide 4 — Rate Limits + Plan]
*~10 seconds*

The Rate Limits tab probes 30-plus endpoints and generates your exact provider settings. The Plan tab lets you describe your use case in plain English and get a complete, deployable Terraform project.

---

## [Slide 5 — Sync Tab Intro]
*~5 seconds*

The Sync tab is the heart of OTTO. You connect your source and target orgs, click Compare — and let me show you what happens.

---

## [Live Demo — Screen Recording]
*~25 seconds*

*(Screen recording: connect both orgs → select resource types → Compare → diff view populates showing matched/changed/missing → select resources → Proceed to Convert → export files → terraform apply runs in-app → success)*

*(Voiceover during demo:)* OTTO discovers every resource in both orgs, shows you a field-by-field diff, lets you pick exactly what to sync, rewrites all the IDs, generates import blocks — and applies it right here in the app. What used to take days now takes minutes.

---

## [Slide 6 — Debug Tab]
*~7 seconds*

When runs fail, paste any Okta error for an AI-powered fix, or upload a TF_LOG file and OTTO parses every request, surfaces rate-limit hits, and gives you the root cause.

---

## [Slide 7 — Impact + Next Steps]
*~10 seconds*

OTTO eliminates configuration drift between environments and gives teams full confidence in every promotion. Next, we're adding multi-LLM support, SSO integration, and Okta for AI Agents — so OTTO gets its own scoped identity with a full audit trail.

---

## [Slide 8 — Closing]
*~5 seconds*

OTTO — faster pipelines, safer promotions, smarter Okta Terraform. Thank you.

---

**Total: ~83 seconds + transitions ≈ 90 seconds**

### Recording Plan
1. Record the slide deck as a screen capture (advance slides on cue)
2. Separately record the OTTO app demo (~25s of the compare → convert → apply flow)
3. Splice the demo clip in between slide 5 and slide 6
4. Record voiceover as a single pass over the final edit

### Demo Recording Checklist
- [ ] Both orgs connected (source: nicole-oie.okta.com, target: nicole-oie.oktapreview.com)
- [ ] Select 5-6 resource types (groups, auth servers, network zones, policies, apps)
- [ ] Click Compare — wait for diff to populate
- [ ] Show the DiffView (matched in green, changed in amber, missing in red)
- [ ] Select a subset of resources
- [ ] Click Proceed to Convert
- [ ] Click Export
- [ ] Run terraform init → plan → apply in-app
- [ ] Show success
