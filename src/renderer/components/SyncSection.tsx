import React, { useState, useEffect, useRef } from 'react';
import { useStore } from '../hooks/useStore';
import { generateVersionsTf, generateVariablesTf, generateTfFromMatches, getOrgInfo } from '../../shared/terraform-gen';
import { EndpointProbeResult, ConfigRecommendation, ProbeResult, FieldDiff, ResourceDiff, DiffResult, RollbackManifest } from '../../shared/types';
import DiffView, { friendlyName } from './DiffView';

// Local type aliases mirroring main-process types (renderer cannot import main-process modules)
interface ResourceMatch {
  sourceAddress: string;
  sourceType: string;
  sourceId: string;
  sourceName: string;
  targetId: string | null;
  targetName: string | null;
  status: 'matched' | 'missing' | 'ambiguous';
  level: number;
  parentSourceId?: string | null;
  parentTargetId?: string | null;
  candidates?: string[];
}

interface SyncSummary {
  totalResources: number;
  matched: number;
  missing: number;
  ambiguous: number;
  subResourceCount: number;
  byType: Record<string, { total: number; matched: number; missing: number }>;
  matches: ResourceMatch[];
}

interface ConvertedConfig {
  portableHcl: string;
  importBlocks: string;
  instructions: string[];
  warnings: string[];
}

type SyncStage = 'idle' | 'discover' | 'match' | 'convert' | 'done' | 'error';
type TfRunStage = 'idle' | 'init' | 'plan' | 'awaiting-confirm' | 'apply' | 'done' | 'no-changes' | 'error';
type RollbackStage = 'idle' | 'init' | 'plan' | 'awaiting-confirm' | 'apply' | 'done' | 'error';

const ALL_COMPARABLE_TYPES = [
  'okta_user', 'okta_group', 'okta_app', 'okta_policy',
  'okta_policy_rule', 'okta_auth_server', 'okta_network_zone',
  'okta_group_rule', 'okta_app_user', 'okta_app_group',
] as const;

const api = (window as unknown as {
  oktaTerraform: {
    connectSource: (orgUrl: string, token: string) => Promise<{ success: boolean; data?: { connected: boolean; orgUrl?: string }; error?: string }>;
    disconnectSource: () => Promise<{ success: boolean }>;
    getSourceStatus: () => Promise<{ connected: boolean; orgUrl?: string }>;
    syncOpenFiles: () => Promise<{ success: boolean; data?: Record<string, string> } | null>;
    syncAnalyze: (tfFiles: Record<string, string>, stateContent?: string) =>
      Promise<{ success: boolean; data?: { summary: SyncSummary; diff: DiffResult | null }; error?: string }>;
    syncConvert: (tfContent: string, matches: ResourceMatch[], targetOrgUrl: string) =>
      Promise<{ success: boolean; data?: ConvertedConfig; error?: string }>;
    stageTfFiles: (tfFiles: Record<string, string>, stateContent?: string) =>
      Promise<{ success: boolean; data?: string; error?: string }>;
    syncDeepProbe: (terraformTypes: string[]) =>
      Promise<{ success: boolean; data?: { probeResults: unknown[]; resourceCounts: unknown[] }; error?: string }>;
    syncCompare: (sourceTypes: string[], reversed?: boolean) =>
      Promise<{ success: boolean; data?: { summary: SyncSummary; diff: DiffResult; matches: ResourceMatch[] }; error?: string }>;
    onSyncDeepProbeProgress: (callback: (progress: { phase: string; detail: string; completed?: number; total?: number }) => void) => () => void;
    onSyncCompareProgress: (callback: (progress: { phase: string; detail: string }) => void) => () => void;
    saveProjectDir: (files: Record<string, string>) => Promise<{ success: boolean; data?: string; error?: string }>;
    getRecommendations: (probeResult: unknown, workload?: unknown) => Promise<{ success: boolean; data?: unknown; error?: string }>;
    terraformRun: (dir: string, args: string[], swapped?: boolean) => Promise<{ success: boolean; exitCode: number; error?: string }>;
    terraformCancel: () => Promise<{ success: boolean }>;
    onTerraformLine: (callback: (line: string) => void) => () => void;
    getSelectedProviderVersion: () => Promise<{ success?: boolean; data?: string }>;
    saveRollback: (exportedDir: string, targetOrgUrl: string, providerVersion: string, exactProviderVersion?: string, swapped?: boolean, importedAddresses?: string[]) => Promise<{ success: boolean; error?: string }>;
    checkRollback: () => Promise<{ success: boolean; data?: { available: boolean; manifest: RollbackManifest | null }; error?: string }>;
    prepareRollback: () => Promise<{ success: boolean; data?: { rollbackDir: string; manifest: RollbackManifest }; error?: string }>;
    clearRollback: () => Promise<{ success: boolean; error?: string }>;
  }
}).oktaTerraform;

