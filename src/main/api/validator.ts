import { getClient } from './claude';
import { VaultEntry, VaultResult, Finding, ValidatorAnalysis } from '../../shared/types';
import { loadSchema } from '../../shared/schema-loader';
import type { ProviderSchema, ResourceSchema } from '../../shared/provider-schemas/schema-types';

type VaultKind = VaultEntry['kind'];

type AttrValueGroups = Record<string, string | undefined>;

interface VaultPattern {
  kind: VaultKind;
  // Matches the full text to mask, in either HCL (`attr = "value"`) or JSON
  // (`"attr": "value"`) shape — see attrValuePattern(). Uses named capture
  // groups (hclAttr/hclVal vs jsonAttr/jsonVal) so extractAttr/extractValue
  // can tell which syntax matched.
  regex: RegExp;
  // Matches the same attribute name, but array-valued: `attr = [...]` (HCL)
  // or `"attr": [...]` (JSON) — see attrArrayPattern(). The body is
  // re-scanned per-element using valuePattern below, since one array can mix
  // PII and non-PII elements.
  arrayRegex: RegExp;
  // The raw value-pattern source (same one baked into `regex`), reused to
  // build a per-element regex against an array body.
  valuePattern: string;
  // Extracts just the sensitive value from the named capture groups.
  extractValue: (groups: AttrValueGroups) => string;
  // Extracts the attribute name from the named capture groups.
  extractAttr: (groups: AttrValueGroups) => string;
  // For value shapes specific enough to be unambiguous on their own (an Okta
  // ID, an org URL, an email, a JWT, an SSWS/Bearer token, a PEM block) —
  // matches the bare valuePattern anywhere in the raw text, not just when the
  // whole quoted value equals it. Real .tfstate content routinely embeds
  // these as substrings of a larger JSON- or XML-encoded string (e.g. the
  // `links`, `metadata`, `embed_url` attributes Okta's provider produces),
  // where the attr="value" shape never matches at all. Patterns whose value
  // shape is generic (client_secret, hcl_pii_attr — both use `[^"]+`) must
  // stay attribute-anchored; scanning those anywhere would mask arbitrary
  // strings.
  bareRegex: RegExp | null;
}

// Builds a regex source matching `attrPattern = "valuePattern"` (HCL) or
// `"attrPattern": "valuePattern"` (JSON, as used by .tfstate). Both branches
// share the same value pattern and ATTR-style bounding, so the ReDoS defense
// documented on ATTR below applies equally to the JSON branch.
function attrValuePattern(attrPattern: string, valuePattern: string): string {
  return (
    `(?:(?<hclAttr>${attrPattern})\\s*=\\s*"(?<hclVal>${valuePattern})")` +
    `|` +
    `(?:"(?<jsonAttr>${attrPattern})"\\s*:\\s*"(?<jsonVal>${valuePattern})")`
  );
}

// Builds a regex source matching `attrPattern = [...]` (HCL) or
// `"attrPattern": [...]` (JSON) array-valued attributes. The array body is
// captured whole (hclArrBody/jsonArrBody) and re-scanned per-element in
// vaultProject. Bounding the body to "no ] character" (rather than a lazy
// match through arbitrary content) keeps this linear-time even on a
// malformed, unterminated array — same rationale as the ATTR bound below.
function attrArrayPattern(attrPattern: string): string {
  return (
    `(?:(?<hclArrAttr>${attrPattern})\\s*=\\s*\\[(?<hclArrBody>[^\\]]*)\\])` +
    `|` +
    `(?:"(?<jsonArrAttr>${attrPattern})"\\s*:\\s*\\[(?<jsonArrBody>[^\\]]*)\\])`
  );
}

function extractAttrGroup(g: AttrValueGroups): string {
  return (g.hclAttr ?? g.jsonAttr)!;
}

function extractValueGroup(g: AttrValueGroups): string {
  return (g.hclVal ?? g.jsonVal)!;
}

function extractArrAttrGroup(g: AttrValueGroups): string {
  return (g.hclArrAttr ?? g.jsonArrAttr)!;
}

