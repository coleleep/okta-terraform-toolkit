import { create } from 'zustand';
import {
  ConnectionStatus, ProbeResult, ConfigRecommendation,
  ProbeProgress, ManagedResourceType, ResourceCount, ResourceWorkload,
  OperationType, EndpointProbeResult, TargetRuntimeAnalysis,
  PreventionOptions, DEFAULT_PREVENTION_OPTIONS, TerraformAuthMethod,
  CustomWorkloadEntry,
} from '../../shared/types';
import { ProviderVersion, DEFAULT_VERSION } from '../../shared/versions';
import { RESOURCE_TYPES } from '../../shared/constants';
import type { OktaTerraformAPI } from '../../preload';

declare global {
  interface Window {
    oktaTerraform: OktaTerraformAPI;
  }
}

const api = () => window.oktaTerraform;

interface AppState {
  // Connection
  connection: ConnectionStatus;
  connecting: boolean;
  connect: (config: { orgUrl: string; authMethod: 'token'; token: string }) => Promise<boolean>;
  disconnect: () => void;

  // Probing
  probing: boolean;
  probeProgress: ProbeProgress | null;
  probeResult: ProbeResult | null;
  baselineProbeResult: ProbeResult | null; // Before deep probe merge
  startProbe: () => Promise<void>;

  // Resource selection
  selectedResources: ManagedResourceType[];
  resourceCounts: ResourceCount[];
  counting: boolean;
  countingLabel: string | null;
  operation: OperationType;
  preventionOptions: PreventionOptions;
  terraformAuthMethod: TerraformAuthMethod;
  toggleResource: (type: ManagedResourceType) => void;
  setOperation: (op: OperationType) => void;
  setTerraformAuthMethod: (method: TerraformAuthMethod) => void;
  togglePrevention: (key: keyof PreventionOptions) => void;
  setManagedCount: (type: ManagedResourceType, managedCount: number | undefined) => void;
  customWorkloads: CustomWorkloadEntry[];
  addCustomWorkload: (entry: CustomWorkloadEntry) => void;
  removeCustomWorkload: (terraformResource: string) => void;
  fetchCounts: () => Promise<void>;
  clearSelection: () => void;

  // Recommendations
  recommendation: ConfigRecommendation | null;
  refreshRecommendation: () => Promise<void>;

  // Target runtime "what if"
  targetMinutes: number | null;
  targetAnalysis: TargetRuntimeAnalysis | null;
  setTargetMinutes: (minutes: number | null) => Promise<void>;
  analyzeTarget: () => Promise<void>;

  // Provider version
  providerVersion: ProviderVersion;
  setProviderVersion: (version: ProviderVersion) => void;

  // File operations
  saveTfFile: (content: string) => Promise<string | null>;
  saveProjectDir: (files: Record<string, string>) => Promise<string | null>;
}

