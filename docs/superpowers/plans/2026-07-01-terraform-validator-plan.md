# Terraform Validator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Validate" tab to OTTO where a user uploads a Terraform project (`.tf`/`.tfstate`/`.tfvars`), OTTO masks hardcoded PII before AI analysis, runs a correctness + optimization review, and on export restores real values — promoted to `variables.tf` + `terraform.tfvars` rather than re-inlined.

**Architecture:** New main-process module `src/main/api/validator.ts` houses a reversible PII vault (extends the pattern list in `redact.ts` but stores real value + token, not a static placeholder) and orchestrates a single-pass Claude call via the existing `tool_use` pattern in `claude.ts`. New renderer component `src/renderer/components/ValidatorSection.tsx` follows the staged-UI pattern from `SyncSection.tsx` and mounts as a new top-level tab in `DashboardPage.tsx`. Four new IPC channels registered in `ipc-handlers.ts`, bridged through `preload.ts`.

**Tech Stack:** Electron (main process module + IPC), React/TypeScript (renderer component), Anthropic SDK (`@anthropic-ai/sdk`, existing `tool_use` pattern), Jest/ts-jest (unit tests).

**Spec:** `docs/superpowers/specs/2026-07-01-terraform-validator-design.md`

---

## File Structure

| File | Responsibility |
|---|---|
| `src/shared/types.ts` | Modify — add `VaultEntry`, `VaultResult`, `Finding`, `ValidatorAnalysis` interfaces |
| `src/main/api/validator.ts` | Create — vault engine (`vaultProject`), AI analysis (`analyzeProject`), export (`exportProject`), session store with idle timeout |
| `src/main/ipc-handlers.ts` | Modify — register `validator:open-files`, `validator:analyze`, `validator:export`, `validator:clear-session` |
| `src/preload.ts` | Modify — bridge the four new channels |
| `src/renderer/components/ValidatorSection.tsx` | Create — staged UI: upload → vault summary → analyze → findings report → export |
| `src/renderer/pages/DashboardPage.tsx` | Modify — add `'validate'` to `Section` union, icon, nav item, render block |
| `src/__tests__/validator.test.ts` | Create — unit tests for `vaultProject` and `exportProject` (pure functions, no AI/network) |

Task order: shared types → vault engine (TDD) → export engine (TDD) → AI analysis function → IPC wiring → preload bridge → renderer component → dashboard integration → manual smoke test.

---

### Task 1: Shared types

**Files:**
- Modify: `src/shared/types.ts`

- [ ] **Step 1: Add the new interfaces to the end of the file**

Open `src/shared/types.ts` and append after the last interface (`RollbackManifest`):

```typescript
export interface VaultEntry {
  token: string;         // e.g. "{{OKTA_ID_1}}"
  value: string;         // original hardcoded value — never sent to the LLM
  kind: 'okta_id' | 'org_url' | 'token' | 'client_secret' | 'email' | 'jwt' | 'pem_key' | 'hcl_pii_attr';
  sourceFile: string;    // filename this value was found in
  sourceAttr: string;    // HCL attribute name, e.g. "app_id" — used to derive a variable name on export
}

export interface VaultResult {
  maskedFiles: Record<string, string>; // filename -> masked content
  entries: VaultEntry[];
}

export interface Finding {
  id: string;
  category: 'correctness' | 'optimization';
  severity: 'error' | 'warning' | 'suggestion';
  file: string;
  resourceAddress: string;  // e.g. "okta_app_oauth.my_app"
  title: string;
  explanation: string;
  fixedSnippet: string;     // masked HCL after fix
}

export interface ValidatorAnalysis {
  findings: Finding[];
  fixedMaskedFiles: Record<string, string>; // filename -> corrected masked content (.tf/.tfvars only)
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/shared/types.ts
git commit -m "feat(validator): add shared types for PII vault and findings"
```

---

### Task 2: PII vault engine (`vaultProject`)

**Files:**
- Create: `src/main/api/validator.ts`
- Test: `src/__tests__/validator.test.ts`

This task builds the reversible masking engine. It extends the pattern list already proven in `src/main/api/redact.ts` (read that file first — 9 patterns for SSWS tokens, Bearer tokens, org URLs, Okta IDs, emails, HCL PII attrs, client secrets, JWTs, PEM keys) but instead of replacing with a static placeholder, it generates a unique token per distinct value and records a `VaultEntry`.

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/validator.test.ts`:

```typescript
import { vaultProject } from '../main/api/validator';

