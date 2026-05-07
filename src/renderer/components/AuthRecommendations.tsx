import React from 'react';
import { useStore } from '../hooks/useStore';
import { TerraformAuthMethod } from '../../shared/types';
import { getRecommendations, API_KEY_ONLY_ENDPOINTS } from '../../shared/scopes';

export default function AuthRecommendations() {
  const {
    selectedResources, operation, terraformAuthMethod, setTerraformAuthMethod,
  } = useStore();

  const hasSelection = selectedResources.length > 0;
  if (!hasSelection) return null;

  const recs = getRecommendations(selectedResources, operation);

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm text-gray-500 mb-3">How will Terraform authenticate to Okta?</p>
        <div className="flex gap-2">
          <button
            onClick={() => setTerraformAuthMethod('api_token')}
            className={`flex-1 px-3 py-2 text-xs font-medium rounded-lg border transition-colors ${
              terraformAuthMethod === 'api_token'
                ? 'border-okta-blue bg-okta-blue/10 text-okta-blue'
                : 'border-gray-200 text-gray-500 hover:border-gray-300'
            }`}
          >
            API Token (SSWS)
          </button>
          <button
            onClick={() => setTerraformAuthMethod('oauth')}
            className={`flex-1 px-3 py-2 text-xs font-medium rounded-lg border transition-colors ${
              terraformAuthMethod === 'oauth'
                ? 'border-okta-blue bg-okta-blue/10 text-okta-blue'
                : 'border-gray-200 text-gray-500 hover:border-gray-300'
            }`}
          >
            OAuth (Service App)
          </button>
        </div>
      </div>

      {/* Admin role requirement */}
      <div className="bg-gray-50 rounded-lg p-3">
        <p className="text-xs text-gray-400 uppercase tracking-wider mb-1">Minimum Admin Role Required</p>
        <p className="text-sm font-medium text-okta-navy">{recs.adminRole}</p>
        {recs.customRolePossible ? (
          <p className="text-xs text-green-600 mt-1">Custom admin role supported for all selected resources</p>
        ) : (
          <div className="mt-1">
            <p className="text-xs text-amber-600">Standard admin role required — some resources don't support custom roles:</p>
            {recs.notes.map((note, i) => (
              <p key={i} className="text-xs text-amber-500 mt-0.5 pl-2">- {note}</p>
            ))}
          </div>
        )}
      </div>

      {/* OAuth-specific recommendations */}
      {terraformAuthMethod === 'oauth' && (
        <>
          {/* API Key only warnings */}
          {recs.apiKeyOnlyWarnings.length > 0 && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3">
              <p className="text-xs font-medium text-red-800 mb-1">API Key Required for Some Resources</p>
              <p className="text-xs text-red-600 mb-2">
                The following resources have no OAuth scope and cannot be managed with a service app:
              </p>
              {recs.apiKeyOnlyWarnings.map((w, i) => (
                <p key={i} className="text-xs text-red-500 pl-2">- {w}</p>
              ))}
              <p className="text-xs text-red-600 mt-2 font-medium">
                Consider using an API token instead, or split your Terraform config into OAuth-managed and API-token-managed workspaces.
              </p>
            </div>
          )}

          {/* Required scopes */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
            <p className="text-xs font-medium text-blue-800 mb-2">
              Required OAuth Scopes ({recs.scopes.length})
            </p>
            <p className="text-xs text-blue-600 mb-2">
              Grant these in Okta Admin &gt; Applications &gt; your service app &gt; Okta API Scopes:
            </p>
            <div className="space-y-1 max-h-40 overflow-y-auto">
              {recs.scopes.map(scope => (
                <code key={scope} className="block text-xs text-okta-navy bg-white px-2 py-1 rounded border border-blue-100">
                  {scope}
                </code>
              ))}
            </div>
          </div>

          {/* Custom role permissions */}
          {recs.customRolePossible && recs.customRolePermissions.length > 0 && (
            <div className="bg-gray-50 rounded-lg p-3">
              <p className="text-xs text-gray-400 uppercase tracking-wider mb-1">Custom Role Permissions Needed</p>
              <div className="space-y-1">
                {recs.customRolePermissions.map(perm => (
                  <code key={perm} className="block text-xs text-gray-600 bg-white px-2 py-1 rounded border border-gray-200">
                    {perm}
                  </code>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* Custom admin role limitations for groups */}
      {recs.customRoleWarnings.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
          <p className="text-xs font-medium text-amber-800 mb-1">Custom Admin Role — Group Limitations</p>
          {recs.customRoleWarnings.map((w, i) => (
            <p key={i} className="text-xs text-amber-600 mt-1">- {w}</p>
          ))}
        </div>
      )}

      {/* API token guidance */}
      {terraformAuthMethod === 'api_token' && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-3">
          <p className="text-xs font-medium text-green-800 mb-1">API Token — Full Access</p>
          <p className="text-xs text-green-600">
            API tokens inherit the permissions of the admin who created them.
            Create the token with a <strong>{recs.adminRole}</strong> account for the selected resources.
            All Okta API endpoints are accessible via API tokens — no scope limitations.
          </p>
        </div>
      )}
    </div>
  );
}
