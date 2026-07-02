process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

import Anthropic from '@anthropic-ai/sdk';
import { app } from 'electron';
import { spawnSync } from 'child_process';
import { join } from 'path';
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'fs';
import { LogAnalysis, ClaudeInterpretation, CustomWorkloadEntry, ProbeResult } from '../../shared/types';
import { RESOURCE_DICTIONARY } from '../../shared/resource-dictionary';
import { SCOPE_REQUIREMENTS, API_KEY_ONLY_ENDPOINTS } from '../../shared/scopes';
import { SUPPORTED_VERSIONS } from '../../shared/versions';
import { redact } from './redact';

// --- Claude Configuration Management ---

export type ClaudeKeySource = 'ocm' | 'static';

interface ClaudeConfig {
  apiKey: string;
  baseUrl?: string;
  source?: ClaudeKeySource;
}

const CONFIG_FILE = 'claude-config.json';
const LEGACY_KEY_FILE = 'claude-key.json';
const LITELLM_BASE_URL = 'https://llm.atko.ai';
// Common OCM install locations across macOS setups.
const OCM_PATH = [process.env.PATH, '/usr/local/bin', '/opt/homebrew/bin', '/usr/bin'].filter(Boolean).join(':');
const OCM_TOKEN_TTL_MS = 15 * 60 * 1000;

let ocmTokenCache: { value: string; fetchedAt: number } | null = null;

function getConfigPath(): string {
  return join(app.getPath('userData'), CONFIG_FILE);
}

