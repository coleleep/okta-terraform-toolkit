import Anthropic from '@anthropic-ai/sdk';
import { app } from 'electron';
import { join } from 'path';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { LogAnalysis, ClaudeInterpretation, CustomWorkloadEntry } from '../../shared/types';
import { RESOURCE_DICTIONARY } from '../../shared/resource-dictionary';
import { SCOPE_REQUIREMENTS, API_KEY_ONLY_ENDPOINTS } from '../../shared/scopes';
import { SUPPORTED_VERSIONS } from '../../shared/versions';

// --- API Key Management ---

const KEY_FILE = 'claude-key.json';

function getKeyPath(): string {
  return join(app.getPath('userData'), KEY_FILE);
}

export function getApiKey(): string | null {
  // Priority: user override > bundled default
  const keyPath = getKeyPath();
  if (existsSync(keyPath)) {
    try {
      const data = JSON.parse(readFileSync(keyPath, 'utf-8'));
      if (data.apiKey) return data.apiKey;
    } catch { /* fall through */ }
  }
  return process.env.CLAUDE_API_KEY || null;
}

export function setApiKey(key: string): void {
  writeFileSync(getKeyPath(), JSON.stringify({ apiKey: key }), 'utf-8');
}

function getClient(): Anthropic {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error('No Claude API key configured. Set your key in Settings or via CLAUDE_API_KEY environment variable.');
  return new Anthropic({ apiKey, baseURL: 'https://llm.atko.ai' });
}

// --- Log Interpreter ---

function buildScopeContext(): string {
  const lines = SCOPE_REQUIREMENTS.map(s =>
    `${s.resourceType}: read=${s.readScope ?? 'API_KEY_ONLY'}, manage=${s.manageScope ?? 'API_KEY_ONLY'}, role=${s.adminRole}${s.notes ? ` (${s.notes})` : ''}`
  );
  const apiKeyLines = API_KEY_ONLY_ENDPOINTS.map(e => `${e.endpoint} → ${e.reason}`);
  return `OAUTH SCOPES BY RESOURCE:\n${lines.join('\n')}\n\nAPI-KEY-ONLY ENDPOINTS (no OAuth scope exists):\n${apiKeyLines.join('\n')}`;
}

const LOG_SYSTEM_PROMPT = `You are an expert on the Okta Terraform Provider. You analyze TF_LOG debug output to explain what happened during a Terraform run — covering rate limits, authentication failures, resource errors, timeouts, and any other issues.

Key domain knowledge:

RATE LIMITING & BACKOFF:
- Okta rate limits are per-endpoint, typically 600 req/min for most endpoints, 100 req/min for app user/group assignment endpoints
- 429 responses mean the rate limit was hit; the provider retries with exponential backoff (min_wait → max_wait)
- max_api_capacity (0-100) controls proactive throttling: provider sleeps when Remaining/Limit < capacity%. Prevents 429s but can cause deadline errors if request_timeout is too low
- Known-good config for ~100 req/window endpoints: max_api_capacity=70, request_timeout=120, parallelism=4, min_wait_seconds=17, max_wait_seconds=90

TIMEOUTS & DEADLINES:
- "context deadline exceeded" means request_timeout killed a request queued too long waiting for rate limit headroom
- Network timeouts vs provider timeouts — distinguish between Okta being slow and the provider giving up

AUTHENTICATION & PERMISSIONS:
- 401 = invalid or expired API token / OAuth token
- 403 = token lacks required scope or permission. Common: missing okta.apps.manage, okta.users.manage, etc.
- OAuth vs API token: OAuth requires specific scopes per resource type; API tokens need Super Admin or appropriate custom admin role
- When you identify permission issues, reference the EXACT scope or role needed from the scope table below

RESOURCE ERRORS:
- 400 = invalid request body — often schema mismatches, invalid enum values, or missing required fields
- 404 = resource not found — could be wrong ID, resource was deleted, or endpoint doesn't exist for this org type (OIE vs Classic)
- 409 = conflict — resource already exists or concurrent modification
- 405 = method not allowed — endpoint doesn't support that HTTP method (common with deprecated features)

PROVIDER-SPECIFIC:
- Import errors: resource exists in Okta but state doesn't match schema expectations
- Dependency errors: resources created in wrong order (e.g., policy rule before policy)
- Version incompatibilities: resource type not available in provider version being used
- OIE vs Classic Okta: some resources/endpoints only work on one or the other

Respond with a JSON object matching this schema exactly:
{
  "narrative": "2-4 sentence plain-English explanation of what happened",
  "rootCause": "One-line root cause",
  "topFix": "Single most impactful fix or config change to recommend",
  "configChanges": { ...partial TerraformProviderConfig if applicable, omit if not relevant }
}

TerraformProviderConfig fields: max_retries, backoff, min_wait_seconds, max_wait_seconds, request_timeout, max_api_capacity, parallelism

Be specific. Reference actual numbers from the data. If the issue isn't rate-limit related, omit configChanges.
When the issue is permission/scope related, tell the user EXACTLY which scope or admin role they need — reference the scope table.
Don't hedge.`;

