// Connection
export interface ConnectionConfig {
  orgUrl: string;
  authMethod: 'token';
  token: string;
}

export interface ConnectionStatus {
  connected: boolean;
  orgUrl?: string;
  error?: string;
}

// Terraform environment auth method (for scope/permission recommendations)
export type TerraformAuthMethod = 'api_token' | 'oauth';

// Probing

/**
 * Where a rate limit value came from. Precedence when merging, highest first:
 * manual (entered from a privileged internal lookup) > probe (measured now) >
 * log (measured at capture time) > baseline (published default, an estimate).
 */
export type LimitSource = 'probe' | 'log' | 'manual' | 'baseline';

export interface EndpointProbeResult {
  endpoint: string;
  label: string;
  method: 'GET' | 'POST';
  limit: number;
  /** Live capacity. Absent for manual and baseline sources, which know the limit but not current usage. */
  remaining?: number;
  /** Absent for manual and baseline sources. */
  resetAt?: number;
  resetWindowSecs: number;
  /** 'unknown' means the limit is known but live capacity is not — never rendered as critical. */
  status: 'ok' | 'warning' | 'critical' | 'error' | 'skipped' | 'unknown';
  source: LimitSource;
  httpStatus?: number;
  error?: string;
}

export interface ProbeResult {
  /** Display label for the limit set. An org URL for a live probe; a log filename or 'Manual entry' otherwise. */
  orgUrl: string;
  timestamp: string;
  endpoints: EndpointProbeResult[];
  overallMinLimit: number;
  probeDurationMs: number;
  /** Which producers contributed to this result. */
  sources: LimitSource[];
}

// Terraform provider config
export interface TerraformProviderConfig {
  max_retries: number;
  backoff: boolean;
  min_wait_seconds: number;
  max_wait_seconds: number;
  request_timeout: number;
  max_api_capacity: number;
  parallelism: number;
}

export interface ConfigRecommendation {
  current: TerraformProviderConfig;
  recommended: TerraformProviderConfig;
  explanations: Record<keyof TerraformProviderConfig, string>;
  runtimeEstimate?: RuntimeEstimate;
}

// IPC response wrapper
export interface IpcResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

// Probe progress
export interface ProbeProgress {
  completed: number;
  total: number;
  currentEndpoint: string;
}

// Resource selection & counting
export type ManagedResourceType =
  | 'users'
  | 'groups'
  | 'applications'
  | 'authServers'
  | 'policies'
  | 'idps'
  | 'networkZones'
  | 'trustedOrigins'
  | 'authenticators'
  | 'domains'
  | 'emailDomains'
  | 'brands'
  | 'eventHooks'
  | 'inlineHooks'
  | 'logStreams'
  | 'behaviors'
  | 'captchas'
  | 'devices'
  | 'profileMappings'
  | 'customRoles'
  | 'realms'
  | 'features'
  | 'pushProviders'
  | 'orgSettings'
  | 'governance'
  | 'identitySources';

export type OperationType = 'import' | 'create' | 'update' | 'full_lifecycle';

export interface ResourceCount {
  type: ManagedResourceType;
  label: string;
  count: number;           // total in org (from API)
  managedCount?: number;   // user override: how many Terraform manages (defaults to count)
  sampleId?: string;       // First resource ID found, used for sub-resource probing
  error?: string;
}

// Prevention options that control which sub-resource API calls the provider makes
export interface PreventionOptions {
  // Apps: skip fetching user/group assignments (deprecated but still functional)
  skipAppUsers: boolean;
  skipAppGroups: boolean;
  // Users: control whether roles/groups are fetched per user
  includeUserRoles: boolean;
  includeUserGroups: boolean;
  // Groups: control whether members are fetched per group
  includeGroupUsers: boolean;
}

export const DEFAULT_PREVENTION_OPTIONS: PreventionOptions = {
  skipAppUsers: false,
  skipAppGroups: false,
  includeUserRoles: false,
  includeUserGroups: false,
  includeGroupUsers: false,
};

export interface CustomWorkloadEntry {
  terraformResource: string;       // e.g., 'okta_app_user'
  count: number;                   // how many Terraform manages
  primaryEndpoint: string;         // rate-limit endpoint pattern, e.g., '/api/v1/apps/<id>/users'
  endpointLabel: string;           // e.g., 'App User Assignments'
  rateLimit: number;               // probed rate limit for that endpoint (0 if unknown)
}

export interface ResourceWorkload {
  selected: ManagedResourceType[];
  counts: ResourceCount[];
  totalResources: number;          // managed count (overridden or org total)
  orgTotalResources: number;       // raw count from Okta API
  operation: OperationType;
  preventionOptions: PreventionOptions;
  customWorkloads: CustomWorkloadEntry[];
}

// Recommendation with runtime estimate
export interface RuntimeEstimate {
  minMinutes: number;
  maxMinutes: number;
  explanation: string;
}

// "What if" target runtime analysis
export interface EndpointBottleneck {
  endpoint: string;
  label: string;
  method: 'GET' | 'POST';
  currentLimit: number;
  requiredLimit: number;
  increaseNeeded: number; // requiredLimit - currentLimit
  percentIncrease: number;
}

/**
 * How much of the workload the analysis actually had rate limit data for.
 *
 * Manual entry is deliberately sparse, so an unentered bucket could be the real
 * bottleneck. Reporting this is what keeps an optimistic verdict from reading as
 * a measured one in a rate limit increase request.
 */