function runOcmAuth(): string | null {
  if (ocmTokenCache && Date.now() - ocmTokenCache.fetchedAt < OCM_TOKEN_TTL_MS) {
    return ocmTokenCache.value;
  }
  try {
    const result = spawnSync('ocm', ['auth', 'litellm'], {
      encoding: 'utf-8',
      timeout: 5000,
      env: { ...process.env, PATH: OCM_PATH },
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    if (result.status !== 0 || !result.stdout) return null;
    const token = result.stdout.trim();
    if (token.length > 0) {
      ocmTokenCache = { value: token, fetchedAt: Date.now() };
      return token;
    }
    return null;
  } catch {
    return null;
  }
}

export function warmUpOcmAuth(): Promise<boolean> {
  return new Promise(resolve => setImmediate(() => resolve(runOcmAuth() !== null)));
}

export function getOcmStatus(): { available: boolean } {
  return { available: runOcmAuth() !== null };
}

export function getClaudeConfig(): ClaudeConfig | null {
  // 1. Explicit static override saved through the UI wins (dev/troubleshooting path).
  const configPath = getConfigPath();
  if (existsSync(configPath)) {
    try {
      const data = JSON.parse(readFileSync(configPath, 'utf-8'));
      if (data.apiKey && data.source === 'static') {
        return { apiKey: data.apiKey, baseUrl: data.baseUrl, source: 'static' };
      }
    } catch { /* fall through */ }
  }

  // 2. OCM-managed LiteLLM JWT — the default for internal Okta use.
  const ocmKey = runOcmAuth();
  if (ocmKey) {
    return { apiKey: ocmKey, baseUrl: LITELLM_BASE_URL, source: 'ocm' };
  }

  // 3. Legacy unmarked claude-config.json (pre-source field) and claude-key.json.
  if (existsSync(configPath)) {
    try {
      const data = JSON.parse(readFileSync(configPath, 'utf-8'));
      if (data.apiKey) return { apiKey: data.apiKey, baseUrl: data.baseUrl };
    } catch { /* fall through */ }
  }
  const legacyPath = join(app.getPath('userData'), LEGACY_KEY_FILE);
  if (existsSync(legacyPath)) {
    try {
      const data = JSON.parse(readFileSync(legacyPath, 'utf-8'));
      if (data.apiKey) return { apiKey: data.apiKey };
    } catch { /* fall through */ }
  }

  // 4. Env var fallback (CI / dev).
  const envKey = process.env.CLAUDE_API_KEY;
  if (envKey) return { apiKey: envKey, baseUrl: process.env.CLAUDE_BASE_URL };

  return null;
}

export function setClaudeConfig(config: { apiKey: string; baseUrl?: string }): void {
  const payload: ClaudeConfig = {
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
    source: 'static',
  };
  writeFileSync(getConfigPath(), JSON.stringify(payload), 'utf-8');
}

export function removeClaudeConfig(): void {
  const configPath = getConfigPath();
  if (existsSync(configPath)) {
    unlinkSync(configPath);
  }
  const legacyPath = join(app.getPath('userData'), LEGACY_KEY_FILE);
  if (existsSync(legacyPath)) {
    unlinkSync(legacyPath);
  }
}

export function getApiKey(): string | null {
  return getClaudeConfig()?.apiKey || null;
}

export function setApiKey(key: string): void {
  const existing = getClaudeConfig();
  setClaudeConfig({ apiKey: key, baseUrl: existing?.baseUrl });
}

export function getClient(): Anthropic {
  const config = getClaudeConfig();
  if (!config?.apiKey) {
    throw new Error(
      'No Claude API key found. Run `ocm auth litellm` to authenticate via OCM, or set a static key under Advanced settings.'
    );
  }
  return new Anthropic({
    apiKey: config.apiKey,
    timeout: 120000,
    ...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
  });
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
- Org-specific rate limits are provided below — use these actual values, not generic estimates
- Rate limits vary by org tier; the numbers below come from (1) X-Rate-Limit-Limit headers in this log run, (2) a probe of this org, or (3) documented Okta developer-tier defaults as a last resort — the source is labeled in the data
- 429 responses mean the rate limit was hit; the provider retries with exponential backoff (min_wait → max_wait)
- max_api_capacity (0-100) controls proactive throttling: provider sleeps when Remaining/Limit < capacity%. Prevents 429s but can cause deadline errors if request_timeout is too low
- For endpoints with limits under 200/window: max_api_capacity=70, request_timeout=120, parallelism=4, min_wait_seconds=17, max_wait_seconds=90
- If log was captured with TF_LOG=INFO instead of TF_LOG=DEBUG, rate limit headers will be absent from the log — note this in your analysis if using probe/default data

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

PRIORITY CONFLICTS:
- 409 on policy rule endpoints (paths containing /rules or /policies) = concurrent priority modification
- The Okta API shifts priorities automatically when conflicts occur, causing Terraform state drift
- If you see multiple 409s on policy/rule endpoints in the same run: the root cause is missing depends_on chains between rules sharing the same parent policy
- Fix: chain all rules under each policy with depends_on in ascending priority order. This serializes rule operations without reducing parallelism for other resources
- Do NOT recommend parallelism=1 for this — depends_on chains are the correct fix

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

function buildRateLimitContext(analysis: LogAnalysis, probeResult?: ProbeResult): string {
  // Tier 1: X-Rate-Limit-Limit headers extracted from the actual log run
  const observed = analysis.endpoints.filter(e => e.minRateLimit > 0);
  if (observed.length > 0) {
    const lines = observed.map(e =>
      `  ${e.pattern}: limit=${e.minRateLimit}/window, lowest_remaining=${e.lowestRemaining}`
    );
    return `ORG RATE LIMITS (source: X-Rate-Limit-Limit headers from this log run — org-specific):\n${lines.join('\n')}`;
  }

  // Tier 2: Probe results for the current org
  if (probeResult) {
    const lines = probeResult.endpoints
      .filter(e => e.limit > 0 && e.status !== 'error' && e.status !== 'skipped')
      .map(e => `  ${e.endpoint}: limit=${e.limit}/window`);
    if (lines.length > 0) {
      return `ORG RATE LIMITS (source: org probe — log did not include rate limit headers; re-run with TF_LOG=DEBUG for log-specific data):\n${lines.join('\n')}`;
    }
  }

  // Tier 3: Documented Okta developer-tier defaults
  return `ORG RATE LIMITS (source: documented Okta developer-tier defaults — no log headers or probe data available; re-run with TF_LOG=DEBUG for org-specific data):
  Most management endpoints: ~600/window
  App user/group assignment (/api/v1/apps/{id}/users, /api/v1/apps/{id}/groups): ~100/window
  NOTE: Actual limits vary by org tier — treat these as rough estimates only.`;
}

export async function interpretLog(analysis: LogAnalysis, probeResult?: ProbeResult): Promise<ClaudeInterpretation> {
  const client = getClient();
  const scopeContext = buildScopeContext();
  const rateLimitContext = buildRateLimitContext(analysis, probeResult);

  const cleanAnalysis = redact(JSON.stringify(analysis, null, 2));
  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    system: `${LOG_SYSTEM_PROMPT}\n\n${rateLimitContext}\n\n${scopeContext}`,
    messages: [{
      role: 'user',
      content: `Analyze this Terraform run:\n\n${cleanAnalysis}\n\nRespond with the JSON object only.`,
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
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    system: WORKLOAD_SYSTEM_PROMPT,
    messages: [{
      role: 'user',
      content: redact(description),
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
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    system: ERROR_DECODER_PROMPT,
    messages: [{
      role: 'user',
      content: `Decode this Terraform/Okta error:\n\n${redact(errorText)}\n\nRespond with the JSON object only.`,
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

POLICY RULE PRIORITY MANAGEMENT:
- The Okta API shifts existing rule priorities when conflicts occur (assigning priority 2 pushes existing priority-2 to 3)
- Concurrent rule modifications at parallelism > 1 cause 409 conflicts and priority drift
- ALWAYS chain policy rules with depends_on in ascending priority order within each parent policy
- This serializes rule operations naturally — no need to reduce parallelism globally
- For priority swaps: use a two-step approach — first move rules to temporary high priorities (100+), apply, then move to final priorities
- Policies themselves also have priority — chain policies under the same scope by priority
- Do NOT recommend parallelism=1 to solve priority conflicts — depends_on chains are the correct fix

RESOURCES WHERE TERRAFORM DESTROY HAS NO EFFECT:
These have no-op delete implementations — terraform destroy only removes from state, no API call:
- okta_org_configuration (singleton — manages existing org settings, no delete endpoint)
- okta_policy_mfa_default (default policy — Okta does not allow deleting default policies)
- okta_policy_password_default (default policy — same as above)
- okta_rate_limiting (provider emits warning: "This resource cannot be deleted via Terraform")
- okta_rate_limit_admin_notification_settings (provider emits warning: "Delete Not Supported")
- okta_rate_limit_warning_threshold_percentage (provider emits warning: "Delete Not Supported")
- okta_resource_owner (governance resource — provider emits warning: "Delete Not Supported")
- okta_request_setting_organization (governance — provider emits warning: "Delete Not Supported")
- okta_request_setting_resource (governance — provider emits warning: "Delete Not Supported")

RESOURCES WHERE DESTROY RESETS TO DEFAULTS (API call, but underlying singleton survives):
- okta_security_notification_emails — destroy resets all notification flags to true (Okta defaults)
- okta_threat_insight_settings — destroy resets threat insight action to 'none'

When generating solutions with these resources: note in warnings that terraform destroy will not remove the configuration from Okta — it only removes the resource from Terraform state.

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
    model: 'claude-sonnet-4-6',
    max_tokens: 8192,
    system: SOLUTION_SYSTEM_PROMPT,
    messages: [{
      role: 'user',
      content: `Provider version: ${providerVersion}\n\nUser request: ${redact(description)}`,
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

  // NOTE: tfContent, targetOrgUrl, and matchContext are NOT redacted here.
  // Unlike the other 4 LLM call sites, this data isn't summarized for a human —
  // it drives real Terraform codegen (org URL, resource IDs) that gets applied
  // to the user's own org. Redacting it corrupts the generated HCL with literal
  // placeholder strings like "[OKTA_ID]" instead of real values.

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 32768,
    system: `You are an expert at converting Terraform configurations between Okta orgs.

Given:
1. Original .tf configuration from a source org
2. A resource mapping showing source IDs → target IDs (matched by name), including sub-resources nested under their parents
3. The target org URL

Your job:
- Replace ALL hardcoded Okta IDs with data source lookups (lookup by name) to make the config portable
- Generate import blocks for every matched resource in the target org
- Flag any resources marked MISSING that exist in source but not target
- COPY ALL resource attributes from the original config verbatim — every name, description, priority, status, grant_type_whitelist, scope_whitelist, group_whitelist, audiences, session_lifetime, etc. must appear in the output. NEVER leave placeholder comments like "preserve original attributes" — write the actual values
- Use variables for org_url and api_token
- Keep the same resource addresses/names from the original config
- The variable for the API token MUST be named "okta_api_token" (not "api_token")

Sub-resource handling:
- Sub-resources (indented with └─) are children of the parent resource above them
- For sub-resources like okta_auth_server_policy, okta_auth_server_scope, okta_auth_server_claim:
  - If the original config already uses a Terraform reference (e.g., okta_auth_server.NAME.id), preserve it as-is
  - If the config uses a hardcoded auth_server_id, replace it with a reference to the parent resource
- For okta_auth_server_policy_rule:
  - Preserve or replace both auth_server_id and policy_id with parent resource references
- For global policy rules (okta_policy_rule_signon, okta_policy_rule_password, okta_policy_rule_mfa, okta_policy_rule_profile_enrollment):
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
- okta_policy_rule_signon: policy_id/rule_id
- okta_policy_rule_password: policy_id/rule_id
- okta_policy_rule_mfa: policy_id/rule_id
- okta_policy_rule_profile_enrollment: policy_id/rule_id
- okta_app_user: app_id/user_id
- okta_app_group_assignment: app_id/group_id
- okta_group_memberships: group_id
- okta_authenticator_webauthn_custom_aaguid: authenticator_id/aaguid
- okta_authenticator_method_webauthn: authenticator_id
- okta_identity_source_group: identity_source_id/id
- okta_identity_source_group_membership: identity_source_id/group_or_external_id/id  ← 3-part ID, unusual format
- okta_identity_source_user: identity_source_id/id
- okta_app_signon_policy_rules: policy_id
- okta_app_signon_policy: id
- okta_label: id

Resources that do NOT support terraform import (never generate import blocks for these):
- okta_trusted_server — ImportState explicitly disabled in provider
- okta_resource_owner — no import support
- okta_identity_source_import — trigger-only resource, no import support

Rules:
- Every okta_group reference by ID → data.okta_group.NAME.id
- Every okta_app reference by ID → data.okta_app.NAME.id or data source lookup
- Every okta_auth_server sub-resource auth_server_id → okta_auth_server.NAME.id
- Every policy rule policy_id → reference to parent policy resource
- Every app assignment app_id → reference to parent app resource
- Generate one import block per matched resource (including sub-resources)
- Do NOT invent resources or attributes not in the original config
- If a resource is MISSING in target, add a comment noting it will be created

IMPORTANT — Resources that require special handling:

1. SYSTEM AUTH SERVER SCOPES: The scopes "openid", "profile", "email", "offline_access", and "address" are system-default scopes that exist on every auth server. They CANNOT be modified via API. For these scopes:
   - Do NOT include them as resource blocks in the output — they already exist and are immutable
   - Do NOT generate import blocks for them — importing then applying will fail with "system cannot be modified"
   - Only include CUSTOM (non-system) scopes in the resource definitions and import blocks

2. GRANT TYPE WHITELIST: When an okta_auth_server_policy_rule has "authorization_code", "implicit", or "password" in grant_type_whitelist, the Okta API REQUIRES either user_whitelist or group_whitelist to be set. If the source config includes any of these grant types but has no user_whitelist or group_whitelist, you MUST add:
   group_whitelist = ["EVERYONE"]

3. DYNAMIC NETWORK ZONES: Resources with type = "DYNAMIC" MUST have at least one of: dynamic_locations, asns, or dynamic_proxy_type configured. If the source config has a dynamic zone without these attributes, add a warning that the zone cannot be created without location/ASN/proxy configuration and comment out the resource block.

4. POLICY NAME CONFLICTS: If a resource is marked MATCHED with a target_id, it MUST have an import block and should NOT be created from scratch. If a resource is marked MISSING, it will be created — warn the user that if a resource with the same name already exists (matching may have missed it due to case/whitespace differences), the apply will fail with "name already in use" and they should import it instead.

5. POLICY RULE PRIORITY ORDERING: All policy rules (okta_auth_server_policy_rule, okta_policy_rule_signon, okta_policy_rule_password, okta_policy_rule_mfa, okta_policy_rule_profile_enrollment, okta_app_signon_policy_rule) MUST be chained with depends_on in ascending priority order within each parent policy. This prevents concurrent priority modifications that cause 409 conflicts and drift.

6. SYSTEM NETWORK ZONES: The network zones named "BlockedIpZone", "LegacyIpZone", "DefaultExemptIpZone", and "DefaultEnhancedDynamicZone" are system-managed zones that CANNOT be created, modified, or destroyed via Terraform. If any of these appear in the resource mapping context:
   - Do NOT generate any resource block for them — omit them entirely from the output HCL
   - Do NOT generate import blocks for them
   - These are pre-existing system resources that Terraform cannot manage

7. AUTH SERVER AUDIENCES: The "audiences" argument is REQUIRED for every okta_auth_server resource block. It MUST always be included:
   - If the source config specifies audiences, copy them verbatim
   - If the source config does not include audiences (e.g., empty config), default to: audiences = ["api://default"]
   - NEVER emit an okta_auth_server resource block without the audiences argument

For example, if a policy has 3 rules with priorities 1, 2, 3:

resource "okta_auth_server_policy_rule" "rule_1" {
  priority = 1
}
resource "okta_auth_server_policy_rule" "rule_2" {
  depends_on = [okta_auth_server_policy_rule.rule_1]
  priority   = 2
}
resource "okta_auth_server_policy_rule" "rule_3" {
  depends_on = [okta_auth_server_policy_rule.rule_2]
  priority   = 3
}

Chain rules within the same parent policy. Rules under different policies can run in parallel — only rules sharing the same parent need chaining.

Similarly, if multiple policies exist under the same auth server or scope, chain the policies themselves by priority:

resource "okta_auth_server_policy" "policy_2" {
  depends_on = [okta_auth_server_policy.policy_1]
  priority   = 2
}`,
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
