# Validator Diff Review — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-finding accept/reject diff review stage to the Terraform Validator, inserted between the analysis results and export.

**Architecture:** Extend `Finding` with `originalSnippet` so Claude returns both sides of each change. Pure utility functions (`reconstructFiles`, `computeDiffLines`) in `src/shared/reconstruct.ts` handle file reconstruction and diff rendering without a diff library — they derive segments directly from the per-finding snippet pairs. A new `ValidatorDiffView` component renders the diff with file tabs and a findings sidebar; `ValidatorSection` gains a `diff-review` stage that calls `reconstructFiles` before the existing export IPC call.

**Tech Stack:** TypeScript, React 18, Tailwind CSS (existing project utilities), Jest + ts-jest for utility tests, Electron IPC (unchanged).

---

## File Map

| Action | File | Purpose |
|---|---|---|
| Modify | `src/shared/types.ts` | Add `originalSnippet: string` to `Finding` |
| Modify | `src/main/api/validator.ts` | Add `originalSnippet` to tool schema + prompt |
| Create | `src/shared/reconstruct.ts` | `reconstructFiles`, `computeDiffLines`, `DiffLine` type |
| Create | `src/__tests__/reconstruct.test.ts` | Unit tests for both utilities |
| Modify | `src/renderer/components/ValidatorSection.tsx` | New state, `diff-review` stage, wiring |
| Create | `src/renderer/components/ValidatorDiffView.tsx` | Diff review UI component |

---

## Task 1: Extend `Finding` type with `originalSnippet`

**Files:**
- Modify: `src/shared/types.ts:321-335`

- [ ] **Step 1: Add `originalSnippet` to the `Finding` interface**

Replace the `Finding` interface at line 321:

```ts
export interface Finding {
  id: string;
  category: 'correctness' | 'optimization';
  severity: 'error' | 'warning' | 'suggestion';
  file: string;
  resourceAddress: string;  // e.g. "okta_app_oauth.my_app"
  title: string;
  explanation: string;
  originalSnippet: string;  // exact original masked HCL that fixedSnippet replaces
  fixedSnippet: string;     // masked HCL after fix
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors. The `originalSnippet` field is added to the interface but no existing code constructs a `Finding` literal (they're only cast from Claude's API response), so nothing breaks.

- [ ] **Step 3: Commit**

```bash
git add src/shared/types.ts
git commit -m "feat(validator): add originalSnippet to Finding type"
```

---

## Task 2: Update `report_findings` tool schema and prompt

**Files:**
- Modify: `src/main/api/validator.ts:467` (prompt) and `:503-505` (schema)

- [ ] **Step 1: Add `originalSnippet` to the tool schema**

In `validator.ts`, inside the `report_findings` tool's `input_schema.properties.findings.items.properties` object, add `originalSnippet` after `explanation` and before `fixedSnippet`:

```ts
explanation: { type: 'string' },
originalSnippet: {
  type: 'string',
  description: 'The exact original masked HCL text being replaced — copy-pasted verbatim from the input file, including indentation. Must be a literal substring of the masked file so String.replace() can locate it.',
},
fixedSnippet: { type: 'string' },
```

Also add `'originalSnippet'` to the `required` array:

```ts
required: ['id', 'category', 'severity', 'file', 'resourceAddress', 'title', 'explanation', 'originalSnippet', 'fixedSnippet'],
```

- [ ] **Step 2: Update the prompt to instruct Claude on `originalSnippet`**

Append one sentence to `VALIDATOR_SYSTEM_PROMPT` before the closing backtick (after the line that starts "For each finding"):

Replace:
```ts
For each finding, call the report_findings tool with the complete list of findings AND the complete corrected content for every .tf/.tfvars file that needed a change (files with no issues can be omitted from fixedFiles).`;
```

