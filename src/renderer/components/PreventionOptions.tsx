import React from 'react';
import { useStore } from '../hooks/useStore';
import { PreventionOptions as PreventionOptionsType } from '../../shared/types';
import { PREVENTION_OPTIONS } from '../../shared/constants';

export default function PreventionOptions() {
  const { selectedResources, preventionOptions, togglePrevention, counting } = useStore();

  // Only show options relevant to selected resource types
  const relevantOptions = PREVENTION_OPTIONS.filter(opt =>
    selectedResources.includes(opt.affectedResource)
  );

  if (relevantOptions.length === 0) return null;

  return (
    <div>
      <p className="text-sm text-gray-500 mb-3">
        Provider skip/include options that affect API call volume and runtime.
      </p>
      <div className="space-y-2">
        {relevantOptions.map((opt) => {
          const isEnabled = preventionOptions[opt.key];
          const isSkip = opt.key.startsWith('skip');

          return (
            <label
              key={opt.key}
              className={`
                flex items-start gap-3 px-3 py-2.5 rounded-lg border cursor-pointer transition-all
                ${isEnabled
                  ? isSkip
                    ? 'border-green-400 bg-green-50'
                    : 'border-orange-400 bg-orange-50'
                  : 'border-gray-200 bg-white hover:border-gray-300'}
                ${counting ? 'opacity-50 pointer-events-none' : ''}
              `}
            >
              <input
                type="checkbox"
                checked={isEnabled}
                onChange={() => togglePrevention(opt.key as keyof PreventionOptionsType)}
                disabled={counting}
                className="mt-0.5 rounded"
              />
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-gray-700">{opt.label}</span>
                  <code className="text-xs text-gray-400 bg-gray-100 px-1 rounded">{opt.terraformAttr}</code>
                  {opt.status === 'deprecated' && (
                    <span className="text-xs text-amber-600 bg-amber-50 px-1 rounded">deprecated</span>
                  )}
                </div>
                <p className="text-xs text-gray-400 mt-0.5">{opt.description}</p>
                <p className={`text-xs mt-0.5 font-medium ${
                  isEnabled
                    ? isSkip ? 'text-green-600' : 'text-orange-600'
                    : 'text-gray-300'
                }`}>
                  {isEnabled
                    ? isSkip
                      ? `Saves ~${opt.extraCallsPerResource} API call(s) per ${opt.affectedResource.replace(/s$/, '')}`
                      : `Adds ~${opt.extraCallsPerResource} API call(s) per ${opt.affectedResource.replace(/s$/, '')}`
                    : isSkip
                      ? 'Off — sub-resource calls will be made (default)'
                      : 'Off — sub-resource calls skipped (default)'}
                </p>
              </div>
            </label>
          );
        })}
      </div>
    </div>
  );
}
