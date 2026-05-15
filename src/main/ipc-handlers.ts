import { ipcMain, shell, app } from 'electron';
import { join } from 'path';
import * as path from 'path';
import * as fs from 'fs';
import * as auth from './api/auth';
import * as sourceAuth from './api/source-auth';
import { probeEndpoints } from './api/probe';
import { deepProbeSubResources } from './api/deep-probe';
import { analyzeAndRecommend } from './api/analyzer';
import { countResources } from './api/resource-counter';
import { analyzeTargetRuntime } from './api/target-analyzer';
import { probeSubResourceEndpoint } from './api/deep-probe';
import { parseLogFile } from './api/log-parser';
import { interpretLog, buildWorkload, decodeError, generateSolution, convertConfig, getApiKey, setApiKey, getClaudeConfig, setClaudeConfig, removeClaudeConfig } from './api/claude';
import { convertConfigDeterministic } from './api/sync-convert';
import { parseStateFile, syncWithSubResources, buildSyncSummary, discoverSourceResources, discoverTargetResources, matchResources, fetchAttributeDiff, parseTfAttributesFromFiles } from './api/sync';
import { logger, setLevel, getLevel } from './logger';
import { getMainWindow } from './index';
import { ConnectionStatus, ManagedResourceType, ResourceCount, LogAnalysis, CompareParams } from '../shared/types';
import { RESOURCE_DICTIONARY } from '../shared/resource-dictionary';
import { runTerraform, cancelTerraform } from './api/terraform';
import { saveTfStateRollbackBundle, checkRollbackBundle, prepareTfStateRollback, clearRollbackBundle } from './api/rollback';
import * as providerManager from './api/okta-provider-manager';