describe('vaultProject', () => {
  it('masks an Okta ID and records a reversible vault entry', () => {
    const files = { 'main.tf': 'resource "okta_app_oauth" "x" { app_id = "0oaABCDEFGHIJKLMNOPQ" }' };
    const result = vaultProject(files);

    expect(result.maskedFiles['main.tf']).not.toContain('0oaABCDEFGHIJKLMNOPQ');
    expect(result.maskedFiles['main.tf']).toMatch(/\{\{OKTA_ID_1\}\}/);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]).toMatchObject({
      token: '{{OKTA_ID_1}}',
      value: '0oaABCDEFGHIJKLMNOPQ',
      kind: 'okta_id',
      sourceFile: 'main.tf',
    });
  });

  it('reuses the same token when the same value appears in multiple files', () => {
    const files = {
      'main.tf': 'app_id = "0oaABCDEFGHIJKLMNOPQ"',
      'other.tf': 'related_app = "0oaABCDEFGHIJKLMNOPQ"',
    };
    const result = vaultProject(files);

    const tokens = result.entries.map(e => e.token);
    expect(new Set(tokens).size).toBe(1);
    expect(result.maskedFiles['main.tf']).toContain(tokens[0]);
    expect(result.maskedFiles['other.tf']).toContain(tokens[0]);
  });

  it('masks an email address', () => {
    const files = { 'main.tf': 'login = "jane.doe@example.com"' };
    const result = vaultProject(files);

    expect(result.maskedFiles['main.tf']).not.toContain('jane.doe@example.com');
    expect(result.entries[0].kind).toBe('email');
  });

  it('masks a client_secret value', () => {
    const files = { 'main.tf': 'client_secret = "super-secret-value-123"' };
    const result = vaultProject(files);

    expect(result.maskedFiles['main.tf']).not.toContain('super-secret-value-123');
    expect(result.entries[0].kind).toBe('client_secret');
  });

  it('returns an empty entries array for a file with no PII', () => {
    const files = { 'main.tf': 'resource "okta_group" "x" { name = "Engineering" }' };
    const result = vaultProject(files);

    expect(result.entries).toHaveLength(0);
    expect(result.maskedFiles['main.tf']).toBe(files['main.tf']);
  });

  it('tracks sourceAttr from the HCL attribute name when detectable', () => {
    const files = { 'main.tf': 'app_id = "0oaABCDEFGHIJKLMNOPQ"' };
    const result = vaultProject(files);

    expect(result.entries[0].sourceAttr).toBe('app_id');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest validator.test.ts`
Expected: FAIL — `Cannot find module '../main/api/validator'`

- [ ] **Step 3: Write the implementation**

Create `src/main/api/validator.ts`:

```typescript
import { VaultEntry, VaultResult } from '../../shared/types';

type VaultKind = VaultEntry['kind'];

interface VaultPattern {
  kind: VaultKind;
  // Matches the full text to mask, with an optional capture group (group 1)
  // for the attribute name when the pattern spans "attr = "value"".
  regex: RegExp;
  // Extracts just the sensitive value from a match, given the full match and its groups.
  extractValue: (match: RegExpMatchArray) => string;
  extractAttr: (match: RegExpMatchArray) => string;
}

const VAULT_PATTERNS: VaultPattern[] = [
  {
    kind: 'okta_id',
    regex: /(\w+)\s*=\s*"((?:00[a-zA-Z]|0oa|0pr)[A-Za-z0-9]{17})"/g,
    extractValue: (m) => m[2],
    extractAttr: (m) => m[1],
  },
  {
    kind: 'org_url',
    regex: /(\w+)\s*=\s*"((?:https?:\/\/)?[a-zA-Z0-9\-]+(?:\.[a-zA-Z0-9\-]+)*\.okta(?:preview)?\.com)"/g,
    extractValue: (m) => m[2],
    extractAttr: (m) => m[1],
  },
  {
    kind: 'client_secret',
    regex: /(client_secret)\s*=\s*"([^"]+)"/g,
    extractValue: (m) => m[2],
    extractAttr: (m) => m[1],
  },
  {
    kind: 'email',
    regex: /(\w+)\s*=\s*"([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})"/g,
    extractValue: (m) => m[2],
    extractAttr: (m) => m[1],
  },
  {
    kind: 'hcl_pii_attr',
    regex: /(firstName|lastName|displayName|login|mobilePhone|primaryPhone)\s*=\s*"([^"]+)"/g,
    extractValue: (m) => m[2],
    extractAttr: (m) => m[1],
  },
  {
    kind: 'jwt',
    regex: /(\w+)\s*=\s*"([A-Za-z0-9_\-]{20,}\.[A-Za-z0-9_\-]{20,}\.[A-Za-z0-9_\-]{20,})"/g,
    extractValue: (m) => m[2],
    extractAttr: (m) => m[1],
  },
  {
    kind: 'token',
    regex: /(\w+)\s*=\s*"((?:SSWS|Bearer)\s+[A-Za-z0-9_.\-]{20,})"/g,
    extractValue: (m) => m[2],
    extractAttr: (m) => m[1],
  },
  {
    kind: 'pem_key',
    regex: /(\w+)\s*=\s*"(-----BEGIN [A-Z ]+-----[\s\S]+?-----END [A-Z ]+-----)"/g,
    extractValue: (m) => m[2],
    extractAttr: (m) => m[1],
  },
];

