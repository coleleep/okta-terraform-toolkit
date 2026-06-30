import { contextBridge, ipcRenderer } from 'electron';

const api = {
  // Auth
  connect: (config: { orgUrl: string; authMethod: 'token'; token: string }) =>
    ipcRenderer.invoke('auth:connect', config),
  disconnect: () => ipcRenderer.invoke('auth:disconnect'),
  getConnectionStatus: () => ipcRenderer.invoke('auth:status'),

  // Probing
  startProbe: () => ipcRenderer.invoke('probe:start'),
  onProbeProgress: (callback: (progress: { completed: number; total: number; currentEndpoint: string }) => void) => {
    const handler = (_event: unknown, progress: { completed: number; total: number; currentEndpoint: string }) =>
      callback(progress);
    ipcRenderer.on('probe:progress', handler);
    return () => ipcRenderer.removeListener('probe:progress', handler);
  },

  // Analysis
  getRecommendations: (probeResult: unknown, workload?: unknown) =>
    ipcRenderer.invoke('probe:analyze', { probeResult, workload }),

  // Resource counting
  countResources: (types: string[]) =>
    ipcRenderer.invoke('resource:count', { types }),
  onCountProgress: (callback: (current: string) => void) => {
    const handler = (_event: unknown, current: string) => callback(current);
    ipcRenderer.on('resource:count-progress', handler);
    return () => ipcRenderer.removeListener('resource:count-progress', handler);
  },

  // Target runtime analysis
  analyzeTarget: (probeResult: unknown, workload: unknown, targetMinutes: number, recommendedConfig?: unknown, runtimeEstimate?: unknown) =>
    ipcRenderer.invoke('analyze:target', { probeResult, workload, targetMinutes, recommendedConfig, runtimeEstimate }),

  // Sub-resource probe (for custom workloads)
  probeSubResource: (terraformResource: string, primaryEndpoint: string) =>
    ipcRenderer.invoke('probe:sub-resource', { terraformResource, primaryEndpoint }),

  // TF_LOG analysis
  analyzeLog: (filePath: string) => ipcRenderer.invoke('log:analyze', filePath),
  openLogFile: () => ipcRenderer.invoke('log:open-file'),

  // Deep probe
  deepProbe: (resourceCounts: unknown) =>
    ipcRenderer.invoke('probe:deep', { resourceCounts }),
  onDeepProbeProgress: (callback: (progress: { completed: number; total: number; currentEndpoint: string }) => void) => {
    const handler = (_event: unknown, progress: { completed: number; total: number; currentEndpoint: string }) =>
      callback(progress);
    ipcRenderer.on('probe:deep-progress', handler);
    return () => ipcRenderer.removeListener('probe:deep-progress', handler);
  },

  // Claude AI
  interpretLog: (params: { analysis: unknown; probeResult?: unknown }) =>
    ipcRenderer.invoke('claude:interpret-log', params),
  buildWorkload: (description: string) => ipcRenderer.invoke('claude:build-workload', description),
  decodeError: (errorText: string) => ipcRenderer.invoke('claude:decode-error', errorText),
  generateSolution: (description: string, providerVersion: string) => ipcRenderer.invoke('claude:generate-solution', { description, providerVersion }),
  hasClaudeKey: () => ipcRenderer.invoke('claude:has-key'),
  setClaudeKey: (key: string) => ipcRenderer.invoke('claude:set-key', key),
  getClaudeConfig: () => ipcRenderer.invoke('claude:get-config'),
  setClaudeConfig: (config: { apiKey: string; baseUrl?: string }) =>
    ipcRenderer.invoke('claude:set-config', config),
  removeClaudeConfig: () => ipcRenderer.invoke('claude:remove-config'),

  // Sync
  syncOpenFiles: () => ipcRenderer.invoke('sync:open-files'),
  syncAnalyze: (tfFiles: Record<string, string>, stateContent?: string) =>
    ipcRenderer.invoke('sync:analyze', { tfFiles, stateContent }),
  syncConvert: (tfContent: string, matches: unknown[], targetOrgUrl: string) =>
    ipcRenderer.invoke('sync:convert', { tfContent, matches, targetOrgUrl }),
  stageTfFiles: (tfFiles: Record<string, string>, stateContent?: string) =>
    ipcRenderer.invoke('sync:stage-files', { tfFiles, stateContent }),
  syncDeepProbe: (terraformTypes: string[]) =>
    ipcRenderer.invoke('sync:deep-probe', { terraformTypes }),
  syncCompare: (sourceTypes: string[], reversed?: boolean) =>
    ipcRenderer.invoke('sync:compare', { sourceTypes, reversed }),
  onSyncDeepProbeProgress: (callback: (progress: { phase: string; detail: string; completed?: number; total?: number }) => void) => {
    const handler = (_event: unknown, progress: { phase: string; detail: string; completed?: number; total?: number }) => callback(progress);
    ipcRenderer.on('sync:deep-probe-progress', handler);
    return () => ipcRenderer.removeListener('sync:deep-probe-progress', handler);
  },
  onSyncCompareProgress: (callback: (progress: { phase: string; detail: string }) => void) => {
    const handler = (_event: unknown, progress: { phase: string; detail: string }) => callback(progress);
    ipcRenderer.on('sync:compare-progress', handler);
    return () => ipcRenderer.removeListener('sync:compare-progress', handler);
  },

  // File operations
  saveTfFile: (content: string) =>
    ipcRenderer.invoke('file:save-tf', { content }),
  saveProjectDir: (files: Record<string, string>) =>
    ipcRenderer.invoke('file:save-project', { files }),

  // Source org connection
  connectSource: (orgUrl: string, token: string) =>
    ipcRenderer.invoke('source:connect', { orgUrl, token }),
  disconnectSource: () =>
    ipcRenderer.invoke('source:disconnect'),
  getSourceStatus: () =>
    ipcRenderer.invoke('source:status'),

  // Logger settings
  setLogLevel: (level: string) =>
    ipcRenderer.invoke('settings:set-log-level', level),
  getLogLevel: () =>
    ipcRenderer.invoke('settings:get-log-level'),
  openLogFolder: () =>
    ipcRenderer.invoke('settings:open-log-folder'),

  // Terraform in-app runner
  terraformRun: (dir: string, args: string[], swapped?: boolean) =>
    ipcRenderer.invoke('terraform:run', { dir, args, swapped }),
  terraformCancel: () =>
    ipcRenderer.invoke('terraform:cancel'),
  onTerraformLine: (callback: (line: string) => void) => {
    const handler = (_event: unknown, line: string) => callback(line);
    ipcRenderer.on('terraform:line', handler);
    return () => ipcRenderer.removeListener('terraform:line', handler);
  },

  // Okta provider version management
  listProviderVersions: () =>
    ipcRenderer.invoke('provider:list-versions'),
  downloadProviderVersion: (version: string) =>
    ipcRenderer.invoke('provider:download-version', { version }),
  onProviderDownloadProgress: (callback: (progress: { version: string; percent: number }) => void) => {
    const handler = (_event: unknown, progress: { version: string; percent: number }) => callback(progress);
    ipcRenderer.on('provider:download-progress', handler);
    return () => ipcRenderer.removeListener('provider:download-progress', handler);
  },
  getSelectedProviderVersion: () =>
    ipcRenderer.invoke('provider:get-selected'),
  setSelectedProviderVersion: (version: string) =>
    ipcRenderer.invoke('provider:set-selected', { version }),

  // OCM status push from main (fired once after startup warm-up)
  onOcmStatus: (callback: (status: { available: boolean }) => void) => {
    const handler = (_event: unknown, status: { available: boolean }) => callback(status);
    ipcRenderer.on('claude:ocm-status', handler);
    return () => ipcRenderer.removeListener('claude:ocm-status', handler);
  },

  // Rollback
  saveRollback: (exportedDir: string, targetOrgUrl: string, providerVersion: string, exactProviderVersion?: string, swapped?: boolean, importedAddresses?: string[]) =>
    ipcRenderer.invoke('rollback:save-tf', { exportedDir, targetOrgUrl, providerVersion, exactProviderVersion, swapped, importedAddresses }),
  checkRollback: () =>
    ipcRenderer.invoke('rollback:check'),
  prepareRollback: () =>
    ipcRenderer.invoke('rollback:prepare'),
  clearRollback: () =>
    ipcRenderer.invoke('rollback:clear'),
};

contextBridge.exposeInMainWorld('oktaTerraform', api);

export type OktaTerraformAPI = typeof api;