export default function SyncSection() {
  const { connection, probeResult, recommendation, providerVersion, connect: connectTargetOrg, disconnect: disconnectTargetOrg } = useStore();

  // Target org panel state (tf-files mode)
  const [targetUrl, setTargetUrl] = useState('');
  const [targetToken, setTargetToken] = useState('');
  const [targetConnecting, setTargetConnecting] = useState(false);
  const [targetError, setTargetError] = useState<string | null>(null);
  const [targetEditing, setTargetEditing] = useState(false);

  // Source org panel state
  const [sourceUrl, setSourceUrl] = useState('');
  const [sourceToken, setSourceToken] = useState('');
  const [sourceConnected, setSourceConnected] = useState(false);
  const [sourceConnectedUrl, setSourceConnectedUrl] = useState('');
  const [sourceConnecting, setSourceConnecting] = useState(false);
  const [sourceError, setSourceError] = useState<string | null>(null);

  // File upload state
  const [tfFiles, setTfFiles] = useState<Record<string, string>>({});
  const [stateContent, setStateContent] = useState<string | undefined>();
  const [previewFile, setPreviewFile] = useState<string | null>(null);

  // Pipeline state
  const [stage, setStage] = useState<SyncStage>('idle');
  const [summary, setSummary] = useState<SyncSummary | null>(null);
  const [converted, setConverted] = useState<ConvertedConfig | null>(null);
  const [pipelineError, setPipelineError] = useState<string | null>(null);

  // Review gate state
  const [resolvedCandidates, setResolvedCandidates] = useState<Record<string, string>>({});

  // Diff state
  const [diff, setDiff] = useState<DiffResult | null>(null);

  // Org Comparison mode state
  const [mode, setModeState] = useState<'compare' | 'tf-files'>('tf-files');
  const [selectedTypes, setSelectedTypes] = useState<Set<string>>(new Set(ALL_COMPARABLE_TYPES));
  const [compareMatches, setCompareMatches] = useState<ResourceMatch[] | null>(null);
  const [swapped, setSwapped] = useState(false);

  // Compare-mode-specific pipeline state (independent from tf-files pipeline state)
  const [compareStage, setCompareStage] = useState<SyncStage>('idle');
  const [compareSummary, setCompareSummary] = useState<SyncSummary | null>(null);
  const [compareDiff, setCompareDiff] = useState<DiffResult | null>(null);
  const [comparePipelineError, setComparePipelineError] = useState<string | null>(null);

  // Managed provider version state
  const [managedProviderVersion, setManagedProviderVersion] = useState<string>('system');

  // UI helpers
  const [copied, setCopied] = useState(false);
  const [probeProgress, setProbeProgress] = useState<string | null>(null);

  // Terraform in-app runner state
  const [exportedDir, setExportedDir] = useState<string | null>(null);
  const [tfStage, setTfStage] = useState<TfRunStage>('idle');
  const [tfLines, setTfLines] = useState<string[]>([]);
  const [tfError, setTfError] = useState<string | null>(null);
  const tfOutputRef = useRef<HTMLDivElement>(null);

  // Rollback state
  const [rollbackAvailable, setRollbackAvailable] = useState(false);
  const [rollbackManifest, setRollbackManifest] = useState<RollbackManifest | null>(null);
  const [rollbackDir, setRollbackDir] = useState<string | null>(null);
  const [rollbackStage, setRollbackStage] = useState<RollbackStage>('idle');
  const [rollbackLines, setRollbackLines] = useState<string[]>([]);
  const [rollbackError, setRollbackError] = useState<string | null>(null);
  const [showRollback, setShowRollback] = useState(false);
  const [warningsCollapsed, setWarningsCollapsed] = useState(false);
  const rollbackOutputRef = useRef<HTMLDivElement>(null);

  const hasTfFiles = Object.keys(tfFiles).length > 0;
  const canRunPipeline = hasTfFiles && stateContent !== undefined;

  // ── Auto-scroll terraform output pane ──────────────────────
  useEffect(() => {
    if (tfOutputRef.current) {
      tfOutputRef.current.scrollTop = tfOutputRef.current.scrollHeight;
    }
  }, [tfLines]);

  // ── Auto-scroll rollback output pane ───────────────────────
  useEffect(() => {
    if (rollbackOutputRef.current) {
      rollbackOutputRef.current.scrollTop = rollbackOutputRef.current.scrollHeight;
    }
  }, [rollbackLines]);

  // ── Check for existing rollback bundle on mount ─────────────
  useEffect(() => {
    api.checkRollback().then((r) => {
      if (r?.data?.available) {
        setRollbackAvailable(true);
        setRollbackManifest(r.data.manifest);
      }
    }).catch(() => {/* ignore */});
  }, []);

  // ── Restore source connection state on mount ───────────────
  useEffect(() => {
    api.getSourceStatus().then((status) => {
      if (status.connected) {
        setSourceConnected(true);
        setSourceConnectedUrl(status.orgUrl ?? '');
      }
    }).catch(() => {/* ignore */});
  }, []);

  // ── Fetch managed provider version on mount ────────────────
  useEffect(() => {
    api.getSelectedProviderVersion().then((r: any) => {
      if (r?.data) setManagedProviderVersion(r.data);
    });
  }, []);

  // ── Source org handlers ────────────────────────────────────

  const handleConnectSource = async () => {
    if (!sourceUrl.trim() || !sourceToken.trim()) return;
    setSourceConnecting(true);
    setSourceError(null);

    const result = await api.connectSource(sourceUrl.trim(), sourceToken.trim());

    if (result.success && result.data?.connected) {
      setSourceConnected(true);
      setSourceConnectedUrl(result.data.orgUrl ?? sourceUrl.trim());
      setSourceUrl('');
      setSourceToken('');
    } else {
      setSourceError(result.error ?? 'Connection failed');
    }
    setSourceConnecting(false);
  };

  const handleDisconnectSource = async () => {
    await api.disconnectSource();
    setSourceConnected(false);
    setSourceConnectedUrl('');
  };

  // ── File upload handler ────────────────────────────────────

  const handleUploadFiles = async () => {
    const result = await api.syncOpenFiles();
    if (!result?.success || !result.data) return;

    const newTfFiles: Record<string, string> = {};
    let newStateContent: string | undefined;

    for (const [name, content] of Object.entries(result.data)) {
      if (name.endsWith('.tfstate') || name === 'terraform.tfstate') {
        newStateContent = content;
      } else {
        newTfFiles[name] = content;
      }
    }

    setTfFiles(newTfFiles);
    setStateContent(newStateContent);
    setSummary(null);
    setConverted(null);
    setStage('idle');
    setPipelineError(null);
    setResolvedCandidates({});
    setPreviewFile(null);
  };

  // ── Background deep probe (preserves rate-limit data) ─────

  const triggerDeepProbe = async (terraformTypes: string[]) => {
    if (terraformTypes.length === 0 || !probeResult) return;
    setProbeProgress('Probing target org rate limits...');

    const cleanup = api.onSyncDeepProbeProgress((progress) => {
      if (progress.total && progress.completed !== undefined) {
        setProbeProgress(`${progress.detail} (${progress.completed}/${progress.total})`);
      } else {
        setProbeProgress(progress.detail);
      }
    });

    const result = await api.syncDeepProbe(terraformTypes);
    cleanup();

    if (result.success && result.data) {
      const subResults = result.data.probeResults as EndpointProbeResult[];
      const mergedEndpoints: EndpointProbeResult[] = [...probeResult.endpoints, ...subResults];
      const successfulAll = mergedEndpoints.filter(r => r.status !== 'error' && r.status !== 'skipped' && r.limit > 0);
      const mergedProbeResult: ProbeResult = {
        ...probeResult,
        endpoints: mergedEndpoints,
        overallMinLimit: successfulAll.length > 0
          ? Math.min(...successfulAll.map(r => r.limit))
          : probeResult.overallMinLimit,
      };
      const recResult = await api.getRecommendations(mergedProbeResult);
      if (recResult.success && recResult.data) {
        useStore.setState({ probeResult: mergedProbeResult, recommendation: recResult.data as ConfigRecommendation });
      }
    }
    setProbeProgress(null);
  };

  // ── Target org handlers (tf-files mode) ───────────────────

  const handleConnectTarget = async () => {
    if (!targetUrl.trim() || !targetToken.trim()) return;
    setTargetConnecting(true);
    setTargetError(null);
    const ok = await connectTargetOrg({ orgUrl: targetUrl.trim(), authMethod: 'token', token: targetToken.trim() });
    if (ok) {
      setTargetUrl('');
      setTargetToken('');
      setTargetEditing(false);
    } else {
      setTargetError(useStore.getState().connection.error ?? 'Connection failed');
    }
    setTargetConnecting(false);
  };

  const handleDisconnectTarget = () => {
    disconnectTargetOrg();
    setTargetEditing(false);
    setTargetError(null);
  };

  // ── Pipeline handlers ──────────────────────────────────────

  const handleRunPipeline = async () => {
    setPipelineError(null);
    setSummary(null);
    setConverted(null);
    setResolvedCandidates({});
    setDiff(null);
    setExportedDir(null);
    setTfStage('idle');
    setTfLines([]);
    setTfError(null);

    if (mode === 'tf-files') {
      setStage('discover');

      const filesToStage = { ...tfFiles };

      // Always inject a canonical versions.tf with okta/okta source.
      // Strip any terraform {} blocks from uploaded files to avoid conflicts,
      // then remove any user-supplied versions.tf in favor of the generated one.
      for (const name of Object.keys(filesToStage)) {
        if (name.endsWith('.tf') && /^\s*terraform\s*\{/m.test(filesToStage[name])) {
          filesToStage[name] = filesToStage[name].replace(
            /^\s*terraform\s*\{(?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*\}\s*\n?/gm,
            '',
          );
        }
      }
      const exactVersion = managedProviderVersion !== 'system' ? managedProviderVersion : undefined;
      filesToStage['versions.tf'] = generateVersionsTf(providerVersion, exactVersion);

      // Stage files to disk (creates temp dir for any downstream TF operations)
      const stageResult = await api.stageTfFiles(filesToStage, stateContent);
      if (!stageResult.success || !stageResult.data) {
        setPipelineError(stageResult.error ?? 'Failed to stage files');
        setStage('error');
        return;
      }
      // Don't expose staged dir as exportedDir yet — handleExport() will set the
      // properly converted dir (with provider.tf, variables.tf, etc.) when the user exports.

      // Analyze uploaded files against connected target org
      const analyzeResult = await api.syncAnalyze(tfFiles, stateContent);
      if (!analyzeResult.success || !analyzeResult.data) {
        setPipelineError(analyzeResult.error ?? 'Discovery failed');
        setStage('error');
        return;
      }

      const { summary: newSummary, diff: newDiff } = analyzeResult.data;
      setSummary(newSummary);
      setDiff(newDiff);
      setStage('match');

      // Kick off background deep probe
      const terraformTypes = [...new Set(newSummary.matches.map(m => m.sourceType))];
      triggerDeepProbe(terraformTypes);
      return;
    }

    // compare mode — live org-to-org analysis (no tf files)
    setStage('discover');

    const analyzeResult = await api.syncAnalyze(tfFiles, stateContent);

    if (!analyzeResult.success || !analyzeResult.data) {
      setPipelineError(analyzeResult.error ?? 'Discovery failed');
      setStage('error');
      return;
    }

    const { summary: newSummary, diff: newDiff } = analyzeResult.data;
    setSummary(newSummary);
    setDiff(newDiff);
    setStage('match');

    // Kick off background deep probe
    const terraformTypes = [...new Set(newSummary.matches.map(m => m.sourceType))];
    triggerDeepProbe(terraformTypes);

    // Stay at 'match' stage — user reviews the diff view and clicks "Proceed to Convert"
  };

  const runConvert = async (matches: ResourceMatch[], currentTfFiles: Record<string, string>) => {
    const setActiveStage = mode === 'compare' ? setCompareStage : setStage;
    const setActivePipelineError = mode === 'compare' ? setComparePipelineError : setPipelineError;

    setActiveStage('convert');
    setActivePipelineError(null);

    const tfContent = Object.entries(currentTfFiles)
      .filter(([name]) => name.endsWith('.tf'))
      .map(([name, content]) => `# --- ${name} ---\n${content}`)
      .join('\n\n');

    const targetOrgUrl = swapped ? sourceConnectedUrl : (connection.orgUrl ?? '');
    const result = await api.syncConvert(tfContent, matches, targetOrgUrl);

    if (result.success && result.data) {
      setConverted({
        portableHcl: result.data.portableHcl ?? '',
        importBlocks: result.data.importBlocks ?? '',
        instructions: result.data.instructions ?? [],
        warnings: result.data.warnings ?? [],
      });

      if (mode === 'tf-files') {
        // Auto-stage converted files so the TF runner is ready immediately —
        // no manual export needed since the user already supplied their tf files.
        // Mirror handleExport() deduplication: don't add provider.tf/variables.tf
        // if portableHcl already contains those blocks (AI conversion may include them).
        let portableHcl = result.data.portableHcl ?? '';
        const exactVersion = managedProviderVersion !== 'system' ? managedProviderVersion : undefined;
        const hasVariables = /^\s*variable\s+"/m.test(portableHcl);
        const hasTerraformBlock = /^\s*terraform\s*\{/m.test(portableHcl);
        const hasProviderBlock = /^\s*provider\s+"okta"/m.test(portableHcl);
        // Strip terraform {} block from main.tf — goes into versions.tf separately
        if (hasTerraformBlock) {
          portableHcl = portableHcl.replace(
            /^\s*terraform\s*\{(?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*\}\s*\n?/m,
            '',
          );
        }
        const filesToStage: Record<string, string> = {
          'main.tf': portableHcl,
          'versions.tf': generateVersionsTf(providerVersion, exactVersion),
        };
        if (result.data.importBlocks) filesToStage['imports.tf'] = result.data.importBlocks;
        if (!hasVariables) filesToStage['variables.tf'] = generateVariablesTf('api_token');
        if (!hasProviderBlock) {
          const targetOrgUrlForProvider = swapped ? sourceConnectedUrl : (connection.orgUrl ?? '');
          const { orgName, baseUrl } = getOrgInfo(targetOrgUrlForProvider);
          filesToStage['provider.tf'] = `provider "okta" {\n  org_name  = "${orgName}"\n  base_url  = "${baseUrl}"\n  api_token = var.okta_api_token\n}\n`;
        }
        const stageResult = await api.stageTfFiles(filesToStage);
        if (stageResult.success && stageResult.data) {
          setExportedDir(stageResult.data);
        }
      }

      setActiveStage('done');
    } else {
      setActivePipelineError(result.error ?? 'Conversion failed');
      setActiveStage('error');
    }
  };

  const handleResolveContinue = async () => {
    const activeSummaryLocal = mode === 'compare' ? compareSummary : summary;
    if (!activeSummaryLocal) return;
    const resolvedMatches = activeSummaryLocal.matches.map(m => {
      if (m.status === 'ambiguous' && resolvedCandidates[m.sourceAddress]) {
        return { ...m, targetId: resolvedCandidates[m.sourceAddress], status: 'matched' as const };
      }
      return m;
    });
    await runConvert(resolvedMatches, tfFiles);
  };

  const handleSkipAmbiguous = async () => {
    const activeSummaryLocal = mode === 'compare' ? compareSummary : summary;
    if (!activeSummaryLocal) return;
    const nonAmbiguous = activeSummaryLocal.matches.filter(m => m.status !== 'ambiguous');
    await runConvert(nonAmbiguous, tfFiles);
  };

  const handleRunComparison = async () => {
    setCompareStage('discover');
    setComparePipelineError(null);
    setProbeProgress('Starting comparison...');

    const cleanup = api.onSyncCompareProgress((progress) => {
      setProbeProgress(progress.detail);
    });

    const result = await api.syncCompare([...selectedTypes], swapped);
    cleanup();
    setProbeProgress(null);

    if (!result.success || !result.data) {
      setComparePipelineError(result.error ?? 'Comparison failed');
      setCompareStage('error');
      return;
    }
    setCompareSummary(result.data.summary);
    setCompareDiff(result.data.diff);
    setCompareMatches(result.data.matches);
    setCompareStage('match');
  };

  const handleSetMode = (newMode: 'compare' | 'tf-files') => {
    setModeState(newMode);
    // Reset shared TF runner state so switching tabs never shows stale results.
    setTfStage('idle');
    setTfLines([]);
    setTfError(null);
    setExportedDir(null);
  };

  const handleExport = async () => {
    if (!converted) return;
    let portableHcl = converted.portableHcl;

    if (recommendation?.recommended) {
      const config = recommendation.recommended;
      const rateLimitBlock = [
        `  # Rate limit optimization (from endpoint probe)`,
        `  max_retries      = ${config.max_retries}`,
        `  backoff          = ${config.backoff}`,
        `  min_wait_seconds = ${config.min_wait_seconds}`,
        `  max_wait_seconds = ${config.max_wait_seconds}`,
        `  request_timeout  = ${config.request_timeout}`,
        `  max_api_capacity = ${config.max_api_capacity}`,
      ].join('\n');
      portableHcl = portableHcl.replace(
        /(provider\s+"okta"\s*\{[^}]*)(})/,
        `$1\n${rateLimitBlock}\n}`,
      );
    }

    const exportFiles: Record<string, string> = { 'main.tf': portableHcl };
    if (converted.importBlocks) exportFiles['imports.tf'] = converted.importBlocks;

    const hasVariables = /^\s*variable\s+"/m.test(portableHcl);
    const hasTerraformBlock = /^\s*terraform\s*\{/m.test(portableHcl);

    if (connection.orgUrl) {
      const exactVersion = managedProviderVersion !== 'system' ? managedProviderVersion : undefined;
      exportFiles['versions.tf'] = generateVersionsTf(providerVersion, exactVersion);
      if (hasTerraformBlock) {
        portableHcl = portableHcl.replace(
          /^\s*terraform\s*\{(?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*\}\s*\n?/m,
          '',
        );
        exportFiles['main.tf'] = portableHcl;
      }
      if (!hasVariables) exportFiles['variables.tf'] = generateVariablesTf('api_token');

      // Generate provider.tf if the HCL doesn't already contain a provider block
      const hasProviderBlock = /^\s*provider\s+"okta"/m.test(portableHcl);
      if (!hasProviderBlock) {
        const targetOrgUrlForProvider = swapped ? sourceConnectedUrl : (connection.orgUrl ?? '');
        const { orgName, baseUrl } = getOrgInfo(targetOrgUrlForProvider);
        exportFiles['provider.tf'] = `provider "okta" {\n  org_name  = "${orgName}"\n  base_url  = "${baseUrl}"\n  api_token = var.okta_api_token\n}\n`;
      }
    }

    const result = await api.saveProjectDir(exportFiles);
    if (result.success && result.data) {
      setExportedDir(result.data);
      setTfStage('idle');
    }
  };

  const handleRunTerraform = async () => {
    if (!exportedDir) return;
    setTfLines([]);
    setTfError(null);

    const unsub = api.onTerraformLine((line) => {
      setTfLines((prev) => [...prev, line]);
    });

    try {
      setTfStage('init');
      const initResult = await api.terraformRun(exportedDir, ['init', '-upgrade', '-input=false', '-no-color'], swapped);
      if (!initResult.success) {
        setTfStage('error');
        setTfError(initResult.error ?? `terraform init exited with code ${initResult.exitCode}`);
        return;
      }

      setTfStage('plan');
      const planResult = await api.terraformRun(exportedDir, ['plan', '-input=false', '-no-color', '-detailed-exitcode'], swapped);
      // exit code 2 means "changes present" — still valid; only 1 is a real error
      if (planResult.exitCode === 1) {
        setTfStage('error');
        setTfError(planResult.error ?? `terraform plan exited with code ${planResult.exitCode}`);
        return;
      }
      // exit code 0 means no changes needed — nothing to apply
      if (planResult.exitCode === 0) {
        setTfStage('no-changes');
        return;
      }

      setTfStage('awaiting-confirm');
    } finally {
      unsub();
    }
  };

  const handleConfirmApply = async () => {
    if (!exportedDir) return;
    setTfLines([]);

    const unsub = api.onTerraformLine((line) => {
      setTfLines((prev) => [...prev, line]);
    });

    try {
      setTfStage('apply');
      const parallelism = recommendation?.recommended?.parallelism ?? 4;
      const applyResult = await api.terraformRun(exportedDir, ['apply', '-auto-approve', `-parallelism=${parallelism}`, '-no-color'], swapped);
      if (!applyResult.success) {
        setTfStage('error');
        setTfError(applyResult.error ?? `terraform apply exited with code ${applyResult.exitCode}`);
        return;
      }
      setTfStage('done');
      // Save rollback bundle with post-apply state (has target org resource IDs)
      const targetOrgUrl = swapped ? sourceConnectedUrl : (connection?.orgUrl ?? '');
      // Track which addresses were imported (pre-existing in target) vs created (new)
      // On rollback, imported resources must only be state-rm'd (not destroyed in Okta)
      const activeMatches = mode === 'compare' ? compareMatches : summary?.matches ?? null;
      const importedAddresses = (activeMatches ?? [])
        .filter(m => m.status === 'matched')
        .map(m => m.sourceAddress);
      const saveResult = await api.saveRollback(exportedDir, targetOrgUrl, managedProviderVersion, undefined, swapped, importedAddresses);
      if (saveResult.success) {
        const checkResult = await api.checkRollback();
        if (checkResult?.data?.available) {
          setRollbackAvailable(true);
          setRollbackManifest(checkResult.data.manifest);
        }
      }
    } finally {
      unsub();
    }
  };

  const handleCancelTf = async () => {
    await api.terraformCancel();
    setTfStage('idle');
    setTfLines([]);
  };

  const handleStartRollback = async () => {
    setRollbackLines([]);
    setRollbackError(null);

    const prepResult = await api.prepareRollback();
    if (!prepResult.success || !prepResult.data) {
      setRollbackError(prepResult.error ?? 'Failed to prepare rollback directory');
      return;
    }
    const { rollbackDir: dir } = prepResult.data;
    setRollbackDir(dir);
    setShowRollback(true);

    const unsub = api.onTerraformLine((line) => {
      setRollbackLines((prev) => [...prev, line]);
    });

    try {
      const rollbackSwapped = rollbackManifest?.swapped ?? false;

      setRollbackStage('init');
      const initResult = await api.terraformRun(dir, ['init', '-no-color'], rollbackSwapped);
      if (!initResult.success) {
        setRollbackStage('error');
        setRollbackError(initResult.error ?? `terraform init exited with code ${initResult.exitCode}`);
        return;
      }

      // State-rm imported resources so rollback only destroys resources that were created
      // (not resources that were pre-existing in the target org and imported)
      const importedAddresses = rollbackManifest?.importedAddresses ?? [];
      for (const addr of importedAddresses) {
        await api.terraformRun(dir, ['state', 'rm', addr], rollbackSwapped);
        // Ignore failures — address may not be in state (e.g. system zone that was filtered)
      }

      setRollbackStage('plan');
      setRollbackLines([]);
      const planResult = await api.terraformRun(dir, ['plan', '-no-color'], rollbackSwapped);
      if (!planResult.success) {
        setRollbackStage('error');
        setRollbackError(planResult.error ?? `terraform plan exited with code ${planResult.exitCode}`);
        return;
      }

      setRollbackStage('awaiting-confirm');
    } finally {
      unsub();
    }
  };

  const handleConfirmRollback = async () => {
    if (!rollbackDir) return;
    setRollbackLines([]);

    const unsub = api.onTerraformLine((line) => {
      setRollbackLines((prev) => [...prev, line]);
    });

    try {
      setRollbackStage('apply');
      const applyResult = await api.terraformRun(rollbackDir, ['apply', '-auto-approve', '-no-color'], rollbackManifest?.swapped ?? false);
      if (!applyResult.success) {
        setRollbackStage('error');
        setRollbackError(applyResult.error ?? `terraform apply exited with code ${applyResult.exitCode}`);
        return;
      }
      setRollbackStage('done');
      // Clear the bundle after successful rollback
      await api.clearRollback();
      setRollbackAvailable(false);
      setRollbackManifest(null);
    } finally {
      unsub();
    }
  };

  const handleCancelRollback = async () => {
    await api.terraformCancel();
    setRollbackStage('idle');
    setRollbackLines([]);
    setShowRollback(false);
    setRollbackDir(null);
  };

  const handleClearRollback = async () => {
    await api.clearRollback();
    setRollbackAvailable(false);
    setRollbackManifest(null);
    setShowRollback(false);
    setRollbackDir(null);
    setRollbackStage('idle');
    setRollbackLines([]);
    setRollbackError(null);
  };

  const handleCopyApply = () => {
    const parallelism = recommendation?.recommended?.parallelism ?? 4;
    navigator.clipboard.writeText(`terraform apply -parallelism=${parallelism}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleReset = () => {
    if (mode === 'compare') {
      setCompareStage('idle');
      setCompareSummary(null);
      setCompareDiff(null);
      setCompareMatches(null);
      setComparePipelineError(null);
      setConverted(null);
    } else {
      setStage('idle');
      setSummary(null);
      setConverted(null);
      setPipelineError(null);
      setResolvedCandidates({});
      setDiff(null);
    }
  };

  // ── Derived data ───────────────────────────────────────────

  const activeStage = mode === 'compare' ? compareStage : stage;
  const activeSummary = mode === 'compare' ? compareSummary : summary;
  const activeDiff = mode === 'compare' ? compareDiff : diff;
  const activePipelineError = mode === 'compare' ? comparePipelineError : pipelineError;

  const ambiguousMatches = activeSummary?.matches.filter(m => m.status === 'ambiguous') ?? [];
  const allAmbiguousResolved = ambiguousMatches.every(m => resolvedCandidates[m.sourceAddress]);

  // ── Stage helper for pipeline bar ─────────────────────────

  const stageIndex = { idle: -1, discover: 0, match: 1, convert: 2, done: 3, error: -1 }[activeStage] ?? -1;

  function StageCircle({ index, label, detail }: { index: number; label: string; detail?: string }) {
    const isDone = stageIndex > index;
    const isActive = stageIndex === index;
    const isPending = stageIndex < index;

    return (
      <div className="flex flex-col items-center flex-1">
        {isDone && (
          <div className="w-7 h-7 rounded-full bg-green-600 flex items-center justify-center text-xs text-white font-bold">✓</div>
        )}
        {isActive && (
          <div className="w-7 h-7 rounded-full bg-accent-teal flex items-center justify-center">
            <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
          </div>
        )}
        {isPending && (
          <div className="w-7 h-7 rounded-full border-2 border-border flex items-center justify-center text-xs text-text-muted">
            {index + 1}
          </div>
        )}
        <div className={`text-[10px] mt-1 text-center ${isDone ? 'text-green-400' : isActive ? 'text-accent-teal' : 'text-text-muted'}`}>
          {label}
        </div>
        {detail && (
          <div className="text-[10px] text-text-muted text-center">{detail}</div>
        )}
      </div>
    );
  }

  function Connector({ filled }: { filled: boolean }) {
    return (
      <div className={`flex-1 h-0.5 mb-5 ${filled ? 'bg-green-600' : 'bg-border'}`} />
    );
  }

  // ── Render ─────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-text-primary">Org Sync</h1>
          <p className="text-xs text-text-muted">
            Sync configuration from{' '}
            {(swapped ? connection.orgUrl : sourceConnectedUrl)
              ? <span className="text-accent-teal">{swapped ? connection.orgUrl : sourceConnectedUrl}</span>
              : 'a source org'}
            {' '}to{' '}
            {(swapped ? sourceConnectedUrl : connection.orgUrl)
              ? <span className="text-accent-teal">{swapped ? sourceConnectedUrl : connection.orgUrl}</span>
              : 'the connected target org'}
          </p>
        </div>
        {activeStage !== 'idle' && (
          <button
            onClick={handleReset}
            className="px-3 py-1.5 text-xs font-medium text-text-muted bg-surface-3 rounded-lg hover:bg-surface-4 transition-colors"
          >
            Start Over
          </button>
        )}
      </div>

      {/* Mode selector */}
      <div className="grid grid-cols-2 gap-3">
        <button
          onClick={() => handleSetMode('compare')}
          className="text-left rounded-xl p-3 transition-colors"
          style={{
            background: mode === 'compare' ? 'rgb(13 51 73 / 0.6)' : '#0d1117',
            border: mode === 'compare' ? '2px solid #2dd4bf' : '1px solid #30363d',
          }}
        >
          <div className="text-[11px] font-semibold mb-1" style={{ color: mode === 'compare' ? '#2dd4bf' : '#8b949e' }}>
            ⇄ Org Comparison
          </div>
          <div className="text-[9px] leading-relaxed text-text-muted">
            Compare two live orgs. Auto-generate terraform from selected resources.
          </div>
        </button>
        <button
          onClick={() => handleSetMode('tf-files')}
          className="text-left rounded-xl p-3 transition-colors"
          style={{
            background: mode === 'tf-files' ? '#161b22' : '#0d1117',
            border: mode === 'tf-files' ? '2px solid #2dd4bf' : '1px solid #30363d',
          }}
        >
          <div className="text-[11px] font-semibold mb-1" style={{ color: mode === 'tf-files' ? '#2dd4bf' : '#8b949e' }}>
            📄 TF State Files
          </div>
          <div className="text-[9px] leading-relaxed text-text-muted">
            Upload existing .tf + state files to sync specific resources.
          </div>
        </button>
      </div>

      {/* TF Files mode panels */}
      {mode === 'tf-files' && (
        <div className="space-y-3">
          <div className="bg-surface-2 border border-border rounded-xl p-4">
            <p className="text-[11px] font-bold uppercase tracking-widest text-text-muted mb-3">Target Org</p>
            {connection.connected && !targetEditing ? (
              <div className="flex items-center justify-between">
                <span className="text-xs text-green-400">✓ {connection.orgUrl}</span>
                <div className="flex gap-2">
                  <button
                    onClick={() => { setTargetEditing(true); setTargetError(null); }}
                    className="text-[10px] text-text-muted hover:text-text-secondary"
                  >
                    Change
                  </button>
                  <button
                    onClick={handleDisconnectTarget}
                    className="text-[10px] text-text-muted hover:text-text-secondary"
                  >
                    Disconnect
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <input
                  type="text"
                  placeholder="Org URL (e.g. trial-123456.okta.com)"
                  value={targetUrl}
                  onChange={e => setTargetUrl(e.target.value)}
                  className="w-full bg-surface-1 border border-border rounded-lg px-3 py-2 text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-teal/50"
                />
                <input
                  type="password"
                  placeholder="API Token"
                  value={targetToken}
                  onChange={e => setTargetToken(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleConnectTarget()}
                  className="w-full bg-surface-1 border border-border rounded-lg px-3 py-2 text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-teal/50"
                />
                {targetError && <p className="text-[11px] text-red-400">{targetError}</p>}
                <div className="flex gap-2">
                  <button
                    onClick={handleConnectTarget}
                    disabled={targetConnecting || !targetUrl.trim() || !targetToken.trim()}
                    className="flex-1 py-2 text-xs font-semibold bg-accent-teal/15 text-accent-teal hover:bg-accent-teal/25 rounded-lg border border-accent-teal/30 transition-colors disabled:opacity-50"
                  >
                    {targetConnecting ? 'Connecting…' : 'Connect'}
                  </button>
                  {targetEditing && (
                    <button
                      onClick={() => { setTargetEditing(false); setTargetError(null); }}
                      className="px-3 py-2 text-xs bg-surface-3 text-text-muted hover:bg-surface-4 rounded-lg border border-border"
                    >
                      Cancel
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Divider */}
          <div className="text-center text-[11px] text-text-muted/50">
            — upload your .tf files to begin the sync pipeline —
          </div>

          {/* File Upload */}
          <div className={`border rounded-xl p-4 ${hasTfFiles ? 'bg-surface-2 border-border' : 'bg-surface-2 border-accent-teal/40'}`}>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-text-secondary">
                  {hasTfFiles
                    ? `${Object.keys(tfFiles).length} .tf file${Object.keys(tfFiles).length !== 1 ? 's' : ''} loaded${stateContent ? ' + .tfstate' : ''}`
                    : 'Upload your Terraform config (.tf files)'}
                </p>
                {!hasTfFiles && (
                  <p className="text-[11px] text-text-muted mt-0.5">
                    Upload .tf files and a .tfstate file to run the pipeline
                  </p>
                )}
                {!stateContent && hasTfFiles && (
                  <p className="text-[11px] text-amber-400 mt-0.5">
                    Upload a .tfstate file to enable matching
                  </p>
                )}
              </div>
              <button
                onClick={handleUploadFiles}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                  hasTfFiles
                    ? 'bg-surface-3 text-text-secondary hover:bg-surface-4'
                    : 'bg-accent-teal/15 text-accent-teal hover:bg-accent-teal/25 border border-accent-teal/30'
                }`}
              >
                {hasTfFiles ? 'Change Files' : 'Upload Files'}
              </button>
            </div>
          </div>

          {/* Loaded File List */}
          {hasTfFiles && (
            <div className="bg-surface-2 border border-border rounded-xl overflow-hidden">
              <div className="px-4 py-2 border-b border-border flex items-center justify-between">
                <p className="text-[11px] font-bold uppercase tracking-widest text-text-muted">Loaded Files</p>
                {previewFile && (
                  <button
                    onClick={() => setPreviewFile(null)}
                    className="text-[11px] text-text-muted hover:text-text-secondary transition-colors"
                  >
                    ✕ close preview
                  </button>
                )}
              </div>
              <div className="divide-y divide-border">
                {Object.keys(tfFiles).sort().map((name) => (
                  <button
                    key={name}
                    onClick={() => setPreviewFile(previewFile === name ? null : name)}
                    className={`w-full flex items-center justify-between px-4 py-2 text-xs font-mono transition-colors text-left ${
                      previewFile === name
                        ? 'bg-accent-teal/10 text-accent-teal'
                        : 'text-text-secondary hover:bg-surface-3 hover:text-text-primary'
                    }`}
                  >
                    <span>{name}</span>
                    <span className="text-[10px] text-text-muted ml-2 shrink-0">
                      {previewFile === name ? '▲' : '▼'}
                    </span>
                  </button>
                ))}
                {stateContent && (
                  <button
                    key="terraform.tfstate"
                    onClick={() => setPreviewFile(previewFile === 'terraform.tfstate' ? null : 'terraform.tfstate')}
                    className={`w-full flex items-center justify-between px-4 py-2 text-xs font-mono transition-colors text-left ${
                      previewFile === 'terraform.tfstate'
                        ? 'bg-accent-teal/10 text-accent-teal'
                        : 'text-text-secondary hover:bg-surface-3 hover:text-text-primary'
                    }`}
                  >
                    <span>terraform.tfstate</span>
                    <span className="text-[10px] text-text-muted ml-2 shrink-0">
                      {previewFile === 'terraform.tfstate' ? '▲' : '▼'}
                    </span>
                  </button>
                )}
              </div>
              {previewFile && (
                <div className="border-t border-border">
                  <pre className="text-[11px] font-mono text-text-secondary p-4 overflow-auto max-h-64 whitespace-pre-wrap break-all leading-relaxed">
                    {previewFile === 'terraform.tfstate' ? stateContent : tfFiles[previewFile]}
                  </pre>
                </div>
              )}
            </div>
          )}

          {/* Run Pipeline Button */}
          {canRunPipeline && activeStage === 'idle' && (
            <button
              onClick={handleRunPipeline}
              className="w-full py-3 text-sm font-bold bg-accent-teal/15 text-accent-teal hover:bg-accent-teal/25 rounded-xl border border-accent-teal/30 transition-colors"
            >
              Run Sync Pipeline
            </button>
          )}
        </div>
      )}

      {/* Org Comparison mode panels */}
      {mode === 'compare' && compareStage === 'idle' && (
        <div className="space-y-3">
          {(() => {
            // Slot A = main connection (read-only); Slot B = secondary connection (with inputs)
            const slotA = (
              <div key="slot-a" className="bg-surface-2 border border-border rounded-xl p-4">
                <p className="text-[11px] font-bold uppercase tracking-widest text-text-muted mb-2">
                  {swapped ? 'Source Org' : 'Target Org'}
                </p>
                {connection.connected ? (
                  <span className="text-xs text-green-400">✓ {connection.orgUrl}</span>
                ) : (
                  <span className="text-xs text-text-muted">Connect an org in the Connection panel above</span>
                )}
              </div>
            );

            const slotB = (
              <div key="slot-b" className="bg-surface-2 border border-border rounded-xl p-4">
                <p className="text-[11px] font-bold uppercase tracking-widest text-text-muted mb-3">
                  {swapped ? 'Target Org' : 'Source Org'}
                </p>
                {sourceConnected ? (
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-green-400">✓ {sourceConnectedUrl}</span>
                    <button onClick={handleDisconnectSource} className="text-[10px] text-text-muted hover:text-text-secondary">Disconnect</button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <input
                      type="url"
                      placeholder="https://your-org.okta.com"
                      value={sourceUrl}
                      onChange={e => setSourceUrl(e.target.value)}
                      className="w-full bg-surface-0 border border-border rounded-lg px-3 py-2 text-xs text-text-primary placeholder-text-muted focus:outline-none focus:border-accent-teal"
                    />
                    <input
                      type="password"
                      placeholder="API token"
                      value={sourceToken}
                      onChange={e => setSourceToken(e.target.value)}
                      className="w-full bg-surface-0 border border-border rounded-lg px-3 py-2 text-xs text-text-primary placeholder-text-muted focus:outline-none focus:border-accent-teal"
                    />
                    <button
                      onClick={handleConnectSource}
                      disabled={sourceConnecting || !sourceUrl.trim() || !sourceToken.trim()}
                      className="w-full py-2 text-xs font-semibold bg-accent-teal/15 text-accent-teal hover:bg-accent-teal/25 rounded-lg border border-accent-teal/30 transition-colors disabled:opacity-50"
                    >
                      {sourceConnecting ? 'Connecting…' : 'Connect'}
                    </button>
                    {sourceError && <p className="text-[10px] text-red-400">{sourceError}</p>}
                  </div>
                )}
              </div>
            );

            const [top, bottom] = swapped ? [slotA, slotB] : [slotB, slotA];
            return (
              <>
                {top}
                {/* Swap button */}
                <div className="flex items-center justify-center">
                  <button
                    onClick={() => setSwapped(s => !s)}
                    title="Swap source and target orgs"
                    className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium text-text-muted bg-surface-2 border border-border rounded-lg hover:border-accent-teal/50 hover:text-accent-teal transition-colors"
                  >
                    <span style={{ display: 'inline-block', transform: swapped ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>⇅</span>
                    swap
                  </button>
                </div>
                {bottom}
              </>
            );
          })()}

          {/* Resource type filter chips */}
          <div className="bg-surface-2 border border-border rounded-xl p-4">
            <p className="text-[11px] font-bold uppercase tracking-widest text-text-muted mb-3">Resource Types to Compare</p>
            <div className="flex flex-wrap gap-2">
              {ALL_COMPARABLE_TYPES.map(type => {
                const active = selectedTypes.has(type);
                return (
                  <button
                    key={type}
                    onClick={() => setSelectedTypes(prev => {
                      const next = new Set(prev);
                      if (next.has(type)) next.delete(type);
                      else next.add(type);
                      return next;
                    })}
                    className="px-2.5 py-1 rounded-full text-[10px] font-medium border transition-colors"
                    style={{
                      background: active ? 'rgb(20 83 45 / 0.22)' : '#21262d',
                      color: active ? '#4ade80' : '#8b949e',
                      borderColor: active ? 'rgb(74 222 128 / 0.4)' : '#30363d',
                    }}
                  >
                    {active ? '✓ ' : ''}{friendlyName(type)}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Run Comparison button */}
          <button
            onClick={handleRunComparison}
            disabled={!sourceConnected || !connection.connected || selectedTypes.size === 0}
            className="w-full py-3 text-sm font-bold bg-accent-teal/15 text-accent-teal hover:bg-accent-teal/25 rounded-xl border border-accent-teal/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Run Comparison →
          </button>
        </div>
      )}

      {/* Pipeline Progress Bar — compare mode only */}
      {mode !== 'tf-files' && activeStage !== 'idle' && activeStage !== 'error' && (
        <div className="bg-surface-2 border border-border rounded-xl p-4">
          <p className="text-[11px] font-bold uppercase tracking-widest text-text-muted mb-4">Pipeline</p>
          <div className="flex items-center">
            <StageCircle
              index={0}
              label="Discover"
              detail={activeSummary ? `${activeSummary.totalResources} resources` : undefined}
            />
            <Connector filled={stageIndex > 0} />
            <StageCircle
              index={1}
              label="Match"
              detail={activeSummary ? `${activeSummary.matched} matched` : undefined}
            />
            <Connector filled={stageIndex > 1} />
            <StageCircle
              index={2}
              label="Convert"
              detail={activeStage === 'convert' ? 'Converting...' : undefined}
            />
            <Connector filled={stageIndex > 2} />
            <StageCircle
              index={3}
              label="Export"
            />
          </div>
          {probeProgress && (
            <p className="text-[10px] text-text-muted mt-2">{probeProgress}</p>
          )}
        </div>
      )}

      {/* Diff View */}
      {activeStage === 'match' && activeDiff !== null && (
        <DiffView
          diff={activeDiff}
          canProceed={activeSummary !== null && activeSummary.matches.filter(m => m.status === 'ambiguous').length === 0}
          selectable={mode === 'compare'}
          onProceed={(selectedAddresses) => {
            if (mode === 'compare' && compareMatches && selectedAddresses) {
              const tfFilesGenerated = generateTfFromMatches(compareMatches, activeDiff, selectedAddresses);
              const SYSTEM_ZONE_NAMES = /^(BlockedIpZone|LegacyIpZone|DefaultExemptIpZone|DefaultEnhancedDynamicZone)$/i;
              const filteredMatches = compareMatches.filter(m =>
                selectedAddresses.has(m.sourceAddress) &&
                !(m.sourceAddress.startsWith('okta_network_zone.') && SYSTEM_ZONE_NAMES.test(m.sourceName))
              );
              runConvert(filteredMatches, tfFilesGenerated);
            } else if (activeSummary) {
              runConvert(activeSummary.matches, tfFiles);
            }
          }}
        />
      )}

      {/* Fallback Proceed — when diff failed to load but no ambiguous resources */}
      {activeStage === 'match' && activeDiff === null && activeSummary !== null && ambiguousMatches.length === 0 && (
        <div className="bg-surface-2 border border-border rounded-xl p-4 flex items-center justify-between">
          <span className="text-[10px] text-text-muted">Diff unavailable — ready to generate Terraform config</span>
          <button
            onClick={() => runConvert(activeSummary.matches, tfFiles)}
            className="px-4 py-1.5 bg-accent-teal text-surface-0 hover:bg-accent-teal/90 rounded-lg text-[11px] font-semibold transition-colors"
          >
            Proceed to Convert →
          </button>
        </div>
      )}

      {/* Error Banner */}
      {activeStage === 'error' && activePipelineError && (
        <div className="bg-red-950/30 border border-accent-red/40 rounded-xl p-4">
          <p className="text-xs font-bold text-accent-red mb-1">Pipeline Failed</p>
          <p className="text-xs text-text-muted">{activePipelineError}</p>
          <button
            onClick={handleReset}
            className="mt-3 px-4 py-1.5 text-xs bg-surface-3 text-text-secondary hover:bg-surface-4 rounded-lg"
          >
            Reset
          </button>
        </div>
      )}

      {/* Review Gate — shown when ambiguous resources need resolution */}
      {activeStage === 'match' && ambiguousMatches.length > 0 && (
        <div className="bg-amber-950/20 border border-amber-600/40 rounded-xl p-4">
          <p className="text-[11px] font-bold uppercase tracking-widest text-amber-400 mb-1">
            ⚠ Review Required — {ambiguousMatches.length} Ambiguous Resource{ambiguousMatches.length !== 1 ? 's' : ''}
          </p>
          <p className="text-xs text-text-muted mb-3">
            Pipeline paused. These resources matched multiple targets — resolve before converting.
          </p>

          <div className="bg-surface-0 rounded-lg overflow-hidden text-xs font-mono mb-3">
            <div className="grid grid-cols-[2fr_1fr_2fr] px-3 py-2 border-b border-border text-[10px] uppercase tracking-wider text-text-muted">
              <span>Resource</span>
              <span>Candidates</span>
              <span>Pick One</span>
            </div>
            {ambiguousMatches.map((m) => (
              <div key={m.sourceAddress} className="grid grid-cols-[2fr_1fr_2fr] px-3 py-2 border-b border-surface-2 last:border-b-0 items-center">
                <span className="text-text-primary truncate">{m.sourceAddress}</span>
                <span className="text-amber-400">{m.candidates?.length ?? 0} matches</span>
                <select
                  value={resolvedCandidates[m.sourceAddress] ?? ''}
                  onChange={(e) => setResolvedCandidates(prev => ({ ...prev, [m.sourceAddress]: e.target.value }))}
                  className="bg-surface-2 border border-border rounded px-2 py-1 text-[10px] text-text-primary focus:outline-none focus:ring-1 focus:ring-accent-teal/50 max-w-full"
                >
                  <option value="">— select —</option>
                  {(m.candidates ?? []).map(id => (
                    <option key={id} value={id}>{id}</option>
                  ))}
                </select>
              </div>
            ))}
          </div>

          <div className="flex gap-2">
            <button
              onClick={handleResolveContinue}
              disabled={!allAmbiguousResolved}
              className="flex-1 py-2 text-xs font-semibold bg-green-700/20 text-green-400 hover:bg-green-700/30 disabled:opacity-40 rounded-lg border border-green-600/30 transition-colors"
            >
              Resolve &amp; Continue
            </button>
            <button
              onClick={handleSkipAmbiguous}
              className="px-4 py-2 text-xs bg-surface-3 text-text-muted hover:bg-surface-4 rounded-lg border border-border"
            >
              Skip Ambiguous
            </button>
          </div>
        </div>
      )}

      {/* Apply Command — shown when done */}
      {activeStage === 'done' && converted && (
        <div className="bg-surface-2 border border-border rounded-xl p-4 space-y-3">
          <p className="text-[11px] font-bold uppercase tracking-widest text-text-muted">Ready to Apply</p>

          <div className="flex items-center gap-2 bg-surface-0 border border-border rounded-lg px-3 py-2.5">
            <code className="flex-1 font-mono text-xs text-green-400">terraform apply -parallelism={recommendation?.recommended?.parallelism ?? 4}</code>
            <button
              onClick={handleCopyApply}
              className="px-2.5 py-1 bg-surface-3 border border-border rounded text-[11px] text-text-muted hover:bg-surface-4 transition-colors"
            >
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>

          {converted.warnings.length > 0 && (
            <div>
              <button
                type="button"
                onClick={() => setWarningsCollapsed(c => !c)}
                className="flex items-center gap-1.5 text-[11px] text-amber-400 hover:text-amber-300 mb-1"
              >
                <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" className={`transition-transform ${warningsCollapsed ? '' : 'rotate-90'}`}>
                  <path d="M4 2l4 4-4 4" />
                </svg>
                ⚠ {converted.warnings.length} warning{converted.warnings.length !== 1 ? 's' : ''}
              </button>
              {!warningsCollapsed && (
                <div className="text-[11px] text-amber-400/80 space-y-0.5 pl-4">
                  {converted.warnings.map((w, i) => <div key={i}>{w}</div>)}
                </div>
              )}
            </div>
          )}

          {mode !== 'tf-files' && (
            <>
              <button
                onClick={handleExport}
                className="w-full py-2.5 text-sm font-bold bg-accent-teal text-surface-0 hover:bg-accent-teal/90 rounded-lg transition-colors"
              >
                Export Project Files
              </button>
              <p className="text-[11px] text-text-muted text-center">
                Exports: main.tf · imports.tf · versions.tf · variables.tf
              </p>
            </>
          )}
        </div>
      )}

      {/* Terraform Runner — available in both compare (after export) and tf-files modes */}
      {activeStage === 'done' && exportedDir && (() => {
        const stageOrder: TfRunStage[] = ['init', 'plan', 'apply'];
        const tfStageIndex = stageOrder.indexOf(tfStage as TfRunStage);
        const doneStages = tfStage === 'done'
          ? stageOrder
          : stageOrder.slice(0, tfStageIndex < 0 ? 0 : tfStageIndex);
        const tfActiveStage = (tfStage === 'init' || tfStage === 'plan' || tfStage === 'apply') ? tfStage : null;

        return (
          <div className="bg-surface-2 border border-border rounded-xl p-4 space-y-2">
            {/* Stage pills */}
            <div className="flex gap-2">
              {stageOrder.map((s) => {
                const isDone = doneStages.includes(s);
                const isActive = tfActiveStage === s;
                return (
                  <span
                    key={s}
                    className={[
                      'rounded-full px-3 py-0.5 text-[10px] font-semibold',
                      isDone ? 'bg-green-700/30 text-green-400' :
                      isActive ? 'bg-blue-600/30 text-blue-400' :
                      'bg-surface-3 text-text-muted',
                    ].join(' ')}
                  >
                    {isDone ? `✓ ${s}` : isActive ? `● ${s}` : s}
                  </span>
                );
              })}
            </div>

            {/* Terminal output pane */}
            {tfLines.length > 0 && (
              <div
                ref={tfOutputRef}
                className="rounded-md border border-surface-3 font-mono text-[10px] leading-relaxed p-2 overflow-y-auto"
                style={{ background: '#010409', height: '160px' }}
              >
                {tfLines.map((line, i) => {
                  const color =
                    /^\s*\+/.test(line) ? '#3fb950' :
                    /^\s*-/.test(line) || /error/i.test(line) ? '#f85149' :
                    /^\s*~/.test(line) ? '#ffa657' :
                    '#e6edf3';
                  return <div key={i} style={{ color }}>{line}</div>;
                })}
              </div>
            )}

            {/* Error message */}
            {tfStage === 'error' && tfError && (
              <p className="text-[11px] text-red-400">{tfError}</p>
            )}

            {/* No changes message */}
            {tfStage === 'no-changes' && (
              <p className="text-[11px] text-yellow-400 font-semibold">✓ No changes — target org is already up to date</p>
            )}

            {/* Success message */}
            {tfStage === 'done' && (
              <p className="text-[11px] text-green-400 font-semibold">✓ Apply complete</p>
            )}

            {/* Action buttons */}
            <div className="flex gap-2">
              {tfStage === 'idle' && (
                <button
                  onClick={handleRunTerraform}
                  className="flex-1 py-2 text-xs font-bold bg-blue-600/20 text-blue-400 hover:bg-blue-600/30 rounded-lg border border-blue-500/30 transition-colors"
                >
                  ▶ Run Terraform
                </button>
              )}
              {(tfStage === 'init' || tfStage === 'plan') && (
                <button
                  onClick={handleCancelTf}
                  className="flex-1 py-2 text-xs bg-surface-3 text-text-muted hover:bg-surface-4 rounded-lg border border-border transition-colors"
                >
                  Cancel
                </button>
              )}
              {tfStage === 'awaiting-confirm' && (
                <>
                  <button
                    onClick={handleCancelTf}
                    className="py-2 px-4 text-xs bg-surface-3 text-text-muted hover:bg-surface-4 rounded-lg border border-border transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleConfirmApply}
                    className="flex-1 py-2 text-xs font-bold bg-green-700/20 text-green-400 hover:bg-green-700/30 rounded-lg border border-green-600/30 transition-colors"
                  >
                    Confirm &amp; Apply →
                  </button>
                </>
              )}
              {tfStage === 'no-changes' && (
                <button
                  onClick={() => { setTfStage('idle'); setTfLines([]); }}
                  className="flex-1 py-2 text-xs bg-surface-3 text-text-muted hover:bg-surface-4 rounded-lg border border-border transition-colors"
                >
                  Run Again
                </button>
              )}
              {tfStage === 'error' && (
                <button
                  onClick={() => { setTfStage('idle'); setTfLines([]); setTfError(null); }}
                  className="flex-1 py-2 text-xs bg-surface-3 text-text-muted hover:bg-surface-4 rounded-lg border border-border transition-colors"
                >
                  Try Again
                </button>
              )}
            </div>
          </div>
        );
      })()}

      {/* ── Rollback banner ─────────────────────────────────── */}
      {rollbackAvailable && !showRollback && (
        <div className="bg-yellow-900/20 border border-yellow-600/30 rounded-xl p-3 flex items-center justify-between gap-3">
          <div className="flex flex-col gap-0.5">
            <span className="text-[11px] font-semibold text-yellow-400">↩ Rollback Available</span>
            {rollbackManifest && (
              <span className="text-[10px] text-text-muted">
                Applied {new Date(rollbackManifest.timestamp).toLocaleString()} to {rollbackManifest.targetOrgUrl}
              </span>
            )}
          </div>
          <div className="flex gap-2 shrink-0">
            <button
              onClick={handleStartRollback}
              className="py-1.5 px-3 text-[11px] font-bold bg-yellow-700/20 text-yellow-400 hover:bg-yellow-700/30 rounded-lg border border-yellow-600/30 transition-colors"
            >
              Rollback
            </button>
            <button
              onClick={handleClearRollback}
              className="py-1.5 px-3 text-[11px] bg-surface-3 text-text-muted hover:bg-surface-4 rounded-lg border border-border transition-colors"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* ── Rollback runner panel ────────────────────────────── */}
      {showRollback && (() => {
        const rollbackStageOrder = ['init', 'plan', 'apply'];
        const rollbackDoneStages = rollbackStageOrder.filter((_, i) =>
          rollbackStageOrder.indexOf(rollbackStage) > i ||
          rollbackStage === 'done'
        );
        const rollbackActiveStage =
          rollbackStage === 'awaiting-confirm' ? 'plan' :
          rollbackStage === 'done' ? '' :
          rollbackStage === 'error' ? rollbackStage :
          rollbackStage;

        return (
          <div className="bg-surface-2 border border-yellow-600/30 rounded-xl p-4 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold text-yellow-400">↩ Rollback in Progress</span>
            </div>

            {/* Stage pills */}
            <div className="flex gap-2">
              {rollbackStageOrder.map((s) => {
                const isDone = rollbackDoneStages.includes(s);
                const isActive = rollbackActiveStage === s;
                return (
                  <span
                    key={s}
                    className={[
                      'rounded-full px-3 py-0.5 text-[10px] font-semibold',
                      isDone ? 'bg-green-700/30 text-green-400' :
                      isActive ? 'bg-yellow-600/30 text-yellow-400' :
                      'bg-surface-3 text-text-muted',
                    ].join(' ')}
                  >
                    {isDone ? `✓ ${s}` : isActive ? `● ${s}` : s}
                  </span>
                );
              })}
            </div>

            {/* Terminal output pane */}
            {rollbackLines.length > 0 && (
              <div
                ref={rollbackOutputRef}
                className="rounded-md border border-surface-3 font-mono text-[10px] leading-relaxed p-2 overflow-y-auto"
                style={{ background: '#010409', height: '160px' }}
              >
                {rollbackLines.map((line, i) => {
                  const color =
                    /^\s*-/.test(line) || /error/i.test(line) ? '#f85149' :
                    /^\s*\+/.test(line) ? '#3fb950' :
                    /^\s*~/.test(line) ? '#ffa657' :
                    '#e6edf3';
                  return <div key={i} style={{ color }}>{line}</div>;
                })}
              </div>
            )}

            {/* Error message */}
            {rollbackStage === 'error' && rollbackError && (
              <p className="text-[11px] text-red-400">{rollbackError}</p>
            )}

            {/* Success message */}
            {rollbackStage === 'done' && (
              <p className="text-[11px] text-green-400 font-semibold">✓ Rollback complete — resources destroyed</p>
            )}

            {/* Action buttons */}
            <div className="flex gap-2">
              {(rollbackStage === 'init' || rollbackStage === 'plan') && (
                <button
                  onClick={handleCancelRollback}
                  className="flex-1 py-2 text-xs bg-surface-3 text-text-muted hover:bg-surface-4 rounded-lg border border-border transition-colors"
                >
                  Cancel
                </button>
              )}
              {rollbackStage === 'awaiting-confirm' && (
                <>
                  <button
                    onClick={handleCancelRollback}
                    className="py-2 px-4 text-xs bg-surface-3 text-text-muted hover:bg-surface-4 rounded-lg border border-border transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleConfirmRollback}
                    className="flex-1 py-2 text-xs font-bold bg-red-700/20 text-red-400 hover:bg-red-700/30 rounded-lg border border-red-600/30 transition-colors"
                  >
                    Confirm Rollback — Destroy All →
                  </button>
                </>
              )}
              {rollbackStage === 'error' && (
                <button
                  onClick={() => { setRollbackStage('idle'); setRollbackLines([]); setRollbackError(null); setShowRollback(false); setRollbackDir(null); }}
                  className="flex-1 py-2 text-xs bg-surface-3 text-text-muted hover:bg-surface-4 rounded-lg border border-border transition-colors"
                >
                  Dismiss
                </button>
              )}
              {rollbackStage === 'done' && (
                <button
                  onClick={() => { setShowRollback(false); setRollbackStage('idle'); setRollbackLines([]); }}
                  className="flex-1 py-2 text-xs bg-surface-3 text-text-muted hover:bg-surface-4 rounded-lg border border-border transition-colors"
                >
                  Close
                </button>
              )}
            </div>
          </div>
        );
      })()}
    </div>
  );
}
