import React, { useState } from 'react';
import { useStore } from '../hooks/useStore';
import { TerraformProviderConfig } from '../../shared/types';

const presets = [
  { label: '15 min', value: 15 },
  { label: '30 min', value: 30 },
  { label: '1 hour', value: 60 },
  { label: '2 hours', value: 120 },
  { label: '4 hours', value: 240 },
];

export default function TargetRuntime() {
  const {
    targetMinutes, targetAnalysis, selectedResources, resourceCounts, customWorkloads,
    setTargetMinutes, analyzeTarget,
  } = useStore();

  const [customMinutes, setCustomMinutes] = useState('');
  const hasWorkload = (selectedResources.length > 0 && resourceCounts.length > 0) || customWorkloads.length > 0;

  if (!hasWorkload) {
    return (
      <div className="p-5 text-sm text-gray-400">
        Select resources and run "Count & Optimize", or add custom workloads, to enable target runtime analysis.
      </div>
    );
  }

  const handlePreset = (minutes: number) => {
    setTargetMinutes(minutes);
    setCustomMinutes('');
  };

  const handleCustom = () => {
    const val = parseInt(customMinutes, 10);
    if (val > 0) setTargetMinutes(val);
  };

  return (
    <div className="p-5 space-y-4">
      <p className="text-sm text-gray-500">
        Set a target completion time to see if your current rate limits can support it — and what increases to request if not.
      </p>

      {/* Preset buttons + custom input */}
      <div className="flex items-center gap-2 flex-wrap">
        {presets.map((p) => (
          <button
            key={p.value}
            onClick={() => handlePreset(p.value)}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
              targetMinutes === p.value
                ? 'border-blue-500 bg-blue-50 text-blue-700'
                : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
            }`}
          >
            {p.label}
          </button>
        ))}
        <div className="flex items-center gap-1">
          <input
            type="number"
            value={customMinutes}
            onChange={(e) => setCustomMinutes(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleCustom(); }}
            placeholder="Custom"
            min={1}
            className="w-20 px-2 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <span className="text-xs text-gray-400">min</span>
          <button
            onClick={handleCustom}
            disabled={!customMinutes}
            className="px-2 py-1.5 text-xs font-medium text-blue-600 hover:text-blue-700 disabled:text-gray-300"
          >
            Set
          </button>
        </div>
      </div>

      {/* Analyze button */}
      {targetMinutes && (
        <button
          onClick={analyzeTarget}
          className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors"
        >
          Analyze for {targetMinutes} min target
        </button>
      )}

      {/* Results */}
      {targetAnalysis && (
        <div className="space-y-4">
          {/* Summary banner */}
          <div className={`rounded-lg p-4 ${
            targetAnalysis.achievable
              ? 'bg-green-50 border border-green-200'
              : 'bg-red-50 border border-red-200'
          }`}>
            <div className="flex items-start gap-3">
              <span className="text-2xl">{targetAnalysis.achievable ? '\u2713' : '\u2717'}</span>
              <div>
                <p className={`text-sm font-medium ${targetAnalysis.achievable ? 'text-green-800' : 'text-red-800'}`}>
                  {targetAnalysis.achievable ? 'Target Achievable' : 'Rate Limit Increase Needed'}
                </p>
                <p className={`text-xs mt-1 ${targetAnalysis.achievable ? 'text-green-600' : 'text-red-600'}`}>
                  {targetAnalysis.summary}
                </p>
              </div>
            </div>
          </div>

          {/* Throughput comparison */}
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-gray-50 rounded-lg p-3">
              <p className="text-xs text-gray-400 uppercase tracking-wide">Current Throughput</p>
              <p className="text-lg font-bold text-gray-900">{targetAnalysis.currentThroughput} <span className="text-xs font-normal text-gray-400">calls/min</span></p>
              <p className="text-xs text-gray-500 mt-1">Est. runtime: {targetAnalysis.estimatedMinutes} min</p>
            </div>
            <div className="bg-gray-50 rounded-lg p-3">
              <p className="text-xs text-gray-400 uppercase tracking-wide">Required Throughput</p>
              <p className="text-lg font-bold text-blue-700">{targetAnalysis.requiredThroughput} <span className="text-xs font-normal text-gray-400">calls/min</span></p>
              <p className="text-xs text-gray-500 mt-1">Target: {targetAnalysis.targetMinutes} min</p>
            </div>
          </div>

          {/* Bottleneck endpoints */}
          {targetAnalysis.bottlenecks.length > 0 && (
            <div>
              <h3 className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">
                Endpoints Requiring Rate Limit Increases
              </h3>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-gray-400 uppercase tracking-wide">
                    <th className="px-3 py-2 font-medium">Endpoint</th>
                    <th className="px-3 py-2 font-medium text-center">Op</th>
                    <th className="px-3 py-2 font-medium text-right">Current</th>
                    <th className="px-3 py-2 font-medium text-right">Required</th>
                    <th className="px-3 py-2 font-medium text-right">Increase</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {targetAnalysis.bottlenecks.map((b, idx) => (
                    <tr key={`${b.endpoint}-${idx}`} className="hover:bg-gray-50">
                      <td className="px-3 py-2">
                        <span className="font-mono text-xs text-gray-600">{b.endpoint}</span>
                        <br />
                        <span className="text-xs text-gray-400">{b.label}</span>
                      </td>
                      <td className="px-3 py-2 text-center">
                        <span className={`inline-block px-1.5 py-0.5 rounded text-xs font-mono font-medium ${
                          b.method === 'GET' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
                        }`}>
                          {b.method}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right font-medium text-gray-900">{b.currentLimit}</td>
                      <td className="px-3 py-2 text-right font-medium text-blue-700">{b.requiredLimit}</td>
                      <td className="px-3 py-2 text-right">
                        <span className="text-red-600 font-medium">+{b.increaseNeeded}</span>
                        <span className="text-gray-400 text-xs ml-1">(+{b.percentIncrease}%)</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Recommended config if increases granted */}
          {targetAnalysis.recommendedConfig && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <h3 className="text-xs font-medium text-blue-700 uppercase tracking-wide mb-2">
                Recommended Config If Increases Granted
              </h3>
              <pre className="text-xs font-mono text-blue-800 leading-relaxed">
{`max_retries      = ${targetAnalysis.recommendedConfig.max_retries}
max_api_capacity = ${targetAnalysis.recommendedConfig.max_api_capacity}
min_wait_seconds = ${targetAnalysis.recommendedConfig.min_wait_seconds}
max_wait_seconds = ${targetAnalysis.recommendedConfig.max_wait_seconds}
request_timeout  = ${targetAnalysis.recommendedConfig.request_timeout}
parallelism      = ${targetAnalysis.recommendedConfig.parallelism}`}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
