import React from 'react';
import { ProbeProgress as ProbeProgressType } from '../../shared/types';

interface Props {
  progress: ProbeProgressType;
}

export default function ProbeProgress({ progress }: Props) {
  const pct = progress.total > 0 ? Math.round((progress.completed / progress.total) * 100) : 0;

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium text-gray-700">
          Probing {progress.currentEndpoint}...
        </span>
        <span className="text-sm text-gray-400">
          {progress.completed} / {progress.total}
        </span>
      </div>
      <div className="w-full bg-gray-100 rounded-full h-2">
        <div
          className="bg-blue-500 h-2 rounded-full transition-all duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
