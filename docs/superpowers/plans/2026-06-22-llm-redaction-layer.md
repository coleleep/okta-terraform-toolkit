# LLM Redaction Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Programmatically strip sensitive data (SSWS tokens, org URLs, Okta IDs, PII, OAuth secrets, signing keys) from all user-supplied content before it reaches any LLM call.

**Architecture:** A new pure function `redact(text: string): string` in `src/main/api/redact.ts` applies regex replacements in a fixed order. Each of the 5 LLM functions in `src/main/api/claude.ts` calls `redact()` on user-supplied content before assembling the prompt string. No other files change.

**Tech Stack:** TypeScript, Jest (ts-jest), Node.js main process (Electron)

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/main/api/redact.ts` | Create | Pure redaction function — all regex patterns live here |
| `src/__tests__/redact.test.ts` | Create | Unit tests for every pattern |
| `src/main/api/claude.ts` | Modify | Call `redact()` at 5 LLM call sites |

---

## Task 1: Create worktree

- [ ] **Step 1: Create a new worktree from the repo root**

```bash
git -C /Users/nicole.pendill/okta-terraform-toolkit worktree add .worktrees/llm-redaction-layer -b feat/llm-redaction-layer
```

- [ ] **Step 2: Verify clean**

```bash
git -C /Users/nicole.pendill/okta-terraform-toolkit/.worktrees/llm-redaction-layer status
```

Expected: `On branch feat/llm-redaction-layer` / `nothing to commit, working tree clean`

---

## Task 2: Build `redact.ts` with TDD

**Files:**
- Create: `src/__tests__/redact.test.ts`
- Create: `src/main/api/redact.ts`

Work from: `/Users/nicole.pendill/okta-terraform-toolkit/.worktrees/llm-redaction-layer`

- [ ] **Step 1: Write the failing tests**

Create `src/__tests__/redact.test.ts`:

```typescript
import { redact } from '../../main/api/redact';

