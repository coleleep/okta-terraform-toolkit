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
    regex: /(\w+)\s*=\s*"((?:00[a-zA-Z]|0oa)[A-Za-z0-9]{17})"/g,
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