export async function interpretLog(analysis: LogAnalysis): Promise<ClaudeInterpretation> {
  const client = getClient();
  const scopeContext = buildScopeContext();

  const response = await client.messages.create({
    model: 'claude-4-6-sonnet',
    max_tokens: 1024,
    system: `${LOG_SYSTEM_PROMPT}\n\n${scopeContext}`,
    messages: [{
      role: 'user',
      content: `Analyze this Terraform run:\n\n${JSON.stringify(analysis, null, 2)}\n\nRespond with the JSON object only.`,
    }],
  });

  const textBlock = response.content.find(b => b.type === 'text');
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('No text response from Claude');
  }

  // Parse JSON from response (handle possible markdown code fences)
  let jsonStr = textBlock.text.trim();
  if (jsonStr.startsWith('```')) {
    jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  }

  const parsed = JSON.parse(jsonStr);
  return {
    narrative: parsed.narrative,
    rootCause: parsed.rootCause,
    topFix: parsed.topFix,
    configChanges: parsed.configChanges,
  };
}

// --- Natural Language Workload Builder ---

function buildResourceContext(): string {
  const entries = RESOURCE_DICTIONARY
    .filter(r => r.primaryEndpoint)
    .map(r => `${r.terraformResource} | ${r.primaryEndpoint} | ${r.endpointLabel}`)
    .join('\n');
  return `Available Terraform resources with rate-limit endpoints:\nterraformResource | primaryEndpoint | endpointLabel\n${entries}`;
}

const WORKLOAD_SYSTEM_PROMPT = `You parse natural language descriptions of Okta Terraform workloads into structured data.

${buildResourceContext()}

When the user describes their workload, call the set_workload tool with the parsed entries. Each entry must use exact values from the table above for terraformResource, primaryEndpoint, and endpointLabel. Infer the count from the user's description.

If the user mentions a resource type not in the table, pick the closest match. If you can't match, skip it and explain in your text response.`;

export async function buildWorkload(description: string): Promise<CustomWorkloadEntry[]> {
  const client = getClient();

  const response = await client.messages.create({
    model: 'claude-4-6-sonnet',
    max_tokens: 1024,
    system: WORKLOAD_SYSTEM_PROMPT,
    messages: [{
      role: 'user',
      content: description,
    }],
    tool_choice: { type: 'any' },
    tools: [{
      name: 'set_workload',
      description: 'Set the parsed workload entries from the user description',
      input_schema: {
        type: 'object' as const,
        properties: {
          workloads: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                terraformResource: { type: 'string', description: 'Exact terraform resource name from the table' },
                count: { type: 'number', description: 'Number of resources' },
                primaryEndpoint: { type: 'string', description: 'API endpoint pattern from the table' },
                endpointLabel: { type: 'string', description: 'Endpoint label from the table' },
              },
              required: ['terraformResource', 'count', 'primaryEndpoint', 'endpointLabel'],
            },
          },
        },
        required: ['workloads'],
      },
    }],
  });

  // Extract tool use result
  const toolUseBlock = response.content.find(b => b.type === 'tool_use');
  if (!toolUseBlock || toolUseBlock.type !== 'tool_use') {
    throw new Error('Claude did not return structured workload data');
  }

  const input = toolUseBlock.input as { workloads: Array<{ terraformResource: string; count: number; primaryEndpoint: string; endpointLabel: string }> };

  return input.workloads.map(w => ({
    terraformResource: w.terraformResource,
    count: w.count,
    primaryEndpoint: w.primaryEndpoint,
    endpointLabel: w.endpointLabel,
    rateLimit: 0, // User can probe after adding
  }));
}

