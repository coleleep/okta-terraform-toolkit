# OTTO Demo Video — Presentation & Assets

This folder contains the hackathon demo presentation and supporting assets for OTTO.

## Contents

| File | Description |
|------|-------------|
| `presentation.html` | Self-contained slide deck (8 slides, no build step needed) |
| `Sync.mp4` | Demo video embedded in slide 5 — autoplays when the slide opens |
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
5. Sync Tab — cross-org promotion pipeline + embedded demo video (autoplays on entry)
6. Debug Tab — log analysis and error decoding
7. Impact, Next Steps & Closing
8. Closing slide
