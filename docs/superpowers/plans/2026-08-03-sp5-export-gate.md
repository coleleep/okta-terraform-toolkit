# SP5: Export Consistency Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add pre-export validation to the `file:save-project` and `file:save-tf` export paths so Terraform errors block export (with override option) and warnings are surfaced before writing files to disk.

**Architecture:** A new `file:validate-project` IPC handler masks files via `vaultProject()`, runs `analyzeProject()`, and returns any findings. A shared `ExportGateModal.tsx` component renders in `App.tsx` and is driven by `exportValidationGate` state in useStore. Each component that calls `saveProjectDir` or `saveTfFile` is updated to call the validator first and populate gate state if findings exist. The `validator:export` path is intentionally excluded — users already reviewed findings via the diff view.

**Tech Stack:** TypeScript, React 18, Zustand, Tailwind CSS, Jest + ts-jest. Builds on existing `vaultProject()` + `analyzeProject()` from `src/main/api/validator.ts` and the `loadSchema()` + `DEFAULT_VERSION` pattern from schema foundation.

---

## File Structure

| File | Change |
|---|---|
| `src/main/api/validator.ts` | Export new `validateForExport(files, version)` function |
| `src/main/ipc-handlers.ts` | Add `file:validate-project` handler |
| `src/preload.ts` | Add `validateProjectFiles` preload method |
| `src/renderer/hooks/useStore.ts` | Add `exportValidationGate` state + `openExportGate` / `dismissExportGate` / `confirmExportGate` actions |
| `src/renderer/components/ExportGateModal.tsx` | New: modal showing findings with block/override/cancel |
| `src/renderer/App.tsx` | Render `<ExportGateModal />` when gate is active |
| `src/renderer/components/ProviderBlock.tsx` | Wrap `saveTfFile` and `saveProjectDir` calls with gate |
| `src/renderer/components/SolutionBuilder.tsx` | Wrap `saveProjectDir` call with gate |
| `src/renderer/components/SyncSection.tsx` | Wrap `saveProjectDir` call with gate |
| `src/__tests__/export-gate.test.ts` | New: unit tests for `validateForExport` |

---

### Task 1: Add validateForExport to validator.ts

**Files:**
- Modify: `src/main/api/validator.ts`

Context: `vaultProject(files)` is already exported and returns `{ maskedFiles, entries }`. `analyzeProject(maskedFiles, version)` returns `Promise<ValidatorAnalysis>` with a `findings` array. `ValidatorAnalysis` is in `src/shared/types.ts`. The new function combines vault masking + analysis into a single call for the export gate. It should NOT throw on vault/analysis errors — it should return an empty findings array and log the error so that the user can still export if validation fails for unexpected reasons.

- [ ] **Step 1: Write failing tests**

Create `src/__tests__/export-gate.test.ts`:

```typescript
import { validateForExport } from '../main/api/validator';

jest.mock('../main/api/validator', () => {
  const actual = jest.requireActual('../main/api/validator');
  return {
    ...actual,
    analyzeProject: jest.fn(),
  };
});

import { analyzeProject } from '../main/api/validator';
const mockAnalyze = analyzeProject as jest.MockedFunction<typeof analyzeProject>;

describe('validateForExport', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns findings from analyzeProject', async () => {
    mockAnalyze.mockResolvedValue({
      findings: [{ id: 'f1', severity: 'error', file: 'main.tf', line: 1, message: 'bad attr', suggestion: '', originalSnippet: '' }],
      summary: 'test',
    });
    const result = await validateForExport({ 'main.tf': 'resource "okta_user" "u" {}' }, '6.13.0');
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].severity).toBe('error');
  });

  test('returns empty findings array on analyzeProject error', async () => {
    mockAnalyze.mockRejectedValue(new Error('API down'));
    const result = await validateForExport({ 'main.tf': 'resource "okta_user" "u" {}' }, '6.13.0');
    expect(result.findings).toEqual([]);
    expect(result.error).toBeTruthy();
  });

  test('returns empty findings for empty files', async () => {
    mockAnalyze.mockResolvedValue({ findings: [], summary: 'clean' });
    const result = await validateForExport({}, '6.13.0');
    expect(result.findings).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx jest export-gate --no-coverage
```

Expected: FAIL — `validateForExport` not exported yet.

