# Optional Org Connection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the org-connection startup gate so DSEs land on the Debug tab immediately, with Rate Limits and Plan > Workload prompting for connection only when needed.

**Architecture:** `App.tsx` always renders `DashboardPage`. A new `ConnectOrgModal` (extracted from `ConnectPage`) is opened from the header "Connect Org" button or the Rate Limits empty-state CTA. `ConnectPage.tsx` is deleted — AI config lives in the existing `SettingsModal`.

**Tech Stack:** React 18, TypeScript, Zustand, Tailwind CSS, Electron renderer process

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/renderer/App.tsx` | Modify | Remove `connected` gate, always render `DashboardPage` |
| `src/renderer/pages/ConnectPage.tsx` | Delete | Superseded by `ConnectOrgModal` + `SettingsModal` |
| `src/renderer/components/ConnectOrgModal.tsx` | Create | Org URL + token form in a modal overlay |
| `src/renderer/pages/DashboardPage.tsx` | Modify | Default tab → debug, header state machine, Rate Limits empty state, wire modal |
| `src/renderer/components/ResourceSelector.tsx` | Modify | Gate "Count & Optimize" button on `connection.connected` |

---

## Task 1: Create new worktree

- [ ] **Step 1: Exit the current worktree and create a fresh one**

Run from the repo root (`/Users/nicole.pendill/okta-terraform-toolkit`):

```bash
git worktree add .worktrees/optional-org-connection -b feat/optional-org-connection
```

- [ ] **Step 2: Verify the worktree is clean**

```bash
cd .worktrees/optional-org-connection
git status
```

Expected output: `On branch feat/optional-org-connection` / `nothing to commit, working tree clean`

---

## Task 2: Create `ConnectOrgModal.tsx`

**File:** Create `src/renderer/components/ConnectOrgModal.tsx`

This component extracts only the org connection form from `ConnectPage.tsx` — no AI config. It follows the `SettingsModal` overlay pattern.

- [ ] **Step 1: Create the file**

```tsx
import React, { useState } from 'react';
import { useStore } from '../hooks/useStore';

interface Props {
  onClose: () => void;
}

export default function ConnectOrgModal({ onClose }: Props) {
  const { connecting, connection, connect } = useStore();
  const [orgUrl, setOrgUrl] = useState('');
  const [token, setToken] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    let url = orgUrl.trim();
    if (!url.startsWith('https://') && !url.startsWith('http://')) {
      url = `https://${url}`;
    }
    url = url.replace(/\/+$/, '');
    const success = await connect({ orgUrl: url, authMethod: 'token', token: token.trim() });
    if (success) onClose();
  };

  const isValid = orgUrl.trim().length > 0 && token.trim().length > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative bg-surface-1 border border-border rounded-xl w-full max-w-md mx-4 p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-sm font-semibold text-text-primary">Connect to Org</h2>
          <button
            onClick={onClose}
            className="text-text-muted hover:text-text-secondary"
            aria-label="Close"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M1 1l12 12M13 1L1 13" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="modal-orgUrl" className="block text-xs font-medium text-text-secondary mb-1.5 uppercase tracking-wide">
              Org URL
            </label>
            <input
              id="modal-orgUrl"
              type="text"
              value={orgUrl}
              onChange={(e) => setOrgUrl(e.target.value)}
              placeholder="https://your-org.okta.com"
              className="w-full px-3 py-2.5 bg-surface-0 border border-border rounded-lg text-sm text-text-primary placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-accent-teal/30 focus:border-accent-teal/50 font-mono"
              disabled={connecting}
              autoFocus
            />
          </div>

          <div>
            <label htmlFor="modal-token" className="block text-xs font-medium text-text-secondary mb-1.5 uppercase tracking-wide">
              API Token
            </label>
            <input
              id="modal-token"
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="00abc..."
              className="w-full px-3 py-2.5 bg-surface-0 border border-border rounded-lg text-sm text-text-primary placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-accent-teal/30 focus:border-accent-teal/50 font-mono"
              disabled={connecting}
            />
            <p className="text-xs text-text-muted mt-1.5">
              Super Admin API token recommended for full probing. Never stored to disk.
            </p>
          </div>

          {connection.error && (
            <div className="bg-accent-red/10 border border-accent-red/30 rounded-lg p-3 text-sm text-accent-red">
              {connection.error}
            </div>
          )}

          <button
            type="submit"
            disabled={!isValid || connecting}
            className="w-full py-2.5 px-4 bg-accent-teal text-surface-0 text-sm font-semibold rounded-lg hover:bg-accent-teal/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {connecting ? 'Connecting...' : 'Connect & Analyze'}
          </button>
        </form>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors related to `ConnectOrgModal.tsx`

