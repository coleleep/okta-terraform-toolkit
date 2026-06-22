const PATTERNS: Array<[RegExp, string]> = [
  // 1. SSWS token — preserve scheme prefix so auth context is readable
  [/SSWS\s+[A-Za-z0-9_\-]{20,}/g, 'SSWS [SSWS_TOKEN]'],
  // 2. Bearer token — preserve scheme prefix
  [/Bearer\s+[A-Za-z0-9._\-]{20,}/g, 'Bearer [BEARER_TOKEN]'],
  // 3. Okta org URL — with or without https://, including multi-segment subdomains and oktapreview.com
  [/(?:https?:\/\/)?[a-zA-Z0-9\-]+(?:\.[a-zA-Z0-9\-]+)*\.okta(?:preview)?\.com/g, '[ORG_URL]'],
  // 4. Okta resource IDs: 00u/00g/00p (users/groups/policies) and 0oa (apps)
  [/(?:00[a-zA-Z]|0oa)[A-Za-z0-9]{17}/g, '[OKTA_ID]'],
  // 5. Email addresses
  [/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g, '[EMAIL]'],
  // 6. HCL profile PII — runs after email (pattern 5) so `login = "email"` becomes [REDACTED_VALUE] not [EMAIL]
  [/(firstName|lastName|displayName|login|mobilePhone|primaryPhone)\s*=\s*"[^"]+"/g, '$1 = "[REDACTED_VALUE]"'],
  // 7. OAuth client secret in HCL
  [/client_secret\s*=\s*"[^"]+"/g, 'client_secret = "[CLIENT_SECRET]"'],
  // 8. JWT tokens: 3 base64url segments of ≥20 chars each (avoids Terraform reference false positives)
  [/[A-Za-z0-9_\-]{20,}\.[A-Za-z0-9_\-]{20,}\.[A-Za-z0-9_\-]{20,}/g, '[JWT_TOKEN]'],
  // 9. PEM key blocks
  [/-----BEGIN [A-Z ]+-----[\s\S]+?-----END [A-Z ]+-----/g, '[PEM_KEY]'],
];

export function redact(text: string): string {
  let result = text;
  for (const [pattern, replacement] of PATTERNS) {
    result = result.replace(pattern, replacement);
  }
  return result;
}