// --- Error Decoder ---

export interface ErrorDecoderResult {
  explanation: string;
  cause: string;
  fix: string;
  relatedDocs?: string;
}

const ERROR_DECODER_PROMPT = `You are an expert on the Okta Terraform Provider. A user is pasting an error message they encountered during a Terraform operation (plan, apply, import, destroy). Your job is to explain what the error means and how to fix it.

${buildScopeContext()}

Key domain knowledge:
- Okta API error codes: E0000001 (API validation), E0000003 (not found), E0000006 (not allowed), E0000007 (not found), E0000011 (invalid token), E0000014 (update/delete not allowed), E0000015 (feature not enabled), E0000016 (activation failed), E0000022 (group constraints), E0000068 (invalid value)
- Provider errors: "context deadline exceeded" (request_timeout too low with capacity throttling), "unexpected state" (state drift), "resource already exists" (needs import)
- State issues: "inconsistent result" (provider bug or API race), "resource not found during refresh" (deleted outside Terraform)
- Import errors: "cannot import" (resource type doesn't support import), "ID format" (wrong ID format for import block)
- Dependency errors: "cycle detected", "depends on resource that will be destroyed"
- Version errors: "unsupported argument" or "unsupported block type" (provider version too old for that resource/attribute)

Respond with a JSON object matching this schema exactly:
{
  "explanation": "1-2 sentence plain-English explanation of what this error means",
  "cause": "The specific root cause",
  "fix": "Step-by-step fix (be specific — include exact config, commands, or scope names)",
  "relatedDocs": "URL or doc reference if applicable, otherwise omit"
}

Be specific and actionable. If the error involves permissions, name the exact scope or role needed. If it's a config issue, show the exact setting to change. Don't hedge.`;

export async function decodeError(errorText: string): Promise<ErrorDecoderResult> {
  const client = getClient();

  const response = await client.messages.create({
    model: 'claude-4-6-sonnet',
    max_tokens: 1024,
    system: ERROR_DECODER_PROMPT,
    messages: [{
      role: 'user',
      content: `Decode this Terraform/Okta error:\n\n${errorText}\n\nRespond with the JSON object only.`,
    }],
  });

  const textBlock = response.content.find(b => b.type === 'text');
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('No text response from Claude');
  }

  let jsonStr = textBlock.text.trim();
  if (jsonStr.startsWith('```')) {
    jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  }

  return JSON.parse(jsonStr);
}

// --- Solution Builder ---

export interface SolutionResult {
  feasible: boolean;
  summary: string;
  limitations?: string[];
  hcl: {
    provider: string;
    resources: string;
    variables: string;
    imports?: string;
  };
  instructions: string[];
  warnings: string[];
  estimatedRuntime?: string;
  requiredScopes: string[];
  requiredRole: string;
}

function buildFullResourceContext(): string {
  const entries = RESOURCE_DICTIONARY.map(r =>
    `${r.terraformResource} | ${r.description} | parent=${r.parentType}${r.primaryEndpoint ? ` | endpoint=${r.primaryEndpoint}` : ''}${r.sinceVersion ? ` | since=v${r.sinceVersion}` : ''}`
  ).join('\n');
  return entries;
}