With:
```ts
For each finding, call the report_findings tool with the complete list of findings AND the complete corrected content for every .tf/.tfvars file that needed a change (files with no issues can be omitted from fixedFiles).

In originalSnippet, copy the EXACT text from the masked file that the fix replaces — verbatim, including whitespace and indentation. It must be a literal substring of the file content so the UI can locate and replace it precisely.`;
```

- [ ] **Step 3: Verify TypeScript compiles and tests still pass**

```bash
npx tsc --noEmit && npx jest
```

Expected: TypeScript clean, all existing tests pass. The `originalSnippet` field is populated from Claude's API response via the type cast on line 524 — existing tests don't mock `analyzeProject`, so nothing breaks.

- [ ] **Step 4: Commit**

```bash
git add src/main/api/validator.ts
git commit -m "feat(validator): add originalSnippet to report_findings tool schema and prompt"
```

---

## Task 3: Create `reconstructFiles` utility with tests (TDD)

**Files:**
- Create: `src/__tests__/reconstruct.test.ts`
- Create: `src/shared/reconstruct.ts`

- [ ] **Step 1: Write failing tests for `reconstructFiles`**

Create `src/__tests__/reconstruct.test.ts`:

```ts
import { reconstructFiles } from '../shared/reconstruct';
import type { Finding } from '../shared/types';

const base = (overrides: Partial<Finding> = {}): Finding => ({
  id: 'f1',
  category: 'correctness',
  severity: 'error',
  file: 'main.tf',
  resourceAddress: 'okta_group.admins',
  title: 'test',
  explanation: 'test',
  originalSnippet: 'skip_users = true',
  fixedSnippet: '# removed',
  ...overrides,
});

