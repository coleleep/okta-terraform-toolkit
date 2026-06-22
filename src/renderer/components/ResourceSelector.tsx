import React from 'react';
import { useStore } from '../hooks/useStore';
import { ManagedResourceType, OperationType } from '../../shared/types';
import { RESOURCE_TYPES, RESOURCE_CATEGORIES, OPERATIONS } from '../../shared/constants';
import PreventionOptions from './PreventionOptions';
import AuthRecommendations from './AuthRecommendations';
import ContextualTip from './ContextualTip';
import ResourceLookup from './ResourceLookup';
import CustomWorkload from './CustomWorkload';

export default function ResourceSelector() {
  const {
    selectedResources, resourceCounts, counting, countingLabel,
    operation, probeResult, providerVersion, customWorkloads, connection,
    toggleResource, setOperation, setManagedCount, fetchCounts, clearSelection,
  } = useStore();

  const countMap = new Map(resourceCounts.map(c => [c.type, c]));
  const hasCounts = resourceCounts.length > 0;
  const hasSelection = selectedResources.length > 0;
  const hasCustom = customWorkloads.length > 0;
  const hasAnyWorkload = hasSelection || hasCustom;

  // Detect unlicensed resources from probe results
  const unlicensedTypes = new Set<string>();
  if (probeResult) {
    for (const ep of probeResult.endpoints) {
      if (ep.status === 'skipped' && ep.error?.includes('not licensed')) {
        const rt = RESOURCE_TYPES.find(r => r.probeLabel === ep.label);
        if (rt) unlicensedTypes.add(rt.type);
      }
    }
  }

  return (
    <div className="p-5 space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-sm font-medium text-gray-700">Workload Configuration</h2>
          <p className="text-xs text-gray-400 mt-0.5">
            Select which resources you plan to manage with Terraform (v{providerVersion}), or add specific sub-resources below.
          </p>
        </div>
        {(hasSelection || hasCounts) && (
          <button onClick={clearSelection} className="text-xs text-gray-400 hover:text-red-500 transition-colors">
            Clear all
          </button>
        )}
      </div>

      {/* Resource type grid with inline managed count */}
      <div className="space-y-4">
        {RESOURCE_CATEGORIES.map((cat) => {
          const typesInCategory = RESOURCE_TYPES.filter(r => r.category === cat.key);
          if (typesInCategory.length === 0) return null;

          return (
            <div key={cat.key}>
              <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">{cat.label}</p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {typesInCategory.map(({ type, label }) => {
                  const selected = selectedResources.includes(type);
                  const count = countMap.get(type);
                  const isUnlicensed = unlicensedTypes.has(type);

                  return (
                    <div key={type} className="flex flex-col">
                      <button
                        onClick={() => !isUnlicensed && toggleResource(type as ManagedResourceType)}
                        disabled={counting || isUnlicensed}
                        className={`
                          flex flex-col items-start px-3 py-2 rounded-lg border text-sm transition-all
                          ${isUnlicensed
                            ? 'border-gray-100 bg-gray-50 text-gray-300 cursor-not-allowed'
                            : selected
                              ? 'border-blue-500 bg-blue-50 text-blue-700'
                              : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:bg-gray-50'}
                          ${counting && !isUnlicensed ? 'opacity-50 cursor-not-allowed' : ''}
                          ${selected ? 'rounded-b-none' : ''}
                        `}
                      >
                        <span className="font-medium text-xs">{label}</span>
                        {isUnlicensed && (
                          <span className="text-xs mt-0.5 text-red-300">Not licensed</span>
                        )}
                        {!isUnlicensed && count && !count.error && (
                          <span className={`text-xs mt-0.5 ${selected ? 'text-blue-500' : 'text-gray-400'}`}>
                            {count.count.toLocaleString()} in org
                          </span>
                        )}
                        {!isUnlicensed && count?.error && (
                          <span className="text-xs mt-0.5 text-red-400">failed</span>
                        )}
                      </button>
                      {/* Inline managed count when selected */}
                      {selected && (
                        <div className="flex items-center border border-t-0 border-blue-300 bg-blue-50/50 rounded-b-lg px-2 py-1 gap-1">
                          <span className="text-xs text-blue-400">Managed:</span>
                          <input
                            type="number"
                            min={0}
                            value={count?.managedCount ?? ''}
                            placeholder={count ? String(count.count) : 'all'}
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) => {
                              const val = e.target.value ? parseInt(e.target.value, 10) : undefined;
                              setManagedCount(type as ManagedResourceType, val);
                            }}
                            className="w-14 px-1 py-0 border border-blue-200 rounded text-xs text-center bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Custom workload — specific TF resource types with endpoint mapping */}
      <CustomWorkload />

      {/* Resource dictionary lookup */}
      <ResourceLookup />

      {/* Operation type selector — show if any workload configured */}
      {hasAnyWorkload && (
        <div>
          <p className="text-sm text-gray-500 mb-3">What operations will Terraform perform?</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {OPERATIONS.map((op) => (
              <button
                key={op.type}
                onClick={() => setOperation(op.type as OperationType)}
                disabled={counting}
                className={`
                  flex flex-col items-start px-3 py-2 rounded-lg border text-sm transition-all
                  ${operation === op.type
                    ? 'border-purple-500 bg-purple-50 text-purple-700'
                    : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:bg-gray-50'}
                  ${counting ? 'opacity-50 cursor-not-allowed' : ''}
                `}
              >
                <span className="font-medium text-xs">{op.label}</span>
                <span className={`text-xs mt-0.5 ${operation === op.type ? 'text-purple-500' : 'text-gray-400'}`}>
                  {op.description}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Prevention / skip options */}
      {hasSelection && <PreventionOptions />}

      {/* Auth method recommendations */}
      {hasSelection && <AuthRecommendations />}

      {/* Action bar */}
      <div className="flex items-center gap-3">
        <button
          onClick={fetchCounts}
          disabled={!hasAnyWorkload || counting || !connection.connected}
          title={!connection.connected ? 'Connect to an org first' : undefined}
          className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {counting
            ? countingLabel ?? 'Working...'
            : hasSelection
              ? `Count & Optimize (${selectedResources.length} types${hasCustom ? ` + ${customWorkloads.length} custom` : ''})`
              : hasCustom
                ? `Optimize (${customWorkloads.length} custom workload${customWorkloads.length > 1 ? 's' : ''})`
                : 'Select resources or add custom workloads'}
        </button>

        {hasCounts && (
          <span className="text-sm text-gray-500">
            {resourceCounts.filter(c => !c.error).reduce((s, c) => s + (c.managedCount ?? c.count), 0).toLocaleString()} managed resources
            {hasCustom && ` + ${customWorkloads.reduce((s, w) => s + w.count, 0).toLocaleString()} custom`}
          </span>
        )}
      </div>

      {hasAnyWorkload && (
        <ContextualTip variant="recommended">
          Start with <strong>import</strong> if you have existing Okta resources. Use import blocks (Terraform 1.5+) to bring resources under management without modifying them.
          Add <code className="bg-green-100/50 px-1 rounded">lifecycle {'{'} prevent_destroy = true {'}'}</code> to critical resources like production apps and groups.
        </ContextualTip>
      )}
    </div>
  );
}