const SOLUTION_SYSTEM_PROMPT = `You are an expert Terraform + Okta solution architect. Given a user's description of what they want to accomplish, you generate a complete, production-ready Terraform solution with the Okta provider.

SUPPORTED PROVIDER VERSIONS: ${SUPPORTED_VERSIONS.join(', ')}

RESOURCE DICTIONARY (terraformResource | description | parent | endpoint | sinceVersion):
${buildFullResourceContext()}

${buildScopeContext()}

PROVIDER CONFIG BEST PRACTICES:
- For workloads hitting endpoints with 100 req/window limits (app users, app groups): max_api_capacity=70, request_timeout=120, parallelism=4
- For workloads on 600 req/window endpoints: max_api_capacity=80, request_timeout=120, parallelism=6
- Always set backoff=true, min_wait_seconds=17, max_wait_seconds=90, max_retries=10
- Import operations: ~1.15 API calls per resource. Create: ~2. Update: ~2.5. Full lifecycle: ~3.
- Throughput with capacity throttling: ~90% of theoretical max

RULES:
1. If a resource/attribute doesn't exist in the provider, say so clearly in limitations. Don't invent resources.
2. If a resource requires a specific version, flag it. If user's version is too old, warn them.
3. Generate real, valid HCL — not pseudocode. Use proper Terraform syntax.
4. Include import blocks when the operation is importing existing resources.
5. Use variables for sensitive values (org_url, api_token) and counts.
6. Estimate runtime based on resource count and rate limits.
7. Include all required OAuth scopes or note if API key is required.
8. If what the user wants is genuinely not possible with the Okta Terraform provider, set feasible=false and explain why.

When you call the set_solution tool, generate real valid HCL in the hcl fields. Be specific, practical, and production-ready. Don't hedge. If something won't work, say so directly.`;

export async function generateSolution(description: string, providerVersion: string): Promise<SolutionResult> {
  const client = getClient();

  const response = await client.messages.create({
    model: 'claude-4-6-sonnet',
    max_tokens: 8192,
    system: SOLUTION_SYSTEM_PROMPT,
    messages: [{
      role: 'user',
      content: `Provider version: ${providerVersion}\n\nUser request: ${description}`,
    }],
    tool_choice: { type: 'any' },
    tools: [{
      name: 'set_solution',
      description: 'Output the complete Terraform solution',
      input_schema: {
        type: 'object' as const,
        properties: {
          feasible: { type: 'boolean', description: 'Whether this is possible with the Okta Terraform provider' },
          summary: { type: 'string', description: '1-2 sentence summary of the solution' },
          limitations: { type: 'array', items: { type: 'string' }, description: 'Provider limitations relevant to this request' },
          hcl_provider: { type: 'string', description: 'provider.tf file content (valid HCL)' },
          hcl_resources: { type: 'string', description: 'resources.tf file content (valid HCL)' },
          hcl_variables: { type: 'string', description: 'variables.tf file content (valid HCL)' },
          hcl_imports: { type: 'string', description: 'imports.tf file content (valid HCL, empty string if not importing)' },
          instructions: { type: 'array', items: { type: 'string' }, description: 'Step-by-step execution instructions' },
          warnings: { type: 'array', items: { type: 'string' }, description: 'Important warnings or gotchas' },
          estimatedRuntime: { type: 'string', description: 'Estimated runtime like "5-10 minutes"' },
          requiredScopes: { type: 'array', items: { type: 'string' }, description: 'Required OAuth scopes' },
          requiredRole: { type: 'string', description: 'Minimum admin role needed' },
        },
        required: ['feasible', 'summary', 'hcl_provider', 'hcl_resources', 'hcl_variables', 'instructions', 'warnings', 'requiredScopes', 'requiredRole'],
      },
    }],
  });

  const toolUseBlock = response.content.find(b => b.type === 'tool_use');
  if (!toolUseBlock || toolUseBlock.type !== 'tool_use') {
    throw new Error('Claude did not return a structured solution');
  }

  const input = toolUseBlock.input as {
    feasible: boolean;
    summary: string;
    limitations?: string[];
    hcl_provider: string;
    hcl_resources: string;
    hcl_variables: string;
    hcl_imports?: string;
    instructions: string[];
    warnings: string[];
    estimatedRuntime?: string;
    requiredScopes: string[];
    requiredRole: string;
  };

  return {
    feasible: input.feasible,
    summary: input.summary,
    limitations: input.limitations,
    hcl: {
      provider: input.hcl_provider,
      resources: input.hcl_resources,
      variables: input.hcl_variables,
      imports: input.hcl_imports || undefined,
    },
    instructions: input.instructions,
    warnings: input.warnings,
    estimatedRuntime: input.estimatedRuntime,
    requiredScopes: input.requiredScopes,
    requiredRole: input.requiredRole,
  };
}

