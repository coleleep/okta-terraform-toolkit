# LLM Redaction Layer — Design Spec

**Date:** 2026-06-22  
**Branch:** `feat/llm-redaction-layer`  
**Status:** Approved, ready for implementation

---

## Problem

User-supplied content (TF_LOG files, HCL/tfstate files, error text, workload descriptions) flows directly into LLM prompts with no sanitization. Sensitive data — SSWS tokens, org URLs, Okta resource IDs, user PII, OAuth secrets, signing keys — can reach the Anthropic API. This must be eliminated before any content touches the LLM.

---

## Goals

- Programmatically redact all known sensitive patterns before any LLM call
- Replace sensitive values with typed placeholders so the LLM retains structural context
- Silent enforcement — no user-facing UI, no preview, just happens automatically
- Pure, testable function with no side effects

---

## Non-Goals

- Redaction preview UI (separate future item)
- AI call audit log (separate future item)
- Catching free-text names not in known HCL profile fields (not reliably detectable with regex)
- Renderer-side redaction (enforcement lives in main process only)

---

## Architecture

### New File

**`src/main/api/redact.ts`**

Single exported function:

```ts
export function redact(text: string): string
```

Pure function. No imports from the rest of the codebase. Applies regex replacements in a fixed order. Returns the sanitized string. If input is not a string, returns input unchanged (defensive, no crash).

### Modified File

**`src/main/api/claude.ts`** — each of the 5 LLM functions calls `redact()` on user-supplied content before the prompt is assembled.

| Function | Field(s) redacted |
|----------|-------------------|
| `interpretLog(analysis)` | Serialized `analysis` JSON |
| `decodeError(errorText)` | `errorText` |
| `buildWorkload(description)` | `description` |
| `generateSolution(description, providerVersion)` | `description` |
| `convertConfig(tfContent, resourceMatches, targetOrgUrl)` | `tfContent`, `targetOrgUrl`, serialized `resourceMatches` |

### New Test File

**`src/__tests__/redact.test.ts`**

---

## Redaction Patterns

Applied in this order (tokens → URLs → IDs → PII → secrets → keys):

| # | Pattern | Regex | Placeholder |
|---|---------|-------|-------------|
| 1 | SSWS token | `SSWS\s+[A-Za-z0-9_\-]{20,}` | `SSWS [SSWS_TOKEN]` |
| 2 | Bearer token | `Bearer\s+[A-Za-z0-9._\-]{20,}` | `Bearer [BEARER_TOKEN]` |
| 3 | Okta org URL | `(?:https?://)?[a-zA-Z0-9\-]+\.okta(?:preview)?\.com` | `[ORG_URL]` |
| 4 | Okta resource IDs | `00[a-zA-Z][A-Za-z0-9]{17}` | `[OKTA_ID]` |
| 5 | Email addresses | `[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}` | `[EMAIL]` |
| 6 | HCL profile PII fields | `(firstName\|lastName\|displayName\|login\|mobilePhone\|primaryPhone)\s*=\s*"[^"]+"` | `$1 = "[REDACTED_VALUE]"` |
| 7 | OAuth client secret in HCL | `client_secret\s*=\s*"[^"]+"` | `client_secret = "[CLIENT_SECRET]"` |
| 8 | JWT tokens | `[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}` | `[JWT_TOKEN]` |
| 9 | PEM key blocks | `-----BEGIN [A-Z ]+-----[\s\S]+?-----END [A-Z ]+-----` | `[PEM_KEY]` |

**Order rationale:** SSWS/Bearer replacements preserve the scheme prefix (e.g., `Authorization: SSWS [SSWS_TOKEN]`) so the LLM retains auth context. Tokens are replaced before URLs to avoid partial matches. IDs before emails to avoid regex overlap on ID-containing strings.

---

## Data Flow

```
user content (file/text)
  → IPC handler
  → claude.ts function
  → redact(userContent)        ← NEW
  → sanitized content
  → prompt assembly
  → Anthropic API call
```

The original value is never stored, logged, or passed beyond the `redact()` call.

---

## Error Handling

`redact()` is a pure string transform — it cannot throw. Defensive guard: if input is not a string, return it unchanged. The LLM call proceeds regardless; a failed redaction is not a reason to surface an error to the user.

---

## Testing

**File:** `src/__tests__/redact.test.ts`

One test per pattern, plus mixed-content and clean-passthrough tests:

1. SSWS token in an Authorization header → replaced, prefix preserved
2. Bearer token in a header → replaced, prefix preserved
3. Org URL with `https://` → replaced
4. Org URL without `https://` (bare domain) → replaced
5. Okta user ID (`00u...`) in an API path → replaced
6. Okta group ID (`00g...`) → replaced
7. Okta app ID (`0oa...`) → replaced
8. Email address → replaced
9. HCL `firstName` field → value replaced, key preserved
10. HCL `login` field → value replaced, key preserved
11. `client_secret` in HCL → value replaced, key preserved
12. JWT token string → replaced
13. PEM key block → replaced
14. Mixed content with multiple pattern types → all replaced
15. Clean content with no sensitive data → returned unchanged