- [ ] **Step 3: Commit**

```bash
git add src/renderer/components/ConnectOrgModal.tsx
git commit -m "feat: ConnectOrgModal — org connection form extracted from ConnectPage"
```

---

## Task 3: Update `App.tsx` and delete `ConnectPage.tsx`

**Files:**
- Modify: `src/renderer/App.tsx`
- Delete: `src/renderer/pages/ConnectPage.tsx`

Only `App.tsx` imports `ConnectPage` (confirmed by grep). Safe to delete.

- [ ] **Step 1: Replace `App.tsx` entirely**

```tsx
import React from 'react';
import DashboardPage from './pages/DashboardPage';

export default function App() {
  return <DashboardPage />;
}
```

- [ ] **Step 2: Delete `ConnectPage.tsx`**

```bash
rm src/renderer/pages/ConnectPage.tsx
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add src/renderer/App.tsx
git rm src/renderer/pages/ConnectPage.tsx
git commit -m "feat: remove startup gate, delete ConnectPage"
```

---

## Task 4: Update `DashboardPage.tsx`

**File:** Modify `src/renderer/pages/DashboardPage.tsx`

Three changes in this file:
1. Default `activeSection` → `'debug'`
2. Header: conditional Connect Org button vs org chip + Re-scan + Disconnect
3. Rate Limits empty state: conditional "Connect Org" CTA when not connected
4. Wire `ConnectOrgModal` with `showConnect` state

- [ ] **Step 1: Add import for `ConnectOrgModal` and `connecting` from store**

At the top of `DashboardPage.tsx`, add the import after the existing imports:

```tsx
import ConnectOrgModal from '../components/ConnectOrgModal';
```

In the `useStore()` destructure (currently line 66–71), add `connecting`:

```tsx
const {
  connection, connecting, probing, probeProgress, probeResult, recommendation,
  selectedResources, resourceCounts,
  providerVersion, setProviderVersion,
  startProbe, disconnect,
} = useStore();
```

- [ ] **Step 2: Change default tab and add `showConnect` state**

Change line 72:

```tsx
// Before
const [activeSection, setActiveSection] = useState<Section>('rate-limits');

// After
const [activeSection, setActiveSection] = useState<Section>('debug');
```

Add after the existing `useState` declarations (after the `showSettings` line):

```tsx
const [showConnect, setShowConnect] = useState(false);
```

- [ ] **Step 3: Replace the header**

Replace the entire `<header>` block (lines 92–146) with:

