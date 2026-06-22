import React, { useState, useEffect } from 'react';
import { useStore } from '../hooks/useStore';
import ProbeProgress from '../components/ProbeProgress';
import RateLimitTable from '../components/RateLimitTable';
import ContextualTip from '../components/ContextualTip';
import PlanSection from '../components/PlanSection';
import DebugSection from '../components/DebugSection';
import LearnSection from '../components/LearnSection';
import SyncSection from '../components/SyncSection';
import SettingsModal from '../components/SettingsModal';
import ConnectOrgModal from '../components/ConnectOrgModal';
import { SUPPORTED_VERSIONS } from '../../shared/versions';

type Section = 'rate-limits' | 'plan' | 'sync' | 'debug' | 'learn';

/* ── SVG Icons ─────────────────────────────────────────────── */
const icons: Record<Section, React.ReactNode> = {
  'rate-limits': (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 2v5l3 2" />
      <circle cx="9" cy="9" r="7" />
      <path d="M13.5 13.5L16 16" />
    </svg>
  ),
  plan: (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="2" width="14" height="14" rx="2" />
      <path d="M2 7h14" />
      <path d="M7 2v14" />
    </svg>
  ),
  sync: (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 9a7 7 0 0112.9-3.7" />
      <path d="M16 9a7 7 0 01-12.9 3.7" />
      <polyline points="15 2 15 6 11 6" />
      <polyline points="3 16 3 12 7 12" />
    </svg>
  ),
  debug: (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 4h12" />
      <path d="M3 9h12" />
      <path d="M3 14h8" />
      <path d="M6 4v10" />
      <circle cx="14" cy="14" r="2" />
    </svg>
  ),
  learn: (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 3h5a2 2 0 012 2v11a1.5 1.5 0 00-1.5-1.5H2V3z" />
      <path d="M16 3h-5a2 2 0 00-2 2v11a1.5 1.5 0 011.5-1.5H16V3z" />
    </svg>
  ),
};

const NAV_ITEMS: { id: Section; label: string }[] = [
  { id: 'rate-limits', label: 'Rate Limits' },
  { id: 'plan', label: 'Plan' },
  { id: 'sync', label: 'Sync' },
  { id: 'debug', label: 'Debug' },
  { id: 'learn', label: 'Learn' },
];