describe('redact', () => {
  // Pattern 1: SSWS token
  it('redacts SSWS token and preserves scheme prefix', () => {
    expect(redact('Authorization: SSWS 00abcDEFGHIJKLMNOPQRSTUVWXYZ1234567890')).toBe(
      'Authorization: SSWS [SSWS_TOKEN]'
    );
  });

  // Pattern 2: Bearer token
  it('redacts Bearer token and preserves scheme prefix', () => {
    expect(redact('Authorization: Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9')).toBe(
      'Authorization: Bearer [BEARER_TOKEN]'
    );
  });

  // Pattern 3: Org URL with https://
  it('redacts org URL with https://', () => {
    expect(redact('connecting to https://dev-123456.okta.com/api/v1')).toBe(
      'connecting to [ORG_URL]/api/v1'
    );
  });

  // Pattern 3: Bare org domain
  it('redacts bare org domain without https://', () => {
    expect(redact('host: dev-123456.okta.com')).toBe('host: [ORG_URL]');
  });

  // Pattern 3: Preview org URL
  it('redacts oktapreview.com domain', () => {
    expect(redact('https://dev-999.oktapreview.com')).toBe('[ORG_URL]');
  });

  // Pattern 4: Okta user ID
  it('redacts Okta user ID', () => {
    expect(redact('GET /api/v1/users/00u1A2B3C4D5E6F7G8H')).toBe(
      'GET /api/v1/users/[OKTA_ID]'
    );
  });

  // Pattern 4: Okta group ID
  it('redacts Okta group ID', () => {
    expect(redact('group_id = "00g1A2B3C4D5E6F7G8H"')).toBe(
      'group_id = "[OKTA_ID]"'
    );
  });

  // Pattern 4: Okta app ID
  it('redacts Okta app ID (0oa prefix)', () => {
    expect(redact('app_id = "0oa1A2B3C4D5E6F7G8H"')).toBe(
      'app_id = "[OKTA_ID]"'
    );
  });

  // Pattern 5: Email address
  it('redacts email address', () => {
    expect(redact('email = "alice@example.com"')).toBe('email = "[EMAIL]"');
  });

  // Pattern 6: HCL firstName field
  it('redacts HCL firstName value but preserves key', () => {
    expect(redact('firstName = "Alice"')).toBe('firstName = "[REDACTED_VALUE]"');
  });

  // Pattern 6: HCL login field
  it('redacts HCL login value but preserves key', () => {
    expect(redact('login = "alice@corp.com"')).toBe('login = "[REDACTED_VALUE]"');
  });

  // Pattern 6: HCL displayName field
  it('redacts HCL displayName value but preserves key', () => {
    expect(redact('displayName = "Alice Smith"')).toBe('displayName = "[REDACTED_VALUE]"');
  });

  // Pattern 7: OAuth client secret in HCL
  it('redacts client_secret value but preserves key', () => {
    expect(redact('client_secret = "supersecretvalue12345"')).toBe(
      'client_secret = "[CLIENT_SECRET]"'
    );
  });

  // Pattern 8: JWT token (3-part base64url)
  it('redacts standalone JWT token', () => {
    const jwt = 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkFsaWNlIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
    expect(redact(`id_token: ${jwt}`)).toBe('id_token: [JWT_TOKEN]');
  });

  // Pattern 9: PEM key block
  it('redacts PEM private key block', () => {
    const pem = '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA1234567890abcdef\n-----END RSA PRIVATE KEY-----';
    expect(redact(pem)).toBe('[PEM_KEY]');
  });

  // Mixed content
  it('redacts multiple patterns in one string', () => {
    const input = [
      'POST https://dev-123456.okta.com/api/v1/users',
      'Authorization: SSWS 00abcDEFGHIJKLMNOPQRSTUVWXYZ1234567890',
      'email: admin@company.com',
    ].join('\n');
    const result = redact(input);
    expect(result).not.toContain('dev-123456.okta.com');
    expect(result).not.toContain('00abcDEFGHIJKLMNOPQRSTUVWXYZ1234567890');
    expect(result).not.toContain('admin@company.com');
    expect(result).toContain('[ORG_URL]');
    expect(result).toContain('SSWS [SSWS_TOKEN]');
    expect(result).toContain('[EMAIL]');
  });

  // Clean passthrough
  it('returns clean Terraform content unchanged', () => {
    const clean = 'resource "okta_group" "engineers" {\n  name        = "Engineers"\n  description = "Engineering team"\n}';
    expect(redact(clean)).toBe(clean);
  });

  // Defensive: non-string input
  it('returns non-string input unchanged', () => {
    expect(redact(null as any)).toBeNull();
    expect(redact(undefined as any)).toBeUndefined();
    expect(redact(42 as any)).toBe(42);
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npx jest src/__tests__/redact.test.ts --no-coverage
```

Expected: `Cannot find module '../../main/api/redact'` or similar — tests fail because the module doesn't exist yet.

- [ ] **Step 3: Create `src/main/api/redact.ts`**

```typescript
const PATTERNS: Array<[RegExp, string]> = [
  // 1. SSWS token — preserve scheme prefix so auth context is readable
  [/SSWS\s+[A-Za-z0-9_\-]{20,}/g, 'SSWS [SSWS_TOKEN]'],
  // 2. Bearer token — preserve scheme prefix
  [/Bearer\s+[A-Za-z0-9._\-]{20,}/g, 'Bearer [BEARER_TOKEN]'],
  // 3. Okta org URL — with or without https://, including oktapreview.com
  [/(?:https?:\/\/)?[a-zA-Z0-9\-]+\.okta(?:preview)?\.com/g, '[ORG_URL]'],
  // 4. Okta resource IDs: 00u/00g/00p (users/groups/policies) and 0oa (apps)
  [/(?:00[a-zA-Z]|0oa)[A-Za-z0-9]{17}/g, '[OKTA_ID]'],
  // 5. Email addresses
  [/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g, '[EMAIL]'],
  // 6. HCL profile PII fields — replace value, preserve key name
  [/(firstName|lastName|displayName|login|mobilePhone|primaryPhone)\s*=\s*"[^"]+"/g, '$1 = "[REDACTED_VALUE]"'],
  // 7. OAuth client secret in HCL
  [/client_secret\s*=\s*"[^"]+"/g, 'client_secret = "[CLIENT_SECRET]"'],
  // 8. JWT tokens: 3 base64url segments of ≥20 chars each (avoids Terraform reference false positives)
  [/[A-Za-z0-9_\-]{20,}\.[A-Za-z0-9_\-]{20,}\.[A-Za-z0-9_\-]{20,}/g, '[JWT_TOKEN]'],
  // 9. PEM key blocks
  [/-----BEGIN [A-Z ]+-----[\s\S]+?-----END [A-Z ]+-----/g, '[PEM_KEY]'],
];

export function redact(text: string): string {
  if (typeof text !== 'string') return text;
  let result = text;
  for (const [pattern, replacement] of PATTERNS) {
    result = result.replace(pattern, replacement);
  }
  return result;
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npx jest src/__tests__/redact.test.ts --no-coverage
```

Expected: all 18 tests pass, 0 failures.

- [ ] **Step 5: Run full test suite to confirm no regressions**

```bash
npm test
```

Expected: all 3 test suites pass (43 existing + 18 new = 61 total).

- [ ] **Step 6: Commit**

```bash
git add src/main/api/redact.ts src/__tests__/redact.test.ts
git commit -m "feat: redact() — strip sensitive data before LLM calls"
```

---

## Task 3: Apply `redact()` in `claude.ts` at all 5 LLM call sites

**File:** Modify `src/main/api/claude.ts`

Work from: `/Users/nicole.pendill/okta-terraform-toolkit/.worktrees/llm-redaction-layer`

There are no new tests for this task — `redact.ts` is already unit tested. The change here is purely wiring. Run the full test suite after to confirm nothing broke.

- [ ] **Step 1: Add `redact` import at the top of `claude.ts`**

After the existing imports (around line 11), add:

```typescript
import { redact } from './redact';
```

- [ ] **Step 2: Apply `redact()` in `interpretLog`**

`interpretLog` is at line 199. The user content is `JSON.stringify(analysis, null, 2)` embedded in the prompt at line 209.

Find this block inside `interpretLog`:
```typescript
  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    system: `${LOG_SYSTEM_PROMPT}\n\n${scopeContext}`,
    messages: [{
      role: 'user',
      content: `Analyze this Terraform run:\n\n${JSON.stringify(analysis, null, 2)}\n\nRespond with the JSON object only.`,
    }],
  });
```

Replace with:
```typescript
  const cleanAnalysis = redact(JSON.stringify(analysis, null, 2));
  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    system: `${LOG_SYSTEM_PROMPT}\n\n${scopeContext}`,
    messages: [{
      role: 'user',
      content: `Analyze this Terraform run:\n\n${cleanAnalysis}\n\nRespond with the JSON object only.`,
    }],
  });
```

- [ ] **Step 3: Apply `redact()` in `buildWorkload`**

`buildWorkload` is at line 251. The user content is the `description` parameter, used at line 261 as `content: description`.

Find this block inside `buildWorkload`:
```typescript
    messages: [{
      role: 'user',
      content: description,
    }],
```

Replace with:
```typescript
    messages: [{
      role: 'user',
      content: redact(description),
    }],
```

- [ ] **Step 4: Apply `redact()` in `decodeError`**

`decodeError` is at line 336. The user content is `errorText`, embedded in the prompt at line 345.

Find this block inside `decodeError`:
```typescript
    messages: [{
      role: 'user',
      content: `Decode this Terraform/Okta error:\n\n${errorText}\n\nRespond with the JSON object only.`,
    }],
```

Replace with:
```typescript
    messages: [{
      role: 'user',
      content: `Decode this Terraform/Okta error:\n\n${redact(errorText)}\n\nRespond with the JSON object only.`,
    }],
```

- [ ] **Step 5: Apply `redact()` in `generateSolution`**

`generateSolution` is at line 425. The user content is `description`, embedded in the prompt at line 435.

Find this block inside `generateSolution`:
```typescript
    messages: [{
      role: 'user',
      content: `Provider version: ${providerVersion}\n\nUser request: ${description}`,
    }],
```

Replace with:
```typescript
    messages: [{
      role: 'user',
      content: `Provider version: ${providerVersion}\n\nUser request: ${redact(description)}`,
    }],
```

- [ ] **Step 6: Apply `redact()` in `convertConfig`**

`convertConfig` is at line 508. Three pieces of user content reach the prompt:
- `tfContent` (the original .tf file content)
- `targetOrgUrl` (the target org URL)
- `matchContext` (built from `resourceMatches`, assembled at line 541)

Find the line where `matchContext` is finalized (after the loop that builds `matchLines`):
```typescript
  const matchContext = matchLines.join('\n');
```

Add immediately after it:
```typescript
  const cleanTfContent = redact(tfContent);
  const cleanTargetOrgUrl = redact(targetOrgUrl);
  const cleanMatchContext = redact(matchContext);
```

Then find the user message content (line 652):
```typescript
      content: `Target org: ${targetOrgUrl}\n\nResource mapping:\n${matchContext}\n\nOriginal .tf configuration:\n${tfContent}`,
```

Replace with:
```typescript
      content: `Target org: ${cleanTargetOrgUrl}\n\nResource mapping:\n${cleanMatchContext}\n\nOriginal .tf configuration:\n${cleanTfContent}`,
```

- [ ] **Step 7: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 8: Run full test suite**

```bash
npm test
```

Expected: all test suites pass, 61 tests total (43 original + 18 redact).

- [ ] **Step 9: Commit**

```bash
git add src/main/api/claude.ts
git commit -m "feat: apply redact() at all 5 LLM call sites in claude.ts"
```

---

## Task 4: Merge to main and push

- [ ] **Step 1: Switch to main and pull**

```bash
git -C /Users/nicole.pendill/okta-terraform-toolkit checkout main
git -C /Users/nicole.pendill/okta-terraform-toolkit pull
```

- [ ] **Step 2: Merge feature branch**

```bash
git -C /Users/nicole.pendill/okta-terraform-toolkit merge feat/llm-redaction-layer
```

- [ ] **Step 3: Run tests on merged result**

```bash
cd /Users/nicole.pendill/okta-terraform-toolkit && npm test
```

Expected: all 61 tests pass.

- [ ] **Step 4: Push main, clean up**

```bash
git -C /Users/nicole.pendill/okta-terraform-toolkit push origin main
git -C /Users/nicole.pendill/okta-terraform-toolkit worktree remove .worktrees/llm-redaction-layer
git -C /Users/nicole.pendill/okta-terraform-toolkit branch -d feat/llm-redaction-layer
```
