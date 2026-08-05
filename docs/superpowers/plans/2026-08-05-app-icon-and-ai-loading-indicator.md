# App Icon + AI Loading Indicator Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace OTTO's generic Electron dock/taskbar icon with its own hexagon-link brand mark, and fix the "looks frozen" AI loading states in ErrorDecoder, SolutionBuilder, and LogAnalyzer by converting them to the app's dark theme and adding an animated "still working" text cue.

**Architecture:** (1) Export the existing inline SVG mark from `DashboardPage.tsx` as a standalone icon asset, rasterize it with macOS's built-in `sips`/`iconutil` (no new npm deps), and wire it into the `BrowserWindow` + dock icon in `src/main/index.ts`. (2) Sweep all light-theme Tailwind classes in the three affected renderer components to the existing dark-theme tokens (`tailwind.config.js`), following the pattern already used in `SyncSection.tsx` and `ExportGateModal.tsx`, and add a small local ellipsis-animation to each loading block.

**Tech Stack:** Electron (main process), React 18 + Tailwind (renderer), macOS `sips`/`iconutil` for icon generation (no new dependencies).

**Design doc:** `docs/superpowers/specs/2026-08-05-app-icon-and-ai-loading-indicator-design.md`

---

### Task 1: Generate app icon assets

**Files:**
- Create: `build/icon.svg`
- Create: `build/icon.png` (generated, not hand-written)
- Create: `build/icon.icns` (generated, not hand-written)

- [ ] **Step 1: Create the icon source SVG**

Create `build/icon.svg` with this exact content (the existing hexagon-link mark from `src/renderer/pages/DashboardPage.tsx:113-122`, composited on a rounded dark-navy square background matching `surface.0` from `tailwind.config.js`):

```xml
<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 40 40">
  <rect width="40" height="40" rx="7" fill="#0B0E14"/>
  <path d="M10 6L16 3L22 6V14L16 17L10 14V6Z" stroke="#00D4AA" stroke-width="1.8" stroke-linejoin="round" fill="none"/>
  <path d="M18 26L24 23L30 26V34L24 37L18 34V26Z" stroke="#00D4AA" stroke-width="1.8" stroke-linejoin="round" fill="none"/>
  <path d="M16 14L24 26" stroke="#00D4AA" stroke-width="1.8" stroke-linecap="round"/>
  <path d="M12 12L20 12" stroke="#00D4AA" stroke-width="1.4" stroke-linecap="round" opacity="0.5"/>
  <path d="M20 28L28 28" stroke="#00D4AA" stroke-width="1.4" stroke-linecap="round" opacity="0.5"/>
</svg>
```

- [ ] **Step 2: Rasterize to a 1024x1024 PNG using macOS's built-in `sips`**

Run:
```bash
mkdir -p build
sips -s format png build/icon.svg --out build/icon.png
```
Expected output: `/path/to/build/icon.svg\n  /path/to/build/icon.png` (no errors)

Verify: `file build/icon.png` should print `PNG image data, 1024 x 1024, 8-bit/color RGBA, non-interlaced`.

- [ ] **Step 3: Build the `.iconset` directory (required sizes for `iconutil`)**

Run:
```bash
mkdir -p build/icon.iconset
sips -z 16 16     build/icon.png --out build/icon.iconset/icon_16x16.png
sips -z 32 32     build/icon.png --out build/icon.iconset/icon_16x16@2x.png
sips -z 32 32     build/icon.png --out build/icon.iconset/icon_32x32.png
sips -z 64 64     build/icon.png --out build/icon.iconset/icon_32x32@2x.png
sips -z 128 128   build/icon.png --out build/icon.iconset/icon_128x128.png
sips -z 256 256   build/icon.png --out build/icon.iconset/icon_128x128@2x.png
sips -z 256 256   build/icon.png --out build/icon.iconset/icon_256x256.png
sips -z 512 512   build/icon.png --out build/icon.iconset/icon_256x256@2x.png
sips -z 512 512   build/icon.png --out build/icon.iconset/icon_512x512.png
cp build/icon.png build/icon.iconset/icon_512x512@2x.png
```
Expected: 10 PNG files created in `build/icon.iconset/`, no errors.

- [ ] **Step 4: Convert the iconset to `.icns` with `iconutil`, then remove the intermediate iconset**

Run:
```bash
iconutil -c icns build/icon.iconset -o build/icon.icns
rm -rf build/icon.iconset
```
Expected: `build/icon.icns` exists. Verify with `file build/icon.icns` → `Mac OS X icon`.

- [ ] **Step 5: Commit the generated assets**

```bash
git add build/icon.svg build/icon.png build/icon.icns
git commit -m "feat(icon): add OTTO brand mark as app icon asset"
```

---

### Task 2: Wire the icon into the running Electron app

**Files:**
- Modify: `src/main/index.ts`

- [ ] **Step 1: Update imports and add the icon path constant**

In `src/main/index.ts`, change line 1 from:
```typescript
import { app, BrowserWindow } from 'electron';
```
to:
```typescript
import { app, BrowserWindow, nativeImage } from 'electron';
```

Then add this constant after the existing `import * as path from 'path';` line (line 2):
```typescript
const APP_ICON_PNG = path.join(__dirname, '..', '..', 'build', 'icon.png');
const APP_ICON_ICNS = path.join(__dirname, '..', '..', 'build', 'icon.icns');
```

