import React, { useState } from 'react';
import { searchResources, RESOURCE_DICTIONARY, ResourceDictionaryEntry } from '../../shared/resource-dictionary';
import { useStore } from '../hooks/useStore';
import { isAvailableIn } from '../../shared/versions';

export default function ResourceLookup() {
  const [query, setQuery] = useState('');
  const [showAll, setShowAll] = useState(false);
  const { providerVersion } = useStore();

  const results = query.trim()
    ? searchResources(query)
    : showAll
      ? RESOURCE_DICTIONARY
      : [];

  const displayResults = results.slice(0, showAll && !query ? 200 : 15);

  return (
    <div className="border-t border-gray-200 mt-4 pt-4">
      <div className="flex items-center gap-2 mb-2">
        <p className="text-xs text-gray-400 font-medium uppercase tracking-wide">Resource Dictionary</p>
        <button
          onClick={() => setShowAll(!showAll)}
          className="text-xs text-okta-blue hover:underline"
        >
          {showAll ? 'Hide all' : 'Browse all'}
        </button>
      </div>
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search terraform resource name... (e.g. okta_app_oauth)"
        className="w-full px-3 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
      />
      {displayResults.length > 0 && (
        <div className="mt-2 max-h-64 overflow-y-auto border border-gray-100 rounded-lg divide-y divide-gray-50">
          {displayResults.map((r) => (
            <ResourceRow key={r.terraformResource} entry={r} providerVersion={providerVersion} />
          ))}
        </div>
      )}
      {query.trim() && results.length === 0 && (
        <p className="text-xs text-gray-400 mt-2 px-1">
          No matching resources found. Try a partial name like "app" or "policy".
        </p>
      )}
      {results.length > displayResults.length && (
        <p className="text-xs text-gray-400 mt-1 px-1">
          Showing {displayResults.length} of {results.length} results
        </p>
      )}
    </div>
  );
}

function ResourceRow({ entry, providerVersion }: { entry: ResourceDictionaryEntry; providerVersion: string }) {
  const available = !entry.sinceVersion || isAvailableIn(entry.sinceVersion, providerVersion);

  return (
    <div className={`flex items-center gap-3 px-3 py-2 ${available ? '' : 'opacity-50'}`}>
      <div className="flex-1 min-w-0">
        <code className="text-xs font-mono text-gray-700">{entry.terraformResource}</code>
        <p className="text-xs text-gray-400 truncate">{entry.description}</p>
      </div>
      <div className="flex-shrink-0 text-right">
        <span className="inline-block px-2 py-0.5 text-xs font-medium rounded-full bg-blue-50 text-blue-700">
          {entry.parentLabel}
        </span>
        {entry.sinceVersion && (
          <span className={`block text-xs mt-0.5 ${available ? 'text-green-600' : 'text-red-400'}`}>
            {available ? `v${entry.sinceVersion}+` : `requires v${entry.sinceVersion}+`}
          </span>
        )}
      </div>
    </div>
  );
}
