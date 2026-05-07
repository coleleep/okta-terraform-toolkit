import React, { useState } from 'react';
import SolutionBuilder from './SolutionBuilder';
import ResourceSelector from './ResourceSelector';
import ConfigComparison from './ConfigComparison';
import ProviderBlock from './ProviderBlock';
import RuntimeEstimate from './RuntimeEstimate';
import TargetRuntime from './TargetRuntime';
import ContextualTip from './ContextualTip';
import { useStore } from '../hooks/useStore';
import { OPERATIONS } from '../../shared/constants';

type PlanTab = 'solution' | 'workload' | 'config' | 'export' | 'target';

const TABS: { id: PlanTab; label: string }[] = [
  { id: 'solution', label: 'Solution Builder' },
  { id: 'workload', label: 'Workload' },
  { id: 'config', label: 'Config' },
  { id: 'export', label: 'Export' },
  { id: 'target', label: 'Target Planner' },
];

export default function PlanSection() {
  const [activeTab, setActiveTab] = useState<PlanTab>('solution');
  const {
    probeResult, recommendation, selectedResources, resourceCounts,
    operation, providerVersion,
  } = useStore();

  const hasWorkload = selectedResources.length > 0 && resourceCounts.length > 0;
  const operationDef = OPERATIONS.find(o => o.type === operation);

  return (
    <div className="space-y-4">
      {/* Tab bar */}
      <div className="flex gap-1 bg-surface-2 border border-border rounded-lg p-1 w-fit">
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-1.5 text-xs font-medium rounded-md transition-colors ${
              activeTab === tab.id
                ? 'bg-surface-4 text-accent-teal shadow-glow-sm'
                : 'text-text-muted hover:text-text-secondary'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Solution Builder */}
      {activeTab === 'solution' && <SolutionBuilder />}

      {/* Workload */}
      {activeTab === 'workload' && (
        <div className="space-y-6">
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            <ResourceSelector />
          </div>
          {recommendation?.runtimeEstimate && (
            <RuntimeEstimate
              estimate={recommendation.runtimeEstimate}
              onNavigateToConfig={() => setActiveTab('config')}
            />
          )}
        </div>
      )}

      {/* Config */}
      {activeTab === 'config' && recommendation && (
        <div className="space-y-6">
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100">
              <h2 className="text-sm font-medium text-okta-gray uppercase tracking-wide">
                Provider Configuration — Default vs. Recommended
              </h2>
              {hasWorkload && (
                <p className="text-xs text-okta-blue mt-0.5">
                  Tuned for {resourceCounts.filter(c => !c.error).reduce((s, c) => s + c.count, 0).toLocaleString()} resources
                  {operationDef ? ` — ${operationDef.label.toLowerCase()}` : ''}
                </p>
              )}
            </div>
            <ConfigComparison recommendation={recommendation} />
          </div>
          <ContextualTip variant="warning">
            <strong>Parallelism is the #1 cause of rate limit errors.</strong> Terraform's default (10) is too aggressive for most Okta orgs.
            Always run with <code className="bg-amber-100/50 px-1 rounded">-parallelism=1</code> or <code className="bg-amber-100/50 px-1 rounded">-parallelism=2</code> until you've verified your rate limits can handle more.
          </ContextualTip>
          {recommendation.recommended.request_timeout > 0 && (
            <ContextualTip variant="recommended">
              <strong>request_timeout</strong> is set to {recommendation.recommended.request_timeout}s. The provider default (0) means unlimited — a single stuck API call can block your entire Terraform run indefinitely.
            </ContextualTip>
          )}
        </div>
      )}
      {activeTab === 'config' && !recommendation && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 text-center">
          <p className="text-okta-gray">Run a scan first to generate configuration recommendations.</p>
        </div>
      )}

      {/* Export */}
      {activeTab === 'export' && recommendation && (
        <div className="space-y-6">
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100">
              <h2 className="text-sm font-medium text-okta-gray uppercase tracking-wide">
                Export Terraform Project
              </h2>
              <p className="text-xs text-gray-400 mt-0.5">
                Complete project scaffold with resource configurations (v{providerVersion})
              </p>
            </div>
            <ProviderBlock
              config={recommendation.recommended}
              orgUrl={probeResult!.orgUrl}
            />
          </div>
          <ContextualTip variant="warning">
            <strong>Never commit .tfstate or .tfvars files</strong> to version control — they may contain API tokens and sensitive resource data.
            Use a remote backend (S3, GCS, Terraform Cloud) with state locking for team environments.
          </ContextualTip>
          <ContextualTip>
            After exporting, run <code className="bg-blue-100/50 px-1 rounded">terraform init</code> then <code className="bg-blue-100/50 px-1 rounded">terraform plan</code> to validate.
            Use import blocks to bring existing Okta resources under management without modifying them.
          </ContextualTip>
        </div>
      )}
      {activeTab === 'export' && !recommendation && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 text-center">
          <p className="text-okta-gray">Run a scan first to generate exportable configuration.</p>
        </div>
      )}

      {/* Target Planner */}
      {activeTab === 'target' && (
        <div className="space-y-6">
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100">
              <h2 className="text-sm font-medium text-okta-gray uppercase tracking-wide">
                Target Runtime Planner
              </h2>
              <p className="text-xs text-gray-400 mt-0.5">
                Can your current rate limits meet a target completion time?
              </p>
            </div>
            <TargetRuntime />
          </div>
          <ContextualTip>
            To request a rate limit increase, contact Okta support with your org URL, the specific endpoints you need increased, and the target throughput.
            Use the bottleneck table above as supporting evidence for your request.
          </ContextualTip>
        </div>
      )}
    </div>
  );
}
