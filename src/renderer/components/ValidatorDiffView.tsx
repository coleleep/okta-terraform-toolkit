import React, { useState, useMemo } from 'react';
import { Finding } from '../../shared/types';
import { computeDiffLines, DiffLine } from '../../shared/reconstruct';

interface ValidatorDiffViewProps {
  findings: Finding[];
  maskedFiles: Record<string, string>;
  acceptedIds: Set<string>;
  onToggle: (id: string) => void;
  onExport: () => void;
  onBack: () => void;
}

export default function ValidatorDiffView({
  findings,
  maskedFiles,
  acceptedIds,
  onToggle,
  onExport,
  onBack,
}: ValidatorDiffViewProps) {
  // Changed files are those with at least one finding
  const changedFiles = useMemo(
    () => [...new Set(findings.map(f => f.file))].sort(),
    [findings],
  );

  const [activeFile, setActiveFile] = useState<string>(changedFiles[0] ?? '');

  const fileFindingCount = (file: string) => findings.filter(f => f.file === file).length;

  const activeFindingsForFile = findings.filter(f => f.file === activeFile);

  const diffLines = useMemo(
    () => computeDiffLines(maskedFiles[activeFile] ?? '', activeFindingsForFile, acceptedIds),
    [activeFile, activeFindingsForFile, acceptedIds, maskedFiles],
  );

  const totalAccepted = findings.filter(f => acceptedIds.has(f.id)).length;

  return (
    <div className="bg-surface-2 rounded-xl border border-border overflow-hidden">
      {/* File tabs */}
      <div className="flex border-b border-border overflow-x-auto">
        {changedFiles.map(file => (
          <button
            key={file}
            onClick={() => setActiveFile(file)}
            className={`px-4 py-2.5 text-xs font-medium whitespace-nowrap border-r border-border flex items-center gap-1.5 transition-colors ${
              file === activeFile
                ? 'bg-surface-0 text-accent-teal border-b-2 border-b-accent-teal'
                : 'text-text-muted hover:text-text-secondary hover:bg-surface-1'
            }`}
          >
            {file}
            <span className={`text-[9px] px-1.5 py-0.5 rounded font-semibold ${
              file === activeFile ? 'bg-accent-teal/20 text-accent-teal' : 'bg-surface-3 text-text-muted'
            }`}>
              {fileFindingCount(file)}
            </span>
          </button>
        ))}
      </div>

      {/* Main panel: sidebar + diff */}
      <div className="grid" style={{ gridTemplateColumns: '220px 1fr', minHeight: '300px' }}>
        {/* Findings sidebar */}
        <div className="border-r border-border p-3 space-y-2 overflow-y-auto">
          <p className="text-[9px] text-text-muted uppercase tracking-wider font-semibold mb-3">
            Findings — {activeFile}
          </p>
          {activeFindingsForFile.map(finding => {
            const accepted = acceptedIds.has(finding.id);
            return (
              <div
                key={finding.id}
                className={`rounded-lg border p-2.5 cursor-pointer transition-colors ${
                  accepted
                    ? 'bg-accent-teal/5 border-accent-teal/25'
                    : 'border-border opacity-50'
                }`}
                onClick={() => onToggle(finding.id)}
              >
                <div className="flex items-center gap-2 mb-1.5">
                  <input
                    type="checkbox"
                    checked={accepted}
                    onChange={() => onToggle(finding.id)}
                    onClick={e => e.stopPropagation()}
                    style={{ accentColor: '#2dd4bf', width: 11, height: 11 }}
                  />
                  <SeverityBadge severity={finding.severity} />
                </div>
                <p className="text-[10px] text-text-primary leading-snug">{finding.title}</p>
                <p className="text-[9px] text-text-muted font-mono mt-1">{finding.resourceAddress}</p>
              </div>
            );
          })}
          <p className="text-[9px] text-text-muted pt-1">
            {activeFindingsForFile.filter(f => acceptedIds.has(f.id)).length} of{' '}
            {activeFindingsForFile.length} selected
          </p>
        </div>

        {/* Diff panel */}
        <div className="overflow-auto font-mono text-[10px] leading-5">
          {diffLines.length === 0 && (
            <p className="p-4 text-text-muted text-xs">No changes in this file.</p>
          )}
          {diffLines.map((line, i) => (
            <DiffLineRow key={i} line={line} />
          ))}
        </div>
      </div>

      {/* Footer */}
      <div className="border-t border-border px-4 py-2.5 flex items-center justify-between">
        <button
          onClick={onBack}
          className="text-[10px] text-text-muted hover:text-text-secondary transition-colors"
        >
          ← Back to Findings
        </button>
        <div className="flex items-center gap-3">
          <span className="text-[10px] text-text-muted">
            {totalAccepted} of {findings.length} fix{findings.length !== 1 ? 'es' : ''} selected
          </span>
          <button
            onClick={onExport}
            className="px-4 py-1.5 text-xs font-semibold bg-accent-teal text-surface-0 hover:bg-accent-teal/90 rounded-lg transition-colors"
          >
            Export Selected Fixes →
          </button>
        </div>
      </div>
    </div>
  );
}

function DiffLineRow({ line }: { line: DiffLine }) {
  if (line.type === 'collapsed') {
    return (
      <div className="flex items-center gap-2 px-3 py-0.5 text-text-muted bg-surface-1 border-y border-border/50">
        <span className="w-8 text-right text-[9px] select-none">···</span>
        <span className="text-[9px] italic">{line.count} unchanged line{line.count !== 1 ? 's' : ''}</span>
      </div>
    );
  }
  const bgClass =
    line.type === 'removed' ? 'bg-red-500/10' :
    line.type === 'added'   ? 'bg-green-500/8' :
    '';
  const textClass =
    line.type === 'removed' ? 'text-red-400' :
    line.type === 'added'   ? 'text-green-400' :
    'text-text-secondary';
  const prefix =
    line.type === 'removed' ? '-' :
    line.type === 'added'   ? '+' :
    ' ';
  const lineNo = line.type !== 'added' ? line.lineNo : null;

  return (
    <div className={`flex items-start ${bgClass}`}>
      <span className="w-10 text-right pr-3 text-[9px] text-text-muted select-none flex-shrink-0 pt-px">
        {lineNo ?? ''}
      </span>
      <span className={`w-3 flex-shrink-0 select-none ${textClass}`}>{prefix}</span>
      <span className={`flex-1 whitespace-pre-wrap break-all pr-3 ${textClass}`}>{line.text}</span>
    </div>
  );
}

const SEVERITY_STYLES: Record<Finding['severity'], string> = {
  error:      'bg-red-500/15 text-red-400 border-red-500/30',
  warning:    'bg-amber-500/15 text-amber-400 border-amber-500/30',
  suggestion: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
};

function SeverityBadge({ severity }: { severity: Finding['severity'] }) {
  return (
    <span className={`text-[8px] font-semibold px-1.5 py-0.5 rounded border ${SEVERITY_STYLES[severity]}`}>
      {severity}
    </span>
  );
}
