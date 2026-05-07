import React from 'react';

type TipVariant = 'tip' | 'warning' | 'recommended';

interface Props {
  variant?: TipVariant;
  children: React.ReactNode;
}

const variantStyles: Record<TipVariant, { bg: string; border: string; label: string; labelColor: string; textColor: string }> = {
  tip: {
    bg: 'bg-accent-blue/5',
    border: 'border-accent-blue/40',
    label: 'Tip',
    labelColor: 'text-accent-blue',
    textColor: 'text-text-secondary',
  },
  warning: {
    bg: 'bg-accent-amber/5',
    border: 'border-accent-amber/40',
    label: 'Heads Up',
    labelColor: 'text-accent-amber',
    textColor: 'text-text-secondary',
  },
  recommended: {
    bg: 'bg-accent-green/5',
    border: 'border-accent-green/40',
    label: 'Best Practice',
    labelColor: 'text-accent-green',
    textColor: 'text-text-secondary',
  },
};

export default function ContextualTip({ variant = 'tip', children }: Props) {
  const s = variantStyles[variant];
  return (
    <div className={`${s.bg} border-l-3 ${s.border} rounded-r px-3 py-2 flex items-start gap-2`}>
      <span className={`text-xs font-semibold ${s.labelColor} whitespace-nowrap mt-px`}>{s.label}</span>
      <div className={`text-xs ${s.textColor} leading-relaxed`}>{children}</div>
    </div>
  );
}
