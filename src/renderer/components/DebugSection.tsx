import React, { useState } from 'react';
import LogAnalyzer from './LogAnalyzer';
import ErrorDecoder from './ErrorDecoder';

type DebugTab = 'error-decoder' | 'log-analyzer';

const TABS: { id: DebugTab; label: string }[] = [
  { id: 'error-decoder', label: 'Error Decoder' },
  { id: 'log-analyzer', label: 'TF_LOG Analyzer' },
];

export default function DebugSection() {
  const [activeTab, setActiveTab] = useState<DebugTab>('error-decoder');

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

      {/* Content */}
      {activeTab === 'error-decoder' && <ErrorDecoder />}
      {activeTab === 'log-analyzer' && <LogAnalyzer />}
    </div>
  );
}