export const useStore = create<AppState>((set, get) => ({
  // Connection
  connection: { connected: false },
  connecting: false,

  connect: async (config) => {
    set({ connecting: true });
    const result = await api().connect(config);
    if (result.success) {
      set({
        connection: { connected: true, orgUrl: config.orgUrl },
        connecting: false,
      });
      get().startProbe();
      return true;
    }
    set({
      connection: { connected: false, error: result.error },
      connecting: false,
    });
    return false;
  },

  disconnect: () => {
    api().disconnect();
    set({
      connection: { connected: false },
      probeResult: null,
      baselineProbeResult: null,
      recommendation: null,
      probeProgress: null,
      selectedResources: [],
      resourceCounts: [],
      operation: 'import',
    });
  },

  // Probing
  probing: false,
  probeProgress: null,
  probeResult: null,
  baselineProbeResult: null,

  startProbe: async () => {
    set({ probing: true, probeProgress: null, probeResult: null, baselineProbeResult: null, recommendation: null });

    const cleanup = api().onProbeProgress((progress) => {
      set({ probeProgress: progress });
    });

    const result = await api().startProbe();
    cleanup();

    if (result.success && result.data) {
      set({ probeResult: result.data, baselineProbeResult: result.data, probing: false });

      const { selectedResources, resourceCounts, operation } = get();
      const workload = buildWorkload(selectedResources, resourceCounts, operation, get().preventionOptions, get().customWorkloads);
      const recResult = await api().getRecommendations(result.data, workload);
      if (recResult.success && recResult.data) {
        set({ recommendation: recResult.data });
      }
    } else {
      set({ probing: false });
    }
  },

  // Resource selection
  selectedResources: [],
  resourceCounts: [],
  counting: false,
  countingLabel: null,
  operation: 'import',
  preventionOptions: { ...DEFAULT_PREVENTION_OPTIONS },
  terraformAuthMethod: 'api_token' as TerraformAuthMethod,

  toggleResource: (type) => {
    set((state) => {
      const next = state.selectedResources.includes(type)
        ? state.selectedResources.filter(t => t !== type)
        : [...state.selectedResources, type];
      return { selectedResources: next };
    });
  },

  setOperation: (op) => {
    set({ operation: op });
  },

  setTerraformAuthMethod: (method) => {
    set({ terraformAuthMethod: method });
  },

  togglePrevention: (key) => {
    set((state) => ({
      preventionOptions: {
        ...state.preventionOptions,
        [key]: !state.preventionOptions[key],
      },
    }));
  },

  setManagedCount: (type, managedCount) => {
    set((state) => {
      const existing = state.resourceCounts.find(c => c.type === type);
      if (existing) {
        return {
          resourceCounts: state.resourceCounts.map(c =>
            c.type === type ? { ...c, managedCount } : c
          ),
        };
      }
      // Create a placeholder entry if none exists yet (before Count & Optimize)
      const def = RESOURCE_TYPES.find(r => r.type === type);
      return {
        resourceCounts: [
          ...state.resourceCounts,
          { type, label: def?.label ?? type, count: 0, managedCount },
        ],
      };
    });
  },

  customWorkloads: [],
  addCustomWorkload: (entry) => {
    set((state) => ({
      customWorkloads: [
        ...state.customWorkloads.filter(w => w.terraformResource !== entry.terraformResource),
        entry,
      ],
    }));
  },
  removeCustomWorkload: (terraformResource) => {
    set((state) => ({
      customWorkloads: state.customWorkloads.filter(w => w.terraformResource !== terraformResource),
    }));
  },

  clearSelection: async () => {
    const { baselineProbeResult } = get();
    set({
      selectedResources: [],
      resourceCounts: [],
      customWorkloads: [],
      operation: 'import',
      preventionOptions: { ...DEFAULT_PREVENTION_OPTIONS },
      countingLabel: null,
      probeResult: baselineProbeResult, // Restore pre-deep-probe results
    });
    // Re-analyze without workload using baseline
    if (baselineProbeResult) {
      const recResult = await api().getRecommendations(baselineProbeResult);
      if (recResult.success && recResult.data) {
        set({ recommendation: recResult.data });
      }
    }
  },

  fetchCounts: async () => {
    const { selectedResources, operation, customWorkloads } = get();

    // Custom workloads only — skip API counting, just optimize
    if (selectedResources.length === 0 && customWorkloads.length > 0) {
      set({ counting: true, countingLabel: 'Optimizing...', resourceCounts: [] });
      const { probeResult } = get();
      if (probeResult) {
        const workload = buildWorkload([], [], operation, get().preventionOptions, customWorkloads);
        const recResult = await api().getRecommendations(probeResult, workload);
        if (recResult.success && recResult.data) {
          set({ recommendation: recResult.data });
        }
      }
      set({ counting: false, countingLabel: null });
      return;
    }

    if (selectedResources.length === 0) {
      set({ resourceCounts: [] });
      const { probeResult } = get();
      if (probeResult) {
        const recResult = await api().getRecommendations(probeResult);
        if (recResult.success && recResult.data) {
          set({ recommendation: recResult.data });
        }
      }
      return;
    }

    set({ counting: true, countingLabel: null });

    // Phase 1: Count resources
    const countCleanup = api().onCountProgress((current) => {
      set({ countingLabel: `Counting ${current}` });
    });

    const countResult = await api().countResources(selectedResources);
    countCleanup();

    if (!countResult.success || !countResult.data) {
      set({ counting: false, countingLabel: null });
      return;
    }

    const counts: ResourceCount[] = countResult.data;
    set({ resourceCounts: counts, countingLabel: 'Deep probing sub-resources...' });

    // Phase 2: Deep probe sub-resource endpoints
    const deepCleanup = api().onDeepProbeProgress((progress: ProbeProgress) => {
      set({ countingLabel: `Probing ${progress.currentEndpoint}` });
    });

    const deepResult = await api().deepProbe(counts);
    deepCleanup();

    // Phase 3: Merge deep probe results into the baseline (pre-deep-probe) result
    // Always merge from baseline to prevent duplication on re-runs
    const { baselineProbeResult } = get();
    const mergeBase = baselineProbeResult || get().probeResult;
    if (mergeBase && deepResult.success && deepResult.data) {
      const subResults: EndpointProbeResult[] = deepResult.data;
      const mergedEndpoints = [...mergeBase.endpoints, ...subResults];
      const successfulAll = mergedEndpoints.filter(r => r.status !== 'error' && r.status !== 'skipped' && r.limit > 0);
      const mergedProbeResult: ProbeResult = {
        ...mergeBase,
        endpoints: mergedEndpoints,
        overallMinLimit: successfulAll.length > 0
          ? Math.min(...successfulAll.map(r => r.limit))
          : mergeBase.overallMinLimit,
      };

      set({ probeResult: mergedProbeResult, counting: false, countingLabel: null });

      // Re-analyze with workload + merged probe data
      const workload = buildWorkload(selectedResources, counts, operation, get().preventionOptions, get().customWorkloads);
      const recResult = await api().getRecommendations(mergedProbeResult, workload);
      if (recResult.success && recResult.data) {
        set({ recommendation: recResult.data });
      }
    } else {
      set({ counting: false, countingLabel: null });

      // Still analyze with what we have
      const fallbackProbe = mergeBase || get().probeResult;
      if (fallbackProbe) {
        const workload = buildWorkload(selectedResources, counts, operation, get().preventionOptions, get().customWorkloads);
        const recResult = await api().getRecommendations(fallbackProbe, workload);
        if (recResult.success && recResult.data) {
          set({ recommendation: recResult.data });
        }
      }
    }
  },

  // Recommendations
  recommendation: null,

  refreshRecommendation: async () => {
    const { probeResult, selectedResources, resourceCounts, operation } = get();
    if (!probeResult) return;
    const workload = buildWorkload(selectedResources, resourceCounts, operation, get().preventionOptions, get().customWorkloads);
    const recResult = await api().getRecommendations(probeResult, workload);
    if (recResult.success && recResult.data) {
      set({ recommendation: recResult.data });
    }
  },

  // Target runtime "what if"
  targetMinutes: null,
  targetAnalysis: null,

  setTargetMinutes: async (minutes) => {
    set({ targetMinutes: minutes, targetAnalysis: null });
    if (!minutes) return;
    // Auto-analyze with the new target
    const { probeResult, selectedResources, resourceCounts, operation, recommendation, customWorkloads } = get();
    console.log(`[target] setTargetMinutes(${minutes}): probe=${!!probeResult}, selected=${selectedResources.length}, custom=${customWorkloads.length}`);
    if (!probeResult) { console.log('[target] No probe result, aborting'); return; }
    if (selectedResources.length === 0 && customWorkloads.length === 0) { console.log('[target] No workload, aborting'); return; }
    const workload = buildWorkload(selectedResources, resourceCounts, operation, get().preventionOptions, customWorkloads);
    if (!workload) { console.log('[target] buildWorkload returned undefined, aborting'); return; }
    console.log(`[target] Analyzing: totalResources=${workload.totalResources}, customWorkloads=${workload.customWorkloads.length}`);
    const result = await api().analyzeTarget(probeResult, workload, minutes, recommendation?.recommended, recommendation?.runtimeEstimate);
    console.log(`[target] Result: success=${result.success}, data=${!!result.data}`, result.data ? `achievable=${result.data.achievable}, est=${result.data.estimatedMinutes}` : result.error);
    if (result.success && result.data) {
      set({ targetAnalysis: result.data });
    }
  },

  analyzeTarget: async () => {
    const { probeResult, selectedResources, resourceCounts, operation, targetMinutes, recommendation, customWorkloads } = get();
    if (!probeResult || !targetMinutes) return;
    if (selectedResources.length === 0 && customWorkloads.length === 0) return;
    const workload = buildWorkload(selectedResources, resourceCounts, operation, get().preventionOptions, customWorkloads);
    if (!workload) return;
    const result = await api().analyzeTarget(probeResult, workload, targetMinutes, recommendation?.recommended, recommendation?.runtimeEstimate);
    if (result.success && result.data) {
      set({ targetAnalysis: result.data });
    }
  },

  // Provider version
  providerVersion: DEFAULT_VERSION,
  setProviderVersion: (version) => set({ providerVersion: version }),

  // File operations
  saveTfFile: async (content) => {
    const result = await api().saveTfFile(content);
    if (result.success) return result.data;
    return null;
  },

  saveProjectDir: async (files) => {
    const result = await api().saveProjectDir(files);
    if (result.success) return result.data;
    return null;
  },
}));

function buildWorkload(
  selected: ManagedResourceType[],
  counts: ResourceCount[],
  operation: OperationType,
  preventionOptions?: PreventionOptions,
  customWorkloads?: CustomWorkloadEntry[]
): ResourceWorkload | undefined {
  const cw = customWorkloads ?? [];
  if (selected.length === 0 && cw.length === 0) return undefined;
  const orgTotalResources = counts
    .filter(c => !c.error)
    .reduce((sum, c) => sum + c.count, 0);
  const gridManaged = counts
    .filter(c => !c.error)
    .reduce((sum, c) => sum + (c.managedCount ?? c.count), 0);
  const customTotal = cw.reduce((sum, w) => sum + w.count, 0);
  const totalResources = gridManaged + customTotal;
  return {
    selected, counts, totalResources, orgTotalResources, operation,
    preventionOptions: preventionOptions ?? { ...DEFAULT_PREVENTION_OPTIONS },
    customWorkloads: cw,
  };
}