- [ ] **Step 3: Add validateForExport to validator.ts**

Add after the existing `vaultProject` function export:

```typescript
export interface ExportValidationResult {
  findings: Finding[];
  error?: string;
}

export async function validateForExport(
  files: Record<string, string>,
  version: string
): Promise<ExportValidationResult> {
  if (Object.keys(files).length === 0) {
    return { findings: [] };
  }
  try {
    const { maskedFiles } = vaultProject(files);
    const analysis = await analyzeProject(maskedFiles, version);
    return { findings: analysis.findings };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('validator', 'validateForExport failed', { error: message });
    return { findings: [], error: message };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx jest export-gate --no-coverage
```

Expected: PASS (3/3)

- [ ] **Step 5: Commit**

```bash
git add src/main/api/validator.ts src/__tests__/export-gate.test.ts
git commit -m "feat(validator): add validateForExport for pre-export consistency gate"
```

---

### Task 2: Add file:validate-project IPC handler and preload

**Files:**
- Modify: `src/main/ipc-handlers.ts`
- Modify: `src/preload.ts`

Context: The new IPC handler takes `{ files: Record<string, string>, version: string }` and calls `validateForExport`. The preload exposes it as `validateProjectFiles`. The version is provided by the renderer (it already has `providerVersion` from useStore). Use `DEFAULT_VERSION` as fallback when version is `'system'` or empty — do this in the IPC handler (same pattern as `validator:analyze`).

- [ ] **Step 1: Add handler to ipc-handlers.ts**

Import `validateForExport` and `DEFAULT_VERSION` at the top of `ipc-handlers.ts` (already has `analyzeProject` import and `DEFAULT_VERSION` import from `'../shared/versions'`):

```typescript
import { analyzeProject, validateForExport } from './api/validator';
```

Add the handler near the other `file:` handlers (after `file:save-tf`, before or after existing file handlers):

```typescript
// Pre-export validation gate
ipcMain.handle('file:validate-project', async (_event, params: { files: Record<string, string>; version: string }) => {
  try {
    const version = (!params.version || params.version === 'system') ? DEFAULT_VERSION : params.version;
    const result = await validateForExport(params.files, version);
    return { success: true, data: result };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
});
```

- [ ] **Step 2: Add to preload.ts**

Add after the existing `saveProjectDir` line in `src/preload.ts`:

```typescript
validateProjectFiles: (files: Record<string, string>, version: string) =>
  ipcRenderer.invoke('file:validate-project', { files, version }),
```

- [ ] **Step 3: Type check**

```bash
npx tsc --noEmit 2>&1 | head -20
```

Expected: clean or only errors on files updated in later tasks.

- [ ] **Step 4: Commit**

```bash
git add src/main/ipc-handlers.ts src/preload.ts
git commit -m "feat(ipc): add file:validate-project handler for pre-export gate"
```

---

### Task 3: Add exportValidationGate state to useStore

**Files:**
- Modify: `src/renderer/hooks/useStore.ts`

Context: The gate state captures the pending export action alongside findings, so the modal can re-invoke it on confirm. `pendingAction` is a `() => Promise<void>` closure that captures the actual save call. On confirm, it's invoked then gate is dismissed. On cancel or dismiss, gate is cleared with no action taken.

The renderer components already call `saveTfFile(content)` and `saveProjectDir(files)` from useStore. After this task, they'll instead call the new `validateThenSave*` wrappers which invoke the gate when findings exist.

- [ ] **Step 1: Write failing test**

In `src/__tests__/export-gate.test.ts`, add (at top, before the `validateForExport` tests):

```typescript
// Note: useStore tests require jsdom environment — these are integration notes only
// The gate state shape is verified via TypeScript types
```

No Jest test needed for the store state — the TypeScript compiler verifies the interface.

- [ ] **Step 2: Add gate state and actions to AppState interface in useStore.ts**

Find the `AppState` interface in `src/renderer/hooks/useStore.ts`. Add:

```typescript
// Export validation gate
exportValidationGate: {
  findings: import('../../shared/types').Finding[];
  pendingAction: () => Promise<void>;
} | null;
openExportGate: (findings: import('../../shared/types').Finding[], pendingAction: () => Promise<void>) => void;
dismissExportGate: () => void;
confirmExportGate: () => Promise<void>;
```

