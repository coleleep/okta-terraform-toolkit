import React, { useState, useEffect } from 'react';
import { useStore } from '../hooks/useStore';

interface SolutionResult {
  feasible: boolean;
  summary: string;
  limitations?: string[];
  hcl: {
    provider: string;
    resources: string;
    variables: string;
    imports?: string;
  };
  instructions: string[];
  warnings: string[];
  estimatedRuntime?: string;
  requiredScopes: string[];
  requiredRole: string;
}

export default function SolutionBuilder() {
  const { providerVersion } = useStore();
  const [input, setInput] = useState('');
  const [result, setResult] = useState<SolutionResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasKey, setHasKey] = useState(false);
  const [activeFile, setActiveFile] = useState<'provider' | 'resources' | 'variables' | 'imports'>('resources');
  const [copied, setCopied] = useState<string | null>(null);

  const api = (window as unknown as { oktaTerraform: {
    generateSolution: (desc: string, version: string) => Promise<{ success: boolean; data?: SolutionResult; error?: string }>;
    hasClaudeKey: () => Promise<{ success: boolean; data?: boolean }>;
    saveProjectDir: (files: Record<string, string>) => Promise<{ success: boolean; data?: string; error?: string }>;
  }}).oktaTerraform;

  useEffect(() => {
    api.hasClaudeKey().then(r => setHasKey(!!r.data));
  }, []);

  const handleGenerate = async () => {
    if (!input.trim()) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await api.generateSolution(input.trim(), providerVersion);
      if (res.success && res.data) {
        setResult(res.data);
      } else {
        setError(res.error ?? 'Failed to generate solution');
      }
    } catch {
      setError('Failed to connect to Claude API');
    }
    setLoading(false);
  };

  const handleExport = async () => {
    if (!result) return;
    const files: Record<string, string> = {
      'provider.tf': result.hcl.provider,
      'resources.tf': result.hcl.resources,
      'variables.tf': result.hcl.variables,
    };
    if (result.hcl.imports) {
      files['imports.tf'] = result.hcl.imports;
    }
    await api.saveProjectDir(files);
  };

  const handleCopy = (content: string, label: string) => {
    navigator.clipboard.writeText(content);
    setCopied(label);
    setTimeout(() => setCopied(null), 2000);
  };

  if (!result && !loading) {
    return (
      <div className="max-w-4xl">
        <h1 className="text-lg font-bold text-okta-navy mb-2">Solution Builder</h1>
        <p className="text-xs text-gray-500 mb-4">
          Describe what you need to accomplish with Okta Terraform in plain English. Get a complete, exportable solution with config, instructions, and provider-specific guidance.
        </p>

        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={"Describe your workload...\n\nExamples:\n• I need to import 200 existing SAML apps with their user assignments into Terraform\n• Create 50 OAuth apps with group assignments and configure SSO policies\n• Set up 10 authorization servers with custom scopes and claims\n• Migrate 5,000 users into Okta with group memberships using Terraform"}
            rows={6}
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-400 resize-y"
          />
          <div className="flex items-center justify-between mt-3">
            <span className="text-xs text-gray-400">
              Provider v{providerVersion}
            </span>
            <button
              onClick={handleGenerate}
              disabled={loading || !input.trim() || !hasKey}
              className="px-4 py-2 text-sm font-medium text-white bg-purple-600 rounded-lg hover:bg-purple-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? 'Generating...' : !hasKey ? 'No API Key' : 'Generate Solution'}
            </button>
          </div>
          {error && <p className="text-xs text-red-500 mt-3">{error}</p>}
          {!hasKey && (
            <p className="text-xs text-amber-600 mt-3">Set a Claude API key to enable the Solution Builder.</p>
          )}
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="max-w-4xl">
        <h1 className="text-lg font-bold text-okta-navy mb-4">Solution Builder</h1>
        <div className="flex items-center gap-3 p-8 bg-white rounded-xl border border-gray-200">
          <div className="animate-spin w-5 h-5 border-2 border-purple-500 border-t-transparent rounded-full" />
          <span className="text-sm text-gray-600">Generating your Terraform solution...</span>
        </div>
      </div>
    );
  }

  if (!result) return null;

  const fileOptions = [
    { id: 'resources' as const, label: 'resources.tf', content: result.hcl.resources },
    { id: 'provider' as const, label: 'provider.tf', content: result.hcl.provider },
    { id: 'variables' as const, label: 'variables.tf', content: result.hcl.variables },
    ...(result.hcl.imports ? [{ id: 'imports' as const, label: 'imports.tf', content: result.hcl.imports }] : []),
  ];
  const activeContent = fileOptions.find(f => f.id === activeFile)?.content ?? '';

  return (
    <div className="max-w-4xl space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-okta-navy">Solution Builder</h1>
          <p className="text-xs text-gray-400">v{providerVersion}</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleExport}
            className="px-3 py-1.5 text-xs font-medium text-white bg-okta-blue rounded-lg hover:bg-okta-blue-light transition-colors"
          >
            Export Project
          </button>
          <button
            onClick={() => { setResult(null); setInput(''); }}
            className="px-3 py-1.5 text-xs font-medium text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
          >
            New Solution
          </button>
        </div>
      </div>

      {/* Feasibility + Summary */}
      {!result.feasible && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4">
          <p className="text-sm font-medium text-red-800">This is not fully possible with the Okta Terraform Provider</p>
          <p className="text-xs text-red-600 mt-1">{result.summary}</p>
        </div>
      )}
      {result.feasible && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-4">
          <p className="text-sm font-medium text-green-800">{result.summary}</p>
          {result.estimatedRuntime && (
            <p className="text-xs text-green-600 mt-1">Estimated runtime: {result.estimatedRuntime}</p>
          )}
        </div>
      )}

      {/* Limitations */}
      {result.limitations && result.limitations.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
          <p className="text-xs font-medium text-amber-700 uppercase tracking-wide mb-2">Provider Limitations</p>
          <ul className="space-y-1">
            {result.limitations.map((l, i) => (
              <li key={i} className="text-xs text-amber-800 flex gap-2">
                <span className="text-amber-500 flex-shrink-0">!</span>
                <span>{l}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* HCL Files */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="flex border-b border-gray-100">
          {fileOptions.map(f => (
            <button
              key={f.id}
              onClick={() => setActiveFile(f.id)}
              className={`px-4 py-2.5 text-xs font-mono transition-colors ${
                activeFile === f.id
                  ? 'text-okta-navy bg-gray-50 border-b-2 border-okta-blue'
                  : 'text-gray-400 hover:text-gray-600'
              }`}
            >
              {f.label}
            </button>
          ))}
          <button
            onClick={() => handleCopy(activeContent, activeFile)}
            className="ml-auto px-3 py-2 text-xs text-gray-400 hover:text-gray-600 transition-colors"
          >
            {copied === activeFile ? 'Copied!' : 'Copy'}
          </button>
        </div>
        <pre className="p-4 text-xs font-mono text-gray-700 overflow-x-auto max-h-80 overflow-y-auto bg-gray-50">
          {activeContent}
        </pre>
      </div>

      {/* Instructions */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-3">Instructions</p>
        <ol className="space-y-2">
          {result.instructions.map((step, i) => (
            <li key={i} className="text-xs text-gray-700 flex gap-2">
              <span className="text-okta-blue font-bold flex-shrink-0">{i + 1}.</span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
      </div>

      {/* Warnings */}
      {result.warnings.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
          <p className="text-xs font-medium text-amber-700 uppercase tracking-wide mb-2">Warnings</p>
          <ul className="space-y-1">
            {result.warnings.map((w, i) => (
              <li key={i} className="text-xs text-amber-800 flex gap-2">
                <span className="text-amber-500 flex-shrink-0">!</span>
                <span>{w}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Auth Requirements */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">Authentication Requirements</p>
        <div className="flex gap-6">
          <div>
            <span className="text-xs text-gray-400">Min. Admin Role</span>
            <p className="text-sm font-medium text-gray-700">{result.requiredRole}</p>
          </div>
          <div className="flex-1">
            <span className="text-xs text-gray-400">OAuth Scopes</span>
            <div className="flex flex-wrap gap-1 mt-1">
              {result.requiredScopes.map(s => (
                <span key={s} className="text-xs font-mono bg-blue-50 text-blue-700 px-2 py-0.5 rounded">{s}</span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