```tsx
<header className="bg-surface-1 border-b border-border px-5 py-2.5 flex items-center justify-between flex-shrink-0">
  <div className="flex items-center gap-4">
    <div className="flex items-center gap-2.5">
      <svg width="28" height="28" viewBox="0 0 40 40" fill="none">
        {/* Left O — hexagon */}
        <path d="M10 6L16 3L22 6V14L16 17L10 14V6Z" stroke="#00D4AA" strokeWidth="1.8" strokeLinejoin="round"/>
        {/* Right O — hexagon */}
        <path d="M18 26L24 23L30 26V34L24 37L18 34V26Z" stroke="#00D4AA" strokeWidth="1.8" strokeLinejoin="round"/>
        {/* T-bridge connecting them */}
        <path d="M16 14L24 26" stroke="#00D4AA" strokeWidth="1.8" strokeLinecap="round"/>
        <path d="M12 12L20 12" stroke="#00D4AA" strokeWidth="1.4" strokeLinecap="round" opacity="0.5"/>
        <path d="M20 28L28 28" stroke="#00D4AA" strokeWidth="1.4" strokeLinecap="round" opacity="0.5"/>
      </svg>
      <span className="text-text-primary font-bold text-sm tracking-[0.15em]">OTTO</span>
    </div>
    <div className="h-4 w-px bg-border" />
    {connection.connected && (
      <span className="text-text-muted text-xs font-mono bg-surface-3 px-2.5 py-1 rounded">
        {connection.orgUrl}
      </span>
    )}
    <select
      value={providerVersion}
      onChange={(e) => setProviderVersion(e.target.value)}
      className="text-xs bg-surface-3 text-text-secondary border border-border rounded px-2.5 py-1 cursor-pointer hover:border-border-hover font-mono"
    >
      {availableVersions.map(v => (
        <option key={v} value={v}>v{v}</option>
      ))}
    </select>
  </div>
  <div className="flex items-center gap-2">
    <button
      onClick={() => setShowSettings(true)}
      className="p-1.5 text-text-muted hover:text-text-primary bg-surface-3 hover:bg-surface-4 rounded-lg transition-colors"
      title="Settings"
    >
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="8" cy="8" r="2.5" />
        <path d="M13.5 8a5.5 5.5 0 01-.3 1.8l1.3.8-.9 1.5-1.4-.5a5.5 5.5 0 01-1.5 1l.1 1.5h-1.8l.1-1.5a5.5 5.5 0 01-1.5-1l-1.4.5-.9-1.5 1.3-.8A5.5 5.5 0 012.5 8a5.5 5.5 0 01.3-1.8l-1.3-.8.9-1.5 1.4.5a5.5 5.5 0 011.5-1L5.2 1.9H7l-.1 1.5a5.5 5.5 0 011.5 1l1.4-.5.9 1.5-1.3.8A5.5 5.5 0 0113.5 8z" />
      </svg>
    </button>
    {connection.connected ? (
      <>
        <button
          onClick={startProbe}
          disabled={probing}
          className="px-3.5 py-1.5 text-xs font-medium bg-accent-teal/15 text-accent-teal hover:bg-accent-teal/25 disabled:opacity-40 rounded-lg transition-colors"
        >
          {probing ? 'Scanning...' : 'Re-scan'}
        </button>
        <button
          onClick={disconnect}
          className="px-3.5 py-1.5 text-xs font-medium text-text-muted hover:text-text-secondary bg-surface-3 hover:bg-surface-4 rounded-lg transition-colors"
        >
          Disconnect
        </button>
      </>
    ) : (
      <button
        onClick={() => setShowConnect(true)}
        disabled={connecting}
        className="px-3.5 py-1.5 text-xs font-medium bg-accent-teal text-surface-0 hover:bg-accent-teal/90 disabled:opacity-40 rounded-lg transition-colors"
      >
        {connecting ? 'Connecting...' : 'Connect Org'}
      </button>
    )}
  </div>
</header>
```

- [ ] **Step 4: Update the Rate Limits empty state**

Find and replace the existing empty-state block (currently):

```tsx
{activeSection === 'rate-limits' && !probeResult && !probing && (
  <div className="bg-surface-2 rounded-xl border border-border p-8 text-center">
    <p className="text-text-secondary">Click "Re-scan" to probe your org's rate limits.</p>
  </div>
)}
```

Replace with:

