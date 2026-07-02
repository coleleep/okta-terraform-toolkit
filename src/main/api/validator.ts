import { getClient } from './claude';
import { RESOURCE_DICTIONARY } from '../../shared/resource-dictionary';
import { VaultEntry, VaultResult, Finding, ValidatorAnalysis } from '../../shared/types';

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

export interface ExportResult {
  files: Record<string, string>; // filename -> final content, ready to write to disk
}

export function exportProject(
  maskedFiles: Record<string, string>,
  entries: VaultEntry[],
): ExportResult {
  const files: Record<string, string> = { ...maskedFiles };
  const usedVarNames = new Set<string>();
  const declarationsToAdd: string[] = [];
  const tfvarsAssignmentsToAdd: string[] = [];

  // Seed usedVarNames with variable names already declared in an existing
  // variables.tf (e.g. uploaded by the user, or left over from a prior
  // export). Without this, a freshly generated name like "app_id_1" could
  // collide with a pre-existing declaration of the same name, producing
  // invalid HCL (duplicate variable declaration).
  const existingVariablesTfForScan = files['variables.tf'] ?? '';
  for (const match of existingVariablesTfForScan.matchAll(/variable\s+"([^"]+)"/g)) {
    usedVarNames.add(match[1]);
  }

  const tfFilenames = Object.keys(files).filter((f) => f.endsWith('.tf'));

  for (const entry of entries) {
    // The promote/restore decision must be based on where the token actually
    // appears in the project, not on entry.sourceFile — vaultProject dedups by
    // VALUE across the whole project, so a single entry's sourceFile only
    // reflects whichever file the value was first encountered in. If the same
    // value also appears in a .tfvars file, that occurrence still needs the
    // real value restored, never a var. reference (tfvars files can't
    // reference variables) — and it must not be left as an unreplaced token.
    const needsPromotion = tfFilenames.some((filename) => files[filename].includes(entry.token));

    if (needsPromotion) {
      // Promote: derive a unique variable name from sourceAttr.
      let baseName = entry.sourceAttr.replace(/[^a-zA-Z0-9_]/g, '_') || 'value';
      let counter = 1;
      let varName = `${baseName}_${counter}`;
      while (usedVarNames.has(varName)) {
        counter += 1;
        varName = `${baseName}_${counter}`;
      }
      usedVarNames.add(varName);

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

    // Regardless of promotion, any occurrence of this token in a .tfvars file
    // gets the real value restored in place — a .tfvars file must never end
    // up with a var. reference or a leftover literal token.
    for (const [filename, content] of Object.entries(files)) {
      if (!filename.endsWith('.tfvars')) continue;
      if (content.includes(entry.token)) {
        files[filename] = content.split(entry.token).join(entry.value);
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