describe('reconstructFiles', () => {
  it('applies an accepted finding — replaces originalSnippet with fixedSnippet', () => {
    const maskedFiles = { 'main.tf': 'resource "okta_group" "x" {\n  skip_users = true\n}\n' };
    const findings = [base()];
    const accepted = new Set(['f1']);
    const result = reconstructFiles(maskedFiles, findings, accepted);
    expect(result['main.tf']).toContain('# removed');
    expect(result['main.tf']).not.toContain('skip_users = true');
  });

  it('does not apply a rejected finding — leaves file unchanged', () => {
    const original = 'resource "okta_group" "x" {\n  skip_users = true\n}\n';
    const maskedFiles = { 'main.tf': original };
    const findings = [base()];
    const result = reconstructFiles(maskedFiles, findings, new Set());
    expect(result['main.tf']).toBe(original);
  });

  it('applies two accepted findings in the same file sequentially', () => {
    const maskedFiles = {
      'main.tf': 'skip_users = true\nskip_groups = true\n',
    };
    const findings = [
      base({ id: 'f1', originalSnippet: 'skip_users = true', fixedSnippet: '# no skip_users' }),
      base({ id: 'f2', originalSnippet: 'skip_groups = true', fixedSnippet: '# no skip_groups' }),
    ];
    const result = reconstructFiles(maskedFiles, findings, new Set(['f1', 'f2']));
    expect(result['main.tf']).toContain('# no skip_users');
    expect(result['main.tf']).toContain('# no skip_groups');
    expect(result['main.tf']).not.toContain('skip_users = true');
    expect(result['main.tf']).not.toContain('skip_groups = true');
  });

  it('applies a finding in one file but not another', () => {
    const maskedFiles = {
      'a.tf': 'skip_users = true',
      'b.tf': 'skip_groups = true',
    };
    const findings = [
      base({ id: 'f1', file: 'a.tf', originalSnippet: 'skip_users = true', fixedSnippet: '# a' }),
      base({ id: 'f2', file: 'b.tf', originalSnippet: 'skip_groups = true', fixedSnippet: '# b' }),
    ];
    const result = reconstructFiles(maskedFiles, findings, new Set(['f1']));
    expect(result['a.tf']).toBe('# a');
    expect(result['b.tf']).toBe('skip_groups = true');
  });

  it('returns original files unchanged when no findings are accepted', () => {
    const maskedFiles = { 'main.tf': 'original content' };
    const result = reconstructFiles(maskedFiles, [base()], new Set());
    expect(result).toEqual(maskedFiles);
  });

  it('does not mutate the input maskedFiles object', () => {
    const maskedFiles = { 'main.tf': 'skip_users = true' };
    const copy = { ...maskedFiles };
    reconstructFiles(maskedFiles, [base()], new Set(['f1']));
    expect(maskedFiles).toEqual(copy);
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npx jest reconstruct.test.ts
```

Expected: FAIL with "Cannot find module '../shared/reconstruct'"

- [ ] **Step 3: Implement `reconstructFiles` in `src/shared/reconstruct.ts`**

Create `src/shared/reconstruct.ts`:

```ts
import type { Finding } from './types';

export function reconstructFiles(
  maskedFiles: Record<string, string>,
  findings: Finding[],
  acceptedIds: Set<string>,
): Record<string, string> {
  const result = { ...maskedFiles };
  for (const finding of findings) {
    if (!acceptedIds.has(finding.id)) continue;
    if (result[finding.file] === undefined) continue;
    result[finding.file] = result[finding.file].replace(
      finding.originalSnippet,
      finding.fixedSnippet,
    );
  }
  return result;
}
```

- [ ] **Step 4: Run tests — confirm they pass**

```bash
npx jest reconstruct.test.ts
```

Expected: all 6 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/shared/reconstruct.ts src/__tests__/reconstruct.test.ts
git commit -m "feat(validator): add reconstructFiles utility with tests"
```

---

## Task 4: Add `computeDiffLines` utility with tests (TDD)

**Files:**
- Modify: `src/__tests__/reconstruct.test.ts` (append new describe block)
- Modify: `src/shared/reconstruct.ts` (append new exports)

- [ ] **Step 1: Write failing tests for `computeDiffLines`**

Append to `src/__tests__/reconstruct.test.ts`:

```ts
import { computeDiffLines, DiffLine } from '../shared/reconstruct';

describe('computeDiffLines', () => {
  it('shows accepted finding as removed + added lines, context around it', () => {
    const file = 'line1\noriginal\nline3\n';
    const f = base({ originalSnippet: 'original', fixedSnippet: 'fixed' });
    const lines = computeDiffLines(file, [f], new Set(['f1']));

    expect(lines).toContainEqual({ type: 'context', text: 'line1', lineNo: 1 });
    expect(lines).toContainEqual({ type: 'removed', text: 'original', lineNo: 2 });
    expect(lines).toContainEqual({ type: 'added', text: 'fixed' });
    expect(lines).toContainEqual({ type: 'context', text: 'line3', lineNo: 3 });
  });

  it('shows rejected finding as unchanged context', () => {
    const file = 'line1\noriginal\nline3\n';
    const f = base({ originalSnippet: 'original', fixedSnippet: 'fixed' });
    const lines = computeDiffLines(file, [f], new Set());

    const types = lines.map(l => l.type);
    expect(types).not.toContain('removed');
    expect(types).not.toContain('added');
    expect(lines).toContainEqual({ type: 'context', text: 'original', lineNo: 2 });
  });

  it('collapses unchanged runs longer than 5 lines', () => {
    const file = Array.from({ length: 10 }, (_, i) => `ctx${i}`).join('\n') + '\noriginal\n';
    const f = base({ originalSnippet: 'original', fixedSnippet: 'fixed' });
    const lines = computeDiffLines(file, [f], new Set(['f1']));

    const collapsed = lines.filter(l => l.type === 'collapsed');
    expect(collapsed.length).toBeGreaterThan(0);
    const total = (collapsed[0] as Extract<DiffLine, { type: 'collapsed' }>).count;
    expect(total).toBeGreaterThan(0);
  });

  it('handles a multi-line originalSnippet and fixedSnippet', () => {
    const file = 'before\nfoo = true\nbar = true\nafter\n';
    const f = base({
      originalSnippet: 'foo = true\nbar = true',
      fixedSnippet: '# removed foo\n# removed bar',
    });
    const lines = computeDiffLines(file, [f], new Set(['f1']));

    expect(lines).toContainEqual({ type: 'removed', text: 'foo = true', lineNo: 2 });
    expect(lines).toContainEqual({ type: 'removed', text: 'bar = true', lineNo: 3 });
    expect(lines).toContainEqual({ type: 'added', text: '# removed foo' });
    expect(lines).toContainEqual({ type: 'added', text: '# removed bar' });
  });

  it('returns only context lines when no findings are present', () => {
    const file = 'a\nb\nc\n';
    const lines = computeDiffLines(file, [], new Set());
    expect(lines.every(l => l.type === 'context')).toBe(true);
    expect(lines).toHaveLength(3);
  });

  it('skips a finding whose originalSnippet is not found in the file', () => {
    const file = 'line1\nline2\n';
    const f = base({ originalSnippet: 'not present', fixedSnippet: 'fixed' });
    const lines = computeDiffLines(file, [f], new Set(['f1']));
    expect(lines.every(l => l.type === 'context')).toBe(true);
  });
});
```

- [ ] **Step 2: Run to confirm they fail**

```bash
npx jest reconstruct.test.ts
```

Expected: FAIL with "computeDiffLines is not a function" (not exported yet)

- [ ] **Step 3: Implement `computeDiffLines` — append to `src/shared/reconstruct.ts`**

```ts
export type DiffLine =
  | { type: 'context'; text: string; lineNo: number }
  | { type: 'removed'; text: string; lineNo: number }
  | { type: 'added'; text: string }
  | { type: 'collapsed'; count: number };

export function computeDiffLines(
  fileContent: string,
  findings: Finding[],
  acceptedIds: Set<string>,
): DiffLine[] {
  // Locate each finding's originalSnippet in the file
  const regions: Array<{ finding: Finding; start: number; end: number }> = [];
  for (const f of findings) {
    const idx = fileContent.indexOf(f.originalSnippet);
    if (idx !== -1) regions.push({ finding: f, start: idx, end: idx + f.originalSnippet.length });
  }
  regions.sort((a, b) => a.start - b.start);

  const result: DiffLine[] = [];
  let cursor = 0;

  for (const { finding, start, end } of regions) {
    if (cursor < start) {
      pushContext(result, fileContent.slice(cursor, start), lineNoAt(fileContent, cursor));
    }
    const lineNo = lineNoAt(fileContent, start);
    if (acceptedIds.has(finding.id)) {
      splitLines(finding.originalSnippet).forEach((text, i) =>
        result.push({ type: 'removed', text, lineNo: lineNo + i }),
      );
      splitLines(finding.fixedSnippet).forEach(text =>
        result.push({ type: 'added', text }),
      );
    } else {
      splitLines(finding.originalSnippet).forEach((text, i) =>
        result.push({ type: 'context', text, lineNo: lineNo + i }),
      );
    }
    cursor = end;
  }

  if (cursor < fileContent.length) {
    pushContext(result, fileContent.slice(cursor), lineNoAt(fileContent, cursor));
  }

  return result;
}

// Returns 1-based line number of the character at pos in content.
function lineNoAt(content: string, pos: number): number {
  return (content.slice(0, pos).match(/\n/g) ?? []).length + 1;
}

// Splits text into lines, dropping a trailing empty string produced by a
// trailing newline (e.g. "a\nb\n".split('\n') → ["a","b",""]).
function splitLines(text: string): string[] {
  const lines = text.split('\n');
  if (lines.at(-1) === '') lines.pop();
  return lines;
}

// Pushes a context segment, collapsing any run longer than 5 lines to
// keep the diff readable. Shows first 2 and last 2 lines around the collapse.
function pushContext(result: DiffLine[], text: string, startLineNo: number): void {
  const lines = splitLines(text);
  if (lines.length <= 5) {
    lines.forEach((t, i) => result.push({ type: 'context', text: t, lineNo: startLineNo + i }));
    return;
  }
  // Show first 2
  result.push({ type: 'context', text: lines[0], lineNo: startLineNo });
  result.push({ type: 'context', text: lines[1], lineNo: startLineNo + 1 });
  // Collapse middle
  const collapsedCount = lines.length - 4;
  result.push({ type: 'collapsed', count: collapsedCount });
  // Show last 2
  const lastStart = startLineNo + lines.length - 2;
  result.push({ type: 'context', text: lines[lines.length - 2], lineNo: lastStart });
  result.push({ type: 'context', text: lines[lines.length - 1], lineNo: lastStart + 1 });
}
```

- [ ] **Step 4: Run all tests**

```bash
npx jest
```

Expected: all tests pass (existing 121 + new reconstruct tests)

- [ ] **Step 5: Commit**

```bash
git add src/shared/reconstruct.ts src/__tests__/reconstruct.test.ts
git commit -m "feat(validator): add computeDiffLines utility with tests"
```

---

## Task 5: Update `ValidatorSection.tsx` — new state, stage, and wiring

**Files:**
- Modify: `src/renderer/components/ValidatorSection.tsx`

- [ ] **Step 1: Add the import for `reconstructFiles`**

At the top of `ValidatorSection.tsx`, after the existing import:

```ts
import { reconstructFiles } from '../../shared/reconstruct';
```

- [ ] **Step 2: Extend the `Stage` type and add new state fields**

Replace:
```ts
type Stage = 'upload' | 'ready' | 'analyzing' | 'reviewed' | 'exporting' | 'exported';
```
With:
```ts
type Stage = 'upload' | 'ready' | 'analyzing' | 'reviewed' | 'diff-review' | 'exporting' | 'exported';
```

Add two new state variables inside the component (after the existing `useState` declarations):
```ts
const [maskedFiles, setMaskedFiles] = useState<Record<string, string>>({});
const [acceptedFindingIds, setAcceptedFindingIds] = useState<Set<string>>(new Set());
```

- [ ] **Step 3: Store `maskedFiles` on upload**

In `handleUpload`, after `setVaultSummary(result.data.vaultSummary)`, add:
```ts
setMaskedFiles(result.data.maskedFiles);
```

- [ ] **Step 4: Initialize `acceptedFindingIds` on analyze**

In `handleAnalyze`, after `setFixedMaskedFiles(result.data.fixedMaskedFiles)`, add:
```ts
setAcceptedFindingIds(new Set(result.data.findings.map((f: Finding) => f.id)));
```

Also add `Finding` to the import from `../../shared/types` if not already present:
```ts
import { Finding } from '../../shared/types';
```

- [ ] **Step 5: Change "Export Fixed Project" button to "Review Changes →"**

In the `stage === 'reviewed'` section, replace the export button:
```tsx
<button
  onClick={() => setStage('diff-review')}
  className="px-4 py-2 text-xs font-medium bg-accent-teal text-surface-0 hover:bg-accent-teal/90 rounded-lg transition-colors"
>
  Review Changes →
</button>
```

- [ ] **Step 6: Update `handleExport` to use `reconstructFiles`**

Replace the body of `handleExport`:
```ts
const handleExport = async () => {
  if (!sessionId) return;
  setError(null);
  setStage('exporting');
  const reconstructed = reconstructFiles(maskedFiles, findings, acceptedFindingIds);
  const result = await window.oktaTerraform.validatorExport(sessionId, reconstructed);
  if (!result.success) {
    setError(result.error ?? 'Export failed');
    setStage('diff-review');
    return;
  }
  setExportedDir(result.data ?? null);
  setStage('exported');
};
```

- [ ] **Step 7: Add `diff-review` stage render and reset `acceptedFindingIds` on discard**

In the `handleDiscard` function, add:
```ts
setAcceptedFindingIds(new Set());
setMaskedFiles({});
```

Add the `diff-review` render block (placeholder until `ValidatorDiffView` is built — renders the findings list with an export button as a temporary stand-in):

```tsx
{stage === 'diff-review' && (
  <div className="space-y-2">
    <p className="text-xs text-text-muted">Diff review loading...</p>
    <div className="flex gap-2">
      <button
        onClick={() => setStage('reviewed')}
        className="px-3 py-1.5 text-xs text-text-muted hover:text-text-secondary bg-surface-3 hover:bg-surface-4 rounded-lg transition-colors"
      >
        ← Back to Findings
      </button>
      <button
        onClick={handleExport}
        className="px-4 py-2 text-xs font-medium bg-accent-teal text-surface-0 hover:bg-accent-teal/90 rounded-lg transition-colors"
      >
        Export Selected Fixes →
      </button>
    </div>
  </div>
)}
```

- [ ] **Step 8: Build and verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 9: Commit**

```bash
git add src/renderer/components/ValidatorSection.tsx
git commit -m "feat(validator): wire diff-review stage into ValidatorSection"
```

---

## Task 6: Build `ValidatorDiffView.tsx`

**Files:**
- Create: `src/renderer/components/ValidatorDiffView.tsx`
- Modify: `src/renderer/components/ValidatorSection.tsx` (swap placeholder for real component)

- [ ] **Step 1: Create `src/renderer/components/ValidatorDiffView.tsx`**

```tsx
import React, { useState, useMemo } from 'react';
import { Finding } from '../../shared/types';
import { computeDiffLines, DiffLine } from '../../shared/reconstruct';

interface ValidatorDiffViewProps {
  findings: Finding[];
  maskedFiles: Record<string, string>;
  acceptedIds: Set<string>;
  onToggle: (id: string) => void;
  onExport: () => void;
  onBack: () => void;
}

export default function ValidatorDiffView({
  findings,
  maskedFiles,
  acceptedIds,
  onToggle,
  onExport,
  onBack,
}: ValidatorDiffViewProps) {
  // Changed files are those with at least one finding
  const changedFiles = useMemo(
    () => [...new Set(findings.map(f => f.file))].sort(),
    [findings],
  );

  const [activeFile, setActiveFile] = useState<string>(changedFiles[0] ?? '');

  const fileFindingCount = (file: string) => findings.filter(f => f.file === file).length;

  const activeFindingsForFile = findings.filter(f => f.file === activeFile);

  const diffLines = useMemo(
    () => computeDiffLines(maskedFiles[activeFile] ?? '', activeFindingsForFile, acceptedIds),
    [activeFile, activeFindingsForFile, acceptedIds, maskedFiles],
  );

  const totalAccepted = findings.filter(f => acceptedIds.has(f.id)).length;

  return (
    <div className="bg-surface-2 rounded-xl border border-border overflow-hidden">
      {/* File tabs */}
      <div className="flex border-b border-border overflow-x-auto">
        {changedFiles.map(file => (
          <button
            key={file}
            onClick={() => setActiveFile(file)}
            className={`px-4 py-2.5 text-xs font-medium whitespace-nowrap border-r border-border flex items-center gap-1.5 transition-colors ${
              file === activeFile
                ? 'bg-surface-0 text-accent-teal border-b-2 border-b-accent-teal'
                : 'text-text-muted hover:text-text-secondary hover:bg-surface-1'
            }`}
          >
            {file}
            <span className={`text-[9px] px-1.5 py-0.5 rounded font-semibold ${
              file === activeFile ? 'bg-accent-teal/20 text-accent-teal' : 'bg-surface-3 text-text-muted'
            }`}>
              {fileFindingCount(file)}
            </span>
          </button>
        ))}
      </div>

      {/* Main panel: sidebar + diff */}
      <div className="grid" style={{ gridTemplateColumns: '220px 1fr', minHeight: '300px' }}>
        {/* Findings sidebar */}
        <div className="border-r border-border p-3 space-y-2 overflow-y-auto">
          <p className="text-[9px] text-text-muted uppercase tracking-wider font-semibold mb-3">
            Findings — {activeFile}
          </p>
          {activeFindingsForFile.map(finding => {
            const accepted = acceptedIds.has(finding.id);
            return (
              <div
                key={finding.id}
                className={`rounded-lg border p-2.5 cursor-pointer transition-colors ${
                  accepted
                    ? 'bg-accent-teal/5 border-accent-teal/25'
                    : 'border-border opacity-50'
                }`}
                onClick={() => onToggle(finding.id)}
              >
                <div className="flex items-center gap-2 mb-1.5">
                  <input
                    type="checkbox"
                    checked={accepted}
                    onChange={() => onToggle(finding.id)}
                    onClick={e => e.stopPropagation()}
                    style={{ accentColor: '#2dd4bf', width: 11, height: 11 }}
                  />
                  <SeverityBadge severity={finding.severity} />
                </div>
                <p className="text-[10px] text-text-primary leading-snug">{finding.title}</p>
                <p className="text-[9px] text-text-muted font-mono mt-1">{finding.resourceAddress}</p>
              </div>
            );
          })}
          <p className="text-[9px] text-text-muted pt-1">
            {activeFindingsForFile.filter(f => acceptedIds.has(f.id)).length} of{' '}
            {activeFindingsForFile.length} selected
          </p>
        </div>

        {/* Diff panel */}
        <div className="overflow-auto font-mono text-[10px] leading-5">
          {diffLines.length === 0 && (
            <p className="p-4 text-text-muted text-xs">No changes in this file.</p>
          )}
          {diffLines.map((line, i) => (
            <DiffLineRow key={i} line={line} />
          ))}
        </div>
      </div>

      {/* Footer */}
      <div className="border-t border-border px-4 py-2.5 flex items-center justify-between">
        <button
          onClick={onBack}
          className="text-[10px] text-text-muted hover:text-text-secondary transition-colors"
        >
          ← Back to Findings
        </button>
        <div className="flex items-center gap-3">
          <span className="text-[10px] text-text-muted">
            {totalAccepted} of {findings.length} fix{findings.length !== 1 ? 'es' : ''} selected
          </span>
          <button
            onClick={onExport}
            className="px-4 py-1.5 text-xs font-semibold bg-accent-teal text-surface-0 hover:bg-accent-teal/90 rounded-lg transition-colors"
          >
            Export Selected Fixes →
          </button>
        </div>
      </div>
    </div>
  );
}

function DiffLineRow({ line }: { line: DiffLine }) {
  if (line.type === 'collapsed') {
    return (
      <div className="flex items-center gap-2 px-3 py-0.5 text-text-muted bg-surface-1 border-y border-border/50">
        <span className="w-8 text-right text-[9px] select-none">···</span>
        <span className="text-[9px] italic">{line.count} unchanged line{line.count !== 1 ? 's' : ''}</span>
      </div>
    );
  }
  const bgClass =
    line.type === 'removed' ? 'bg-red-500/10' :
    line.type === 'added'   ? 'bg-green-500/8' :
    '';
  const textClass =
    line.type === 'removed' ? 'text-red-400' :
    line.type === 'added'   ? 'text-green-400' :
    'text-text-secondary';
  const prefix =
    line.type === 'removed' ? '-' :
    line.type === 'added'   ? '+' :
    ' ';
  const lineNo = line.type !== 'added' ? line.lineNo : null;

  return (
    <div className={`flex items-start ${bgClass}`}>
      <span className="w-10 text-right pr-3 text-[9px] text-text-muted select-none flex-shrink-0 pt-px">
        {lineNo ?? ''}
      </span>
      <span className={`w-3 flex-shrink-0 select-none ${textClass}`}>{prefix}</span>
      <span className={`flex-1 whitespace-pre-wrap break-all pr-3 ${textClass}`}>{line.text}</span>
    </div>
  );
}

const SEVERITY_STYLES: Record<Finding['severity'], string> = {
  error:      'bg-red-500/15 text-red-400 border-red-500/30',
  warning:    'bg-amber-500/15 text-amber-400 border-amber-500/30',
  suggestion: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
};

function SeverityBadge({ severity }: { severity: Finding['severity'] }) {
  return (
    <span className={`text-[8px] font-semibold px-1.5 py-0.5 rounded border ${SEVERITY_STYLES[severity]}`}>
      {severity}
    </span>
  );
}
```

- [ ] **Step 2: Swap the placeholder in `ValidatorSection.tsx` for the real component**

Add the import at the top of `ValidatorSection.tsx`:
```ts
import ValidatorDiffView from './ValidatorDiffView';
```

Replace the placeholder `stage === 'diff-review'` block with:
```tsx
{stage === 'diff-review' && (
  <ValidatorDiffView
    findings={findings}
    maskedFiles={maskedFiles}
    acceptedIds={acceptedFindingIds}
    onToggle={id =>
      setAcceptedFindingIds(prev => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id); else next.add(id);
        return next;
      })
    }
    onExport={handleExport}
    onBack={() => setStage('reviewed')}
  />
)}
```

- [ ] **Step 3: TypeScript compile check**

```bash
npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 4: Run full test suite**

```bash
npx jest
```

Expected: all tests pass

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/ValidatorDiffView.tsx src/renderer/components/ValidatorSection.tsx
git commit -m "feat(validator): add ValidatorDiffView with per-finding accept/reject diff review"
```

---

## Task 7: Smoke test in the running app

**Files:** none — manual verification only

- [ ] **Step 1: Start the dev server**

```bash
npm run dev
```

Wait for all three webpack builds to complete and Electron to launch.

- [ ] **Step 2: Upload a real Terraform project with findings**

Use the files from `/Users/nicole.pendill/Desktop/otto - cos testing v2/validate test/` (or any `.tf` + `.tfstate`). Click **Select Files**, then **Analyze**. Wait for analysis to complete.

- [ ] **Step 3: Confirm "Review Changes →" button appears**

The `reviewed` stage should now show "Review Changes →" instead of "Export Fixed Project".

- [ ] **Step 4: Click "Review Changes →" and inspect the diff-review stage**

Expected:
- File tabs appear for each file with findings
- Sidebar shows findings for the active file with checkboxes (all checked by default)
- Diff panel shows removed/added lines for accepted findings in red/green
- Unchanged regions longer than 5 lines are collapsed

- [ ] **Step 5: Toggle a finding off — confirm the diff updates**

Uncheck one finding in the sidebar. Expected: that finding's lines change from red/green to gray (context), with no green added lines.

- [ ] **Step 6: Export and verify the output**

Click **Export Selected Fixes →**, choose a directory. Open the exported `.tf` file. Confirm:
- Accepted findings' changes are present
- Rejected findings' original text is preserved (not replaced)
- No `{{TOKEN}}` placeholders remain in any file

- [ ] **Step 7: Commit if any last-minute tweaks were needed**

```bash
git add -p
git commit -m "fix(validator): smoke test fixes"
```

---

## Self-Review Checklist

**Spec coverage:**
- ✅ `originalSnippet` added to `Finding` (Task 1)
- ✅ `report_findings` schema + prompt updated (Task 2)
- ✅ `reconstructFiles` with tests (Task 3)
- ✅ `computeDiffLines` with tests (Task 4)
- ✅ `ValidatorSection`: new state, `maskedFiles` stored on upload, `acceptedFindingIds` initialized on analyze, `diff-review` stage, renamed button, export uses reconstruction (Task 5)
- ✅ `ValidatorDiffView`: file tabs, findings sidebar with checkboxes, diff panel, footer with back + export (Task 6)
- ✅ `fixedMaskedFiles` no longer passed to export IPC — reconstructed files used instead (Task 5, Step 6)
- ✅ "← Back to Findings" navigates to `reviewed` without losing selection state (Task 6, Step 2)
- ✅ Smoke test (Task 7)

**Out of scope verified not implemented:** inline snippet editing, real value display in diff, changes to `redact.ts`/`exportProject`.
