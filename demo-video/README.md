# OTTO Demo Video — Presentation & Assets

This folder contains the hackathon demo presentation and narration script for OTTO.

## Contents

| File | Description |
|------|-------------|
| `presentation.html` | Self-contained slide deck (10 slides, no build step needed) |
| `speech-script.md` | Full narration script with per-slide timing notes |

## Running the Presentation

Open directly in a browser:

```bash
open presentation.html
```

Or serve locally (required if a tool blocks `file://` URLs):

```bash
cd demo-video
python3 -m http.server 8765
# then open http://localhost:8765/presentation.html
```

## Navigation

- **Arrow keys** (`←` / `→`) — previous / next slide
- **Click anywhere** on the slide — advance to next slide
- Slide counter shown in bottom-right corner

## Slides

1. Title — OTTO intro
2. The Problem — rate limits and manual promotion pain
3. Solution Overview — what OTTO does
4. Rate Limits Tab — live API probing, generated `provider.tf`
5. Plan Tab — AI-generated Terraform from plain-English description
6. Sync Tab — field-by-field diff, AI ID rewrite, in-app apply
7. Debug Tab — log analysis and error decoding
8. Impact & Next Steps — time saved, roadmap
9. Closing

## Recording Tips

See `speech-script.md` for the full narration with per-slide timing. Target duration is ~90 seconds at a natural pace.

Key emphasis points:
- Slow down on the Sync tab section — it's the key differentiator
- Stress: *"field-by-field diff"*, *"AI rewrites all the IDs"*, *"minutes instead of days"*