- [ ] **Step 2: Pass the icon to `BrowserWindow`**

In `createWindow()`, update the `BrowserWindow` constructor call (currently lines 17-28) to add an `icon` field:
```typescript
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'OTTO — Okta Terraform Tuning & Optimization',
    icon: APP_ICON_PNG,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
```

- [ ] **Step 3: Set the macOS dock icon explicitly**

In the `app.whenReady().then(...)` block (currently lines 48-57), add a dock icon call for macOS right after `registerIpcHandlers();`:
```typescript
app.whenReady().then(() => {
  registerIpcHandlers();
  if (process.platform === 'darwin') {
    app.dock?.setIcon(nativeImage.createFromPath(APP_ICON_ICNS));
  }
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});
```

- [ ] **Step 4: Build and verify no TypeScript errors**

Run: `npm run build:main`
Expected: exits 0, no TS errors.

- [ ] **Step 5: Manually verify the icon shows up**

Run: `npm run dev` (or `npm start`)
Expected: the dock icon (macOS) / taskbar icon shows the teal hexagon-link mark on a dark background, not the default Electron icon.

- [ ] **Step 6: Commit**

```bash
git add src/main/index.ts
git commit -m "feat(icon): show OTTO brand mark as dock/taskbar icon instead of default Electron icon"
```

---

### Task 3: Convert ErrorDecoder.tsx to dark theme + animated loading text

**Files:**
- Modify: `src/renderer/components/ErrorDecoder.tsx`

- [ ] **Step 1: Add the ellipsis-animation state**

In `ErrorDecoder.tsx`, add a new state hook right after the existing `useState` declarations (after line 15, `const [hasKey, setHasKey] = useState(false);`):
```typescript
  const [dots, setDots] = useState('');

  useEffect(() => {
    if (!loading) { setDots(''); return; }
    const interval = setInterval(() => {
      setDots(d => (d.length >= 3 ? '' : d + '.'));
    }, 400);
    return () => clearInterval(interval);
  }, [loading]);
```

- [ ] **Step 2: Replace the full component body with the dark-theme version**

Replace the entire `return (...)` block (lines 44-131) with:
```tsx
  return (
    <div>
      <h1 className="text-lg font-bold text-text-primary mb-2">Error Decoder</h1>
      <p className="text-xs text-text-secondary mb-4">
        Paste any Terraform + Okta error message and get a plain-English explanation with a specific fix.
      </p>

      {/* Input */}
      <div className="bg-surface-2 rounded-xl border border-border p-4 mb-4">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Paste your error message here...&#10;&#10;Examples:&#10;• Error: API Error (401): E0000011 - Invalid token provided&#10;• Error creating okta_app_user: The API returned an error: ...&#10;• context deadline exceeded&#10;• Error: cycle detected in resource dependencies"
          rows={6}
          className="w-full px-3 py-2 text-xs font-mono bg-surface-1 text-text-primary border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-400 resize-y"
        />
        <div className="flex items-center justify-between mt-3">
          <span className="text-xs text-text-muted">
            {input.length > 0 ? `${input.split('\n').length} lines` : 'Supports Terraform CLI output, provider errors, and Okta API responses'}
          </span>
          <button
            onClick={handleDecode}
            disabled={loading || !input.trim() || !hasKey}
            className="px-4 py-2 text-xs font-medium text-white bg-purple-600 rounded-lg hover:bg-purple-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? 'Decoding...' : !hasKey ? 'No API Key' : 'Decode Error'}
          </button>
        </div>
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex items-center gap-2 p-4 bg-surface-2 rounded-xl border border-border">
          <div className="animate-spin w-4 h-4 border-2 border-purple-500 border-t-transparent rounded-full" />
          <span className="text-xs text-text-secondary">Claude is analyzing the error{dots}</span>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="bg-accent-red/10 border border-accent-red/30 rounded-xl p-4">
          <p className="text-xs text-accent-red">{error}</p>
        </div>
      )}

      {/* Result */}
      {result && (
        <div className="bg-surface-2 rounded-xl border border-border p-4 space-y-4">
          <div>
            <span className="text-xs font-medium text-text-muted uppercase tracking-wide">What This Means</span>
            <p className="text-sm text-text-secondary mt-1">{result.explanation}</p>
          </div>

          <div>
            <span className="text-xs font-medium text-text-muted uppercase tracking-wide">Root Cause</span>
            <p className="text-sm font-medium text-text-primary mt-1">{result.cause}</p>
          </div>

          <div className="bg-accent-green/10 border border-accent-green/30 rounded-lg p-3">
            <span className="text-xs font-medium text-accent-green uppercase tracking-wide">How to Fix</span>
            <p className="text-sm text-accent-green mt-1 whitespace-pre-line">{result.fix}</p>
          </div>

          {result.relatedDocs && (
            <div className="border-t border-border pt-3">
              <span className="text-xs font-medium text-text-muted uppercase tracking-wide">Related Docs</span>
              <p className="text-xs text-accent-blue mt-1">{result.relatedDocs}</p>
            </div>
          )}

          <button
            onClick={() => { setResult(null); setInput(''); }}
            className="text-xs text-text-muted hover:text-text-primary transition-colors"
          >
            Decode another error
          </button>
        </div>
      )}

      {/* No key message */}
      {!hasKey && !loading && (
        <div className="bg-accent-amber/10 border border-accent-amber/30 rounded-xl p-4">
          <p className="text-xs text-accent-amber">Set a Claude API key to enable AI-powered error decoding.</p>
        </div>
      )}
    </div>
  );
```

