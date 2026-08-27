import { getClient } from './claude';
import { VaultEntry, VaultResult, Finding, ValidatorAnalysis } from '../../shared/types';
import { loadSchema } from '../../shared/schema-loader';
import type { ProviderSchema, ResourceSchema } from '../../shared/provider-schemas/schema-types';
import { vaultProject } from './redact-vault';
import { getBreakingChangesForVersion, BreakingChange } from '../../shared/versions';

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

// Blanks out full-line HCL comments (lines matching optional leading
// whitespace followed by '#') so the breaking-change scanner below never
// matches attribute names or block headers inside commented-out (inactive)
// config. Line/offset structure is preserved (only the comment text is
// removed, not the trailing newline) — this mirrors the LLM validator's own
// documented contract in buildValidatorSystemPrompt: "lines starting with #
// are comments... do not flag any issue that exists only inside a
// commented-out block."
function stripCommentedLines(content: string): string {
  return content.replace(/^[ \t]*#.*$/gm, '');
}

// Finds `resource "type" "name" { ... }` and `data "type" "name" { ... }`
// blocks and returns each with its block kind, type, instance name, and body
// text — used to scope a breaking-change attribute check to the correct
// resource type AND block kind, never a bare global search for the attribute
// name (which would false-positive on an unrelated resource/data source that
// happens to share an attribute name, or conflate a resource-only change
// with a data-source block of the same type name).
//
// Known limitation: an unbalanced '{'/'}' inside a string attribute value
// (e.g. description = "use { as a placeholder") can cause the depth counter
// below to over-extend past the real closing brace, potentially absorbing a
// following same-type block. Rare in practice; not defended against.
function extractResourceBlocks(
  rawContent: string
): { blockKind: 'resource' | 'data_source'; type: string; name: string; body: string; fullMatch: string }[] {
  const content = stripCommentedLines(rawContent);
  const blocks: { blockKind: 'resource' | 'data_source'; type: string; name: string; body: string; fullMatch: string }[] = [];
  const blockRegex = /\b(resource|data)\s+"(\w+)"\s+"(\w+)"\s*\{/g;
  let match: RegExpExecArray | null;
  while ((match = blockRegex.exec(content)) !== null) {
    const blockKind = match[1] === 'data' ? 'data_source' : 'resource';
    const [type, name] = [match[2], match[3]];
    const start = match.index;
    // Find the matching closing brace by depth counting from the opening brace.
    let depth = 1;
    let i = blockRegex.lastIndex;
    while (i < content.length && depth > 0) {
      if (content[i] === '{') depth += 1;
      if (content[i] === '}') depth -= 1;
      i += 1;
    }
    const fullMatch = content.slice(start, i);
    const body = content.slice(match.index + match[0].length, i - 1);
    blocks.push({ blockKind, type, name, body, fullMatch });
  }
  return blocks;
}

function findBreakingChangeFindings(
  files: Record<string, string>,
  version: string
): Finding[] {
  const changes = getBreakingChangesForVersion(version);
  if (changes.length === 0) return [];

  const findings: Finding[] = [];
  let idCounter = 0;

  for (const [filename, content] of Object.entries(files)) {
    for (const block of extractResourceBlocks(content)) {
      const relevant = changes.filter((c: BreakingChange) =>
        c.resource === block.type && (!c.blockKind || c.blockKind === block.blockKind)
      );
      for (const change of relevant) {
        // Anchored to the start of a line (allowing leading whitespace) so
        // this only matches an actual attribute assignment, never the
        // attribute name appearing inside an unrelated string value on the
        // same line (e.g. description = "status = active for onboarding").
        const attrRegex = new RegExp(`^\\s*${change.attribute}\\s*=`, 'm');
        if (!attrRegex.test(block.body)) continue;

        idCounter += 1;
        findings.push({
          id: `breaking-change-${idCounter}`,
          category: 'correctness',
          severity: change.kind === 'removed' || change.kind === 'renamed' ? 'error' : 'warning',
          file: filename,
          resourceAddress: block.blockKind === 'data_source'
            ? `data.${block.type}.${block.name}`
            : `${block.type}.${block.name}`,
          title:
            change.kind === 'renamed'
              ? `${change.attribute} renamed to ${change.replacement}`
              : change.kind === 'removed'
                ? `${change.attribute} is no longer settable`
                : `${change.attribute} changed`,
          explanation: change.note,
          originalSnippet: '',
          fixedSnippet: '',
        });
      }
    }
  }

  return findings;
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

export { vaultProject };

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

export interface ExportValidationResult {
  findings: Finding[];
  error?: string;
}

export async function validateForExport(
  files: Record<string, string>,
  version: string,
  _analyze: typeof analyzeProject = analyzeProject
): Promise<ExportValidationResult> {
  if (Object.keys(files).length === 0) {
    return { findings: [] };
  }
  try {
    const breakingChangeFindings = findBreakingChangeFindings(files, version);
    const { maskedFiles } = vaultProject(files);
    const analysis = await _analyze(maskedFiles, version);
    return { findings: [...breakingChangeFindings, ...analysis.findings] };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[validator] validateForExport failed', { error: message });
    return { findings: [], error: message };
  }
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

IMPORTANT: Lines starting with # are comments in HCL and are NOT active configuration. Do not flag any issue that exists only inside a commented-out block. If an entire resource block is commented out, ignore it completely.

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
