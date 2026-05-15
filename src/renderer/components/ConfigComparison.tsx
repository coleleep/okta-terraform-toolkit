import React, { useState } from 'react';
import { ConfigRecommendation, TerraformProviderConfig } from '../../shared/types';

interface Props {
  recommendation: ConfigRecommendation;
}

const settingLabels: Record<keyof TerraformProviderConfig, string> = {
  backoff: 'backoff',
  max_retries: 'max_retries',
  max_api_capacity: 'max_api_capacity',
  min_wait_seconds: 'min_wait_seconds',
  max_wait_seconds: 'max_wait_seconds',
  request_timeout: 'request_timeout',
  parallelism: 'parallelism',
};

const settingOrder: (keyof TerraformProviderConfig)[] = [
  'max_api_capacity',
  'parallelism',
  'max_retries',
  'backoff',
  'min_wait_seconds',
  'max_wait_seconds',
  'request_timeout',
];

function formatValue(val: boolean | number): string {
  if (typeof val === 'boolean') return val ? 'true' : 'false';
  if (val === 0) return '0 (unlimited)';
  return String(val);
}

export default function ConfigComparison({ recommendation }: Props) {
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-xs text-gray-500 uppercase tracking-wide">
          <th className="px-5 py-3 font-medium">Setting</th>
          <th className="px-5 py-3 font-medium text-right">Default</th>
          <th className="px-5 py-3 font-medium text-right">Recommended</th>
          <th className="px-5 py-3 font-medium">Why</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-white/5">
        {settingOrder.map((key) => {
          const currentVal = recommendation.current[key];
          const recVal = recommendation.recommended[key];
          const changed = currentVal !== recVal;
          const explanation = recommendation.explanations[key];
          const isExpanded = expanded === key;

          return (
            <tr
              key={key}
              className="transition-colors cursor-pointer hover:bg-white/5"
              onClick={() => setExpanded(isExpanded ? null : key)}
            >
              <td className="px-5 py-3 font-mono text-xs text-gray-300">{settingLabels[key]}</td>
              <td className="px-5 py-3 text-right text-gray-400">{formatValue(currentVal)}</td>
              <td className={`px-5 py-3 text-right font-medium ${changed ? 'text-blue-400' : 'text-gray-200'}`}>
                {formatValue(recVal)}
                {changed && <span className="ml-1 text-green-400 text-xs">changed</span>}
              </td>
              <td className="px-5 py-3 text-gray-400 text-xs max-w-xs">
                {isExpanded ? explanation : `${explanation.slice(0, 60)}...`}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
