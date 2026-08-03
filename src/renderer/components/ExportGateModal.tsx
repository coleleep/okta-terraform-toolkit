import React from 'react';
import { useStore } from '../hooks/useStore';
import type { Finding } from '../../shared/types';

function FindingItem({ finding }: { finding: Finding }) {
  const isError = finding.severity === 'error';
  return (
    <div className={`rounded-lg px-3 py-2.5 text-xs border ${isError ? 'border-accent-red/30 bg-accent-red/10' : 'border-accent-amber/30 bg-accent-amber/10'}`}>
      <div className="flex items-center gap-2 mb-1">
        <span className={`font-semibold uppercase text-xs tracking-wide ${isError ? 'text-accent-red' : 'text-accent-amber'}`}>
          {finding.severity}
        </span>
        <span className="text-text-muted">·</span>
        <span className="font-mono text-text-secondary truncate">{finding.file}</span>
        {finding.resourceAddress && (
          <>
            <span className="text-text-muted">·</span>
            <span className="font-mono text-text-secondary truncate">{finding.resourceAddress}</span>
          </>
        )}
      </div>
      <p className="text-text-primary leading-relaxed">{finding.title}</p>
    </div>
  );
}

export default function ExportGateModal() {
  const { exportValidationGate, dismissExportGate, confirmExportGate } = useStore();

  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dismissExportGate();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [dismissExportGate]);

  if (!exportValidationGate) return null;

  const { findings } = exportValidationGate;
  const errors = findings.filter(f => f.severity === 'error');
  const warnings = findings.filter(f => f.severity === 'warning');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={dismissExportGate}>
      <div
        className="bg-surface-2 border border-border rounded-xl shadow-2xl w-full max-w-lg mx-4 p-6"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-sm font-semibold text-text-primary mb-1">
          Validation findings before export
        </h2>
        <p className="text-xs text-text-secondary mb-4">
          {errors.length > 0
            ? `${errors.length} error${errors.length !== 1 ? 's' : ''} found. Fix them or save anyway.`
            : `${warnings.length} warning${warnings.length !== 1 ? 's' : ''} found. Review before saving.`}
        </p>
        <div className="space-y-2 max-h-64 overflow-y-auto mb-5 pr-0.5">
          {[...errors, ...warnings].map(f => (
            <FindingItem key={f.id} finding={f} />
          ))}
        </div>
        <div className="flex items-center justify-end gap-3">
          <button
            onClick={dismissExportGate}
            className="px-4 py-1.5 text-xs font-medium text-text-secondary hover:text-text-primary border border-border hover:border-border-hover rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => void confirmExportGate()}
            className="px-4 py-1.5 text-xs font-medium text-white bg-accent-blue hover:bg-blue-600 rounded-lg transition-colors"
          >
            Save anyway
          </button>
        </div>
      </div>
    </div>
  );
}
