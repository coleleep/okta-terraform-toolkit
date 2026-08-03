import React from 'react';
import { useStore } from '../hooks/useStore';
import type { Finding } from '../../shared/types';

function FindingItem({ finding }: { finding: Finding }) {
  const isError = finding.severity === 'error';
  return (
    <div className={`rounded px-3 py-2 text-xs ${isError ? 'bg-red-50' : 'bg-yellow-50'}`}>
      <span className={`font-semibold uppercase text-xs ${isError ? 'text-red-600' : 'text-yellow-600'}`}>
        {finding.severity}
      </span>
      {' · '}
      <code className="text-gray-600">{finding.file} · {finding.resourceAddress}</code>
      <p className="mt-0.5 text-gray-700">{finding.title}</p>
    </div>
  );
}

export default function ExportGateModal() {
  const { exportValidationGate, dismissExportGate, confirmExportGate } = useStore();

  if (!exportValidationGate) return null;

  const { findings } = exportValidationGate;
  const errors = findings.filter(f => f.severity === 'error');
  const warnings = findings.filter(f => f.severity === 'warning');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg mx-4 p-6">
        <h2 className="text-base font-semibold text-gray-900 mb-1">
          Validation findings before export
        </h2>
        <p className="text-xs text-gray-500 mb-4">
          {errors.length > 0
            ? `${errors.length} error${errors.length !== 1 ? 's' : ''} found. Fix them or save anyway.`
            : `${warnings.length} warning${warnings.length !== 1 ? 's' : ''} found. Review before saving.`}
        </p>
        <div className="space-y-2 max-h-64 overflow-y-auto mb-5">
          {[...errors, ...warnings].map(f => (
            <FindingItem key={f.id} finding={f} />
          ))}
        </div>
        <div className="flex items-center justify-end gap-3">
          <button
            onClick={dismissExportGate}
            className="px-4 py-1.5 text-xs font-medium text-gray-600 hover:text-gray-900 border border-gray-200 rounded-lg"
          >
            Cancel
          </button>
          <button
            onClick={() => void confirmExportGate()}
            className="px-4 py-1.5 text-xs font-medium text-white bg-okta-blue hover:bg-blue-700 rounded-lg"
          >
            Save anyway
          </button>
        </div>
      </div>
    </div>
  );
}