- [ ] **Step 3: Initialize gate state and implement actions**

In the `create<AppState>((set, get) => ({` block, add initial state and implementations:

```typescript
exportValidationGate: null,

openExportGate: (findings, pendingAction) => {
  set({ exportValidationGate: { findings, pendingAction } });
},

dismissExportGate: () => {
  set({ exportValidationGate: null });
},

confirmExportGate: async () => {
  const gate = get().exportValidationGate;
  if (!gate) return;
  set({ exportValidationGate: null });
  await gate.pendingAction();
},
```

- [ ] **Step 4: Add validateThenSaveProjectDir and validateThenSaveTfFile wrappers**

These wrappers call `validateProjectFiles`, check for errors, open the gate if needed, or proceed directly.

First, find the `api()` call pattern in useStore to understand how to call the preload. Then add:

```typescript
validateThenSaveProjectDir: async (files: Record<string, string>) => {
  const { providerVersion, saveProjectDir, openExportGate } = get();
  const version = (!providerVersion || providerVersion === 'system') ? DEFAULT_VERSION : providerVersion;
  const api = (window as { oktaTerraform: Record<string, (...args: unknown[]) => Promise<unknown>> }).oktaTerraform;
  const result = await api.validateProjectFiles(files, version) as { success: boolean; data?: { findings: Finding[]; error?: string }; error?: string };
  if (!result.success) {
    // Validation call itself failed — proceed with save (don't block on infra issues)
    await saveProjectDir(files);
    return;
  }
  const { findings } = result.data!;
  if (findings.length === 0) {
    await saveProjectDir(files);
    return;
  }
  openExportGate(findings, () => saveProjectDir(files));
},

validateThenSaveTfFile: async (content: string) => {
  const { providerVersion, saveTfFile, openExportGate } = get();
  const version = (!providerVersion || providerVersion === 'system') ? DEFAULT_VERSION : providerVersion;
  const api = (window as { oktaTerraform: Record<string, (...args: unknown[]) => Promise<unknown>> }).oktaTerraform;
  const result = await api.validateProjectFiles({ 'provider.tf': content }, version) as { success: boolean; data?: { findings: Finding[]; error?: string }; error?: string };
  if (!result.success) {
    await saveTfFile(content);
    return;
  }
  const { findings } = result.data!;
  if (findings.length === 0) {
    await saveTfFile(content);
    return;
  }
  openExportGate(findings, () => saveTfFile(content));
},
```

Add `Finding` import at top of useStore.ts:
```typescript
import type { Finding } from '../../shared/types';
```

Add `DEFAULT_VERSION` import:
```typescript
import { DEFAULT_VERSION } from '../../shared/versions';
```

Add the new action signatures to `AppState`:
```typescript
validateThenSaveProjectDir: (files: Record<string, string>) => Promise<void>;
validateThenSaveTfFile: (content: string) => Promise<void>;
```

- [ ] **Step 5: Type check**

```bash
npx tsc --noEmit 2>&1 | grep "useStore" | head -10
```

Expected: no errors on useStore.ts.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/hooks/useStore.ts
git commit -m "feat(store): add exportValidationGate state and validateThenSave wrappers"
```

---

### Task 4: Build ExportGateModal component

**Files:**
- Create: `src/renderer/components/ExportGateModal.tsx`

Context: Shows a modal when `exportValidationGate` is non-null. Displays findings grouped by severity (errors first, then warnings). Errors have a "Save anyway" override button; the user can also cancel. "Save anyway" calls `confirmExportGate`. "Cancel" calls `dismissExportGate`. The modal shows a summary count at the top.

- [ ] **Step 1: Create ExportGateModal.tsx**

```typescript
import React from 'react';
import { useStore } from '../hooks/useStore';
import type { Finding } from '../../shared/types';

function FindingItem({ finding }: { finding: Finding }) {
  const color = finding.severity === 'error' ? 'text-red-600' : 'text-yellow-600';
  const bg = finding.severity === 'error' ? 'bg-red-50' : 'bg-yellow-50';
  return (
    <div className={`rounded px-3 py-2 text-xs ${bg}`}>
      <span className={`font-semibold uppercase text-xs ${color}`}>{finding.severity}</span>
      {' · '}
      <code className="text-gray-600">{finding.file}:{finding.line}</code>
      <p className="mt-0.5 text-gray-700">{finding.message}</p>
    </div>
  );
}