export function registerIpcHandlers() {
  // Auth
  ipcMain.handle('auth:connect', async (_event, params) => {
    try {
      await auth.connect(params);
      logger.info('auth', 'connected', { orgUrl: params.orgUrl });
      return { success: true };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('auth', 'connect failed', { error: message });
      return { success: false, error: message };
    }
  });

  ipcMain.handle('auth:disconnect', () => {
    auth.disconnect();
    logger.info('auth', 'disconnected');
    return { success: true };
  });

  ipcMain.handle('auth:status', (): ConnectionStatus => {
    const config = auth.getConfig();
    return {
      connected: auth.isConnected(),
      orgUrl: config?.orgUrl,
    };
  });

  // Source org connection
  ipcMain.handle('source:connect', async (_event, params: { orgUrl: string; token: string }) => {
    const result = await sourceAuth.connectSource({
      orgUrl: params.orgUrl,
      authMethod: 'token',
      token: params.token,
    });
    if (result.success) {
      logger.info('source-auth', 'connected', { orgUrl: params.orgUrl });
    } else {
      logger.error('source-auth', 'connect failed', { error: result.error });
    }
    return result;
  });

  ipcMain.handle('source:disconnect', () => {
    sourceAuth.disconnectSource();
    logger.info('source-auth', 'disconnected');
    return { success: true };
  });

  ipcMain.handle('source:status', () => {
    return sourceAuth.getSourceStatus();
  });

  // Logger settings
  ipcMain.handle('settings:set-log-level', (_event, level: string) => {
    const validLevels = ['debug', 'info', 'warn', 'error'];
    if (!validLevels.includes(level)) {
      return { success: false, error: `Invalid log level: ${level}` };
    }
    setLevel(level as 'debug' | 'info' | 'warn' | 'error');
    logger.info('settings', 'log level changed', { level });
    return { success: true };
  });

  ipcMain.handle('settings:get-log-level', () => {
    return { success: true, data: getLevel() };
  });

  ipcMain.handle('settings:open-log-folder', async () => {
    const userData = app.getPath('userData');
    await shell.openPath(userData);
    return { success: true };
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
      let stateResources;

      if (sourceAuth.isSourceConnected()) {
        // Live source org path: discover resources via API
        logger.info('sync', 'discover started', { source: 'live-org' });
        const client = sourceAuth.getSourceClient()!;
        stateResources = await discoverSourceResources(client);
        logger.info('sync', 'discovered resources', { count: stateResources.length });
      } else if (params.stateContent) {
        // File upload path: parse .tfstate
        logger.info('sync', 'discover started', { source: 'tfstate-file' });
        stateResources = parseStateFile(params.stateContent).resources;
        logger.info('sync', 'parsed state file', { count: stateResources.length });
      } else {
        return {
          success: false,
          error: 'No source data: connect a source org or upload a .tfstate file',
        };
      }

      if (stateResources.length === 0) {
        return {
          success: true,
          data: {
            summary: buildSyncSummary([]),
            diff: { changed: 0, missing: 0, same: 0, ambiguous: 0, diffs: [] },
          },
        };
      }

      const { topLevelMatches, subResourceMatches } = await syncWithSubResources(stateResources);
      const allMatches = [...topLevelMatches, ...subResourceMatches];
      const summary = buildSyncSummary(allMatches);

      logger.info('sync', 'match complete', {
        total: summary.totalResources,
        matched: summary.matched,
        ambiguous: summary.ambiguous,
        missing: summary.missing,
      });

      // Attribute diff pass
      const tfParsedAttributes = parseTfAttributesFromFiles(params.tfFiles);
      let diff: import('../shared/types').DiffResult | null = null;
      try {
        diff = await fetchAttributeDiff(
          allMatches,
          sourceAuth.isSourceConnected() ? sourceAuth.getSourceClient() : null,
          auth.getClient(),
          tfParsedAttributes,
        );
        logger.info('sync', 'attribute diff complete', {
          changed: diff.changed,
          missing: diff.missing,
          same: diff.same,
        });
      } catch (diffError: unknown) {
        const msg = diffError instanceof Error ? diffError.message : String(diffError);
        logger.warn('sync', 'attribute diff failed, proceeding without diff', { error: msg });
      }

      return { success: true, data: { summary, diff } };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('sync', 'analyze failed', { error: message });
      return { success: false, error: message };
    }
  });

  // Org Comparison — discover both orgs directly, no .tf files needed
  ipcMain.handle('sync:compare', async (_event, params: CompareParams) => {
    try {
      if (!sourceAuth.isSourceConnected()) {
        return { success: false, error: 'Source org not connected.' };
      }
      if (!auth.isConnected()) {
        return { success: false, error: 'Target org not connected.' };
      }

      const connectedSourceClient = sourceAuth.getSourceClient()!;
      const connectedTargetClient = auth.getClient();

      // When reversed, treat the main connection as source and the secondary as target
      const effectiveSourceClient = params.reversed ? connectedTargetClient : connectedSourceClient;
      const effectiveTargetClient = params.reversed ? connectedSourceClient : connectedTargetClient;

      logger.info('sync', 'compare started', { typeCount: params.sourceTypes.length, reversed: !!params.reversed });

      const win = getMainWindow();
      if (win) win.webContents.send('sync:compare-progress', { phase: 'source', detail: 'Discovering source org resources...' });
      const sourceResources = await discoverSourceResources(effectiveSourceClient, params.sourceTypes);

      if (win) win.webContents.send('sync:compare-progress', { phase: 'target', detail: 'Discovering target org resources...' });
      const targetResources = await discoverTargetResources(params.sourceTypes, params.reversed ? connectedSourceClient : undefined);

      if (win) win.webContents.send('sync:compare-progress', { phase: 'match', detail: 'Matching resources...' });
      const matches = matchResources(sourceResources, targetResources);
      const summary = buildSyncSummary(matches);

      if (win) win.webContents.send('sync:compare-progress', { phase: 'diff', detail: `Fetching attribute differences for ${summary.totalResources} resources...` });
      const unambiguous = matches.filter(m => m.status !== 'ambiguous');
      const diff = await fetchAttributeDiff(unambiguous, effectiveSourceClient, effectiveTargetClient, {});

      logger.info('sync', 'compare complete', {
        total: summary.totalResources,
        matched: summary.matched,
      });

      // Write compare debug log with raw resource data samples
      const compareDebugPath = join(app.getPath('userData'), 'compare-debug.log');
      const sampleResources = sourceResources.slice(0, 20).map(r => ({
        address: r.address,
        type: r.type,
        attrKeys: Object.keys(r.attributes),
        attrSample: JSON.stringify(r.attributes).slice(0, 500),
      }));
      const compareDebug = [
        `=== Compare Debug ${new Date().toISOString()} ===`,
        `Source resources: ${sourceResources.length}`,
        `Target resources: ${targetResources.length}`,
        `Matches: ${matches.length} (matched: ${summary.matched}, missing: ${summary.missing}, ambiguous: ${summary.ambiguous})`,
        `\n--- Sample source resources (first 20) ---`,
        ...sampleResources.map(r => `${r.address} [${r.type}] keys=[${r.attrKeys.join(',')}]\n  ${r.attrSample}`),
        `\n--- Diff summary ---`,
        `Changed: ${diff.changed}, Missing: ${diff.missing}, Same: ${diff.same}, Ambiguous: ${diff.ambiguous}`,
        `\n=== END ===\n`,
      ];
      fs.writeFileSync(compareDebugPath, compareDebug.join('\n'), 'utf8');

      return { success: true, data: { summary, diff, matches } };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('sync', 'compare failed', { error: message });
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
      logger.info('sync', 'convert started', { matchCount: params.matches.length, targetOrg: params.targetOrgUrl });
      // Use deterministic convert for large payloads (>50 matches) to avoid API timeouts.
      // AI convert is reserved for smaller, file-based syncs where it adds value.
      const useAi = getApiKey() && params.matches.length <= 50;
      const result = useAi
        ? await convertConfig(params.tfContent, params.matches, params.targetOrgUrl)
        : convertConfigDeterministic(params.tfContent, params.matches, params.targetOrgUrl);
      logger.info('sync', 'convert complete', { mode: useAi ? 'ai' : 'deterministic' });

      // Write debug log with generated TF content and warnings
      const debugPath = join(app.getPath('userData'), 'convert-debug.log');
      const debugLines = [
        `=== Convert Debug ${new Date().toISOString()} ===`,
        `Mode: ${useAi ? 'ai' : 'deterministic'}`,
        `Matches: ${params.matches.length}`,
        `Target: ${params.targetOrgUrl}`,
        `Warnings (${result.warnings.length}):`,
        ...result.warnings.map(w => `  - ${w}`),
        `\n--- Generated HCL (first 5000 chars) ---`,
        result.portableHcl.slice(0, 5000),
        `\n--- Import Blocks (first 2000 chars) ---`,
        result.importBlocks.slice(0, 2000),
        `\n--- Input TF Content (first 3000 chars) ---`,
        params.tfContent.slice(0, 3000),
        `\n=== END ===\n`,
      ];
      fs.writeFileSync(debugPath, debugLines.join('\n'), 'utf8');
      logger.info('sync', 'debug log written', { path: debugPath });

      return { success: true, data: result };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('sync', 'convert failed', { error: message });
      return { success: false, error: message };
    }
  });

  // Sync — stage uploaded tf files to a temp dir (tf-files mode, no dialog)
  ipcMain.handle('sync:stage-files', async (_event, params: { tfFiles: Record<string, string>; stateContent?: string }) => {
    try {
      const os = await import('os');
      const path = await import('path');
      const fs = await import('fs');
      const tmpDir = path.join(os.tmpdir(), `okta-tf-stage-${Date.now()}`);
      fs.mkdirSync(tmpDir, { recursive: true });
      for (const [filename, content] of Object.entries(params.tfFiles)) {
        fs.writeFileSync(path.join(tmpDir, filename), content, 'utf8');
      }
      if (params.stateContent) {
        fs.writeFileSync(path.join(tmpDir, 'terraform.tfstate'), params.stateContent, 'utf8');
      }
      return { success: true, data: tmpDir };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
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

  ipcMain.handle('terraform:run', async (event, { dir, args, swapped }: { dir: string; args: string[]; swapped?: boolean }) => {
    try {
      const tfEnv: Record<string, string> = {};
      // Enable TF debug logging
      const tfLogPath = join(app.getPath('userData'), 'terraform-debug.log');
      tfEnv['TF_LOG'] = 'DEBUG';
      tfEnv['TF_LOG_PATH'] = tfLogPath;
      logger.info('terraform', 'debug log path', { path: tfLogPath });

      if (swapped) {
        const srcConfig = sourceAuth.getSourceConfig();
        const rawToken = srcConfig?.token ?? '';
        const cleanToken = rawToken.trim().replace(/^SSWS\s+/i, '');
        if (cleanToken) tfEnv['TF_VAR_okta_api_token'] = cleanToken;
        logger.info('terraform', 'using source token', { hasToken: !!cleanToken, swapped: true });
      } else {
        const config = auth.getConfig();
        const rawToken = config?.token ?? '';
        const cleanToken = rawToken.trim().replace(/^SSWS\s+/i, '');
        if (cleanToken) tfEnv['TF_VAR_okta_api_token'] = cleanToken;
        logger.info('terraform', 'using target token', { hasToken: !!cleanToken, swapped: false });
      }
      const selectedVersion = providerManager.getSelectedVersion();
      if (selectedVersion !== 'system') {
        if (!providerManager.isVersionCached(selectedVersion)) {
          event.sender.send('terraform:line', `[otto] Warning: provider ${selectedVersion} not cached — falling back to registry`);
        } else {
          providerManager.ensureMirrorLayout(selectedVersion);
          tfEnv['TF_CLI_CONFIG_FILE'] = providerManager.getCliConfigPath();
        }
      }
      const { exitCode } = await runTerraform(dir, args, (line) => {
        event.sender.send('terraform:line', line);
      }, tfEnv);
      return { success: exitCode === 0, exitCode };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      const isNotFound = message.includes('ENOENT') || message.includes('not found');
      return {
        success: false,
        exitCode: -1,
        error: isNotFound
          ? 'terraform not found — install from https://developer.hashicorp.com/terraform/downloads'
          : message,
      };
    }
  });

  ipcMain.handle('terraform:cancel', () => {
    cancelTerraform();
    return { success: true };
  });

  // Provider version management
  ipcMain.handle('provider:list-versions', async () => {
    try {
      const versions = await providerManager.listGitHubVersions();
      return { success: true, data: versions };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, error: message };
    }
  });

  ipcMain.handle('provider:download-version', async (event, { version }: { version: string }) => {
    try {
      await providerManager.downloadAndExtract(version, (percent) => {
        event.sender.send('provider:download-progress', { version, percent });
      });
      return { success: true };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, error: message };
    }
  });

  ipcMain.handle('provider:get-selected', () => {
    return { success: true, data: providerManager.getSelectedVersion() };
  });

  ipcMain.handle('provider:set-selected', (_event, { version }: { version: string }) => {
    providerManager.setSelectedVersion(version);
    return { success: true };
  });

  ipcMain.handle('rollback:save-tf', (_event, { exportedDir, targetOrgUrl, providerVersion, exactProviderVersion, swapped, importedAddresses }: { exportedDir: string; targetOrgUrl: string; providerVersion: string; exactProviderVersion?: string; swapped?: boolean; importedAddresses?: string[] }) => {
    try {
      saveTfStateRollbackBundle(exportedDir, targetOrgUrl, providerVersion, exactProviderVersion, swapped, importedAddresses);
      return { success: true };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, error: message };
    }
  });

  ipcMain.handle('rollback:check', () => {
    try {
      const result = checkRollbackBundle();
      return { success: true, data: result };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, error: message };
    }
  });

  ipcMain.handle('rollback:prepare', () => {
    try {
      const result = prepareTfStateRollback();
      return { success: true, data: result };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, error: message };
    }
  });

  ipcMain.handle('rollback:clear', () => {
    try {
      clearRollbackBundle();
      return { success: true };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, error: message };
    }
  });
}