Note: `accent-green` isn't in `tailwind.config.js` under that exact name — check the file again: `accent.green` maps to `#10B981` and IS defined (see `tailwind.config.js` `accent` block). So `accent-green` is valid.

- [ ] **Step 3: Build and verify no TypeScript/Tailwind errors**

Run: `npm run build:renderer`
Expected: exits 0, no errors.

- [ ] **Step 4: Manually verify in the running app**

Run: `npm run dev`, open Error Decoder, paste any text, click "Decode Error".
Expected: input card, loading card, and result card all render with dark backgrounds and legible text; loading text cycles through `Claude is analyzing the error`, `Claude is analyzing the error.`, `..`, `...` every 400ms.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/ErrorDecoder.tsx
git commit -m "fix(ui): convert ErrorDecoder to dark theme and animate loading text"
```

---

### Task 4: Convert SolutionBuilder.tsx to dark theme + animated loading text

**Files:**
- Modify: `src/renderer/components/SolutionBuilder.tsx`

- [ ] **Step 1: Add the ellipsis-animation state**

Add after the existing `useState` declarations (after line 29, `const [copied, setCopied] = useState<string | null>(null);`):
```typescript
  const [dots, setDots] = useState('');

  useEffect(() => {
    if (!loading) { setDots(''); return; }
    const interval = setInterval(() => {
      setDots(d => (d.length >= 3 ? '' : d + '.'));
    }, 400);
    return () => clearInterval(interval);
  }, [loading]);
```

- [ ] **Step 2: Convert the empty/input state block (lines 78-113) to dark theme**

Replace:
```tsx
  if (!result && !loading) {
    return (
      <div>
        <h1 className="text-lg font-bold text-okta-navy mb-2">Solution Builder</h1>
        <p className="text-xs text-gray-500 mb-4">
          Describe what you need to accomplish with Okta Terraform in plain English. Get a complete, exportable solution with config, instructions, and provider-specific guidance.
        </p>

        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={"Describe your workload...\n\nExamples:\n• I need to import 200 existing SAML apps with their user assignments into Terraform\n• Create 50 OAuth apps with group assignments and configure SSO policies\n• Set up 10 authorization servers with custom scopes and claims\n• Migrate 5,000 users into Okta with group memberships using Terraform"}
            rows={6}
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-400 resize-y"
          />
          <div className="flex items-center justify-between mt-3">
            <span className="text-xs text-gray-400">
              Provider v{providerVersion}
            </span>
            <button
              onClick={handleGenerate}
              disabled={loading || !input.trim() || !hasKey}
              className="px-4 py-2 text-sm font-medium text-white bg-purple-600 rounded-lg hover:bg-purple-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? 'Generating...' : !hasKey ? 'No API Key' : 'Generate Solution'}
            </button>
          </div>
          {error && <p className="text-xs text-red-500 mt-3">{error}</p>}
          {!hasKey && (
            <p className="text-xs text-amber-600 mt-3">Set a Claude API key to enable the Solution Builder.</p>
          )}
        </div>
      </div>
    );
  }
```
with:
```tsx
  if (!result && !loading) {
    return (
      <div>
        <h1 className="text-lg font-bold text-text-primary mb-2">Solution Builder</h1>
        <p className="text-xs text-text-secondary mb-4">
          Describe what you need to accomplish with Okta Terraform in plain English. Get a complete, exportable solution with config, instructions, and provider-specific guidance.
        </p>

        <div className="bg-surface-2 rounded-xl border border-border p-4">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={"Describe your workload...\n\nExamples:\n• I need to import 200 existing SAML apps with their user assignments into Terraform\n• Create 50 OAuth apps with group assignments and configure SSO policies\n• Set up 10 authorization servers with custom scopes and claims\n• Migrate 5,000 users into Okta with group memberships using Terraform"}
            rows={6}
            className="w-full px-3 py-2 text-sm bg-surface-1 text-text-primary border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-400 resize-y"
          />
          <div className="flex items-center justify-between mt-3">
            <span className="text-xs text-text-muted">
              Provider v{providerVersion}
            </span>
            <button
              onClick={handleGenerate}
              disabled={loading || !input.trim() || !hasKey}
              className="px-4 py-2 text-sm font-medium text-white bg-purple-600 rounded-lg hover:bg-purple-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? 'Generating...' : !hasKey ? 'No API Key' : 'Generate Solution'}
            </button>
          </div>
          {error && <p className="text-xs text-accent-red mt-3">{error}</p>}
          {!hasKey && (
            <p className="text-xs text-accent-amber mt-3">Set a Claude API key to enable the Solution Builder.</p>
          )}
        </div>
      </div>
    );
  }
