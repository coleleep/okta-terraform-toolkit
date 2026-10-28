// Stronger redaction engine than redact.ts: prefix-agnostic Okta ID matching
// (catches oty/exk/prm/rst and any future ID prefix, not just an enumerated
// list), a larger PII attribute set, and a scan-anywhere pass for secrets
// embedded as substrings inside larger blobs (e.g. a URL nested in JSON).
// Originally built for the Validate tab (vaultProject → export path) and
// extracted here so the TF_LOG-to-AI redaction path (claude.ts:interpretLog)
// could reuse it without a circular import. redact.ts is still used by this
// file's other callers (buildWorkload, decodeError, generateSolution) — it
// was intentionally left in place for those call sites; only interpretLog
// was migrated to this module.
import { VaultEntry, VaultResult, LogAnalysis } from '../../shared/types';

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

export function vaultProject(
  files: Record<string, string>,
  patterns: VaultPattern[] = VAULT_PATTERNS
): VaultResult {
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
    for (const pattern of patterns) {
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

// hcl_pii_attr is attribute-name-anchored (matches `"title": "value"`,
// `"department": "value"`, etc.) — a correct signal in real HCL/tfstate
// content, where those are Okta user profile attributes. LogAnalysis is a
// plain app-internal struct, not HCL/tfstate: its "title" is LogIssue.title
// (an app-generated summary sentence, e.g. "6 requests (19%) hit rate limits
// (429)"), not anyone's job title. Scanning the whole serialized object with
// this pattern turns unrelated struct fields into masked tokens. The other
// patterns are all value-shape-anchored (an Okta ID's 20-char shape, an
// @domain, an org's .okta.com host, a token/JWT/PEM prefix) and stay safe to
// run against arbitrary JSON, since they only fire on text that actually
// looks like the thing being redacted.
export const LOG_ANALYSIS_PATTERNS = VAULT_PATTERNS.filter(p => p.kind !== 'hcl_pii_attr');

// Redacts a parsed TF_LOG analysis before it leaves the main process for the
// renderer (on-screen display) or the LLM (interpretLog). A customer's
// terraform-debug.log routinely embeds org URLs, emails, and Okta IDs inside
// endpoint paths, error messages, and captured error bodies — vaultProject
// scans strings anywhere, so serializing the whole analysis and re-parsing the
// masked JSON scrubs those without touching the numeric stats or endpoint
// patterns the target planner and analyzer depend on. The vault entries are
// discarded on purpose: there is no un-redact step for log analysis, and
// tokenization is idempotent (GENERATED_TOKEN_SHAPE), so re-running downstream
// in interpretLog is a no-op.
export function redactLogAnalysis(analysis: LogAnalysis): LogAnalysis {
  const { maskedFiles } = vaultProject({ 'log-analysis': JSON.stringify(analysis) }, LOG_ANALYSIS_PATTERNS);
  return JSON.parse(maskedFiles['log-analysis']) as LogAnalysis;
}

// Scrubs raw TF_LOG debug text (the on-disk terraform-debug.log an in-app
// `terraform apply` produces). That file records the API token in
// `Authorization: SSWS ...` headers plus org URLs, emails, and Okta IDs in
// full request/response DEBUG output — vaultProject's scan-anywhere passes
// catch all of those. Returns the redacted text to write back over the file so
// no plaintext secret persists on disk.
export function redactLogText(raw: string): string {
  const { maskedFiles } = vaultProject({ log: raw });
  return maskedFiles.log;
}
