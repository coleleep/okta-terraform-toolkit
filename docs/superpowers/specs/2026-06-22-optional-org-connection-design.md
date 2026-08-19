# Optional Org Connection — Design Spec

**Date:** 2026-06-22  
**Branch:** `feat/optional-org-connection`  
**Status:** Approved, ready for implementation

---

## Problem

OTTO currently gates the entire app behind org URL + API key at startup. Okta DSEs need access to Debug (log analysis, error decoding) and Learn features immediately, without having to supply org credentials. Org connection should be an on-demand action, required only when a feature actually needs it.

---

## Goals

- App launches directly into the dashboard — no connection gate
- Debug and Learn tabs are fully usable with no org configured
- Sync tab is unaffected (already has its own independent credentials)
- Rate Limits and Plan > Workload prompt for connection inline when needed
- Default landing tab changes from Rate Limits to Debug

---

## Non-Goals

- No new IPC handlers
- No changes to the Zustand store interface
- No changes to AI config (OCM key setup stays in Settings modal)
- No persistence of org credentials across launches (same as today)

---

## Architecture

### Files Changed

| File | Change |
|------|--------|
| `src/renderer/App.tsx` | Remove `connected` gate — always render `DashboardPage` |
| `src/renderer/pages/ConnectPage.tsx` | **Deleted** — AI config is in Settings; org connection moves to modal |
| `src/renderer/components/ConnectOrgModal.tsx` | **New** — lightweight org connection modal |
| `src/renderer/pages/DashboardPage.tsx` | Default tab → `'debug'`; header state machine; Rate Limits empty state |
| `src/renderer/components/PlanSection.tsx` | Gate "Count & Optimize" button on `connection.connected` |

### No changes needed

- `src/renderer/hooks/useStore.ts` — connection state and `connect()` action unchanged
- `src/main/` — no new IPC surface
- `src/renderer/components/SettingsModal.tsx` — AI config already lives here

---

## Component Design

### `ConnectOrgModal`

Follows the `SettingsModal` pattern:
- Props: `onClose: () => void`
- Reads `connecting`, `connection` from store
- Calls `connect({ orgUrl, authMethod: 'token', token })` on submit
- On success: `connect()` already calls `startProbe()` — modal closes
- On error: renders `connection.error` inline below the form
- Org URL and token fields, same validation as current ConnectPage

### Header State Machine

Three states driven by `connecting` and `connection.connected`:

```
not connected:  [Connect Org button]  (no org chip, no Re-scan, no Disconnect)
connecting:     [Connecting… spinner] (disabled)
connected:      [org URL chip] [Re-scan] [Disconnect]
```

`showConnect` state lives in `DashboardPage`, passed as an `onOpen` handler to Rate Limits empty state so both the header button and the inline CTA open the same modal.

### Rate Limits Tab

When `!connection.connected && !probing && !probeResult`:
- Centered empty-state card (matches existing "Click Re-scan" placeholder style)
- "Connect Org" button opens `ConnectOrgModal`

When connected but no probe yet: existing "Click Re-scan" placeholder unchanged.

### Plan > Workload

The "Count & Optimize" button gets a second disable condition:

```tsx
disabled={selectedResources.length === 0 || !connection.connected}
title={!connection.connected ? 'Connect to an org first' : undefined}
```

All other Plan sub-tabs (Solution Builder, Config, Export, Target Planner) work without connection — no changes needed.

---

## Data Flow

```
User launches app
  → DashboardPage renders (Debug tab active)
  → connection = { connected: false }

User clicks "Connect Org" (header or Rate Limits CTA)
  → ConnectOrgModal opens
  → User submits org URL + token
  → store.connect() called
  → on success: connection = { connected: true, orgUrl }
                store.startProbe() fires automatically
  → modal closes

User navigates to Rate Limits
  → if connected + probeResult: shows rate limit table
  → if connected + probing: shows ProbeProgress
  → if not connected: shows empty state with "Connect Org" CTA
```

---

## Error Handling

- Connection errors: `connection.error` already set by `connect()` in store; modal reads and renders inline
- Modal closed mid-connect: `connecting` resets on next open (store resets it on failure)
- No new error paths introduced

---

## Smoke Test Checklist

1. Cold launch → Debug tab active, "Connect Org" button in header, no org chip
2. Debug tab → upload TF log, AI analysis works (no org required)
3. Learn tab → loads immediately, no org required
4. Rate Limits tab (not connected) → empty state with "Connect Org" CTA visible
5. "Connect Org" (header) → modal opens, submit valid creds → modal closes, probe fires, Rate Limits populates
6. "Connect Org" (Rate Limits CTA) → same result
7. Plan > Workload (not connected) → "Count & Optimize" disabled with tooltip
8. Plan > Workload (connected) → button enabled, counting works
9. Disconnect → header shows "Connect Org", Debug/Learn/Sync still usable
10. Settings modal → AI config (OCM) still accessible and unchanged
11. Sync tab → unaffected in both connected and disconnected states