```

- [ ] **Step 3: Convert the loading block (lines 115-125) to dark theme with animated text**

Replace:
```tsx
  if (loading) {
    return (
      <div>
        <h1 className="text-lg font-bold text-okta-navy mb-4">Solution Builder</h1>
        <div className="flex items-center gap-3 p-8 bg-white rounded-xl border border-gray-200">
          <div className="animate-spin w-5 h-5 border-2 border-purple-500 border-t-transparent rounded-full" />
          <span className="text-sm text-gray-600">Generating your Terraform solution...</span>
        </div>
      </div>
    );
  }
```
with:
```tsx
  if (loading) {
    return (
      <div>
        <h1 className="text-lg font-bold text-text-primary mb-4">Solution Builder</h1>
        <div className="flex items-center gap-3 p-8 bg-surface-2 rounded-xl border border-border">
          <div className="animate-spin w-5 h-5 border-2 border-purple-500 border-t-transparent rounded-full" />
          <span className="text-sm text-text-secondary">Generating your Terraform solution{dots}</span>
        </div>
      </div>
    );
  }
```

- [ ] **Step 4: Convert the result view (lines 137-267) to dark theme**

Replace the entire final `return (...)` block with:
```tsx
  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-text-primary">Solution Builder</h1>
          <p className="text-xs text-text-muted">v{providerVersion}</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleExport}
            className="px-3 py-1.5 text-xs font-medium text-white bg-okta-blue rounded-lg hover:bg-okta-blue-light transition-colors"
          >
            Export Project
          </button>
          <button
            onClick={() => { setResult(null); setInput(''); }}
            className="px-3 py-1.5 text-xs font-medium text-text-secondary bg-surface-3 rounded-lg hover:bg-surface-4 transition-colors"
          >
            New Solution
          </button>
        </div>
      </div>

      {/* Feasibility + Summary */}
      {!result.feasible && (
        <div className="bg-accent-red/10 border border-accent-red/30 rounded-xl p-4">
          <p className="text-sm font-medium text-accent-red">This is not fully possible with the Okta Terraform Provider</p>
          <p className="text-xs text-accent-red mt-1">{result.summary}</p>
        </div>
      )}
      {result.feasible && (
        <div className="bg-accent-green/10 border border-accent-green/30 rounded-xl p-4">
          <p className="text-sm font-medium text-accent-green">{result.summary}</p>
          {result.estimatedRuntime && (
            <p className="text-xs text-accent-green mt-1">Estimated runtime: {result.estimatedRuntime}</p>
          )}
        </div>
      )}

      {/* Limitations */}
      {result.limitations && result.limitations.length > 0 && (
        <div className="bg-accent-amber/10 border border-accent-amber/30 rounded-xl p-4">
          <p className="text-xs font-medium text-accent-amber uppercase tracking-wide mb-2">Provider Limitations</p>
          <ul className="space-y-1">
            {result.limitations.map((l, i) => (
              <li key={i} className="text-xs text-accent-amber flex gap-2">
                <span className="text-accent-amber flex-shrink-0">!</span>
                <span>{l}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* HCL Files */}
      <div className="bg-surface-2 rounded-xl border border-border overflow-hidden">
        <div className="flex border-b border-border">
          {fileOptions.map(f => (
            <button
              key={f.id}
              onClick={() => setActiveFile(f.id)}
              className={`px-4 py-2.5 text-xs font-mono transition-colors ${
                activeFile === f.id
                  ? 'text-text-primary bg-surface-3 border-b-2 border-okta-blue'
                  : 'text-text-muted hover:text-text-secondary'
              }`}
            >
              {f.label}
            </button>
          ))}
          <button
            onClick={() => handleCopy(activeContent, activeFile)}
            className="ml-auto px-3 py-2 text-xs text-text-muted hover:text-text-secondary transition-colors"
          >
            {copied === activeFile ? 'Copied!' : 'Copy'}
          </button>
        </div>
        <pre className="p-4 text-xs font-mono text-text-secondary overflow-x-auto max-h-80 overflow-y-auto bg-surface-1">
          {activeContent}
        </pre>
      </div>

      {/* Instructions */}
      <div className="bg-surface-2 rounded-xl border border-border p-4">
        <p className="text-xs font-medium text-text-muted uppercase tracking-wide mb-3">Instructions</p>
        <ol className="space-y-2">
          {result.instructions.map((step, i) => (
            <li key={i} className="text-xs text-text-secondary flex gap-2">
              <span className="text-okta-blue font-bold flex-shrink-0">{i + 1}.</span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
      </div>

      {/* Warnings */}
      {result.warnings.length > 0 && (
        <div className="bg-accent-amber/10 border border-accent-amber/30 rounded-xl p-4">
          <p className="text-xs font-medium text-accent-amber uppercase tracking-wide mb-2">Warnings</p>
          <ul className="space-y-1">
            {result.warnings.map((w, i) => (
              <li key={i} className="text-xs text-accent-amber flex gap-2">
                <span className="text-accent-amber flex-shrink-0">!</span>
                <span>{w}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Auth Requirements */}
      <div className="bg-surface-2 rounded-xl border border-border p-4">
        <p className="text-xs font-medium text-text-muted uppercase tracking-wide mb-2">Authentication Requirements</p>
        <div className="flex gap-6">
          <div>
            <span className="text-xs text-text-muted">Min. Admin Role</span>
            <p className="text-sm font-medium text-text-secondary">{result.requiredRole}</p>
          </div>
          <div className="flex-1">
            <span className="text-xs text-text-muted">OAuth Scopes</span>
            <div className="flex flex-wrap gap-1 mt-1">
              {result.requiredScopes.map(s => (
                <span key={s} className="text-xs font-mono bg-accent-blue/10 text-accent-blue px-2 py-0.5 rounded">{s}</span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
```

- [ ] **Step 5: Build and verify no TypeScript/Tailwind errors**

Run: `npm run build:renderer`
Expected: exits 0, no errors.

- [ ] **Step 6: Manually verify in the running app**

Run: `npm run dev`, open Solution Builder, describe a workload, click "Generate Solution".
Expected: input card, loading card (animated ellipsis), and result card (tabs, instructions, auth requirements) all render with dark backgrounds and legible text.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/components/SolutionBuilder.tsx
git commit -m "fix(ui): convert SolutionBuilder to dark theme and animate loading text"
```

---

### Task 5: Convert LogAnalyzer.tsx to dark theme + animated loading text

**Files:**
- Modify: `src/renderer/components/LogAnalyzer.tsx`

- [ ] **Step 1: Convert the `severityColors` map (lines 12-16) to dark-theme accent tokens**

Replace:
```typescript
const severityColors = {
  critical: { bg: 'bg-red-50', border: 'border-red-200', title: 'text-red-800', text: 'text-red-600', badge: 'bg-red-100 text-red-700' },
  warning: { bg: 'bg-amber-50', border: 'border-amber-200', title: 'text-amber-800', text: 'text-amber-600', badge: 'bg-amber-100 text-amber-700' },
  info: { bg: 'bg-blue-50', border: 'border-blue-200', title: 'text-blue-800', text: 'text-blue-600', badge: 'bg-blue-100 text-blue-700' },
};
```
with:
```typescript
const severityColors = {
  critical: { bg: 'bg-accent-red/10', border: 'border-accent-red/30', title: 'text-accent-red', text: 'text-accent-red', badge: 'bg-accent-red/20 text-accent-red' },
  warning: { bg: 'bg-accent-amber/10', border: 'border-accent-amber/30', title: 'text-accent-amber', text: 'text-accent-amber', badge: 'bg-accent-amber/20 text-accent-amber' },
  info: { bg: 'bg-accent-blue/10', border: 'border-accent-blue/30', title: 'text-accent-blue', text: 'text-accent-blue', badge: 'bg-accent-blue/20 text-accent-blue' },
};
```

- [ ] **Step 2: Add the ellipsis-animation state**

Add after the existing `useState` declarations (after line 26, `const [hasKey, setHasKey] = useState(false);`):
```typescript
  const [dots, setDots] = useState('');

  useEffect(() => {
    if (!loading) { setDots(''); return; }
    const interval = setInterval(() => {
      setDots(d => (d.length >= 3 ? '' : d + '.'));
    }, 400);
    return () => clearInterval(interval);
  }, [loading]);

  const [interpretDots, setInterpretDots] = useState('');

  useEffect(() => {
    if (!interpreting) { setInterpretDots(''); return; }
    const interval = setInterval(() => {
      setInterpretDots(d => (d.length >= 3 ? '' : d + '.'));
    }, 400);
    return () => clearInterval(interval);
  }, [interpreting]);
```

- [ ] **Step 3: Convert the empty/upload state block (lines 74-100) to dark theme**

Replace:
```tsx
  if (!analysis && !loading) {
    return (
      <div>
        <h1 className="text-lg font-bold text-okta-navy mb-2">TF_LOG Analyzer</h1>
        <p className="text-xs text-gray-500 mb-4">
          Load a Terraform debug log (<code className="bg-gray-100 px-1 rounded">TF_LOG=DEBUG</code>) to analyze rate limit behavior, identify bottlenecks, and get optimization recommendations.
        </p>
        <div className="flex items-start gap-2.5 bg-amber-950/20 border border-amber-600/30 rounded-lg px-3.5 py-3 mb-5">
          <span className="text-amber-400 text-sm mt-0.5 shrink-0">⚠</span>
          <p className="text-[11px] text-amber-300/80 leading-relaxed">
            <span className="font-semibold text-amber-400">No PII.</span> Debug logs may contain SSWS tokens, Bearer tokens, org URLs, and user IDs. Remove sensitive data before uploading. Log contents are sent to the AI for analysis.
          </p>
        </div>
        <button
          onClick={handleOpen}
          className="w-full py-12 border-2 border-dashed border-gray-300 rounded-xl hover:border-okta-blue hover:bg-blue-50/30 transition-colors cursor-pointer"
        >
          <div className="text-center">
            <span className="text-3xl block mb-2">📂</span>
            <span className="text-sm font-medium text-gray-600">Click to select a log file</span>
            <span className="text-xs text-gray-400 block mt-1">.log or .txt — typically 10MB+ for large runs</span>
          </div>
        </button>
        {error && <p className="text-xs text-red-500 mt-3">{error}</p>}
      </div>
    );
  }
```
with:
```tsx
  if (!analysis && !loading) {
    return (
      <div>
        <h1 className="text-lg font-bold text-text-primary mb-2">TF_LOG Analyzer</h1>
        <p className="text-xs text-text-secondary mb-4">
          Load a Terraform debug log (<code className="bg-surface-3 px-1 rounded">TF_LOG=DEBUG</code>) to analyze rate limit behavior, identify bottlenecks, and get optimization recommendations.
        </p>
        <div className="flex items-start gap-2.5 bg-amber-950/20 border border-amber-600/30 rounded-lg px-3.5 py-3 mb-5">
          <span className="text-amber-400 text-sm mt-0.5 shrink-0">⚠</span>
          <p className="text-[11px] text-amber-300/80 leading-relaxed">
            <span className="font-semibold text-amber-400">No PII.</span> Debug logs may contain SSWS tokens, Bearer tokens, org URLs, and user IDs. Remove sensitive data before uploading. Log contents are sent to the AI for analysis.
          </p>
        </div>
        <button
          onClick={handleOpen}
          className="w-full py-12 border-2 border-dashed border-border hover:border-okta-blue hover:bg-accent-blue/5 transition-colors cursor-pointer rounded-xl"
        >
          <div className="text-center">
            <span className="text-3xl block mb-2">📂</span>
            <span className="text-sm font-medium text-text-secondary">Click to select a log file</span>
            <span className="text-xs text-text-muted block mt-1">.log or .txt — typically 10MB+ for large runs</span>
          </div>
        </button>
        {error && <p className="text-xs text-accent-red mt-3">{error}</p>}
      </div>
    );
  }
```

- [ ] **Step 4: Convert the loading block (lines 102-112) to dark theme with animated text**

Replace:
```tsx
  if (loading) {
    return (
      <div>
        <h1 className="text-lg font-bold text-okta-navy mb-4">TF_LOG Analyzer</h1>
        <div className="flex items-center gap-3 p-8 bg-white rounded-xl border border-gray-200">
          <div className="animate-spin w-5 h-5 border-2 border-okta-blue border-t-transparent rounded-full" />
          <span className="text-sm text-gray-600">Parsing {fileName}...</span>
        </div>
      </div>
    );
  }
```
with:
```tsx
  if (loading) {
    return (
      <div>
        <h1 className="text-lg font-bold text-text-primary mb-4">TF_LOG Analyzer</h1>
        <div className="flex items-center gap-3 p-8 bg-surface-2 rounded-xl border border-border">
          <div className="animate-spin w-5 h-5 border-2 border-okta-blue border-t-transparent rounded-full" />
          <span className="text-sm text-text-secondary">Parsing {fileName}{dots}</span>
        </div>
      </div>
    );
  }
```

- [ ] **Step 5: Convert the main result view (lines 116-337) to dark theme**

Replace the entire final `return (...)` block with:
```tsx
  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-text-primary">TF_LOG Analyzer</h1>
          <p className="text-xs text-text-muted">{fileName}</p>
        </div>
        <button
          onClick={handleOpen}
          className="px-3 py-1.5 text-xs font-medium text-okta-blue bg-okta-blue/10 rounded-lg hover:bg-okta-blue/20 transition-colors"
        >
          Load another log
        </button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
        <SummaryCard label="Duration" value={formatDuration(analysis.durationSeconds)} />
        <SummaryCard label="Requests" value={analysis.totalRequests.toLocaleString()} />
        <SummaryCard label="429s" value={String(analysis.rateLimited)} color={analysis.rateLimited > 0 ? 'red' : 'green'} />
        <SummaryCard label="Errors" value={String(analysis.errors)} color={analysis.errors > 0 ? 'red' : 'green'} />
        <SummaryCard label="Deadline Errors" value={String(analysis.deadlineExceeded)} color={analysis.deadlineExceeded > 0 ? 'red' : 'green'} />
        <SummaryCard label="Backoff Time" value={analysis.estimatedBackoffSeconds > 0 ? formatDuration(analysis.estimatedBackoffSeconds) : '—'} color={analysis.estimatedBackoffSeconds > 30 ? 'amber' : undefined} />
      </div>

      {/* AI Interpretation */}
      <div className="bg-surface-2 rounded-xl border border-border p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xs font-medium text-text-muted uppercase tracking-wide">AI Analysis</h2>
          {!interpretation && (
            <button
              onClick={handleInterpret}
              disabled={interpreting || !hasKey}
              className="px-3 py-1.5 text-xs font-medium text-white bg-purple-600 rounded-lg hover:bg-purple-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {interpreting ? 'Analyzing...' : !hasKey ? 'No API Key' : 'Explain with AI'}
            </button>
          )}
        </div>
        {interpreting && (
          <div className="flex items-center gap-2 py-4">
            <div className="animate-spin w-4 h-4 border-2 border-purple-500 border-t-transparent rounded-full" />
            <span className="text-xs text-text-secondary">Claude is analyzing your log{interpretDots}</span>
          </div>
        )}
        {interpretError && (
          <p className="text-xs text-accent-red">{interpretError}</p>
        )}
        {interpretation && (
          <div className="space-y-3">
            <div>
              <span className="text-xs font-medium text-text-muted uppercase">Root Cause</span>
              <p className="text-sm font-medium text-text-primary mt-0.5">{interpretation.rootCause}</p>
            </div>
            <div>
              <span className="text-xs font-medium text-text-muted uppercase">What Happened</span>
              <p className="text-sm text-text-secondary mt-0.5">{interpretation.narrative}</p>
            </div>
            <div className="bg-accent-green/10 border border-accent-green/30 rounded-lg p-3">
              <span className="text-xs font-medium text-accent-green uppercase">Top Fix</span>
              <p className="text-sm font-medium text-accent-green mt-0.5">{interpretation.topFix}</p>
            </div>
            {interpretation.configChanges && Object.keys(interpretation.configChanges).length > 0 && (
              <div className="bg-surface-1 rounded-lg p-3">
                <span className="text-xs font-medium text-text-muted uppercase">Suggested Config</span>
                <pre className="text-xs font-mono text-text-secondary mt-1">
                  {Object.entries(interpretation.configChanges).map(([k, v]) => `${k} = ${v}`).join('\n')}
                </pre>
              </div>
            )}
          </div>
        )}
        {!interpretation && !interpreting && !interpretError && hasKey && (
          <p className="text-xs text-text-muted">Click "Explain with AI" to get a plain-English analysis of this run.</p>
        )}
        {!hasKey && !interpreting && (
          <p className="text-xs text-text-muted">Set a Claude API key to enable AI-powered log interpretation.</p>
        )}
      </div>

      {/* Detected config */}
      <div className="bg-surface-2 rounded-xl border border-border p-4">
        <h2 className="text-xs font-medium text-text-muted uppercase tracking-wide mb-3">Detected Provider Config</h2>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          <ConfigItem label="min_wait" value={`${analysis.detectedConfig.minWait}s`} />
          <ConfigItem label="max_wait" value={`${analysis.detectedConfig.maxWait}s`} />
          <ConfigItem label="max_retries" value={String(analysis.detectedConfig.maxRetries)} />
          <ConfigItem label="max_api_capacity" value={analysis.detectedConfig.maxApiCapacity ? `${analysis.detectedConfig.maxApiCapacity}%` : 'not set'} />
          <ConfigItem label="parallelism" value={analysis.detectedConfig.parallelism ? `~${analysis.detectedConfig.parallelism}` : 'unknown'} />
        </div>
      </div>

      {/* Issues */}
      {analysis.issues.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-xs font-medium text-text-muted uppercase tracking-wide">Findings</h2>
          {analysis.issues.map((issue, i) => {
            const colors = severityColors[issue.severity];
            return (
              <div key={i} className={`${colors.bg} border ${colors.border} rounded-lg p-3`}>
                <div className="flex items-start gap-2">
                  <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${colors.badge}`}>
                    {issue.severity}
                  </span>
                  <div>
                    <p className={`text-xs font-medium ${colors.title}`}>{issue.title}</p>
                    <p className={`text-xs ${colors.text} mt-0.5 whitespace-pre-wrap`}>{issue.detail}</p>
                    <p className={`text-xs font-medium ${colors.title} mt-1`}>→ {issue.recommendation}</p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Error breakdown by status */}
      {analysis.errorsByStatus && Object.keys(analysis.errorsByStatus).length > 0 && (
        <div className="bg-surface-2 rounded-xl border border-border p-4">
          <h2 className="text-xs font-medium text-text-muted uppercase tracking-wide mb-3">Error Breakdown by Status</h2>
          <div className="flex flex-wrap gap-3">
            {Object.entries(analysis.errorsByStatus)
              .sort(([, a], [, b]) => b - a)
              .map(([status, count]) => {
                const statusNum = parseInt(status);
                const label = statusNum === 401 ? 'Unauthorized' : statusNum === 403 ? 'Forbidden' : statusNum === 404 ? 'Not Found' : statusNum === 409 ? 'Conflict' : statusNum === 429 ? 'Rate Limited' : statusNum >= 500 ? 'Server Error' : `HTTP ${status}`;
                const color = statusNum === 429 ? 'bg-accent-amber/10 text-accent-amber border-accent-amber/30' : 'bg-accent-red/10 text-accent-red border-accent-red/30';
                return (
                  <div key={status} className={`${color} border rounded-lg px-3 py-2`}>
                    <span className="text-lg font-bold">{count}</span>
                    <span className="text-xs block">{statusNum} {label}</span>
                  </div>
                );
              })}
          </div>
        </div>
      )}

      {/* Error details table */}
      {analysis.errorDetails && analysis.errorDetails.length > 0 && (
        <div className="bg-surface-2 rounded-xl border border-border overflow-hidden">
          <div className="px-4 py-3 border-b border-border">
            <h2 className="text-xs font-medium text-text-muted uppercase tracking-wide">Error Details</h2>
          </div>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-text-muted uppercase tracking-wide border-b border-border">
                <th className="px-4 py-2 font-medium">Endpoint</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium">Error Code</th>
                <th className="px-4 py-2 font-medium">Message</th>
                <th className="px-4 py-2 font-medium text-right">Count</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {analysis.errorDetails.slice(0, 25).map((err, i) => (
                <tr key={i} className="hover:bg-surface-3">
                  <td className="px-4 py-2">
                    <span className="font-medium text-text-secondary">{err.label}</span>
                    <span className="block font-mono text-text-muted">{err.endpoint}</span>
                  </td>
                  <td className="px-4 py-2">
                    <span className={`font-medium ${err.httpStatus >= 500 ? 'text-accent-red' : err.httpStatus >= 400 ? 'text-accent-amber' : 'text-text-secondary'}`}>
                      {err.httpStatus}
                    </span>
                  </td>
                  <td className="px-4 py-2 font-mono text-text-secondary">
                    {err.oktaErrorCode || '—'}
                  </td>
                  <td className="px-4 py-2 text-text-secondary max-w-xs truncate">
                    {err.message || '—'}
                  </td>
                  <td className="px-4 py-2 text-right font-medium text-text-primary">
                    {err.count}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Endpoint breakdown */}
      {analysis.endpoints.length > 0 && (
        <div className="bg-surface-2 rounded-xl border border-border overflow-hidden">
          <div className="px-4 py-3 border-b border-border">
            <h2 className="text-xs font-medium text-text-muted uppercase tracking-wide">Endpoint Breakdown</h2>
          </div>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-text-muted uppercase tracking-wide border-b border-border">
                <th className="px-4 py-2 font-medium">Endpoint</th>
                <th className="px-4 py-2 font-medium text-right">Calls</th>
                <th className="px-4 py-2 font-medium text-right">429s</th>
                <th className="px-4 py-2 font-medium text-right">Errors</th>
                <th className="px-4 py-2 font-medium text-right">Rate Limit</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {analysis.endpoints.slice(0, 20).map((ep, i) => (
                <tr key={i} className="hover:bg-surface-3">
                  <td className="px-4 py-2">
                    <span className="font-medium text-text-secondary">{ep.label}</span>
                    <span className="block font-mono text-text-muted text-xs">{ep.pattern}</span>
                  </td>
                  <td className="px-4 py-2 text-right font-medium text-text-primary">{ep.totalCalls.toLocaleString()}</td>
                  <td className={`px-4 py-2 text-right font-medium ${ep.rateLimited > 0 ? 'text-accent-red' : 'text-text-muted'}`}>
                    {ep.rateLimited}
                  </td>
                  <td className={`px-4 py-2 text-right font-medium ${ep.errors > 0 ? 'text-accent-red' : 'text-text-muted'}`}>
                    {ep.errors}
                  </td>
                  <td className="px-4 py-2 text-right text-text-secondary">
                    {ep.minRateLimit > 0 ? `${ep.minRateLimit}/win` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 6: Convert `SummaryCard` and `ConfigItem` helper components (lines 342-359) to dark theme**

Replace:
```tsx
function SummaryCard({ label, value, color }: { label: string; value: string; color?: 'red' | 'green' | 'amber' }) {
  const valueColor = color === 'red' ? 'text-red-600' : color === 'green' ? 'text-green-600' : color === 'amber' ? 'text-amber-600' : 'text-okta-navy';
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-3">
      <div className="text-xs text-gray-400 uppercase tracking-wider">{label}</div>
      <div className={`text-lg font-bold mt-0.5 ${valueColor}`}>{value}</div>
    </div>
  );
}

function ConfigItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="text-xs text-gray-400 font-mono">{label}</span>
      <span className="block text-sm font-medium text-gray-700">{value}</span>
    </div>
  );
}
```
with:
```tsx
function SummaryCard({ label, value, color }: { label: string; value: string; color?: 'red' | 'green' | 'amber' }) {
  const valueColor = color === 'red' ? 'text-accent-red' : color === 'green' ? 'text-accent-green' : color === 'amber' ? 'text-accent-amber' : 'text-text-primary';
  return (
    <div className="bg-surface-2 rounded-lg border border-border p-3">
      <div className="text-xs text-text-muted uppercase tracking-wider">{label}</div>
      <div className={`text-lg font-bold mt-0.5 ${valueColor}`}>{value}</div>
    </div>
  );
}

function ConfigItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="text-xs text-text-muted font-mono">{label}</span>
      <span className="block text-sm font-medium text-text-secondary">{value}</span>
    </div>
  );
}
```

- [ ] **Step 7: Build and verify no TypeScript/Tailwind errors**

Run: `npm run build:renderer`
Expected: exits 0, no errors.

- [ ] **Step 8: Manually verify in the running app**

Run: `npm run dev`, open TF_LOG Analyzer, load a `.log`/`.txt` file, click "Explain with AI".
Expected: upload screen, loading card (animated ellipsis "Parsing filename..."), summary cards, findings, tables, and "Explain with AI" loading state (animated ellipsis "Claude is analyzing your log...") all render with dark backgrounds and legible text.

- [ ] **Step 9: Commit**

```bash
git add src/renderer/components/LogAnalyzer.tsx
git commit -m "fix(ui): convert LogAnalyzer to dark theme and animate loading text"
```

---

### Task 6: Full test suite regression check

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: all existing tests still pass (this change touches only JSX/className strings and adds new local state — no test currently asserts on specific className values in these 3 files, per a quick check of `src/__tests__/` for `ErrorDecoder`, `SolutionBuilder`, `LogAnalyzer` references).

- [ ] **Step 2: Run the full build**

Run: `npm run build`
Expected: exits 0, no errors, `dist/main/index.js`, `dist/preload.js`, `dist/renderer/*` all produced.

- [ ] **Step 3: Final manual smoke test**

Run: `npm start`
Expected: dock/taskbar icon shows the OTTO mark; Error Decoder, Solution Builder, and TF_LOG Analyzer all show legible dark-theme loading states with animated ellipsis text during their respective AI calls.