// --- Config Converter (Sync) ---

export interface ConvertedConfig {
  portableHcl: string;      // .tf content with data sources instead of hardcoded IDs
  importBlocks: string;      // import {} blocks for target org
  instructions: string[];
  warnings: string[];
}

export async function convertConfig(
  tfContent: string,
  resourceMatches: Array<{ sourceAddress: string; sourceId: string; sourceName: string; targetId: string | null; status: string; level?: number; parentSourceId?: string | null; parentTargetId?: string | null }>,
  targetOrgUrl: string,
): Promise<ConvertedConfig> {
  const client = getClient();

  // Build hierarchical match context showing parent-child relationships
  const topLevel = resourceMatches.filter(m => !m.level || m.level === 0);
  const subResources = resourceMatches.filter(m => m.level && m.level > 0);

  const matchLines: string[] = [];
  for (const m of topLevel) {
    matchLines.push(`${m.sourceAddress}: source_id=${m.sourceId} name="${m.sourceName}" → target_id=${m.targetId ?? 'MISSING'} (${m.status})`);
    // Nest children under their parent
    const children = subResources.filter(s => s.parentSourceId === m.sourceId);
    for (const child of children) {
      matchLines.push(`  └─ ${child.sourceAddress}: source_id=${child.sourceId} parent=${child.parentSourceId} name="${child.sourceName}" → target_id=${child.targetId ?? 'MISSING'} parent=${child.parentTargetId ?? 'MISSING'} (${child.status})`);
      // Nest grandchildren (level 2) under level 1
      const grandchildren = subResources.filter(g => g.parentSourceId === child.sourceId);
      for (const gc of grandchildren) {
        matchLines.push(`    └─ ${gc.sourceAddress}: source_id=${gc.sourceId} parent=${gc.parentSourceId} name="${gc.sourceName}" → target_id=${gc.targetId ?? 'MISSING'} parent=${gc.parentTargetId ?? 'MISSING'} (${gc.status})`);
      }
    }
  }
  // Include any orphaned sub-resources not nested under a top-level match
  const nestedIds = new Set(matchLines.map(l => l.trim()));
  for (const m of subResources) {
    const line = `${m.sourceAddress}: source_id=${m.sourceId} parent=${m.parentSourceId} name="${m.sourceName}" → target_id=${m.targetId ?? 'MISSING'} (${m.status})`;
    if (!nestedIds.has(line)) {
      matchLines.push(`[orphan] ${line}`);
    }
  }
  const matchContext = matchLines.join('\n');

  const response = await client.messages.create({
    model: 'claude-4-6-sonnet',
    max_tokens: 8192,
    system: `You are an expert at converting Terraform configurations between Okta orgs.

Given:
1. Original .tf configuration from a source org
2. A resource mapping showing source IDs → target IDs (matched by name), including sub-resources nested under their parents
3. The target org URL

Your job:
- Replace ALL hardcoded Okta IDs with data source lookups (lookup by name) to make the config portable
- Generate import blocks for every matched resource in the target org
- Flag any resources marked MISSING that exist in source but not target
- Preserve all resource configuration (attributes, settings, lifecycle blocks)
- Use variables for org_url and api_token
- Keep the same resource addresses/names from the original config

Sub-resource handling:
- Sub-resources (indented with └─) are children of the parent resource above them
- For sub-resources like okta_auth_server_policy, okta_auth_server_scope, okta_auth_server_claim:
  - If the original config already uses a Terraform reference (e.g., okta_auth_server.NAME.id), preserve it as-is
  - If the config uses a hardcoded auth_server_id, replace it with a reference to the parent resource
- For okta_auth_server_policy_rule:
  - Preserve or replace both auth_server_id and policy_id with parent resource references
- For global policy rules (okta_policy_rule_sign_on, okta_policy_rule_password, okta_policy_rule_mfa, okta_policy_rule_profile_enrollment):
  - Replace hardcoded policy_id with a reference to the parent policy resource
- For app assignments (okta_app_user, okta_app_group_assignment, okta_app_group_assignments):
  - Replace hardcoded app_id with a reference to the parent app resource
- For group memberships (okta_group_memberships):
  - Replace hardcoded group_id with a reference to the parent group resource
- Generate import blocks for matched sub-resources using the appropriate composite ID format
- If a sub-resource's parent is MISSING or AMBIGUOUS, the sub-resource cannot be imported — add a warning
- For policy rules: if the parent policy is MISSING, both the policy and all its rules must be created from scratch — warn about this

Import ID formats for sub-resources:
- okta_auth_server_policy: auth_server_id/policy_id
- okta_auth_server_scope: auth_server_id/scope_id
- okta_auth_server_claim: auth_server_id/claim_id
- okta_auth_server_policy_rule: auth_server_id/policy_id/rule_id
- okta_policy_rule_sign_on: policy_id/rule_id
- okta_policy_rule_password: policy_id/rule_id
- okta_policy_rule_mfa: policy_id/rule_id
- okta_policy_rule_profile_enrollment: policy_id/rule_id
- okta_app_user: app_id/user_id
- okta_app_group_assignment: app_id/group_id
- okta_group_memberships: group_id

Rules:
- Every okta_group reference by ID → data.okta_group.NAME.id
- Every okta_app reference by ID → data.okta_app.NAME.id or data source lookup
- Every okta_auth_server sub-resource auth_server_id → okta_auth_server.NAME.id
- Every policy rule policy_id → reference to parent policy resource
- Every app assignment app_id → reference to parent app resource
- Generate one import block per matched resource (including sub-resources)
- Do NOT invent resources or attributes not in the original config
- If a resource is MISSING in target, add a comment noting it will be created`,
    messages: [{
      role: 'user',
      content: `Target org: ${targetOrgUrl}\n\nResource mapping:\n${matchContext}\n\nOriginal .tf configuration:\n${tfContent}`,
    }],
    tool_choice: { type: 'any' },
    tools: [{
      name: 'set_converted_config',
      description: 'Output the converted Terraform configuration',
      input_schema: {
        type: 'object' as const,
        properties: {
          portable_hcl: { type: 'string', description: 'Complete .tf content with data sources replacing hardcoded IDs' },
          import_blocks: { type: 'string', description: 'import {} blocks for all matched resources in target org' },
          instructions: { type: 'array', items: { type: 'string' }, description: 'Step-by-step instructions for applying to target org' },
          warnings: { type: 'array', items: { type: 'string' }, description: 'Warnings about missing resources, potential issues, or manual steps needed' },
        },
        required: ['portable_hcl', 'import_blocks', 'instructions', 'warnings'],
      },
    }],
  });

  const toolUseBlock = response.content.find(b => b.type === 'tool_use');
  if (!toolUseBlock || toolUseBlock.type !== 'tool_use') {
    throw new Error('Claude did not return converted config');
  }

  const input = toolUseBlock.input as {
    portable_hcl: string;
    import_blocks: string;
    instructions: string[];
    warnings: string[];
  };

  return {
    portableHcl: input.portable_hcl,
    importBlocks: input.import_blocks,
    instructions: input.instructions,
    warnings: input.warnings,
  };
}