function extractArrBodyGroup(g: AttrValueGroups): string {
  return (g.hclArrBody ?? g.jsonArrBody)!;
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

// Builds both the scalar and array-valued regex for a pattern from the same
// attrPattern/valuePattern, so the two can never drift out of sync (e.g. one
// getting a value-length cap added without the other). scanAnywhere adds a
// bareRegex matching valuePattern anywhere in the raw text (see VaultPattern
// above) — only pass true for value shapes specific enough not to need
// attribute context.
function makeVaultPattern(
  kind: VaultKind,
  attrPattern: string,
  valuePattern: string,
  scanAnywhere = false
): VaultPattern {
  return {
    kind,
    regex: new RegExp(attrValuePattern(attrPattern, valuePattern), 'g'),
    arrayRegex: new RegExp(attrArrayPattern(attrPattern), 'g'),
    valuePattern,
    extractValue: extractValueGroup,
    extractAttr: extractAttrGroup,
    bareRegex: scanAnywhere ? new RegExp(valuePattern, 'g') : null,
  };
}

// Order matters: patterns whose value can legitimately span many KB (jwt,
// token, pem_key) run FIRST so they fully tokenize their own attribute's
// value before any scanAnywhere pass below gets a chance to match a
// coincidental substring inside it (e.g. a 20-char lowercase-alnum run
// inside a large JWT payload looks exactly like an Okta ID). Once such a
// value is replaced by its token, its curly braces break every later
// pattern's charset, so order — not luck — is what prevents cross-pattern
// clobbering.
const VAULT_PATTERNS: VaultPattern[] = [
  // jwt: segment lengths are intentionally left uncapped in the
  // attr-anchored pattern (only a lower bound of 20 chars, to avoid false
  // positives on short dotted strings). An earlier version capped each
  // segment at 5000 chars as defense-in-depth against ReDoS, but real large
  // Okta JWTs (e.g. a token with a `groups` claim covering hundreds of
  // groups) can have a payload segment well beyond 5000 chars — that cap
  // silently failed to match those tokens, leaving them unmasked and sent to
  // the LLM in plaintext, which is worse than the ReDoS hang it was meant to
  // prevent. The ATTR bound above (\w{1,100}) is what actually prevents the
  // exponential backtracking blowup on unterminated input — but that
  // protection comes from the attr="..." prefix being cheap to fail almost
  // everywhere, which only applies to the attr-anchored regex. scanAnywhere
  // is deliberately NOT enabled here: without that cheap-fail prefix, the
  // same unbounded quantifiers scanned across a large malformed blob
  // backtrack at every position (O(n²)), reintroducing the exact hang this
  // pattern was already fixed for. JWTs also don't need scanAnywhere in
  // practice — in real Okta .tfstate content they're always their own
  // top-level attribute value, never embedded as a substring inside another
  // JSON/XML-encoded string blob, so the attr-anchored pass already covers
  // them.
  makeVaultPattern(
    'jwt',
    ATTR,
    '[A-Za-z0-9_\\-]{20,}\\.[A-Za-z0-9_\\-]{20,}\\.[A-Za-z0-9_\\-]{20,}'
  ),
  // token: the SSWS/Bearer literal prefix is cheap to fail almost anywhere,
  // so scanning it anywhere in the raw text carries none of the jwt/pem_key
  // backtracking risk above — safe to enable.
  makeVaultPattern('token', ATTR, '(?:SSWS|Bearer)\\s+[A-Za-z0-9_.\\-]{20,}', true),
  // pem_key: the PEM body length is intentionally left uncapped in the
  // attr-anchored pattern for the same reason as jwt above (a legitimate
  // multi-cert chain — a `ca_bundle` or `certificate_chain` holding a CA
  // bundle, cross-signed intermediates, or an mTLS chain — routinely exceeds
  // 10KB, and an earlier length cap silently failed to match such chains).
  // scanAnywhere is deliberately NOT enabled for the same reason as jwt: no
  // cheap-fail prefix outside the attr-anchored context, and PEM blocks are
  // always their own top-level attribute value in real Okta Terraform
  // content, never embedded as a substring.
  makeVaultPattern('pem_key', ATTR, '-----BEGIN [A-Z ]+-----[\\s\\S]+?-----END [A-Z ]+-----'),
  makeVaultPattern('client_secret', 'client_secret', '[^"]+'),
  // Okta resource IDs are always exactly 20 characters, alphanumeric, and
  // conventionally start with a lowercase letter or digit (e.g. 0oa=app,
  // 00u=user, oty=user type, exk=IdP signing key, prm=profile mapping,
  // rst=policy — the provider mints new type prefixes over time, so an
  // enumerated prefix list silently misses IDs as Okta adds resource types;
  // matching the fixed 20-char shape instead of specific prefixes doesn't).
  // The shape is a fixed count, not an unbounded quantifier, so scanning it
  // anywhere carries no backtracking risk — a failed attempt at any position
  // costs O(1), not O(n).
  makeVaultPattern('okta_id', ATTR, '\\b[a-z0-9][A-Za-z0-9]{19}\\b', true),
  // org_url / email: bounded to realistic DNS/RFC lengths (label ≤63 chars,
  // ≤10 labels; email local-part ≤64 chars, domain ≤253 chars) so the
  // scanAnywhere pass can't backtrack proportionally to input size — on a
  // large malformed blob with no '@' or ".okta" anywhere, an unbounded
  // quantifier here reintroduces the same O(n²) hang as jwt/pem_key above.
  // These bounds are generous relative to any real org URL or email address,
  // so legitimate values are unaffected; only the worst-case cost of a
  // failed match on adversarial input is capped.
  makeVaultPattern(
    'org_url',
    ATTR,
    '(?:https?:\\/\\/)?[a-zA-Z0-9\\-]{1,63}(?:\\.[a-zA-Z0-9\\-]{1,63}){0,10}\\.okta(?:preview)?\\.com',
    true
  ),
  makeVaultPattern(
    'email',
    ATTR,
    '[a-zA-Z0-9._%+\\-]{1,64}@[a-zA-Z0-9.\\-]{1,253}\\.[a-zA-Z]{2,24}',
    true
  ),
  // Attribute names pulled from the canonical okta_user profile mapping in
  // shared/terraform-gen.ts (extractTfAttrs), not guessed — that mapping is
  // the source of truth for which raw Okta API fields this app already
  // treats as okta_user profile attributes. Excludes non-identifying
  // config/preference fields from that same mapping (profileUrl,
  // preferredLanguage, locale, timezone, userType) since those aren't PII.
  makeVaultPattern(
    'hcl_pii_attr',
    'firstName|lastName|displayName|login|mobilePhone|primaryPhone|secondEmail|nickName|' +
      'employeeNumber|title|department|division|organization|costCenter|managerId|manager|' +
      'honorificPrefix|honorificSuffix|streetAddress|city|state|zipCode|countryCode|postalAddress',
    '[^"]+'
  ),
];

function extractResourceTypes(files: Record<string, string>): string[] {
  const types = new Set<string>();
  const resourceRegex = /resource\s+"(\w+)"/g;
  const dataRegex = /data\s+"(\w+)"/g;
  for (const content of Object.values(files)) {
    for (const m of content.matchAll(resourceRegex)) if (m[1].startsWith('okta_')) types.add(m[1]);
    for (const m of content.matchAll(dataRegex)) if (m[1].startsWith('okta_')) types.add(m[1]);
  }
  return [...types].sort();
}

function formatResourceSchema(resourceType: string, schema: ResourceSchema): string {
  const lines: string[] = [`${resourceType}:`];
  const attrs = schema.attributes ?? {};

  const required   = Object.entries(attrs).filter(([, a]) => a.required).map(([n]) => n);
  const optional   = Object.entries(attrs).filter(([, a]) => a.optional && !a.deprecated).map(([n]) => n);
  const deprecated = Object.entries(attrs).filter(([, a]) => a.deprecated).map(([n]) => n);

  if (required.length)   lines.push(`  Required: ${required.join(', ')}`);
  if (optional.length)   lines.push(`  Optional: ${optional.join(', ')}`);
  if (deprecated.length) lines.push(`  Deprecated (do not use — flag as warning): ${deprecated.join(', ')}`);

  for (const [btName, bt] of Object.entries(schema.block_types ?? {})) {
    const btReq = Object.entries(bt.attributes ?? {}).filter(([, a]) => a.required).map(([n]) => n);
    const maxNote = bt.max_items === 1 ? ' (max 1)' : '';
    lines.push(`  Block "${btName}"${maxNote}: required: ${btReq.join(', ') || 'none'}`);
  }

  return lines.join('\n');
}

export function buildSchemaContext(schema: ProviderSchema, files: Record<string, string>): string {
  const resourceTypes = extractResourceTypes(files);
  if (resourceTypes.length === 0) return '';

  const sections: string[] = [];
  for (const resourceType of resourceTypes) {
    const resourceSchema =
      schema.resource_schemas[resourceType] ?? schema.data_source_schemas[resourceType] ?? null;
    if (resourceSchema) {
      sections.push(formatResourceSchema(resourceType, resourceSchema));
    } else {
      sections.push(`${resourceType}: NOT FOUND in provider schema — flag as error`);
    }
  }

  return `Okta Terraform Provider schema — resources in this project:\n\n${sections.join('\n\n')}`;
}

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
        // Every pattern's regex has named capture groups (hclAttr/hclVal vs
        // jsonAttr/jsonVal), so replace() always passes the groups object as
        // the last callback argument — the full matched text is args[0].
        const groups = args[args.length - 1] as AttrValueGroups;
        const fullMatch = args[0] as string;
        const value = pattern.extractValue(groups);
        const attr = pattern.extractAttr(groups);
        // Skip values that were already replaced by an earlier, more specific pattern
        // (e.g. an email matched by hcl_pii_attr's "login" case after email's generic case ran).
        // GENERATED_TOKEN_SHAPE checks whether `value` IS a token we already generated
        // (e.g. "{{EMAIL_1}}"), as opposed to a legitimate value that merely happens to
        // contain the literal substring "{{" (e.g. an unrelated Terraform template
        // placeholder) — the latter must still be masked, not silently skipped.
        if (!GENERATED_TOKEN_SHAPE.test(value)) {
          const token = tokenFor(pattern.kind, value, filename, attr);
          // Reconstruct the replacement directly from the known "attr = "value""
          // (HCL) or ""attr": "value"" (JSON, e.g. .tfstate) structure instead of
          // searching for `value` as a substring inside the full match — a
          // substring search can match the wrong occurrence (e.g. the attribute
          // name itself, when attr and value are equal strings, as in
          // `client_secret = "client_secret"`), leaving the real secret unmasked.
          return groups.jsonAttr !== undefined ? `"${attr}": "${token}"` : `${attr} = "${token}"`;
        }
        return fullMatch;
      });

      masked = masked.replace(pattern.arrayRegex, (...args) => {
        // Same last-argument-is-groups mechanic as the scalar replace above.
        const groups = args[args.length - 1] as AttrValueGroups;
        const fullMatch = args[0] as string;
        const attr = extractArrAttrGroup(groups);
        const body = extractArrBodyGroup(groups);
        const isJson = groups.jsonArrAttr !== undefined;

        // Re-scan the array body for individual quoted elements matching this
        // pattern's value shape — one array can mix PII and non-PII elements
        // (or elements of several different PII kinds), so each element is
        // evaluated independently rather than masking the whole array body.
        const elementRegex = new RegExp(`"(${pattern.valuePattern})"`, 'g');
        let changed = false;
        const newBody = body.replace(elementRegex, (elemMatch: string, capturedValue: string) => {
          if (GENERATED_TOKEN_SHAPE.test(capturedValue)) return elemMatch;
          changed = true;
          const token = tokenFor(pattern.kind, capturedValue, filename, attr);
          return `"${token}"`;
        });

        if (!changed) return fullMatch;
        return isJson ? `"${attr}": [${newBody}]` : `${attr} = [${newBody}]`;
      });

      if (pattern.bareRegex) {
        // Catches occurrences the attr="value" and attr=[...] shapes above
        // can't reach — e.g. an org URL embedded as a substring inside a
        // larger JSON- or XML-encoded string value (Okta's `links`,
        // `metadata`, `embed_url` attributes routinely nest URLs this way in
        // a real .tfstate). No attribute context is available here, so
        // sourceAttr falls back to the pattern's kind name.
        masked = masked.replace(pattern.bareRegex, (fullMatch: string) => {
          if (GENERATED_TOKEN_SHAPE.test(fullMatch)) return fullMatch;
          return tokenFor(pattern.kind, fullMatch, filename, pattern.kind);
        });
      }
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

      // var. references are only meaningful inside .tf files — rewrite those
      // and leave every other file type (.tfvars, .tfstate, etc.) alone here.
      for (const filename of tfFilenames) {
        if (files[filename].includes(entry.token)) {
          files[filename] = files[filename].split(entry.token).join(`var.${varName}`);
        }
      }
    }

    // Regardless of promotion, any occurrence of this token in a non-.tf file
    // (.tfvars, .tfstate, or anything else) gets the real value restored in
    // place — those files can't reference a Terraform variable, so they must
    // never end up with a "var.x" string or a leftover literal token.
    for (const [filename, content] of Object.entries(files)) {
      if (filename.endsWith('.tf')) continue;
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

function buildValidatorSystemPrompt(schema: ProviderSchema, version: string, maskedFiles: Record<string, string>): string {
  const schemaContext = buildSchemaContext(schema, maskedFiles);
  const schemaSection = schemaContext
    ? `${schemaContext}\n\nThe schema above is authoritative for provider v${version}. Do not rename valid resource types. Flag resource types absent from the schema as errors.`
    : `Provider version: ${version}. Validate resource types against your knowledge of the Okta Terraform provider.`;

  return `You are a senior Okta Terraform reviewer. You will be given one or more masked Terraform files (secrets and identifiers have been replaced with tokens like {{OKTA_ID_1}} — treat these as opaque placeholders, never remove or rewrite the token syntax itself).

${schemaSection}

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

GRANT TYPE SEVERITY RULES for okta_app_oauth resources:
- implicit grant on a "browser" type app: flag as severity "warning" (not "error") — implicit is technically functional but RFC 9700 (OAuth 2.0 Security Best Current Practice) recommends against it for browser/SPA clients due to token exposure in the URL fragment; the recommendation is authorization_code + PKCE only. Reference RFC 9700 in the explanation.
- implicit grant on any other app type: no finding needed — implicit is valid for server-side and native flows.

For each finding, call the report_findings tool with the complete list of findings AND the complete corrected content for every .tf/.tfvars file that needed a change (files with no issues can be omitted from fixedFiles).

In originalSnippet, copy the EXACT text from the masked file that the fix replaces — verbatim, including whitespace and indentation. It must be a literal substring of the file content so the UI can locate and replace it precisely.`;
}

export async function analyzeProject(maskedFiles: Record<string, string>, version: string): Promise<ValidatorAnalysis> {
  const client = getClient();
  const schema = loadSchema(version);
  const systemPrompt = buildValidatorSystemPrompt(schema, version, maskedFiles);

  const fileBlocks = Object.entries(maskedFiles)
    .map(([name, content]) => `--- ${name} ---\n${content}`)
    .join('\n\n');

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 8192,
    system: systemPrompt,
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
                originalSnippet: {
                  type: 'string',
                  description: 'The exact original masked HCL text being replaced — copy-pasted verbatim from the input file, including indentation. Must be a literal substring of the masked file so String.replace() can locate it.',
                },
                fixedSnippet: { type: 'string' },
              },
              required: ['id', 'category', 'severity', 'file', 'resourceAddress', 'title', 'explanation', 'originalSnippet', 'fixedSnippet'],
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
