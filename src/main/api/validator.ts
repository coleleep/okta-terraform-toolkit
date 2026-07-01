import { VaultEntry, VaultResult } from '../../shared/types';

type VaultKind = VaultEntry['kind'];

interface VaultPattern {
  kind: VaultKind;
  // Matches the full text to mask. Capture group 1 is the attribute name and
  // group 2 is the sensitive value, in the shape `attr = "value"`.
  // Currently every pattern requires this shape (attr is always present);
  // documented per-field below in case that assumption changes later.
  regex: RegExp;
  // Extracts just the sensitive value from a match, given the full match and its groups.
  extractValue: (match: RegExpMatchArray) => string;
  // Extracts the attribute name (capture group 1). Always required today —
  // all 8 patterns match "attr = "value"" — but kept as its own field in
  // case a future pattern needs to derive/default the attribute differently.
  extractAttr: (match: RegExpMatchArray) => string;
}

// Matches tokens this module itself generates, e.g. "{{OKTA_ID_1}}".
// Used to detect "this value is already a token we inserted" without
// falsely matching a legitimate value that merely contains literal "{{"
// (e.g. an unrelated Terraform template placeholder).
const GENERATED_TOKEN_SHAPE = /^\{\{[A-Z_]+_\d+\}\}$/;

// HCL attribute names are realistically well under 100 characters. Bounding
// this quantifier (instead of leaving it as unbounded \w+) matters for more
// than tidiness: an unbounded \w+ prefix combined with a value pattern that
// fails to find its closing delimiter (e.g. a truncated PEM/JWT, or any
// unterminated string) causes the regex engine to retry the ENTIRE pattern
// starting at every word-character position in the remaining input — this is
// what caused multi-second-to-tens-of-seconds hangs on large inputs across
// several of the patterns below, not just the two flagged in review.
const ATTR = '\\w{1,100}';

const VAULT_PATTERNS: VaultPattern[] = [
  {
    kind: 'okta_id',
    regex: new RegExp(`(${ATTR})\\s*=\\s*"((?:00[a-zA-Z]|0oa)[A-Za-z0-9]{17})"`, 'g'),
    extractValue: (m) => m[2],
    extractAttr: (m) => m[1],
  },
  {
    kind: 'org_url',
    regex: new RegExp(
      `(${ATTR})\\s*=\\s*"((?:https?:\\/\\/)?[a-zA-Z0-9\\-]+(?:\\.[a-zA-Z0-9\\-]+)*\\.okta(?:preview)?\\.com)"`,
      'g'
    ),
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
    regex: new RegExp(
      `(${ATTR})\\s*=\\s*"([a-zA-Z0-9._%+\\-]+@[a-zA-Z0-9.\\-]+\\.[a-zA-Z]{2,})"`,
      'g'
    ),
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
    // Segment lengths are intentionally left uncapped (only a lower bound of
    // 20 chars, to avoid false positives on short dotted strings). An earlier
    // version capped each segment at 5000 chars as defense-in-depth against
    // ReDoS, but real large Okta JWTs (e.g. a token with a `groups` claim
    // covering hundreds of groups) can have a payload segment well beyond
    // 5000 chars — that cap silently failed to match those tokens, leaving
    // them unmasked and sent to the LLM in plaintext, which is worse than
    // the ReDoS hang it was meant to prevent. Benchmarking confirmed the
    // ATTR bound above (\w{1,100}) is what actually prevents the exponential
    // backtracking blowup on unterminated input; removing this cap keeps a
    // 200KB malformed/unterminated input completing in well under 1 second.
    regex: new RegExp(
      `(${ATTR})\\s*=\\s*"([A-Za-z0-9_\\-]{20,}\\.[A-Za-z0-9_\\-]{20,}\\.[A-Za-z0-9_\\-]{20,})"`,
      'g'
    ),
    extractValue: (m) => m[2],
    extractAttr: (m) => m[1],
  },
  {
    kind: 'token',
    regex: new RegExp(`(${ATTR})\\s*=\\s*"((?:SSWS|Bearer)\\s+[A-Za-z0-9_.\\-]{20,})"`, 'g'),
    extractValue: (m) => m[2],
    extractAttr: (m) => m[1],
  },
  {
    kind: 'pem_key',
    // The PEM body length is intentionally left uncapped. An earlier version
    // capped it at 10000 chars as defense-in-depth against ReDoS, but a
    // legitimate multi-cert chain (e.g. a `ca_bundle` or `certificate_chain`
    // attribute holding a CA bundle, cross-signed intermediates, or an mTLS
    // chain — six or more concatenated PEM blocks is an ordinary shape for
    // these) can easily exceed 10KB. That cap silently failed to match such
    // chains, leaving the certificate material unmasked and sent to the LLM
    // in plaintext, which is worse than the ReDoS hang it was meant to
    // prevent (same failure mode fixed for the jwt pattern above). Benchmarking
    // confirmed the ATTR bound above (\w{1,100}) is what actually prevents the
    // exponential backtracking blowup on unterminated input; removing this cap
    // keeps a 200KB malformed/unterminated PEM completing in well under 1 second.
    regex: new RegExp(
      `(${ATTR})\\s*=\\s*"(-----BEGIN [A-Z ]+-----[\\s\\S]+?-----END [A-Z ]+-----)"`,
      'g'
    ),
    extractValue: (m) => m[2],
    extractAttr: (m) => m[1],
  },
];

export function vaultProject(files: Record<string, string>): VaultResult {
  // Map from real value -> token, so the same value gets one token across the whole project.
  const valueToToken = new Map<string, string>();
  const entries: VaultEntry[] = [];
  const tokenCounters: Record<VaultKind, number> = {
    okta_id: 0,
    org_url: 0,
    token: 0,
    client_secret: 0,
    email: 0,
    jwt: 0,
    pem_key: 0,
    hcl_pii_attr: 0,
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
        // GENERATED_TOKEN_SHAPE checks whether `value` IS a token we already generated
        // (e.g. "{{EMAIL_1}}"), as opposed to a legitimate value that merely happens to
        // contain the literal substring "{{" (e.g. an unrelated Terraform template
        // placeholder) — the latter must still be masked, not silently skipped.
        if (!GENERATED_TOKEN_SHAPE.test(value)) {
          const token = tokenFor(pattern.kind, value, filename, attr);
          // Reconstruct the replacement directly from the known "attr = "value""
          // structure instead of searching for `value` as a substring inside
          // match[0] — a substring search can match the wrong occurrence (e.g.
          // the attribute name itself, when attr and value are equal strings,
          // as in `client_secret = "client_secret"`), leaving the real secret
          // unmasked in plaintext.
          return `${attr} = "${token}"`;
        }
        return match[0];
      });
    }
    maskedFiles[filename] = masked;
  }

  return { maskedFiles, entries };
}