export function vaultProject(files: Record<string, string>): VaultResult {
  // Map from real value -> token, so the same value gets one token across the whole project.
  const valueToToken = new Map<string, string>();
  const entries: VaultEntry[] = [];
  const tokenCounters: Record<VaultKind, number> = {
    okta_id: 0, org_url: 0, token: 0, client_secret: 0, email: 0, jwt: 0, pem_key: 0, hcl_pii_attr: 0,
  };

  function tokenFor(kind: VaultKind, value: string, sourceFile: string, sourceAttr: string): string {
    const existing = valueToToken.get(value);
    if (existing) return existing;

    tokenCounters[kind] += 1;
    const label = kind.toUpperCase();
    const token = `{{${label}_${tokenCounters[kind]}}}`;
    valueToToken.set(value, token);
    entries.push({ token, value, kind, sourceFile, sourceAttr });
    return token;
  }

  const maskedFiles: Record<string, string> = {};

  for (const [filename, content] of Object.entries(files)) {
    let masked = content;
    for (const pattern of VAULT_PATTERNS) {
      masked = masked.replace(pattern.regex, (...args) => {
        const match = args as unknown as RegExpMatchArray;
        const value = pattern.extractValue(match);
        const attr = pattern.extractAttr(match);
        // Skip values that were already replaced by an earlier, more specific pattern
        // (e.g. an email matched by hcl_pii_attr's "login" case after email's generic case ran).
        if (!value.includes('{{')) {
          const token = tokenFor(pattern.kind, value, filename, attr);
          return match[0].replace(value, token);
        }
        return match[0];
      });
    }
    maskedFiles[filename] = masked;
  }

  return { maskedFiles, entries };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest validator.test.ts`
Expected: PASS (6/6)

- [ ] **Step 5: Commit**

```bash
git add src/main/api/validator.ts src/__tests__/validator.test.ts
git commit -m "feat(validator): add reversible PII vault engine"
```

---

### Task 3: Export engine (`exportProject`)

**Files:**
- Modify: `src/main/api/validator.ts`
- Test: `src/__tests__/validator.test.ts`

Implements the export logic locked in during design: values sourced from `.tf` files get promoted to a `variables.tf` declaration (no default — real value never lands there) + a `terraform.tfvars` assignment; values sourced from `.tfvars` files are restored in place with no promotion.

- [ ] **Step 1: Write the failing tests**

Append to `src/__tests__/validator.test.ts`:

```typescript
import { vaultProject, exportProject } from '../main/api/validator';

describe('exportProject', () => {
  it('promotes a .tf-sourced value to variables.tf + terraform.tfvars, not inlined', () => {
    const original = { 'main.tf': 'resource "okta_app_oauth" "x" { app_id = "0oaABCDEFGHIJKLMNOPQ" }' };
    const { maskedFiles, entries } = vaultProject(original);

    const result = exportProject(maskedFiles, entries);

    expect(result.files['main.tf']).not.toContain('0oaABCDEFGHIJKLMNOPQ');
    expect(result.files['main.tf']).toMatch(/var\.app_id_1/);
    expect(result.files['variables.tf']).toContain('variable "app_id_1"');
    expect(result.files['variables.tf']).not.toContain('0oaABCDEFGHIJKLMNOPQ');
    expect(result.files['variables.tf']).not.toContain('default');
    expect(result.files['terraform.tfvars']).toContain('app_id_1 = "0oaABCDEFGHIJKLMNOPQ"');
  });

  it('restores a .tfvars-sourced value in place without promoting it', () => {
    const original = { 'terraform.tfvars': 'app_id = "0oaABCDEFGHIJKLMNOPQ"' };
    const { maskedFiles, entries } = vaultProject(original);

    const result = exportProject(maskedFiles, entries);

    expect(result.files['terraform.tfvars']).toBe('app_id = "0oaABCDEFGHIJKLMNOPQ"');
    expect(result.files['variables.tf']).toBeUndefined();
  });

  it('appends to an existing variables.tf without disturbing existing declarations', () => {
    const original = {
      'main.tf': 'app_id = "0oaABCDEFGHIJKLMNOPQ"',
      'variables.tf': 'variable "region" {\n  type = string\n}\n',
    };
    const { maskedFiles, entries } = vaultProject(original);

    const result = exportProject(maskedFiles, entries);

    expect(result.files['variables.tf']).toContain('variable "region"');
    expect(result.files['variables.tf']).toContain('variable "app_id_1"');
  });

  it('deduplicates variable names when the same sourceAttr appears more than once', () => {
    const original = {
      'main.tf': 'a = "0oaAAAAAAAAAAAAAAAAAA"\nb = "0oaBBBBBBBBBBBBBBBBBB"',
    };
    // Force both entries to share sourceAttr "app_id" to exercise the dedup counter.
    const vaulted = vaultProject(original);
    const entries = vaulted.entries.map(e => ({ ...e, sourceAttr: 'app_id' }));

    const result = exportProject(vaulted.maskedFiles, entries);

    expect(result.files['variables.tf']).toContain('variable "app_id_1"');
    expect(result.files['variables.tf']).toContain('variable "app_id_2"');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest validator.test.ts`
Expected: FAIL — `exportProject` is not exported

- [ ] **Step 3: Write the implementation**

Append to `src/main/api/validator.ts`:

```typescript
export interface ExportResult {
  files: Record<string, string>; // filename -> final content, ready to write to disk
}

export function exportProject(
  maskedFiles: Record<string, string>,
  entries: VaultEntry[],
): ExportResult {
  const files: Record<string, string> = { ...maskedFiles };
  const usedVarNames = new Set<string>();
  const varNameForToken = new Map<string, string>();
  const declarationsToAdd: string[] = [];
  const tfvarsAssignmentsToAdd: string[] = [];

  for (const entry of entries) {
    const isFromTfvars = entry.sourceFile.endsWith('.tfvars');

    if (isFromTfvars) {
      // Restore in place: replace the token with the real value directly in the tfvars content.
      for (const [filename, content] of Object.entries(files)) {
        if (content.includes(entry.token)) {
          files[filename] = content.split(entry.token).join(entry.value);
        }
      }
      continue;
    }

    // Promote: derive a unique variable name from sourceAttr.
    let baseName = entry.sourceAttr.replace(/[^a-zA-Z0-9_]/g, '_') || 'value';
    let counter = 1;
    let varName = `${baseName}_${counter}`;
    while (usedVarNames.has(varName)) {
      counter += 1;
      varName = `${baseName}_${counter}`;
    }
    usedVarNames.add(varName);
    varNameForToken.set(entry.token, varName);

    declarationsToAdd.push(
      `variable "${varName}" {\n  type      = string\n  sensitive = true\n}\n`,
    );
    tfvarsAssignmentsToAdd.push(`${varName} = "${entry.value}"`);

    for (const [filename, content] of Object.entries(files)) {
      if (filename.endsWith('.tfvars')) continue; // never rewrite tfvars content with var. references
      if (content.includes(entry.token)) {
        files[filename] = content.split(entry.token).join(`var.${varName}`);
      }
    }
  }

  if (declarationsToAdd.length > 0) {
    const existingVariablesTf = files['variables.tf'] ?? '';
    const separator = existingVariablesTf.trim().length > 0 ? '\n' : '';
    files['variables.tf'] = existingVariablesTf + separator + declarationsToAdd.join('\n');
  }

  if (tfvarsAssignmentsToAdd.length > 0) {
    const existingTfvars = files['terraform.tfvars'] ?? '';
    const separator = existingTfvars.trim().length > 0 ? '\n' : '';
    files['terraform.tfvars'] = existingTfvars + separator + tfvarsAssignmentsToAdd.join('\n') + '\n';
  }

  return { files };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest validator.test.ts`
Expected: PASS (10/10)

- [ ] **Step 5: Commit**

```bash
git add src/main/api/validator.ts src/__tests__/validator.test.ts
git commit -m "feat(validator): add export engine — promote .tf values, restore .tfvars in place"
```

---

### Task 4: AI analysis function (`analyzeProject`)

**Files:**
- Modify: `src/main/api/validator.ts`
- Modify: `src/main/api/claude.ts` (export `getClient` — currently module-private)

This wires the masked files into a single Claude call using the same `tool_use` structured-output pattern as `buildWorkload` in `claude.ts`.

- [ ] **Step 1: Export `getClient` from `claude.ts`**

In `src/main/api/claude.ts`, find:

```typescript
function getClient(): Anthropic {
```

Change to:

```typescript
export function getClient(): Anthropic {
```

- [ ] **Step 2: Run existing claude tests to confirm nothing broke**

Run: `npx jest claude-config.test.ts`
Expected: PASS (all existing tests unaffected — this is a visibility-only change)

- [ ] **Step 3: Add the analysis function to `validator.ts`**

Add these imports at the top of `src/main/api/validator.ts`:

```typescript
import { getClient } from './claude';
import { RESOURCE_DICTIONARY } from '../../shared/resource-dictionary';
import { VaultEntry, VaultResult, Finding, ValidatorAnalysis } from '../../shared/types';
```

Append to `src/main/api/validator.ts`:

```typescript
function buildResourceNameContext(): string {
  const names = RESOURCE_DICTIONARY.map(r => r.terraformResource).join(', ');
  return `Valid Okta Terraform resource and data source names (use ONLY these — never invent a resource name not in this list):\n${names}`;
}

const VALIDATOR_SYSTEM_PROMPT = `You are a senior Okta Terraform reviewer. You will be given one or more masked Terraform files (secrets and identifiers have been replaced with tokens like {{OKTA_ID_1}} — treat these as opaque placeholders, never remove or rewrite the token syntax itself).

${buildResourceNameContext()}

Review the combined project across ALL provided files for:

CORRECTNESS issues:
- Resource or data source names that are not in the valid list above (these are hallucinations and must be flagged as errors)
- Missing required attributes or use of deprecated attributes
- Resources that reference another resource without a "depends_on" where Terraform cannot infer the ordering automatically
- Conflicting or ambiguous "priority" values across policy rules or auth server rules
- Import ID or destroy-behavior mistakes

OPTIMIZATION suggestions (always severity "suggestion", never "error" or "warning"):
- Near-identical repeated resource blocks that could collapse into a single block using for_each or count
- SAML/OIDC app resources where "skip_authentication_policy" would reduce unnecessary /policies API calls, when the authentication policy is not independently managed elsewhere in the project
- Hardcoded value duplication where a "data" source lookup would be more maintainable
- Provider configuration tuning opportunities (max_retries, parallelism) if a provider.tf is included

Never suggest "skip_users" or "skip_groups" — both are deprecated in the Okta Terraform provider and must not appear in any recommendation.

For each finding, call the report_findings tool with the complete list of findings AND the complete corrected content for every .tf/.tfvars file that needed a change (files with no issues can be omitted from fixedFiles).`;

export async function analyzeProject(maskedFiles: Record<string, string>): Promise<ValidatorAnalysis> {
  const client = getClient();

  const fileBlocks = Object.entries(maskedFiles)
    .map(([name, content]) => `--- ${name} ---\n${content}`)
    .join('\n\n');

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 8192,
    system: VALIDATOR_SYSTEM_PROMPT,
    messages: [{
      role: 'user',
      content: `Review this Terraform project:\n\n${fileBlocks}`,
    }],
    tool_choice: { type: 'any' },
    tools: [{
      name: 'report_findings',
      description: 'Report validation findings and corrected file content',
      input_schema: {
        type: 'object' as const,
        properties: {
          findings: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                category: { type: 'string', enum: ['correctness', 'optimization'] },
                severity: { type: 'string', enum: ['error', 'warning', 'suggestion'] },
                file: { type: 'string' },
                resourceAddress: { type: 'string' },
                title: { type: 'string' },
                explanation: { type: 'string' },
                fixedSnippet: { type: 'string' },
              },
              required: ['id', 'category', 'severity', 'file', 'resourceAddress', 'title', 'explanation', 'fixedSnippet'],
            },
          },
          fixedFiles: {
            type: 'object',
            description: 'Map of filename to full corrected file content, for files that needed changes',
            additionalProperties: { type: 'string' },
          },
        },
        required: ['findings', 'fixedFiles'],
      },
    }],
  });

  const toolUseBlock = response.content.find(b => b.type === 'tool_use');
  if (!toolUseBlock || toolUseBlock.type !== 'tool_use') {
    throw new Error('Claude did not return structured validation results');
  }

  const input = toolUseBlock.input as { findings: Finding[]; fixedFiles: Record<string, string> };

  return {
    findings: input.findings,
    fixedMaskedFiles: { ...maskedFiles, ...input.fixedFiles },
  };
}
```

- [ ] **Step 4: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add src/main/api/validator.ts src/main/api/claude.ts
git commit -m "feat(validator): add single-pass AI analysis via Claude tool_use"
```

---

### Task 5: Session store + vault lifetime policy

**Files:**
- Modify: `src/main/api/validator.ts`
- Test: `src/__tests__/validator.test.ts`

Implements the spec's vault lifetime policy: memory-only, session-scoped, 15-minute idle timeout, explicit clear.

- [ ] **Step 1: Write the failing tests**

Append to `src/__tests__/validator.test.ts`:

```typescript
import { createSession, getSession, clearSession, touchSession } from '../main/api/validator';

describe('validator session store', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('creates and retrieves a session by id', () => {
    const id = createSession({ maskedFiles: { 'main.tf': 'x' }, entries: [] });
    const session = getSession(id);

    expect(session).not.toBeNull();
    expect(session!.vault.maskedFiles['main.tf']).toBe('x');
  });

  it('returns null for an unknown session id', () => {
    expect(getSession('does-not-exist')).toBeNull();
  });

  it('clearSession removes the session', () => {
    const id = createSession({ maskedFiles: {}, entries: [] });
    clearSession(id);

    expect(getSession(id)).toBeNull();
  });

  it('auto-clears a session after 15 minutes of inactivity', () => {
    jest.useFakeTimers();
    const id = createSession({ maskedFiles: {}, entries: [] });

    jest.advanceTimersByTime(15 * 60 * 1000 + 1000);

    expect(getSession(id)).toBeNull();
  });

  it('touchSession resets the idle timer', () => {
    jest.useFakeTimers();
    const id = createSession({ maskedFiles: {}, entries: [] });

    jest.advanceTimersByTime(10 * 60 * 1000);
    touchSession(id);
    jest.advanceTimersByTime(10 * 60 * 1000);

    expect(getSession(id)).not.toBeNull(); // 20 min total elapsed, but touched at 10 min mark
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest validator.test.ts`
Expected: FAIL — `createSession` is not exported

- [ ] **Step 3: Write the implementation**

Append to `src/main/api/validator.ts`:

```typescript
const IDLE_TIMEOUT_MS = 15 * 60 * 1000;

interface ValidatorSession {
  vault: VaultResult;
  timer: ReturnType<typeof setTimeout>;
}

const sessions = new Map<string, ValidatorSession>();
let sessionCounter = 0;

export function createSession(vault: VaultResult): string {
  sessionCounter += 1;
  const id = `validator-session-${sessionCounter}`;
  const timer = setTimeout(() => sessions.delete(id), IDLE_TIMEOUT_MS);
  sessions.set(id, { vault, timer });
  return id;
}

export function getSession(id: string): ValidatorSession | null {
  return sessions.get(id) ?? null;
}

export function touchSession(id: string): void {
  const session = sessions.get(id);
  if (!session) return;
  clearTimeout(session.timer);
  session.timer = setTimeout(() => sessions.delete(id), IDLE_TIMEOUT_MS);
}

export function clearSession(id: string): void {
  const session = sessions.get(id);
  if (session) clearTimeout(session.timer);
  sessions.delete(id);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest validator.test.ts`
Expected: PASS (15/15)

- [ ] **Step 5: Commit**

```bash
git add src/main/api/validator.ts src/__tests__/validator.test.ts
git commit -m "feat(validator): add memory-only session store with 15-min idle timeout"
```

---

### Task 6: IPC handlers

**Files:**
- Modify: `src/main/ipc-handlers.ts`

Wires the four channels: `validator:open-files`, `validator:analyze`, `validator:export`, `validator:clear-session`. Follows the exact patterns already in this file for `sync:open-files` (dialog + multi-file read) and `file:save-project` (directory picker + multi-file write).

- [ ] **Step 1: Add the import**

At the top of `src/main/ipc-handlers.ts`, add alongside the other API imports:

```typescript
import { vaultProject, analyzeProject, exportProject, createSession, getSession, touchSession, clearSession } from './api/validator';
```

- [ ] **Step 2: Add the handlers**

Add this block after the `sync:stage-files` handler (after line ~531, before the `sync:deep-probe` handler):

```typescript
// Validator — file upload (.tf/.tfstate/.tfvars)
ipcMain.handle('validator:open-files', async () => {
  const { dialog } = await import('electron');
  const win = getMainWindow();
  if (!win) return null;
  const result = await dialog.showOpenDialog(win, {
    title: 'Select Terraform project files (.tf, .tfstate, .tfvars)',
    filters: [
      { name: 'Terraform Files', extensions: ['tf', 'tfstate', 'tfvars', 'json'] },
      { name: 'All Files', extensions: ['*'] },
    ],
    properties: ['openFile', 'multiSelections'],
  });
  if (result.canceled || !result.filePaths.length) return null;

  const files: Record<string, string> = {};
  for (const fp of result.filePaths) {
    files[path.basename(fp)] = fs.readFileSync(fp, 'utf-8');
  }

  if (!Object.keys(files).some(name => name.endsWith('.tf'))) {
    return { success: false, error: 'At least one .tf file is required.' };
  }

  const vault = vaultProject(files);
  const sessionId = createSession(vault);
  logger.info('validator', 'files vaulted', { sessionId, fileCount: Object.keys(files).length, entryCount: vault.entries.length });

  return {
    success: true,
    data: {
      sessionId,
      maskedFiles: vault.maskedFiles,
      // Real values never leave the main process — only tokens, kinds, and source locations.
      vaultSummary: vault.entries.map(e => ({ token: e.token, kind: e.kind, sourceFile: e.sourceFile, sourceAttr: e.sourceAttr })),
    },
  };
});

// Validator — AI analysis of masked files
ipcMain.handle('validator:analyze', async (_event, params: { sessionId: string }) => {
  try {
    const session = getSession(params.sessionId);
    if (!session) {
      return { success: false, error: 'Session expired or not found. Please re-upload your files.' };
    }
    touchSession(params.sessionId);

    logger.info('validator', 'analyze started', { sessionId: params.sessionId });
    const analysis = await analyzeProject(session.vault.maskedFiles);
    logger.info('validator', 'analyze complete', { sessionId: params.sessionId, findingCount: analysis.findings.length });

    return { success: true, data: analysis };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('validator', 'analyze failed', { error: message });
    return { success: false, error: message };
  }
});

// Validator — export fixed project (restores/promotes vaulted values, clears session)
ipcMain.handle('validator:export', async (_event, params: { sessionId: string; fixedMaskedFiles: Record<string, string> }) => {
  try {
    const session = getSession(params.sessionId);
    if (!session) {
      return { success: false, error: 'Session expired or not found. Please re-upload your files.' };
    }

    const { dialog } = await import('electron');
    const win = getMainWindow();
    if (!win) throw new Error('No window');

    const dirResult = await dialog.showOpenDialog(win, {
      title: 'Choose directory for validated Terraform project',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (dirResult.canceled || !dirResult.filePaths[0]) {
      return { success: false, error: 'Cancelled' };
    }

    const { files } = exportProject(params.fixedMaskedFiles, session.vault.entries);
    const dir = dirResult.filePaths[0];
    for (const [filename, content] of Object.entries(files)) {
      fs.writeFileSync(path.join(dir, filename), content, 'utf8');
    }

    clearSession(params.sessionId);
    logger.info('validator', 'export complete', { sessionId: params.sessionId, fileCount: Object.keys(files).length });

    return { success: true, data: dir };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('validator', 'export failed', { error: message });
    return { success: false, error: message };
  }
});

// Validator — explicit session clear (Discard / Start Over, or tab unmount)
ipcMain.handle('validator:clear-session', (_event, params: { sessionId: string }) => {
  clearSession(params.sessionId);
  return { success: true };
});
```

- [ ] **Step 3: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add src/main/ipc-handlers.ts
git commit -m "feat(validator): register IPC handlers for upload/analyze/export/clear"
```

---

### Task 7: Preload bridge

**Files:**
- Modify: `src/preload.ts`

- [ ] **Step 1: Add the bridge methods**

In `src/preload.ts`, add this block to the `api` object, after the `stageTfFiles` entry (near line 74):

```typescript
  // Validator
  validatorOpenFiles: () => ipcRenderer.invoke('validator:open-files'),
  validatorAnalyze: (sessionId: string) => ipcRenderer.invoke('validator:analyze', { sessionId }),
  validatorExport: (sessionId: string, fixedMaskedFiles: Record<string, string>) =>
    ipcRenderer.invoke('validator:export', { sessionId, fixedMaskedFiles }),
  validatorClearSession: (sessionId: string) => ipcRenderer.invoke('validator:clear-session', { sessionId }),
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/preload.ts
git commit -m "feat(validator): bridge validator IPC channels through preload"
```

---

### Task 8: ValidatorSection renderer component

**Files:**
- Create: `src/renderer/components/ValidatorSection.tsx`

Staged UI mirroring `SyncSection.tsx`'s pattern: upload → collapsible vault summary → analyze → findings report (Correctness then Optimization) → export → discard/start-over available at every stage.

- [ ] **Step 1: Write the component**

Create `src/renderer/components/ValidatorSection.tsx`:

```typescript
import React, { useState, useEffect, useRef } from 'react';
import { Finding } from '../../shared/types';

interface VaultSummaryEntry {
  token: string;
  kind: string;
  sourceFile: string;
  sourceAttr: string;
}

type Stage = 'upload' | 'ready' | 'analyzing' | 'reviewed' | 'exported';

const api = (window as unknown as {
  oktaTerraform: {
    validatorOpenFiles: () => Promise<{ success: boolean; data?: { sessionId: string; maskedFiles: Record<string, string>; vaultSummary: VaultSummaryEntry[] }; error?: string } | null>;
    validatorAnalyze: (sessionId: string) => Promise<{ success: boolean; data?: { findings: Finding[]; fixedMaskedFiles: Record<string, string> }; error?: string }>;
    validatorExport: (sessionId: string, fixedMaskedFiles: Record<string, string>) => Promise<{ success: boolean; data?: string; error?: string }>;
    validatorClearSession: (sessionId: string) => Promise<{ success: boolean }>;
  }
}).oktaTerraform;

const SEVERITY_STYLES: Record<Finding['severity'], string> = {
  error: 'bg-red-50 text-red-700 border-red-200',
  warning: 'bg-amber-50 text-amber-700 border-amber-200',
  suggestion: 'bg-blue-50 text-blue-700 border-blue-200',
};

export default function ValidatorSection() {
  const [stage, setStage] = useState<Stage>('upload');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [vaultSummary, setVaultSummary] = useState<VaultSummaryEntry[]>([]);
  const [vaultExpanded, setVaultExpanded] = useState(false);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [fixedMaskedFiles, setFixedMaskedFiles] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [exportedDir, setExportedDir] = useState<string | null>(null);

  // Mirrors sessionId in a ref so the unmount cleanup below always sees the latest value
  // without needing to re-run the effect (and re-register the listener) on every change.
  const sessionIdRef = useRef<string | null>(null);
  sessionIdRef.current = sessionId;

  useEffect(() => {
    return () => {
      if (sessionIdRef.current) {
        api.validatorClearSession(sessionIdRef.current);
      }
    };
  }, []);

  const handleUpload = async () => {
    setError(null);
    const result = await api.validatorOpenFiles();
    if (!result) return;
    if (!result.success || !result.data) {
      setError(result.error ?? 'Upload failed');
      return;
    }
    setSessionId(result.data.sessionId);
    setVaultSummary(result.data.vaultSummary);
    setStage('ready');
  };

  const handleAnalyze = async () => {
    if (!sessionId) return;
    setError(null);
    setStage('analyzing');
    const result = await api.validatorAnalyze(sessionId);
    if (!result.success || !result.data) {
      setError(result.error ?? 'Analysis failed');
      setStage('ready');
      return;
    }
    setFindings(result.data.findings);
    setFixedMaskedFiles(result.data.fixedMaskedFiles);
    setStage('reviewed');
  };

  const handleExport = async () => {
    if (!sessionId) return;
    setError(null);
    const result = await api.validatorExport(sessionId, fixedMaskedFiles);
    if (!result.success) {
      setError(result.error ?? 'Export failed');
      return;
    }
    setExportedDir(result.data ?? null);
    setStage('exported');
  };

  const handleDiscard = async () => {
    if (sessionId) await api.validatorClearSession(sessionId);
    setSessionId(null);
    setVaultSummary([]);
    setFindings([]);
    setFixedMaskedFiles({});
    setError(null);
    setExportedDir(null);
    setStage('upload');
  };

  const vaultCounts = vaultSummary.reduce<Record<string, number>>((acc, e) => {
    acc[e.kind] = (acc[e.kind] ?? 0) + 1;
    return acc;
  }, {});

  const correctnessFindings = findings.filter(f => f.category === 'correctness');
  const optimizationFindings = findings.filter(f => f.category === 'optimization');

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold text-text-primary">Validate Terraform Project</h1>
        <p className="text-xs text-text-muted mt-1">
          Upload your Terraform project for a PII-safe correctness and optimization review.
        </p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-xs rounded-lg p-3">{error}</div>
      )}

      {stage === 'upload' && (
        <div className="bg-surface-2 rounded-xl border border-border p-8 text-center space-y-3">
          <p className="text-text-secondary text-sm">Select your .tf, .tfstate, and .tfvars files to begin.</p>
          <button
            onClick={handleUpload}
            className="px-4 py-2 text-xs font-medium bg-accent-teal text-surface-0 hover:bg-accent-teal/90 rounded-lg transition-colors"
          >
            Select Files
          </button>
        </div>
      )}

      {stage !== 'upload' && (
        <div className="bg-surface-2 rounded-xl border border-border overflow-hidden">
          <button
            onClick={() => setVaultExpanded(!vaultExpanded)}
            className="w-full flex items-center justify-between px-4 py-3 text-left"
          >
            <span className="text-sm font-medium text-text-primary">
              {vaultSummary.length} value{vaultSummary.length === 1 ? '' : 's'} masked before analysis
              {Object.entries(vaultCounts).length > 0 && (
                <span className="text-text-muted"> ({Object.entries(vaultCounts).map(([kind, count]) => `${count} ${kind}`).join(', ')})</span>
              )}
            </span>
            <span className={`text-text-muted transition-transform ${vaultExpanded ? 'rotate-180' : ''}`}>&#9662;</span>
          </button>
          {vaultExpanded && (
            <div className="px-4 pb-3 border-t border-border text-xs font-mono text-text-muted space-y-1">
              {vaultSummary.map((e, i) => (
                <div key={i}>{e.token} &larr; {e.sourceAttr} in {e.sourceFile}</div>
              ))}
            </div>
          )}
        </div>
      )}

      {stage === 'ready' && (
        <button
          onClick={handleAnalyze}
          className="px-4 py-2 text-xs font-medium bg-accent-teal text-surface-0 hover:bg-accent-teal/90 rounded-lg transition-colors"
        >
          Analyze
        </button>
      )}

      {stage === 'analyzing' && (
        <div className="bg-surface-2 rounded-xl border border-border p-6 text-center text-text-secondary text-sm">
          Analyzing project...
        </div>
      )}

      {stage === 'reviewed' && (
        <div className="space-y-4">
          <FindingsGroup title="Correctness" findings={correctnessFindings} />
          <FindingsGroup title="Optimization" findings={optimizationFindings} />
          <button
            onClick={handleExport}
            className="px-4 py-2 text-xs font-medium bg-accent-teal text-surface-0 hover:bg-accent-teal/90 rounded-lg transition-colors"
          >
            Export Fixed Project
          </button>
        </div>
      )}

      {stage === 'exported' && exportedDir && (
        <div className="bg-green-50 border border-green-200 text-green-700 text-xs rounded-lg p-3">
          Exported to {exportedDir}
        </div>
      )}

      {stage !== 'upload' && (
        <button
          onClick={handleDiscard}
          className="px-3 py-1.5 text-xs font-medium text-text-muted hover:text-text-secondary bg-surface-3 hover:bg-surface-4 rounded-lg transition-colors"
        >
          Discard / Start Over
        </button>
      )}
    </div>
  );
}

