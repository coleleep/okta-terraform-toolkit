# App Icon + AI Loading Indicator Fix — Design

## Problem

1. OTTO runs with the generic Electron icon in the dock/taskbar instead of its own brand mark.
2. During AI calls (error decoding, solution generation, log analysis), the loading state renders with leftover light-theme styling (`bg-white`, `text-gray-*`, `border-gray-*`, `text-okta-navy`) on top of OTTO's dark UI. This makes the loading indicator hard to see/read, which reads as "the app is frozen" rather than "AI is working."

## Root Cause

`ErrorDecoder.tsx`, `SolutionBuilder.tsx`, and `LogAnalyzer.tsx` were never converted to the dark theme introduced elsewhere in the app (confirmed via `bg-white`/`text-gray-*`/`border-gray-*`/`text-okta-navy` class counts: 15, 25, and 51 occurrences respectively). `SyncSection.tsx` already uses the correct dark-theme spinner pattern and serves as the reference implementation.

## Scope

- App icon: dev-mode dock/taskbar icon only. No `electron-builder`/packaging config exists in this repo yet, so `.icns`/`.ico` bundle-icon wiring for a packaged `.app`/`.exe` is out of scope — this only fixes the icon shown while running via `electron .` / `npm start` / `npm run dev`.
- AI loading indicator: full dark-theme conversion of `ErrorDecoder.tsx`, `SolutionBuilder.tsx`, and `LogAnalyzer.tsx` (all light-theme classes, not just the loading block), plus added motion/emphasis on the loading state specifically. No other components are touched — light-theme leftovers elsewhere in the app (e.g. `BestPractices.tsx`, `CustomWorkload.tsx`) are pre-existing and explicitly out of scope for this change.
- No new npm dependencies. No global/shared loading state — each component keeps its own local `loading` state, consistent with the existing pattern.

## Design

### 1. App icon

Reuse the existing hexagon-link mark already drawn inline in `DashboardPage.tsx` (two linked hexagons, `#00D4AA` stroke) — this is OTTO's established brand mark, just not yet exported as a standalone asset.

- Add `build/icon.svg`: the same mark, composited on a rounded dark-navy square (`#0B0E14`, matching `surface.0`) so it reads clearly as an app icon rather than a transparent line mark.
- Generate `build/icon.png` (1024×1024) from the SVG using macOS's built-in `sips` (`sips -s format png icon.svg --out icon.png`) — no new dependency needed, confirmed working.
- Generate `build/icon.icns` from the PNG using macOS's built-in `iconutil` (standard multi-resolution `.iconset` → `.icns` flow).
- In `src/main/index.ts`:
  - Pass `icon: path.join(__dirname, '../../build/icon.png')` in the `BrowserWindow` constructor options (covers Windows/Linux taskbar icon).
  - On `darwin`, call `app.dock?.setIcon(nativeImage.createFromPath(path.join(__dirname, '../../build/icon.icns')))` after `app.whenReady()` so the dev-mode dock icon shows the OTTO mark instead of Electron's default.

### 2. AI loading indicator

For each of `ErrorDecoder.tsx`, `SolutionBuilder.tsx`, `LogAnalyzer.tsx`:

- Sweep all light-theme classes to the existing dark-theme tokens (`tailwind.config.js`), matching how already-converted components (e.g. `SyncSection.tsx`, `ExportGateModal.tsx`) use them:
  - `bg-white` → `bg-surface-2`
  - `border-gray-200` → `border-border`
  - `text-gray-400`/`text-gray-500` → `text-text-secondary`
  - `text-gray-600`/`text-gray-700`/`text-gray-800` → `text-text-primary`
  - `text-okta-navy` (headings) → `text-text-primary`
  - `bg-red-50`/`border-red-200`/`text-red-600` (error blocks) → `bg-accent-red/10`/`border-accent-red/30`/`text-accent-red`
  - `bg-blue-50` (info callouts, if present) → `bg-accent-blue/10`
- Loading state specifically, replacing the current static "spinner + static sentence" block:
  - Card: `bg-surface-2 border border-border rounded-xl` (dark, consistent with other panels).
  - Spinner: keep `animate-spin` ring, colored with the component's existing accent (purple for decoder/solution, blue for log analyzer) so each feature keeps its visual identity.
  - Text: animate an ellipsis (`Decoding`, `Decoding.`, `Decoding..`, `Decoding...` cycling every ~400ms via a small `useEffect` + `setInterval` local to each component) so the text visibly changes over time — this is the "still working" signal, not just a spinning ring that can visually stall.
- No shared/global loading component is introduced — the fix is local styling + a small local animation hook, repeated in each of the 3 files (consistent with "surgical, minimal" — extracting a shared `<LoadingIndicator>` would touch more files than necessary for this fix and isn't requested).

## Testing

- Manual: run `npm run dev`, trigger each of Error Decoder, Solution Builder, and TF_LOG Analyzer, confirm the loading card is legible on the dark background and the ellipsis animates.
- Manual: launch via `npm start` and `electron .` on macOS, confirm the dock icon shows the OTTO mark, not the default Electron icon.
- No new automated tests needed — this is a styling/asset fix with no new logic branches worth unit-testing beyond existing coverage.

## Out of Scope / Follow-ups

- Full app-wide dark-theme audit (light-theme leftovers exist in other components too, e.g. `BestPractices.tsx`, `CustomWorkload.tsx`) — separate future task if desired.
- Packaged-app icon wiring (`electron-builder` config, `.ico` for Windows, bundle `Info.plist` icon) — only relevant once/if the app is packaged for distribution.
