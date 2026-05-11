import { ipcMain } from 'electron';
import * as auth from './api/auth';
import { probeEndpoints } from './api/probe';
import { deepProbeSubResources } from './api/deep-probe';
import { analyzeAndRecommend } from './api/analyzer';
import { countResources } from './api/resource-counter';
import { analyzeTargetRuntime } from './api/target-analyzer';
import { probeSubResourceEndpoint } from './api/deep-probe';
import { parseLogFile } from './api/log-parser';
import { interpretLog, buildWorkload, decodeError, generateSolution, convertConfig, getApiKey, setApiKey, getClaudeConfig, setClaudeConfig, removeClaudeConfig } from './api/claude';
import { parseStateFile, syncWithSubResources, buildSyncSummary } from './api/sync';
import { getMainWindow } from './index';
import { ConnectionStatus, ManagedResourceType, ResourceCount, LogAnalysis } from '../shared/types';
import { RESOURCE_DICTIONARY } from '../shared/resource-dictionary';

export function registerIpcHandlers() {
  // Auth
  ipcMain.handle('auth:connect', async (_event, params) => {
    try {
      await auth.connect(params);
      return { success: true };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, error: message };
    }
  });

  ipcMain.handle('auth:disconnect', () => {
    auth.disconnect();
    return { success: true };
  });

  ipcMain.handle('auth:status', (): ConnectionStatus => {
    const config = auth.getConfig();
    return {
      connected: auth.isConnected(),
      orgUrl: config?.orgUrl,
    };
  });

  // Probe
  ipcMain.handle('probe:start', async () => {
    try {
      const config = auth.getConfig();
      if (!config) throw new Error('Not connected');

      const result = await probeEndpoints(config.orgUrl, (progress) => {
        const win = getMainWindow();
        if (win) {
          win.webContents.send('probe:progress', progress);
        }
      });

      return { success: true, data: result };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, error: message };
    }
  });

  // Analyze
  ipcMain.handle('probe:analyze', async (_event, params) => {
    try {
      const { probeResult, workload } = params;
      const recommendation = analyzeAndRecommend(probeResult, workload);
      return { success: true, data: recommendation };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, error: message };
    }
  });

  // Resource counting
  ipcMain.handle('resource:count', async (_event, params: { types: ManagedResourceType[] }) => {
    try {
      const results = await countResources(params.types, (current) => {
        const win = getMainWindow();
        if (win) {
          win.webContents.send('resource:count-progress', current);
        }
      });
      return { success: true, data: results };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, error: message };
    }
  });

  // Target runtime analysis
  ipcMain.handle('analyze:target', async (_event, params) => {
    try {
      const { probeResult, workload, targetMinutes, recommendedConfig, runtimeEstimate } = params;
      console.log(`[target] IPC: targetMinutes=${targetMinutes}, totalResources=${workload?.totalResources}, customWorkloads=${workload?.customWorkloads?.length}, hasRuntimeEstimate=${!!runtimeEstimate}`);
      const analysis = analyzeTargetRuntime(probeResult, workload, targetMinutes, recommendedConfig, runtimeEstimate);
      console.log(`[target] Result: achievable=${analysis.achievable}, est=${analysis.estimatedMinutes}, bottlenecks=${analysis.bottlenecks.length}`);
      return { success: true, data: analysis };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.log(`[target] ERROR: ${message}`);
      return { success: false, error: message };
    }
  });

  // Deep probe sub-resource endpoints
  ipcMain.handle('probe:deep', async (_event, params: { resourceCounts: ResourceCount[] }) => {
    try {
      const results = await deepProbeSubResources(params.resourceCounts, (progress) => {
        const win = getMainWindow();
        if (win) {
          win.webContents.send('probe:deep-progress', progress);
        }
      });
      return { success: true, data: results };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, error: message };
    }
  });

  // Probe a specific sub-resource endpoint for rate limits
  ipcMain.handle('probe:sub-resource', async (_event, params: { terraformResource: string; primaryEndpoint: string }) => {
    try {
      const result = await probeSubResourceEndpoint(params.terraformResource, params.primaryEndpoint);
      console.log(`[sub-probe] IPC result: limit=${result.limit}, reset=${result.resetWindowSecs}s, error=${result.error}`);
      return { success: true, data: result };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, error: message };
    }
  });

  // TF_LOG analysis
  ipcMain.handle('log:analyze', async (_event, filePath: string) => {
    try {
      console.log(`[log-parser] Analyzing: ${filePath}`);
      const analysis = await parseLogFile(filePath);
      console.log(`[log-parser] Done: ${analysis.totalRequests} requests, ${analysis.rateLimited} 429s, ${analysis.deadlineExceeded} deadline errors`);
      return { success: true, data: analysis };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.log(`[log-parser] Error: ${message}`);
      return { success: false, error: message };
    }
  });

  ipcMain.handle('log:open-file', async () => {
    const { dialog } = await import('electron');
    const win = getMainWindow();
    if (!win) return null;
    const result = await dialog.showOpenDialog(win, {
      title: 'Select Terraform Debug Log',
      filters: [{ name: 'Log Files', extensions: ['log', 'txt'] }],
      properties: ['openFile'],
    });
    return result.filePaths[0] ?? null;
  });

  // Claude AI
  ipcMain.handle('claude:interpret-log', async (_event, analysis: LogAnalysis) => {
    try {
      const result = await interpretLog(analysis);
      return { success: true, data: result };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, error: message };
    }
  });

  ipcMain.handle('claude:build-workload', async (_event, description: string) => {
    try {
      const entries = await buildWorkload(description);
      return { success: true, data: entries };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, error: message };
    }
  });

  ipcMain.handle('claude:generate-solution', async (_event, params: { description: string; providerVersion: string }) => {
    try {
      const result = await generateSolution(params.description, params.providerVersion);
      return { success: true, data: result };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, error: message };
    }
  });

  ipcMain.handle('claude:decode-error', async (_event, errorText: string) => {
    try {
      const result = await decodeError(errorText);
      return { success: true, data: result };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, error: message };
    }
  });

  ipcMain.handle('claude:has-key', () => {
    return { success: true, data: !!getApiKey() };
  });

  ipcMain.handle('claude:set-key', async (_event, key: string) => {
    try {
      setApiKey(key);
      return { success: true };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, error: message };
    }
  });

  ipcMain.handle('claude:get-config', () => {
    const config = getClaudeConfig();
    if (!config) return { success: true, data: null };
    return { success: true, data: { hasKey: true, baseUrl: config.baseUrl || '' } };
  });

  ipcMain.handle('claude:set-config', async (_event, config: { apiKey: string; baseUrl?: string }) => {
    try {
      setClaudeConfig({ apiKey: config.apiKey, baseUrl: config.baseUrl || undefined });
      return { success: true };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, error: message };
    }
  });

  ipcMain.handle('claude:remove-config', () => {
    try {
      removeClaudeConfig();
      return { success: true };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, error: message };
    }
  });

  // Sync — file upload
  ipcMain.handle('sync:open-files', async () => {
    const { dialog } = await import('electron');
    const win = getMainWindow();
    if (!win) return null;
    const result = await dialog.showOpenDialog(win, {
      title: 'Select Terraform files (.tf and/or .tfstate)',
      filters: [
        { name: 'Terraform Files', extensions: ['tf', 'tfstate', 'json'] },
        { name: 'All Files', extensions: ['*'] },
      ],
      properties: ['openFile', 'multiSelections'],
    });
    if (result.canceled || !result.filePaths.length) return null;

    const fs = await import('fs');
    const path = await import('path');
    const files: Record<string, string> = {};
    for (const fp of result.filePaths) {
      files[path.basename(fp)] = fs.readFileSync(fp, 'utf-8');
    }
    return { success: true, data: files };
  });

  // Sync — parse state + match against connected org (with sub-resource support)
  ipcMain.handle('sync:analyze', async (_event, params: { tfFiles: Record<string, string>; stateContent?: string }) => {
    try {
      // Parse state if provided (now links sub-resources to parents)
      const stateResources = params.stateContent ? parseStateFile(params.stateContent).resources : [];

      if (stateResources.length === 0) {
        return { success: true, data: buildSyncSummary([]) };
      }

      // Discover, match top-level resources, then discover and match sub-resources
      const { topLevelMatches, subResourceMatches } = await syncWithSubResources(stateResources);
      const allMatches = [...topLevelMatches, ...subResourceMatches];
      const summary = buildSyncSummary(allMatches);

      return { success: true, data: summary };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, error: message };
    }
  });

  // Sync — convert config via Claude
  ipcMain.handle('sync:convert', async (_event, params: {
    tfContent: string;
    matches: Array<{ sourceAddress: string; sourceId: string; sourceName: string; targetId: string | null; status: string; level?: number; parentSourceId?: string | null; parentTargetId?: string | null }>;
    targetOrgUrl: string;
  }) => {
    try {
      console.log(`[sync:convert] Starting conversion: ${params.matches.length} matches, targetOrg=${params.targetOrgUrl}`);
      const result = await convertConfig(params.tfContent, params.matches, params.targetOrgUrl);
      console.log(`[sync:convert] Success`);
      return { success: true, data: result };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[sync:convert] ERROR: ${message}`, error);
      return { success: false, error: message };
    }
  });

  // Sync — deep probe target org for resource types in the source config
  ipcMain.handle('sync:deep-probe', async (_event, params: { terraformTypes: string[] }) => {
    try {
      // Map terraform resource types to ManagedResourceTypes
      const parentTypes = new Set<ManagedResourceType>();
      for (const tfType of params.terraformTypes) {
        const entry = RESOURCE_DICTIONARY.find(r => r.terraformResource === tfType);
        if (entry) parentTypes.add(entry.parentType);
      }

      if (parentTypes.size === 0) {
        return { success: true, data: { probeResults: [], resourceCounts: [] } };
      }

      const types = Array.from(parentTypes);
      const win = getMainWindow();

      // Phase 1: Count resources in target org to get sample IDs
      if (win) win.webContents.send('sync:deep-probe-progress', { phase: 'counting', detail: 'Counting resources in target org...' });
      const counts = await countResources(types, (current) => {
        if (win) win.webContents.send('sync:deep-probe-progress', { phase: 'counting', detail: `Counting ${current}` });
      });

      // Phase 2: Deep probe sub-resource endpoints
      if (win) win.webContents.send('sync:deep-probe-progress', { phase: 'probing', detail: 'Deep probing rate limits...' });
      const probeResults = await deepProbeSubResources(counts, (progress) => {
        if (win) win.webContents.send('sync:deep-probe-progress', { phase: 'probing', detail: progress.currentEndpoint, completed: progress.completed, total: progress.total });
      });

      return { success: true, data: { probeResults, resourceCounts: counts } };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, error: message };
    }
  });

  // Save project directory
  ipcMain.handle('file:save-project', async (_event, params: { files: Record<string, string> }) => {
    try {
      const { dialog } = await import('electron');
      const fs = await import('fs');
      const path = await import('path');
      const win = getMainWindow();
      if (!win) throw new Error('No window');

      const result = await dialog.showOpenDialog(win, {
        title: 'Choose directory for Terraform project',
        properties: ['openDirectory', 'createDirectory'],
      });

      if (result.canceled || !result.filePaths[0]) {
        return { success: false, error: 'Cancelled' };
      }

      const dir = result.filePaths[0];
      for (const [filename, content] of Object.entries(params.files)) {
        fs.writeFileSync(path.join(dir, filename), content, 'utf8');
      }

      return { success: true, data: dir };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, error: message };
    }
  });

  // Save .tf file
  ipcMain.handle('file:save-tf', async (_event, params: { content: string }) => {
    try {
      const { dialog } = await import('electron');
      const win = getMainWindow();
      if (!win) throw new Error('No window');

      const result = await dialog.showSaveDialog(win, {
        title: 'Save Terraform Provider Configuration',
        defaultPath: 'provider.tf',
        filters: [
          { name: 'Terraform Files', extensions: ['tf'] },
          { name: 'All Files', extensions: ['*'] },
        ],
      });

      if (result.canceled || !result.filePath) {
        return { success: false, error: 'Cancelled' };
      }

      const fs = await import('fs');
      fs.writeFileSync(result.filePath, params.content, 'utf8');
      return { success: true, data: result.filePath };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, error: message };
    }
  });
}