export default function DashboardPage() {
  const {
    connection, connecting, probing, probeProgress, probeResult, recommendation,
    selectedResources, resourceCounts,
    providerVersion, setProviderVersion,
    startProbe, disconnect,
  } = useStore();

  const [activeSection, setActiveSection] = useState<Section>('debug');
  const [showSettings, setShowSettings] = useState(false);
  const [showConnect, setShowConnect] = useState(false);
  const [availableVersions, setAvailableVersions] = useState<string[]>([...SUPPORTED_VERSIONS]);
  const hasWorkload = selectedResources.length > 0 && resourceCounts.length > 0;

  useEffect(() => {
    window.oktaTerraform.listProviderVersions().then((r: any) => {
      if (r?.success && r.data?.length > 0) {
        const versions: string[] = r.data.map((v: { version: string }) => v.version);
        setAvailableVersions(versions);
        if (!versions.includes(providerVersion)) {
          setProviderVersion(versions[0]);
        }
      }
    }).catch(() => { /* keep fallback */ });
  }, []);

  return (
    <div className="h-screen flex flex-col bg-surface-0">
      {/* ── Top bar ────────────────────────────────────────── */}
      <header className="bg-surface-1 border-b border-border px-5 py-2.5 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2.5">
            <svg width="28" height="28" viewBox="0 0 40 40" fill="none">
              {/* Left O — hexagon */}
              <path d="M10 6L16 3L22 6V14L16 17L10 14V6Z" stroke="#00D4AA" strokeWidth="1.8" strokeLinejoin="round"/>
              {/* Right O — hexagon */}
              <path d="M18 26L24 23L30 26V34L24 37L18 34V26Z" stroke="#00D4AA" strokeWidth="1.8" strokeLinejoin="round"/>
              {/* T-bridge connecting them */}
              <path d="M16 14L24 26" stroke="#00D4AA" strokeWidth="1.8" strokeLinecap="round"/>
              <path d="M12 12L20 12" stroke="#00D4AA" strokeWidth="1.4" strokeLinecap="round" opacity="0.5"/>
              <path d="M20 28L28 28" stroke="#00D4AA" strokeWidth="1.4" strokeLinecap="round" opacity="0.5"/>
            </svg>
            <span className="text-text-primary font-bold text-sm tracking-[0.15em]">OTTO</span>
          </div>
          {connection.connected && (
            <>
              <div className="h-4 w-px bg-border" />
              <span className="text-text-muted text-xs font-mono bg-surface-3 px-2.5 py-1 rounded">
                {connection.orgUrl}
              </span>
            </>
          )}
          <select
            value={providerVersion}
            onChange={(e) => setProviderVersion(e.target.value)}
            className="text-xs bg-surface-3 text-text-secondary border border-border rounded px-2.5 py-1 cursor-pointer hover:border-border-hover font-mono"
          >
            {availableVersions.map(v => (
              <option key={v} value={v}>v{v}</option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowSettings(true)}
            className="p-1.5 text-text-muted hover:text-text-primary bg-surface-3 hover:bg-surface-4 rounded-lg transition-colors"
            title="Settings"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="8" cy="8" r="2.5" />
              <path d="M13.5 8a5.5 5.5 0 01-.3 1.8l1.3.8-.9 1.5-1.4-.5a5.5 5.5 0 01-1.5 1l.1 1.5h-1.8l.1-1.5a5.5 5.5 0 01-1.5-1l-1.4.5-.9-1.5 1.3-.8A5.5 5.5 0 012.5 8a5.5 5.5 0 01.3-1.8l-1.3-.8.9-1.5 1.4.5a5.5 5.5 0 011.5-1L5.2 1.9H7l-.1 1.5a5.5 5.5 0 011.5 1l1.4-.5.9 1.5-1.3.8A5.5 5.5 0 0113.5 8z" />
            </svg>
          </button>
          {connection.connected ? (
            <>
              <button
                onClick={startProbe}
                disabled={probing}
                className="px-3.5 py-1.5 text-xs font-medium bg-accent-teal/15 text-accent-teal hover:bg-accent-teal/25 disabled:opacity-40 rounded-lg transition-colors"
              >
                {probing ? 'Scanning...' : 'Re-scan'}
              </button>
              <button
                onClick={disconnect}
                className="px-3.5 py-1.5 text-xs font-medium text-text-muted hover:text-text-secondary bg-surface-3 hover:bg-surface-4 rounded-lg transition-colors"
              >
                Disconnect
              </button>
            </>
          ) : (
            <button
              onClick={() => setShowConnect(true)}
              disabled={connecting}
              className="px-3.5 py-1.5 text-xs font-medium bg-accent-teal text-surface-0 hover:bg-accent-teal/90 disabled:opacity-40 rounded-lg transition-colors"
            >
              {connecting ? 'Connecting...' : 'Connect Org'}
            </button>
          )}
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* ── Sidebar ────────────────────────────────────── */}
        <nav className="w-52 bg-surface-1 border-r border-border flex-shrink-0 flex flex-col py-3">
          <div className="px-3 mb-1">
            <span className="text-[10px] font-semibold text-text-muted uppercase tracking-widest px-2">Navigation</span>
          </div>
          {NAV_ITEMS.map((item) => {
            const isActive = activeSection === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActiveSection(item.id)}
                className={`
                  mx-2 flex items-center gap-3 px-3 py-2 text-sm rounded-lg text-left transition-all relative
                  ${isActive
                    ? 'text-accent-teal bg-accent-teal/10'
                    : 'text-text-secondary hover:text-text-primary hover:bg-surface-3'}
                `}
              >
                {isActive && (
                  <div className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-[3px] w-[3px] h-4 bg-accent-teal rounded-full" />
                )}
                <span className={isActive ? 'text-accent-teal' : 'text-text-muted'}>{icons[item.id]}</span>
                <span className="font-medium">{item.label}</span>
              </button>
            );
          })}

          {/* ── Summary stats ────────────────────────────── */}
          {probeResult && (
            <div className="mt-auto mx-2 px-3 pt-3 border-t border-border">
              <div className="text-text-muted text-[10px] uppercase tracking-widest font-semibold mb-2">Summary</div>
              <div className="text-accent-teal text-xl font-bold font-mono">
                {probeResult.overallMinLimit > 0 ? probeResult.overallMinLimit : '\u2014'}
              </div>
              <div className="text-text-muted text-xs">req/window bottleneck</div>
              <div className="text-text-muted text-xs mt-2 font-mono">
                {probeResult.endpoints.filter(e => e.status !== 'error' && e.status !== 'skipped').length} endpoints probed
              </div>
              {hasWorkload && (
                <div className="text-text-muted text-xs mt-1 font-mono">
                  {resourceCounts.filter(c => !c.error).reduce((s, c) => s + c.count, 0).toLocaleString()} resources
                </div>
              )}
              {recommendation?.runtimeEstimate && (
                <div className="text-text-muted text-xs mt-1 font-mono">
                  ~{Math.round(recommendation.runtimeEstimate.minMinutes)}-{Math.round(recommendation.runtimeEstimate.maxMinutes)} min est.
                </div>
              )}
            </div>
          )}
        </nav>

        {/* ── Main content ───────────────────────────────── */}
        <main className="flex-1 overflow-auto p-6 bg-surface-0">
          {probing && probeProgress && (
            <ProbeProgress progress={probeProgress} />
          )}

          <div className={activeSection === 'plan' ? '' : 'hidden'}><PlanSection /></div>
          <div className={activeSection === 'sync' ? '' : 'hidden'}><SyncSection /></div>
          <div className={activeSection === 'debug' ? '' : 'hidden'}><DebugSection /></div>
          <div className={activeSection === 'learn' ? '' : 'hidden'}><LearnSection /></div>

          {activeSection === 'rate-limits' && probeResult && !probing && (
            <div className="space-y-6">
              <div className="grid grid-cols-3 gap-4">
                <StatCard label="Bottleneck" value={probeResult.overallMinLimit > 0 ? String(probeResult.overallMinLimit) : '\u2014'} sub="req/window" />
                <StatCard label="Endpoints" value={String(probeResult.endpoints.filter(e => e.status !== 'error' && e.status !== 'skipped').length)} sub={`of ${probeResult.endpoints.length} probed`} />
                <StatCard label="Scan Duration" value={`${(probeResult.probeDurationMs / 1000).toFixed(1)}s`} sub="sequential probing" />
              </div>

              <div className="bg-surface-2 rounded-xl border border-border overflow-hidden">
                <RateLimitTable endpoints={probeResult.endpoints} />
              </div>

              <ContextualTip>
                Your lowest rate limit is the bottleneck — Terraform can only go as fast as the slowest endpoint it needs.
                Head to <button onClick={() => setActiveSection('learn')} className="font-medium text-accent-teal hover:underline">Learn</button> for rate limit tuning guidance.
              </ContextualTip>
            </div>
          )}

          {activeSection === 'rate-limits' && !probeResult && !probing && (
            <div className="bg-surface-2 rounded-xl border border-border p-8 text-center space-y-3">
              {connection.connected ? (
                <p className="text-text-secondary">Click "Re-scan" to probe your org's rate limits.</p>
              ) : (
                <>
                  <p className="text-text-secondary">Connect to an org to probe rate limits.</p>
                  <button
                    onClick={() => setShowConnect(true)}
                    className="px-4 py-2 text-xs font-medium bg-accent-teal text-surface-0 hover:bg-accent-teal/90 rounded-lg transition-colors"
                  >
                    Connect Org
                  </button>
                </>
              )}
            </div>
          )}
        </main>
      </div>

      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
      {showConnect && <ConnectOrgModal onClose={() => setShowConnect(false)} />}
    </div>
  );
}

function StatCard({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="bg-surface-2 rounded-xl border border-border p-4">
      <div className="text-text-muted text-[10px] uppercase tracking-widest font-semibold">{label}</div>
      <div className="text-2xl font-bold text-text-primary mt-1 font-mono">{value}</div>
      <div className="text-text-muted text-xs">{sub}</div>
    </div>
  );
}
