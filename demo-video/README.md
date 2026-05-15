# OTTO Demo Video — Presentation & Assets

This folder contains the hackathon demo presentation, narration script, and supporting assets for OTTO.

## Contents

| File | Description |
|------|-------------|
| `presentation.html` | Self-contained slide deck (8 slides, no build step needed) |
| `speech-script.md` | Full narration script with per-slide timing (~83s + 25s live demo) |
| `voiceover-text.txt` | Plain-text version of the script for TTS generation (luvvoice.com) |
| `config_example.png` | Screenshot of the Config tab (provider recommendations) |
| `workload_example.png` | Screenshot of the Plan/Workload tab (auth, sizing, runtime) |

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
4. Rate Limits + Plan — live probing, config generation, workload sizing (with screenshots)
5. Sync Tab — cross-org promotion pipeline + live demo callout
6. **[Live Demo — 25s screen recording]** — compare, diff, convert, apply
7. Debug Tab — log analysis and error decoding
8. Impact, Next Steps & Closing

## Recording Plan

1. Record the slide deck as a screen capture (advance slides on cue)
2. Separately record the OTTO app demo (~25s of the compare → convert → apply flow)
3. Splice the demo clip in between slides 5 and 7
4. Record voiceover as a single pass over the final edit (or use `voiceover-text.txt` with TTS)

## Recording Tips

See `speech-script.md` for the full narration with per-slide timing. Target duration is ~90 seconds total (including 25s live demo).

Key emphasis points:
- Slow down on the Sync/demo section — it's the key differentiator
- Stress: *"field-by-field diff"*, *"rewrites all the IDs"*, *"days → minutes"*
