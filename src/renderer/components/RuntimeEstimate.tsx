import React from 'react';
import { RuntimeEstimate as RuntimeEstimateType } from '../../shared/types';
import ContextualTip from './ContextualTip';

interface Props {
  estimate: RuntimeEstimateType;
  onNavigateToConfig?: () => void;
}

function formatDuration(minutes: number): string {
  if (minutes < 1) return 'under 1 min';
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const hours = Math.floor(minutes / 60);
  const remaining = Math.round(minutes % 60);
  if (remaining === 0) return `${hours}h`;
  return `${hours}h ${remaining}m`;
}

export default function RuntimeEstimate({ estimate, onNavigateToConfig }: Props) {
  const { minMinutes, maxMinutes, explanation } = estimate;

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-sm font-medium text-gray-500 uppercase tracking-wide mb-3">
            Estimated Runtime
          </h2>
          <div className="flex items-baseline gap-2 mb-2">
            <span className="text-2xl font-bold text-gray-900">
              {formatDuration(minMinutes)}
            </span>
            <span className="text-gray-400">to</span>
            <span className="text-2xl font-bold text-gray-900">
              {formatDuration(maxMinutes)}
            </span>
          </div>
          <p className="text-xs text-gray-400 leading-relaxed">{explanation}</p>
        </div>
        {onNavigateToConfig && (
          <button
            onClick={onNavigateToConfig}
            className="flex-shrink-0 ml-4 px-3 py-1.5 text-xs font-medium text-okta-blue bg-okta-blue/10 rounded-lg hover:bg-okta-blue/20 transition-colors"
          >
            View Recommended Config &rarr;
          </button>
        )}
      </div>
      {maxMinutes > 60 && (
        <div className="mt-3">
          <ContextualTip>
            Long runtimes are usually caused by high parallelism triggering rate limits, which forces excessive backoff waits.
            Counterintuitively, <strong>lowering parallelism often makes runs faster</strong> by avoiding 429 retries.
          </ContextualTip>
        </div>
      )}
    </div>
  );
}
