import React, { useState } from 'react';
import { EndpointProbeResult } from '../../shared/types';

interface Props {
  endpoints: EndpointProbeResult[];
}

const statusColors: Record<string, string> = {
  ok: 'bg-green-100 text-green-700',
  warning: 'bg-yellow-100 text-yellow-700',
  critical: 'bg-red-100 text-red-700',
  error: 'bg-red-50 text-red-500',
  skipped: 'bg-gray-100 text-gray-400',
};

function isSubResource(endpoint: string): boolean {
  return endpoint.includes('<id>') || endpoint.includes('{id}');
}

function statusLabel(ep: EndpointProbeResult): string {
  if (ep.status === 'skipped') return `skipped (${ep.httpStatus ?? '?'})`;
  if (ep.status === 'error') return `error (${ep.httpStatus ?? '?'})`;
  return ep.status;
}

function noData(ep: EndpointProbeResult): boolean {
  return ep.status === 'error' || ep.status === 'skipped';
}

function EndpointRow({ ep }: { ep: EndpointProbeResult }) {
  const isSub = isSubResource(ep.endpoint);
  const isSkipped = ep.status === 'skipped';

  return (
    <tr
      className={`
        hover:bg-gray-50 transition-colors
        ${isSub && !isSkipped ? 'bg-indigo-50/30' : ''}
        ${isSkipped ? 'opacity-60' : ''}
      `}
    >
      <td className="px-4 py-3 font-mono text-xs text-gray-600">
        {isSub && (
          <span
            className={`inline-block w-2 h-2 rounded-full mr-1.5 align-middle ${isSkipped ? 'bg-gray-300' : 'bg-indigo-400'}`}
            title="Sub-resource endpoint"
          />
        )}
        {ep.endpoint}
      </td>
      <td className="px-4 py-3 text-gray-700 text-xs">{ep.label}</td>
      <td className="px-4 py-3 text-right font-medium text-gray-900">
        {noData(ep) ? '—' : ep.limit}
      </td>
      <td className="px-4 py-3 text-right text-gray-600">
        {noData(ep) ? '—' : ep.remaining}
      </td>
      <td className="px-4 py-3 text-right text-gray-600">
        {noData(ep) ? '—' : `${ep.resetWindowSecs}s`}
      </td>
      <td className="px-4 py-3">
        <div className="flex flex-col items-center gap-1">
          <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${statusColors[ep.status]}`}>
            {statusLabel(ep)}
          </span>
          {ep.error && noData(ep) && (
            <span className="text-xs text-gray-400 text-center leading-tight max-w-[200px]">
              {ep.error.replace(/\s*\(x-okta-request-id:.*\)/, '')}
            </span>
          )}
        </div>
      </td>
    </tr>
  );
}

function EndpointTable({ endpoints, footer }: { endpoints: EndpointProbeResult[]; footer?: React.ReactNode }) {
  const sorted = [...endpoints].sort((a, b) => {
    const order = (s: string) => s === 'skipped' ? 2 : s === 'error' ? 1 : 0;
    const oa = order(a.status), ob = order(b.status);
    if (oa !== ob) return oa - ob;
    return a.limit - b.limit;
  });

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-xs text-gray-400 uppercase tracking-wide">
          <th className="px-4 py-3 font-medium">Endpoint</th>
          <th className="px-4 py-3 font-medium">Category</th>
          <th className="px-4 py-3 font-medium text-right">Limit</th>
          <th className="px-4 py-3 font-medium text-right">Remaining</th>
          <th className="px-4 py-3 font-medium text-right">Reset</th>
          <th className="px-4 py-3 font-medium text-center">Status</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-50">
        {sorted.map((ep, idx) => (
          <EndpointRow key={`${ep.endpoint}-${ep.method}-${idx}`} ep={ep} />
        ))}
      </tbody>
      {footer && (
        <tfoot>
          <tr>
            <td colSpan={6} className="px-4 py-2 text-xs text-gray-400">{footer}</td>
          </tr>
        </tfoot>
      )}
    </table>
  );
}

export default function RateLimitTable({ endpoints }: Props) {
  const [activeTab, setActiveTab] = useState<'read' | 'write'>('read');

  // Separate endpoints by method — skipped/error stay on their respective method tab
  const getEndpoints = endpoints.filter(ep => (ep.method || 'GET') === 'GET');
  const postEndpoints = endpoints.filter(ep => ep.method === 'POST');

  const readList = getEndpoints;
  const writeList = postEndpoints;

  const hasSubResources = endpoints.some(ep => isSubResource(ep.endpoint));

  const footer = hasSubResources ? (
    <>
      <span className="inline-block w-2 h-2 rounded-full bg-indigo-400 mr-1 align-middle" />
      Sub-resource endpoints probed using sample resource IDs.
    </>
  ) : undefined;

  return (
    <div>
      {/* GET / POST tabs */}
      <div className="flex border-b border-gray-200">
        <button
          onClick={() => setActiveTab('read')}
          className={`
            px-5 py-3 text-sm font-medium transition-colors relative
            ${activeTab === 'read'
              ? 'text-emerald-700 border-b-2 border-emerald-500'
              : 'text-gray-400 hover:text-gray-600'}
          `}
        >
          <span className="inline-block px-1.5 py-0.5 rounded text-xs font-mono bg-emerald-100 text-emerald-700 mr-2">GET</span>
          Read Operations
          <span className="ml-2 text-xs text-gray-400">({getEndpoints.length})</span>
        </button>
        <button
          onClick={() => setActiveTab('write')}
          className={`
            px-5 py-3 text-sm font-medium transition-colors relative
            ${activeTab === 'write'
              ? 'text-amber-700 border-b-2 border-amber-500'
              : 'text-gray-400 hover:text-gray-600'}
          `}
        >
          <span className="inline-block px-1.5 py-0.5 rounded text-xs font-mono bg-amber-100 text-amber-700 mr-2">POST</span>
          Write Operations
          <span className="ml-2 text-xs text-gray-400">({postEndpoints.length})</span>
        </button>
      </div>

      {/* Table for active tab */}
      {activeTab === 'read' && (
        <EndpointTable
          endpoints={readList}
          footer={footer}
        />
      )}
      {activeTab === 'write' && (
        <EndpointTable
          endpoints={writeList}
          footer={
            <span>Write probes send POST with empty body to discover write rate limit buckets.</span>
          }
        />
      )}
    </div>
  );
}