```tsx
{activeSection === 'rate-limits' && !probeResult && !probing && (
  <div className="bg-surface-2 rounded-xl border border-border p-8 text-center space-y-3">
    {connection.connected ? (
      <p className="text-text-secondary">Click "Re-scan" to probe your org's rate limits.</p>
    ) : (
      <>
        <p className="text-text-secondary">Connect to an org to probe rate limits.</p>
        <button
          onClick={() => setShowConnect(true)}
          className="px-4 py-2 text-xs font-medium bg-accent-teal text-surface-0 hover:bg-accent-teal/90 rounded-lg transition-colors"
        >
          Connect Org
        </button>
      </>
    )}
  </div>
)}
```

- [ ] **Step 5: Wire up `ConnectOrgModal` at the bottom of the return**

Find the last line of the JSX return (currently `{showSettings && <SettingsModal onClose={...} />}`). Add after it, before the closing `</div>`:

```tsx
{showConnect && <ConnectOrgModal onClose={() => setShowConnect(false)} />}
```

- [ ] **Step 6: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 7: Commit**

```bash
git add src/renderer/pages/DashboardPage.tsx
git commit -m "feat: optional org connection — header, default tab, rate limits empty state"
```

---

## Task 5: Gate "Count & Optimize" in `ResourceSelector.tsx`

**File:** Modify `src/renderer/components/ResourceSelector.tsx`

- [ ] **Step 1: Add `connection` to the `useStore` destructure**

Current destructure (lines 12–16):

```tsx
const {
  selectedResources, resourceCounts, counting, countingLabel,
  operation, probeResult, providerVersion, customWorkloads,
  toggleResource, setOperation, setManagedCount, fetchCounts, clearSelection,
} = useStore();
```

Replace with:

```tsx
const {
  selectedResources, resourceCounts, counting, countingLabel,
  operation, probeResult, providerVersion, customWorkloads, connection,
  toggleResource, setOperation, setManagedCount, fetchCounts, clearSelection,
} = useStore();
```

- [ ] **Step 2: Update the "Count & Optimize" button's `disabled` prop and add a `title`**

Find the button (around line 166):

```tsx
<button
  onClick={fetchCounts}
  disabled={!hasAnyWorkload || counting}
  className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
>
```

Replace with:

```tsx
<button
  onClick={fetchCounts}
  disabled={!hasAnyWorkload || counting || !connection.connected}
  title={!connection.connected ? 'Connect to an org first' : undefined}
  className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
>
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add src/renderer/components/ResourceSelector.tsx
git commit -m "feat: disable Count & Optimize when no org connection"
```

---

## Task 6: Smoke test and push

- [ ] **Step 1: Launch the dev app**

```bash
npm run dev
```

- [ ] **Step 2: Run smoke test checklist**

| # | Action | Expected |
|---|--------|----------|
| 1 | Cold launch | Debug tab active; "Connect Org" button in header; no org chip |
| 2 | Debug tab → upload TF log | AI analysis works (no org required) |
| 3 | Learn tab | Loads immediately, no org required |
| 4 | Rate Limits tab (not connected) | Empty state with "Connect Org" CTA visible |
| 5 | Click "Connect Org" in header | Modal opens with Org URL + API Token form |
| 6 | Submit valid creds | Modal closes; probe fires; Rate Limits populates |
| 7 | Click "Connect Org" in Rate Limits CTA | Same modal opens and works |
| 8 | Plan > Workload (not connected) | "Count & Optimize" disabled; hover shows tooltip |
| 9 | Plan > Workload (connected) | Button enabled; counting works |
| 10 | Disconnect | Header shows "Connect Org"; Debug/Learn/Sync still usable |
| 11 | Settings modal | AI config (OCM) unchanged and accessible |
| 12 | Sync tab | Unaffected in both connected and disconnected states |

- [ ] **Step 3: Push the branch**

```bash
git push -u origin feat/optional-org-connection
```
