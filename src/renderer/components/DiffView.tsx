import React, { useState, useMemo } from 'react';
import { DiffResult, ResourceDiff, FieldDiff } from '../../shared/types';

const PAGE_SIZE = 10;

const FRIENDLY_NAMES: Record<string, string> = {
  okta_user: 'Users',
  okta_group: 'Groups',
  okta_app: 'Applications',
  okta_policy: 'Policies',
  okta_policy_rule: 'Policy Rules',
  okta_auth_server: 'Authorization Servers',
  okta_network_zone: 'Network Zones',
  okta_group_rule: 'Group Rules',
  okta_app_user: 'App Users',
  okta_app_group: 'App Groups',
};

export function friendlyName(sourceType: string): string {
  return FRIENDLY_NAMES[sourceType]
    ?? sourceType
        .replace(/^okta_/, '')
        .replace(/_/g, ' ')
        .replace(/\b\w/g, c => c.toUpperCase());
}

interface DiffViewProps {
  diff: DiffResult;
  canProceed: boolean;
  onProceed: (selectedAddresses?: Set<string>) => void;
  selectable?: boolean;
}

export default function DiffView({ diff, canProceed, onProceed, selectable = false }: DiffViewProps) {
  const [filter, setFilter] = useState<'all' | 'changed' | 'missing' | 'same'>('all');
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [visibleCounts, setVisibleCounts] = useState<Record<string, number>>({});
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [selectedResources, setSelectedResources] = useState<Set<string>>(
    () => new Set(diff.diffs.map(d => d.sourceAddress)),
  );

  const groups = useMemo(() => {
    const filtered = diff.diffs.filter(rd =>
      filter === 'all' || rd.status === filter
    );
    const map = new Map<string, ResourceDiff[]>();
    for (const rd of filtered) {
      const arr = map.get(rd.sourceType) ?? [];
      arr.push(rd);
      map.set(rd.sourceType, arr);
    }
    return [...map.entries()]
      .sort(([a], [b]) => friendlyName(a).localeCompare(friendlyName(b)));
  }, [diff, filter]);

  const handleFilterChange = (key: typeof filter) => {
    setFilter(key);
    setExpandedRow(null);
    setVisibleCounts({});
  };

  const toggleGroup = (sourceType: string) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      if (next.has(sourceType)) next.delete(sourceType);
      else next.add(sourceType);
      return next;
    });
  };

  const loadMore = (sourceType: string) => {
    setVisibleCounts(prev => ({
      ...prev,
      [sourceType]: (prev[sourceType] ?? PAGE_SIZE) + PAGE_SIZE,
    }));
  };

  const toggleRow = (address: string) => {
    setExpandedRow(prev => prev === address ? null : address);
  };

  const toggleResource = (address: string) => {
    setSelectedResources(prev => {
      const next = new Set(prev);
      if (next.has(address)) next.delete(address);
      else next.add(address);
      return next;
    });
  };

  const toggleGroupSelection = (rows: ResourceDiff[]) => {
    const addresses = rows.map(r => r.sourceAddress);
    const noneSelected = addresses.every(a => !selectedResources.has(a));
    setSelectedResources(prev => {
      const next = new Set(prev);
      if (noneSelected) {
        addresses.forEach(a => next.add(a));
      } else {
        addresses.forEach(a => next.delete(a));
      }
      return next;
    });
  };

  return (
    <div className="bg-surface-2 border border-border rounded-xl p-4">
      {/* Stats row */}
      <div className="flex gap-3 mb-4">
        <div className="bg-surface-0 rounded-lg px-3 py-2 flex-1 text-center">
          <div className="text-green-400 font-bold text-base">{diff.same + diff.changed}</div>
          <div className="text-[9px] text-text-muted mt-0.5 uppercase tracking-wide">Matched</div>
        </div>
        <div className="bg-surface-0 rounded-lg px-3 py-2 flex-1 text-center">
          <div className="text-amber-400 font-bold text-base">{diff.changed}</div>
          <div className="text-[9px] text-text-muted mt-0.5 uppercase tracking-wide">Changed</div>
        </div>
        <div className="bg-surface-0 rounded-lg px-3 py-2 flex-1 text-center">
          <div className="text-red-400 font-bold text-base">{diff.missing}</div>
          <div className="text-[9px] text-text-muted mt-0.5 uppercase tracking-wide">Missing</div>
        </div>
        {selectable && (
          <div className="bg-surface-0 rounded-lg px-3 py-2 flex-1 text-center" style={{ borderColor: 'rgb(45 212 191 / 0.25)', border: '1px solid' }}>
            <div className="font-bold text-base" style={{ color: '#2dd4bf' }}>
              {selectedResources.size}
              <span className="text-text-muted font-normal text-sm">/{diff.diffs.length}</span>
            </div>
            <div className="text-[9px] text-text-muted mt-0.5 uppercase tracking-wide">Selected</div>
          </div>
        )}
      </div>

      {/* Filter chips */}
      <div className="flex gap-1.5 mb-3">
        {(
          [
            { key: 'all' as const, label: 'All', count: diff.diffs.length, activeClass: 'bg-surface-3 text-text-primary border-border', inactiveClass: 'text-text-muted border-border' },
            { key: 'changed' as const, label: 'Changed', count: diff.changed, activeClass: 'bg-amber-500/20 text-amber-400 border-amber-500/40', inactiveClass: 'text-amber-400/60 border-amber-500/20' },
            { key: 'missing' as const, label: 'Missing', count: diff.missing, activeClass: 'bg-red-500/15 text-red-400 border-red-500/30', inactiveClass: 'text-red-400/60 border-red-500/20' },
            { key: 'same' as const, label: 'Same', count: diff.same, activeClass: 'bg-green-500/10 text-green-400 border-green-500/20', inactiveClass: 'text-green-400/60 border-green-500/15' },
          ] as const
        ).map(({ key, label, count, activeClass, inactiveClass }) => (
          <button
            key={key}
            onClick={() => handleFilterChange(key)}
            className={`px-2.5 py-1 rounded-full text-[10px] font-medium border ${filter === key ? activeClass : inactiveClass}`}
          >
            {label} ({count})
          </button>
        ))}
      </div>

      {/* Groups */}
      <div className="border border-border rounded-lg overflow-hidden mb-4">
        {groups.map(([sourceType, rows]) => {
          const isCollapsed = collapsedGroups.has(sourceType);
          const visible = visibleCounts[sourceType] ?? PAGE_SIZE;
          const visibleRows = rows.slice(0, visible);
          const remaining = rows.length - visible;

          return (
            <div key={sourceType}>
              {/* Group header */}
              <div
                className="bg-surface-1 px-3 py-1.5 flex items-center justify-between cursor-pointer border-b border-border hover:bg-surface-2 transition-colors"
                onClick={() => toggleGroup(sourceType)}
              >
                <span className="text-[10px] font-semibold text-accent-blue">
                  {isCollapsed ? '▸' : '▾'}{' '}
                  {friendlyName(sourceType)}{' '}
                  <span className="text-text-muted font-normal">{rows.length} resource{rows.length !== 1 ? 's' : ''}</span>
                </span>
                {selectable && (
                  <label
                    className="flex items-center gap-1.5 cursor-pointer text-text-muted text-[9px] font-normal"
                    onClick={e => e.stopPropagation()}
                  >
                    <input
                      type="checkbox"
                      checked={rows.every(r => selectedResources.has(r.sourceAddress))}
                      ref={el => {
                        if (el) {
                          const allSel = rows.every(r => selectedResources.has(r.sourceAddress));
                          const noneSel = rows.every(r => !selectedResources.has(r.sourceAddress));
                          el.indeterminate = !allSel && !noneSel;
                        }
                      }}
                      onChange={() => toggleGroupSelection(rows)}
                      style={{ accentColor: '#2dd4bf', width: 12, height: 12 }}
                    />
                    select all
                  </label>
                )}
              </div>

              {/* Group body — only shown when not collapsed */}
              {!isCollapsed && (
                <>
                  {/* Column headers */}
                  <div className={`grid bg-surface-0 border-b border-border ${selectable ? 'grid-cols-[20px_1fr_1fr]' : 'grid-cols-2'}`}>
                    {selectable && <div className="px-1 py-1.5" />}
                    <div className="px-3 py-1.5 text-[9.5px] font-semibold uppercase tracking-wider text-accent-teal border-r border-border">Source Org</div>
                    <div className="px-3 py-1.5 text-[9.5px] font-semibold uppercase tracking-wider text-text-muted">Target Org</div>
                  </div>

                  {visibleRows.map(rd => (
                    <React.Fragment key={rd.sourceAddress}>
                      {/* Resource row */}
                      <div
                        className={`grid border-b border-surface-1 transition-colors ${selectable ? 'grid-cols-[20px_1fr_1fr]' : 'grid-cols-2'} ${
                          rd.status === 'changed'
                            ? 'bg-surface-0'
                            : `cursor-pointer ${expandedRow === rd.sourceAddress ? 'bg-surface-0' : 'hover:bg-surface-0'}`
                        }`}
                        style={selectable && !selectedResources.has(rd.sourceAddress) ? { opacity: 0.4 } : undefined}
                        onClick={() => rd.status !== 'changed' && toggleRow(rd.sourceAddress)}
                      >
                        {selectable && (
                          <div
                            className="flex items-center justify-center bg-surface-0"
                            onClick={e => e.stopPropagation()}
                          >
                            <input
                              type="checkbox"
                              checked={selectedResources.has(rd.sourceAddress)}
                              onChange={() => toggleResource(rd.sourceAddress)}
                              style={{ accentColor: '#2dd4bf', width: 11, height: 11 }}
                            />
                          </div>
                        )}
                        {/* Source cell — always teal left border */}
                        <div className="px-2.5 py-1.5 border-r border-border border-l-2 border-l-accent-teal">
                          <div className="font-mono text-[10px] text-text-primary">{rd.sourceAddress}</div>
                          <div className="text-[9px] text-text-muted mt-0.5">{rd.sourceType}</div>
                          {rd.status === 'changed' && (
                            <div className="text-[9.5px] text-amber-400 mt-0.5">
                              {rd.fieldDiffs.length} field{rd.fieldDiffs.length !== 1 ? 's' : ''} differ
                            </div>
                          )}
                        </div>
                        {/* Target cell — color by status */}
                        <div className={`px-2.5 py-1.5 border-l-2 ${
                          rd.status === 'same' ? 'border-l-green-400' :
                          rd.status === 'changed' ? 'border-l-amber-400' :
                          rd.status === 'missing' ? 'border-l-red-400 bg-red-500/5' :
                          'border-l-purple-400'
                        }`}>
                          {rd.status === 'same' && (
                            <>
                              <div className="font-mono text-[10px] text-text-primary">{rd.sourceAddress}</div>
                              <div className="text-[9.5px] text-green-400 mt-0.5">✓ identical</div>
                            </>
                          )}
                          {rd.status === 'changed' && (
                            <>
                              <div className="font-mono text-[10px] text-text-primary">{rd.sourceAddress}</div>
                              <div className="text-[9.5px] text-amber-400 mt-0.5">
                                {rd.fieldDiffs.length} field{rd.fieldDiffs.length !== 1 ? 's' : ''} differ
                              </div>
                            </>
                          )}
                          {rd.status === 'missing' && (
                            <>
                              <div className="font-mono text-[10px] text-red-400">Not in target</div>
                              <div className="text-[9.5px] text-red-400/70 mt-0.5">will be created by terraform</div>
                            </>
                          )}
                          {rd.status === 'ambiguous' && (
                            <>
                              <div className="font-mono text-[10px] text-text-primary">{rd.sourceAddress}</div>
                              <div className="text-[9.5px] text-purple-400 mt-0.5">{rd.candidates?.length ?? '?'} candidates</div>
                            </>
                          )}
                        </div>
                      </div>

                      {/* Inline expand panel — always shown for changed rows; click-to-expand for others */}
                      {(rd.status === 'changed' || expandedRow === rd.sourceAddress) && rd.fieldDiffs.length > 0 && (
                        <div className={`grid bg-black/20 border-b border-border ${selectable ? 'grid-cols-[20px_1fr_1fr]' : 'grid-cols-2'}`}>
                          {selectable && <div className="bg-surface-0" />}
                          <div className="px-3 py-2 border-r border-border">
                            <div className="text-[8.5px] font-semibold uppercase tracking-wider text-text-muted mb-1.5">Source values</div>
                            {rd.fieldDiffs.map((fd: FieldDiff) => (
                              <div key={fd.field} className="flex gap-2 py-0.5 border-b border-surface-1 last:border-0 text-[9.5px]">
                                <span className="font-mono text-text-muted w-32 flex-shrink-0 text-[9px]">{fd.field}</span>
                                <span className="font-mono text-accent-teal">{JSON.stringify(fd.sourceValue)}</span>
                              </div>
                            ))}
                          </div>
                          <div className="px-3 py-2">
                            <div className="text-[8.5px] font-semibold uppercase tracking-wider text-text-muted mb-1.5">Target values</div>
                            {rd.fieldDiffs.map((fd: FieldDiff) => (
                              <div key={fd.field} className="flex gap-2 py-0.5 border-b border-surface-1 last:border-0 text-[9.5px]">
                                <span className="font-mono text-text-muted w-32 flex-shrink-0 text-[9px]">{fd.field}</span>
                                <span className={`font-mono ${
                                  fd.targetValue === null || fd.targetValue === undefined
                                    ? 'text-text-muted italic'
                                    : 'text-amber-400'
                                }`}>
                                  {fd.targetValue === null || fd.targetValue === undefined
                                    ? 'null'
                                    : JSON.stringify(fd.targetValue)}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </React.Fragment>
                  ))}

                  {/* Load more button */}
                  {remaining > 0 && (
                    <div className="py-2 text-center border-b border-border">
                      <button
                        onClick={() => loadMore(sourceType)}
                        className="text-[10px] text-accent-blue hover:text-accent-blue/80 transition-colors"
                      >
                        ↓ Load {Math.min(PAGE_SIZE, remaining)} more {friendlyName(sourceType).toLowerCase()} ({remaining} remaining)
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          );
        })}
      </div>

      {/* Proceed to Convert — only when canProceed */}
      {canProceed && (
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-text-muted">
            {selectable
              ? `${selectedResources.size} of ${diff.diffs.length} resources selected`
              : 'Review complete — ready to generate Terraform config'}
          </span>
          <button
            onClick={() => onProceed(selectable ? selectedResources : undefined)}
            disabled={selectable && selectedResources.size === 0}
            className="px-4 py-1.5 bg-accent-teal text-surface-0 hover:bg-accent-teal/90 rounded-lg text-[11px] font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Proceed to Convert{selectable ? ` (${selectedResources.size})` : ''} →
          </button>
        </div>
      )}
    </div>
  );
}