function FindingsGroup({ title, findings }: { title: string; findings: Finding[] }) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const toggle = (id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  if (findings.length === 0) {
    return (
      <div>
        <h2 className="text-sm font-semibold text-text-primary mb-2">{title}</h2>
        <p className="text-xs text-text-muted">No {title.toLowerCase()} findings.</p>
      </div>
    );
  }

  return (
    <div>
      <h2 className="text-sm font-semibold text-text-primary mb-2">{title} ({findings.length})</h2>
      <div className="space-y-2">
        {findings.map(f => (
          <div key={f.id} className="bg-surface-2 rounded-lg border border-border overflow-hidden">
            <button onClick={() => toggle(f.id)} className="w-full flex items-center gap-2 px-3 py-2 text-left">
              <span className={`text-[10px] font-medium px-2 py-0.5 rounded border ${SEVERITY_STYLES[f.severity]}`}>
                {f.severity}
              </span>
              <span className="text-xs font-mono text-text-muted">{f.resourceAddress}</span>
              <span className="text-xs text-text-primary flex-1">{f.title}</span>
            </button>
            {expandedIds.has(f.id) && (
              <div className="px-3 pb-3 border-t border-border text-xs space-y-2">
                <p className="text-text-secondary pt-2">{f.explanation}</p>
                <pre className="bg-surface-3 rounded p-2 overflow-x-auto font-mono text-text-secondary">{f.fixedSnippet}</pre>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/renderer/components/ValidatorSection.tsx
git commit -m "feat(validator): add ValidatorSection UI component"
```

---

### Task 9: Dashboard integration

**Files:**
- Modify: `src/renderer/pages/DashboardPage.tsx`

- [ ] **Step 1: Add the import**

Add near the top with the other component imports:

```typescript
import ValidatorSection from '../components/ValidatorSection';
```

- [ ] **Step 2: Add `'validate'` to the `Section` type**

Change:

```typescript
type Section = 'rate-limits' | 'plan' | 'sync' | 'debug' | 'learn';
```

to:

```typescript
type Section = 'rate-limits' | 'plan' | 'sync' | 'validate' | 'debug' | 'learn';
```

- [ ] **Step 3: Add an icon**

In the `icons` object, add an entry after `sync` (before `debug`):

```typescript
  validate: (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 15l-4-4 1.4-1.4L9 12.2l5.6-5.6L16 8l-7 7z" />
      <circle cx="9" cy="9" r="7.5" />
    </svg>
  ),
```

- [ ] **Step 4: Add the nav item**

In `NAV_ITEMS`, add after `sync`:

```typescript
  { id: 'validate', label: 'Validate' },
```

- [ ] **Step 5: Add the render block**

In the `<main>` section, add alongside the other conditionally-rendered sections (after the `SyncSection` line):

```typescript
          <div className={activeSection === 'validate' ? '' : 'hidden'}><ValidatorSection /></div>
```

- [ ] **Step 6: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 7: Commit**

```bash
git add src/renderer/pages/DashboardPage.tsx
git commit -m "feat(validator): add Validate tab to dashboard navigation"
```

---

### Task 10: Full test suite + manual smoke test

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: all tests pass (existing suite + new `validator.test.ts`)

- [ ] **Step 2: Type-check the whole project**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Manual smoke test in the running app**

Run: `npm run dev`

In the app:
1. Click the **Validate** tab in the sidebar — confirm it appears between Sync and Debug
2. Click **Select Files**, choose a `.tf` file containing at least one Okta ID or email (e.g. a test fixture from `test-data/`)
3. Confirm the vault summary banner appears with a correct count, and expanding it shows tokens + source locations but never raw values
4. Click **Analyze** — confirm it calls out to Claude and returns to a Findings Report (requires a configured AI key per `docs/USAGE.md#ai-features`)
5. Confirm findings are grouped Correctness then Optimization
6. Click **Export Fixed Project**, choose a directory, confirm the exported `variables.tf` has declarations with `sensitive = true` and no `default`, and `terraform.tfvars` has the real values
7. Click **Discard / Start Over** on a fresh upload and confirm the UI resets cleanly

- [ ] **Step 4: Update docs**

Add a `## Terraform Validator` section to `docs/USAGE.md` (steps 1-6 above, condensed) and a bullet to `docs/FEATURES.md`'s feature list and Architecture component tree (`ValidatorSection.tsx`, `validator.ts`), per [[feedback_docs_before_push]] — docs must reflect the change before it's pushed.

- [ ] **Step 5: Final commit**

```bash
git add docs/USAGE.md docs/FEATURES.md
git commit -m "docs: document the Terraform Validator feature"
```
