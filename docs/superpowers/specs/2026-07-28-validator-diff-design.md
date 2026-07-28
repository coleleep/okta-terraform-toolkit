# Validator Diff Review — Design Spec

**Date:** 2026-07-28  
**Feature area:** Terraform Validator (`ValidatorSection`, `validator.ts`)  
**Status:** Approved for implementation

---

## Problem

After Claude analyzes a uploaded Terraform project and recommends fixes, the user currently has no visibility into what the fixes actually change before exporting. They must either trust the AI's output blindly or manually diff the exported files after the fact. The goal is to show the changes inline — before export — and let the user selectively accept or reject individual fixes.

---

## Decisions Made

| Question | Decision |
|---|---|
| Selection granularity | Per finding (not per file) |
| Layout | Dedicated diff-review stage (not inline in finding cards) |
| Multi-file navigation | File tabs |
| Diff reconstruction strategy | Add `originalSnippet` to `Finding`; apply accepted findings client-side |

---

## Stage Flow

```
upload → ready → analyzing → reviewed → diff-review (NEW) → exporting → exported
```

- **`reviewed`** stays as-is: shows findings summary (correctness + optimization groups). The "Export Fixed Project" button is renamed to **"Review Changes →"** and advances to `diff-review`.
- **`diff-review`** (new): the full diff review stage with accept/reject per finding. Export happens from here via **"Export Selected Fixes →"**.
- A **"← Back to Findings"** link returns to `reviewed` without losing selection state.

---

## Data Model Changes

### `Finding` (`shared/types.ts`)

Add `originalSnippet`:

```ts
export interface Finding {
  id: string;
  category: 'correctness' | 'optimization';
  severity: 'error' | 'warning' | 'suggestion';
  file: string;
  resourceAddress: string;
  title: string;
  explanation: string;
  originalSnippet: string;  // NEW: the original masked HCL before the fix
  fixedSnippet: string;     // existing: the corrected masked HCL
}
```

`originalSnippet` contains the exact text Claude is replacing — the same region of the masked file that `fixedSnippet` corrects. This pairing is what enables client-side file reconstruction without a general-purpose diff library.

---

## Backend Changes (`validator.ts`)

### `report_findings` tool schema

Add `originalSnippet` as a required field on each finding object:

```json
"originalSnippet": {
  "type": "string",
  "description": "The exact original masked HCL text that this finding replaces. Must be a verbatim substring of the masked file content."
}
```

### Claude prompt update

Instruct Claude to capture the exact original text for each finding — the literal substring in the masked file that its fix will replace, including exact indentation and whitespace. Emphasize it must be verbatim (copy-paste from the masked file) so client-side `String.replace()` works reliably.

### No changes to `exportProject` or the `validator:export` IPC handler

The export path is unchanged. The renderer reconstructs files client-side before calling the existing export IPC — the handler still receives `Record<string, string>` (filename → content) and writes it to disk.

---

## Frontend Changes

### `ValidatorSection.tsx`

**New state:**
```ts
const [maskedFiles, setMaskedFiles] = useState<Record<string, string>>({});
const [acceptedFindingIds, setAcceptedFindingIds] = useState<Set<string>>(new Set());
```

**On upload:** store `result.data.maskedFiles` (already returned by the IPC handler, currently unused in the component).

**On analyze:** initialize `acceptedFindingIds` to all finding IDs (all accepted by default).

**New stage `'diff-review'`:** renders `<ValidatorDiffView>` with the props below. Export is triggered from within the diff view component — `ValidatorSection` handles the actual IPC call via a callback.

**File reconstruction** (called before the export IPC call):
```ts
function reconstructFiles(
  maskedFiles: Record<string, string>,
  findings: Finding[],
  acceptedIds: Set<string>,
): Record<string, string> {
  const result = { ...maskedFiles };
  for (const finding of findings) {
    if (!acceptedIds.has(finding.id)) continue;
    if (!result[finding.file]) continue;
    result[finding.file] = result[finding.file].replace(
      finding.originalSnippet,
      finding.fixedSnippet,
    );
  }
  return result;
}
```

The reconstructed files are passed to the existing `validatorExport` IPC call in place of `fixedMaskedFiles`. `fixedMaskedFiles` is no longer passed to the export handler — the exported result is derived strictly from the accepted findings applied to `maskedFiles`, not from Claude's full corrected file. This is intentional: it makes the export exactly match what the user reviewed and selected.

`String.prototype.replace()` replaces only the first match. This is by design — Terraform resource blocks are uniquely named, so `originalSnippet` (a region of a named resource block) will only appear once per file in practice.

### New component: `ValidatorDiffView.tsx`

**Props:**
```ts
interface ValidatorDiffViewProps {
  findings: Finding[];
  maskedFiles: Record<string, string>;
  acceptedIds: Set<string>;
  onToggle: (id: string) => void;
  onExport: () => void;
  onBack: () => void;
}
```

**Layout:**
- File tabs across the top — one tab per file that has at least one finding. Badge shows finding count per file. Active tab highlighted in teal.
- Left sidebar: findings for the active file only, each with a checkbox. Shows accepted/rejected count at the bottom.
- Right panel: diff view for the active file, derived from the active findings' `originalSnippet`/`fixedSnippet` pairs.
- Footer: "← Back to Findings" (left) + total selection count + "Export Selected Fixes →" (right).

**Diff rendering (no external library):**

Rather than a general-purpose LCS differ, the diff view is built from the per-finding snippet pairs:

1. For the active file, collect findings sorted by their `originalSnippet` position in `maskedFiles[activeFile]`.
2. Walk through the file content, splitting it into segments:
   - **Accepted finding region:** `originalSnippet` lines shown in red (removed), `fixedSnippet` lines shown in green (added).
   - **Rejected finding region:** `originalSnippet` lines shown as unchanged (no color).
   - **Context:** everything else shown as unchanged.
3. Render as a scrollable line list with line numbers, standard red/green background coloring.
4. Collapse long unchanged runs (> 5 lines) into a `... N unchanged lines ...` row.

This produces an accurate visual diff without backtracking or ambiguity, because the semantic meaning (which finding caused which change) is already known.

**Active file recomputes** whenever `acceptedIds` changes, giving live preview as the user toggles findings.

---

## Testing

- Unit tests for `reconstructFiles`: accepted finding applied, rejected finding not applied, two findings in same file, no findings accepted returns original.
- Unit tests for the diff segment computation: correct region boundaries, collapsed context, rejected finding shown as unchanged.
- Existing `exportProject` tests unchanged — reconstruction happens before the export call, not inside it.

---

## Out of Scope

- Inline editing of `fixedSnippet` text.
- Showing real (unmasked) values in the diff — the diff operates on masked content only, consistent with the PII vault model.
- Any changes to `redact.ts`, `exportProject`, or the IPC export handler.