export interface LimitCoverage {
  /** Distinct rate limit buckets this workload touches. */
  relevant: number;
  /** Buckets resolved from a probe, a log, or manual entry. */
  measured: number;
  /** Buckets resolved from a published baseline — an estimate, not a measurement. */
  estimated: number;
  /** Bucket labels with no limit data at all. */
  missingLabels: string[];
}

export interface TargetRuntimeAnalysis {
  targetMinutes: number;
  achievable: boolean;
  estimatedMinutes: number; // what current limits would actually take
  requiredThroughput: number; // total API calls per minute needed
  currentThroughput: number; // what current limits support per minute
  bottlenecks: EndpointBottleneck[];
  coverage: LimitCoverage;
  recommendedConfig?: TerraformProviderConfig; // config if increases granted
  summary: string;
}

// TF_LOG Analyzer
export interface LogAnalysis {
  detectedConfig: {
    minWait: number;
    maxWait: number;
    maxRetries: number;
    maxApiCapacity?: number;
    parallelism?: number;
  };
  startTime: string;
  endTime: string;
  durationSeconds: number;
  totalRequests: number;
  successfulRequests: number;
  rateLimited: number;
  errors: number;
  deadlineExceeded: number;
  rateLimitExhausted: number;
  estimatedBackoffSeconds: number;
  endpoints: LogEndpointStats[];
  issues: LogIssue[];
  // Error breakdown
  errorsByStatus: Record<number, number>;  // e.g., { 401: 5, 403: 12, 404: 3 }
  errorDetails: LogErrorDetail[];          // individual captured errors
  terraformErrors?: string[];              // provider/validation errors outside HTTP context
}

export interface LogErrorDetail {
  timestamp?: string;
  endpoint: string;
  label: string;
  httpStatus: number;
  oktaErrorCode?: string;   // E0000011, E0000003, etc.
  message?: string;         // error message from response
  count: number;            // how many times this exact error occurred
}

export interface LogEndpointStats {
  pattern: string;
  method: string;            // HTTP method — read and write buckets have separate limits
  label: string;
  totalCalls: number;
  rateLimited: number;
  errors: number;
  minRateLimit: number;
  lowestRemaining: number;
  errorsByStatus?: Record<number, number>;  // per-endpoint error breakdown
}

export interface LogIssue {
  severity: 'critical' | 'warning' | 'info';
  title: string;
  detail: string;
  recommendation: string;
}

// Claude AI interpretation
export interface ClaudeInterpretation {
  narrative: string;
  rootCause: string;
  topFix: string;
  configChanges?: Partial<TerraformProviderConfig>;
}

// Source org connection
export interface SourceConnectionStatus {
  connected: boolean;
  orgUrl?: string;
  error?: string;
}

// Pipeline stage tracking
export type SyncStage = 'idle' | 'discover' | 'match' | 'convert' | 'export' | 'done' | 'error';

export interface AmbiguousResource {
  resourceAddress: string;  // e.g., "okta_group.engineering"
  candidates: string[];     // candidate IDs in target org
}

export interface SyncPipelineState {
  stage: SyncStage;
  discoveredCount: number;
  matchedCount: number;
  ambiguousResources: AmbiguousResource[];
  convertedCount: number;
  error?: string;
}

// Logger
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

// ── Org Diff ───────────────────────────────────────────────
export interface FieldDiff {
  field: string;
  sourceValue: unknown;
  targetValue: unknown;
}

export interface ResourceDiff {
  sourceAddress: string;   // e.g. "okta_group.engineering"
  sourceType: string;      // e.g. "okta_group"
  sourceName: string;      // human-readable display name
  status: 'same' | 'changed' | 'missing' | 'ambiguous';
  candidates?: string[];   // populated for 'ambiguous' status
  fieldDiffs: FieldDiff[]; // empty when status is 'same', 'missing', or 'ambiguous'
  allSourceAttrs?: Record<string, unknown>; // raw API response for TF generation
}

export interface DiffResult {
  changed: number;
  missing: number;
  same: number;
  ambiguous: number;
  diffs: ResourceDiff[];
}

export interface CompareParams {
  sourceTypes: string[];
  reversed?: boolean;
}

export interface RollbackManifest {
  timestamp: string;
  targetOrgUrl: string;
  providerVersion: string;
  exactProviderVersion?: string;
  mode: 'tf-state';
  swapped?: boolean;
  importedAddresses?: string[];
}

export interface VaultEntry {
  token: string;         // e.g. "{{OKTA_ID_1}}"
  value: string;         // original hardcoded value — never sent to the LLM
  kind: 'okta_id' | 'org_url' | 'token' | 'client_secret' | 'email' | 'jwt' | 'pem_key' | 'hcl_pii_attr';
  sourceFile: string;    // filename this value was found in
  sourceAttr: string;    // HCL attribute name, e.g. "app_id" — used to derive a variable name on export
}

export interface VaultResult {
  maskedFiles: Record<string, string>; // filename -> masked content
  entries: VaultEntry[];
}

export interface Finding {
  id: string;
  category: 'correctness' | 'optimization';
  severity: 'error' | 'warning' | 'suggestion';
  file: string;
  resourceAddress: string;  // e.g. "okta_app_oauth.my_app"
  title: string;
  explanation: string;
  originalSnippet: string;  // exact original masked HCL that fixedSnippet replaces
  fixedSnippet: string;     // masked HCL after fix
}

export interface ValidatorAnalysis {
  findings: Finding[];
  fixedMaskedFiles: Record<string, string>; // filename -> corrected masked content (.tf/.tfvars only)
}
