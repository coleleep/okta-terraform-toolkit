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
  interpretLog: (analysis: unknown) => ipcRenderer.invoke('claude:interpret-log', analysis),
  buildWorkload: (description: string) => ipcRenderer.invoke('claude:build-workload', description),
  decodeError: (errorText: string) => ipcRenderer.invoke('claude:decode-error', errorText),
  generateSolution: (description: string, providerVersion: string) => ipcRenderer.invoke('claude:generate-solution', { description, providerVersion }),
  hasClaudeKey: () => ipcRenderer.invoke('claude:has-key'),
  setClaudeKey: (key: string) => ipcRenderer.invoke('claude:set-key', key),

  // Sync
  syncOpenFiles: () => ipcRenderer.invoke('sync:open-files'),
  syncAnalyze: (tfFiles: Record<string, string>, stateContent?: string) =>
    ipcRenderer.invoke('sync:analyze', { tfFiles, stateContent }),
  syncConvert: (tfContent: string, matches: unknown[], targetOrgUrl: string) =>
    ipcRenderer.invoke('sync:convert', { tfContent, matches, targetOrgUrl }),
  syncDeepProbe: (terraformTypes: string[]) =>
    ipcRenderer.invoke('sync:deep-probe', { terraformTypes }),
  onSyncDeepProbeProgress: (callback: (progress: { phase: string; detail: string; completed?: number; total?: number }) => void) => {
    const handler = (_event: unknown, progress: { phase: string; detail: string; completed?: number; total?: number }) => callback(progress);
    ipcRenderer.on('sync:deep-probe-progress', handler);
    return () => ipcRenderer.removeListener('sync:deep-probe-progress', handler);
  },

  // File operations
  saveTfFile: (content: string) =>
    ipcRenderer.invoke('file:save-tf', { content }),
  saveProjectDir: (files: Record<string, string>) =>
    ipcRenderer.invoke('file:save-project', { files }),
};

contextBridge.exposeInMainWorld('oktaTerraform', api);

export type OktaTerraformAPI = typeof api;
