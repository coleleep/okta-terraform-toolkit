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
export interface EndpointProbeResult {
  endpoint: string;
  label: string;
  method: 'GET' | 'POST';
  limit: number;
  remaining: number;
  resetAt: number;
  resetWindowSecs: number;
  status: 'ok' | 'warning' | 'critical' | 'error' | 'skipped';
  httpStatus?: number;
  error?: string;
}

export interface ProbeResult {
  orgUrl: string;
  timestamp: string;
  endpoints: EndpointProbeResult[];
  overallMinLimit: number;
  probeDurationMs: number;
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
  | 'governance';

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

export interface TargetRuntimeAnalysis {
  targetMinutes: number;
  achievable: boolean;
  estimatedMinutes: number; // what current limits would actually take
  requiredThroughput: number; // total API calls per minute needed
  currentThroughput: number; // what current limits support per minute
  bottlenecks: EndpointBottleneck[];
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
}
