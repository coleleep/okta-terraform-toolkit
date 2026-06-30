import React, { useState } from 'react';
import BestPractices from './BestPractices';
import ResourceLimitations from './ResourceLimitations';

type LearnTab = 'best-practices' | 'resource-limitations';

const TABS: { id: LearnTab; label: string }[] = [
  { id: 'best-practices', label: 'Best Practices' },
  { id: 'resource-limitations', label: 'Resource Limitations' },
];

export default function LearnSection() {
  const [activeTab, setActiveTab] = useState<LearnTab>('best-practices');

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

      {activeTab === 'best-practices' && <BestPractices />}
      {activeTab === 'resource-limitations' && <ResourceLimitations />}
    </div>
  );
}