export default function ExportGateModal() {
  const { exportValidationGate, dismissExportGate, confirmExportGate } = useStore();

  if (!exportValidationGate) return null;

  const { findings } = exportValidationGate;
  const errors = findings.filter(f => f.severity === 'error');
  const warnings = findings.filter(f => f.severity === 'warning');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg mx-4 p-6">
        <h2 className="text-base font-semibold text-gray-900 mb-1">
          Validation findings before export
        </h2>
        <p className="text-xs text-gray-500 mb-4">
          {errors.length > 0
            ? `${errors.length} error${errors.length !== 1 ? 's' : ''} found. Fix them or save anyway.`
            : `${warnings.length} warning${warnings.length !== 1 ? 's' : ''} found. Review before saving.`}
        </p>
        <div className="space-y-2 max-h-64 overflow-y-auto mb-5">
          {[...errors, ...warnings].map(f => (
            <FindingItem key={f.id} finding={f} />
          ))}
        </div>
        <div className="flex items-center justify-end gap-3">
          <button
            onClick={dismissExportGate}
            className="px-4 py-1.5 text-xs font-medium text-gray-600 hover:text-gray-900 border border-gray-200 rounded-lg"
          >
            Cancel
          </button>
          <button
            onClick={confirmExportGate}
            className="px-4 py-1.5 text-xs font-medium text-white bg-okta-blue hover:bg-blue-700 rounded-lg"
          >
            Save anyway
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Type check the new component**

```bash
npx tsc --noEmit 2>&1 | grep "ExportGateModal" | head -10
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/components/ExportGateModal.tsx
git commit -m "feat(ui): add ExportGateModal for pre-export validation findings"
```

---

### Task 5: Wire ExportGateModal into App.tsx

**Files:**
- Modify: `src/renderer/App.tsx`

Context: `App.tsx` is the root renderer component. Adding `<ExportGateModal />` here means it renders once and is shared across all components that trigger the gate. No prop drilling needed — it reads from useStore directly.

- [ ] **Step 1: Add ExportGateModal to App.tsx**

Find the return statement in `src/renderer/App.tsx`. Add `<ExportGateModal />` inside the root element, adjacent to any other app-level modals:

```typescript
import ExportGateModal from './components/ExportGateModal';

// Inside the return JSX:
<>
  {/* existing content */}
  <ExportGateModal />
</>
```

- [ ] **Step 2: Type check**

```bash
npx tsc --noEmit 2>&1 | grep "App.tsx" | head -5
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/App.tsx
git commit -m "feat(app): mount ExportGateModal at app root"
```

---

### Task 6: Wire gate into ProviderBlock, SolutionBuilder, SyncSection

**Files:**
- Modify: `src/renderer/components/ProviderBlock.tsx:615,659,671`
- Modify: `src/renderer/components/SolutionBuilder.tsx:34,69`
- Modify: `src/renderer/components/SyncSection.tsx:67,556`

Context: Replace `saveTfFile` and `saveProjectDir` calls with the new `validateThenSaveTfFile` and `validateThenSaveProjectDir` wrappers. The wrappers have identical signatures — this is a find/replace of the function name at the call site. No other logic changes.

**ProviderBlock.tsx:**
- Line 615: add `validateThenSaveProjectDir`, `validateThenSaveTfFile` to destructured useStore values
- Line 659: `saveTfFile(currentFile.content)` → `validateThenSaveTfFile(currentFile.content)`
- Line 671: `saveProjectDir(projectFiles)` → `validateThenSaveProjectDir(projectFiles)`

**SolutionBuilder.tsx:**
- Line 34: add `validateThenSaveProjectDir` to the typed `api` object
- Line 69: `api.saveProjectDir(files)` → `api.validateThenSaveProjectDir(files)`

Wait — SolutionBuilder.tsx calls `api.saveProjectDir` via a locally typed API interface, not via useStore directly. Check whether it calls via useStore `saveProjectDir` action or via the preload directly. Looking at the grep output earlier:
- `SolutionBuilder.tsx:34` shows `saveProjectDir: (files: Record<string, string>) => Promise<{ ... }>` — this is a typed preload interface
- The component calls `api.saveProjectDir(files)` on line 69

Since SolutionBuilder.tsx accesses the preload directly (not useStore), it cannot use `validateThenSaveProjectDir` from useStore. Instead, update SolutionBuilder to use useStore's `validateThenSaveProjectDir`:

```typescript
// Replace in SolutionBuilder.tsx:
const { validateThenSaveProjectDir } = useStore();
// ...
await validateThenSaveProjectDir(files);
```

**SyncSection.tsx:**
- Same pattern — check if it uses useStore or preload directly, apply the same approach.

- [ ] **Step 1: Update ProviderBlock.tsx**

Find line 615 in `src/renderer/components/ProviderBlock.tsx`:
```typescript
const { selectedResources, operation, terraformAuthMethod, providerVersion, saveTfFile, saveProjectDir } = useStore();
```
Add `validateThenSaveTfFile`, `validateThenSaveProjectDir`:
```typescript
const { selectedResources, operation, terraformAuthMethod, providerVersion, saveTfFile, saveProjectDir, validateThenSaveTfFile, validateThenSaveProjectDir } = useStore();
```

Find line 659 (saveTfFile call):
```typescript
const filePath = await saveTfFile(currentFile.content);
```
Change to:
```typescript
await validateThenSaveTfFile(currentFile.content);
const filePath = null; // path returned via modal confirmation now
```

Wait — `saveTfFile` returns `string | null` (the saved path) which ProviderBlock uses for feedback. After the gate refactor, the actual save happens asynchronously via `confirmExportGate`. The path feedback won't be available synchronously. 

For the immediate call site: change to use the existing `saveTfFile` — but only when there are no gate findings. Actually, the `validateThenSaveTfFile` wrapper calls `saveTfFile` internally when clean, and `openExportGate` when there are findings. Either way, `saveTfFile` (returning a path) is no longer directly called from this component.

Check what ProviderBlock.tsx does with the returned path from `saveTfFile` and `saveProjectDir`. If it only uses it for success feedback, we can adapt the pattern. Look at lines around 659 and 671 to understand exactly.

Actually — read the ProviderBlock.tsx section around lines 655-680 before making the change, to understand the exact save success/failure flow. Then adapt accordingly.

- [ ] **Step 2: Read ProviderBlock.tsx save section before editing**

```bash
sed -n '645,690p' /Users/nicole.pendill/okta-terraform-toolkit/src/renderer/components/ProviderBlock.tsx
```

Understand how `filePath` / `dir` return values are used (likely for a success toast). Adapt the wrapper call to still show success feedback — if `validateThenSaveTfFile` is async and void, show success feedback after `await validateThenSaveTfFile()` completes (it either proceeds immediately or waits for modal confirm, but either way it resolves).

Note: `validateThenSaveTfFile` is void — it doesn't return the saved path. If ProviderBlock uses the returned path for a toast, change the success message to be generic ("File saved" instead of showing the path). Or return the path from `validateThenSaveProjectDir` by capturing it in the closure.

The simplest approach: if the component only uses the path for a generic success message, just show a generic "Saved" toast after the await.

- [ ] **Step 3: Update SolutionBuilder.tsx**

Read SolutionBuilder.tsx lines 60-80 first:
```bash
sed -n '60,80p' /Users/nicole.pendill/okta-terraform-toolkit/src/renderer/components/SolutionBuilder.tsx
```

Replace the preload-direct `saveProjectDir` call with the useStore `validateThenSaveProjectDir` wrapper. Import `useStore` if not already imported.

- [ ] **Step 4: Update SyncSection.tsx**

Read SyncSection.tsx lines 545-565 first:
```bash
sed -n '545,570p' /Users/nicole.pendill/okta-terraform-toolkit/src/renderer/components/SyncSection.tsx
```

Replace `api.saveProjectDir(exportFiles)` (line 556) with `validateThenSaveProjectDir` from useStore.

- [ ] **Step 5: Full type check**

```bash
npx tsc --noEmit 2>&1 | head -30
```

Expected: clean.

- [ ] **Step 6: Run full test suite**

```bash
npx jest --no-coverage 2>&1 | tail -10
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/components/ProviderBlock.tsx src/renderer/components/SolutionBuilder.tsx src/renderer/components/SyncSection.tsx
git commit -m "feat(export): add pre-export validation gate to save-project and save-tf paths"
```
