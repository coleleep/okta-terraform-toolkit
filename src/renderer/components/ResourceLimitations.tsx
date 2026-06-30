import React, { useState, useRef, useCallback } from 'react';

const SECTIONS = [
  { id: 'import-support', title: 'Import Support' },
  { id: 'destroy-behavior', title: 'Destroy Behavior' },
  { id: 'oie-vs-classic', title: 'OIE vs Classic' },
] as const;

type SectionId = (typeof SECTIONS)[number]['id'];

function Warning({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-red-50 border-l-4 border-red-500 rounded-r p-3 my-3">
      <p className="text-xs font-medium text-red-800 mb-0.5">Important</p>
      <div className="text-xs text-red-700">{children}</div>
    </div>
  );
}
function Caution({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-amber-50 border-l-4 border-amber-500 rounded-r p-3 my-3">
      <p className="text-xs font-medium text-amber-800 mb-0.5">Caution</p>
      <div className="text-xs text-amber-700">{children}</div>
    </div>
  );
}
function H3({ children }: { children: React.ReactNode }) {
  return <h3 className="text-sm font-semibold text-gray-700 mt-4 mb-2">{children}</h3>;
}
function P({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-gray-600 leading-relaxed mb-2">{children}</p>;
}

function ImportSupportContent() {
  return (
    <>
      <P>
        Most Okta Terraform resources support <code className="bg-gray-100 px-1 rounded">terraform import</code>.
        A few do not — and several use composite IDs that are easy to get wrong.
      </P>

      <Warning>
        These resources do <strong>not</strong> support import. Do not generate{' '}
        <code className="bg-red-100 px-1 rounded">import {'{}'}</code> blocks for them:
        <ul className="mt-2 space-y-1 list-disc ml-4">
          <li><code>okta_trusted_server</code> — ImportState explicitly disabled in provider</li>
          <li><code>okta_resource_owner</code> — no import support</li>
          <li><code>okta_identity_source_import</code> — trigger-only resource, no import</li>
        </ul>
      </Warning>

      <H3>Composite Import IDs (multi-part — easy to get wrong)</H3>
      <div className="overflow-x-auto my-3">
        <table className="w-full text-xs border border-gray-200 rounded">
          <thead className="bg-gray-50">
            <tr>
              <th className="text-left p-2 font-medium text-gray-600">Resource</th>
              <th className="text-left p-2 font-medium text-gray-600">Import ID Format</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            <tr><td className="p-2 font-mono">okta_auth_server_policy</td><td className="p-2 font-mono">auth_server_id/policy_id</td></tr>
            <tr><td className="p-2 font-mono">okta_auth_server_policy_rule</td><td className="p-2 font-mono">auth_server_id/policy_id/rule_id</td></tr>
            <tr><td className="p-2 font-mono">okta_auth_server_scope</td><td className="p-2 font-mono">auth_server_id/scope_id</td></tr>
            <tr><td className="p-2 font-mono">okta_auth_server_claim</td><td className="p-2 font-mono">auth_server_id/claim_id</td></tr>
            <tr><td className="p-2 font-mono">okta_policy_rule_signon</td><td className="p-2 font-mono">policy_id/rule_id</td></tr>
            <tr><td className="p-2 font-mono">okta_policy_rule_password</td><td className="p-2 font-mono">policy_id/rule_id</td></tr>
            <tr><td className="p-2 font-mono">okta_policy_rule_mfa</td><td className="p-2 font-mono">policy_id/rule_id</td></tr>
            <tr><td className="p-2 font-mono">okta_policy_rule_profile_enrollment</td><td className="p-2 font-mono">policy_id/rule_id</td></tr>
            <tr><td className="p-2 font-mono">okta_app_user</td><td className="p-2 font-mono">app_id/user_id</td></tr>
            <tr><td className="p-2 font-mono">okta_app_group_assignment</td><td className="p-2 font-mono">app_id/group_id</td></tr>
            <tr><td className="p-2 font-mono">okta_authenticator_webauthn_custom_aaguid</td><td className="p-2 font-mono">authenticator_id/aaguid</td></tr>
            <tr className="bg-amber-50"><td className="p-2 font-mono">okta_identity_source_group_membership</td><td className="p-2 font-mono text-amber-800">identity_source_id/group_or_external_id/id <strong>(3-part)</strong></td></tr>
            <tr><td className="p-2 font-mono">okta_identity_source_group</td><td className="p-2 font-mono">identity_source_id/id</td></tr>
            <tr><td className="p-2 font-mono">okta_identity_source_user</td><td className="p-2 font-mono">identity_source_id/id</td></tr>
          </tbody>
        </table>
      </div>

      <H3>Simple Import IDs (just the resource ID)</H3>
      <P>
        All other resources import with a single ID string:{' '}
        <code className="bg-gray-100 px-1 rounded">terraform import okta_resource.name &lt;id&gt;</code>.
        Notable ones: <code>okta_authenticator_method_webauthn</code> (authenticator_id),{' '}
        <code>okta_app_signon_policy_rules</code> (policy_id),{' '}
        <code>okta_app_signon_policy</code>, <code>okta_label</code>, <code>okta_group_memberships</code> (group_id).
      </P>
    </>
  );
}

function DestroyBehaviorContent() {
  return (
    <>
      <P>
        Not all resources support <code className="bg-gray-100 px-1 rounded">terraform destroy</code>.
        Some have no-op deletes; others reset to defaults rather than truly deleting.
      </P>

      <Warning>
        <strong>No-op destroy</strong> — these resources are removed from Terraform state only.
        No API call is made. The configuration persists in Okta unchanged:
        <ul className="mt-2 space-y-1 list-disc ml-4">
          <li><code>okta_org_configuration</code> — singleton org settings, no delete endpoint</li>
          <li><code>okta_policy_mfa_default</code> — Okta prohibits deleting default policies</li>
          <li><code>okta_policy_password_default</code> — same as above</li>
          <li><code>okta_rate_limiting</code> — provider emits a warning and exits</li>
          <li><code>okta_rate_limit_admin_notification_settings</code></li>
          <li><code>okta_rate_limit_warning_threshold_percentage</code></li>
          <li><code>okta_resource_owner</code> — governance resource</li>
          <li><code>okta_request_setting_organization</code> — governance resource</li>
          <li><code>okta_request_setting_resource</code> — governance resource</li>
        </ul>
      </Warning>

      <Caution>
        <strong>Destroy resets to defaults</strong> — these make an API call, but the underlying
        resource is a singleton that cannot be removed. Destroy just reverts settings:
        <ul className="mt-2 space-y-1 list-disc ml-4">
          <li><code>okta_security_notification_emails</code> — all notification flags reset to <code>true</code></li>
          <li><code>okta_threat_insight_settings</code> — action reset to <code>none</code></li>
        </ul>
      </Caution>

      <H3>What to do instead</H3>
      <P>
        For no-op resources, removing them from your Terraform config and running{' '}
        <code className="bg-gray-100 px-1 rounded">terraform state rm</code> will drop them from
        state without touching Okta. To actually change the settings, update the resource attributes
        and apply — or manage the settings directly in the Okta Admin Console.
      </P>
    </>
  );
}

function OieVsClassicContent() {
  return (
    <>
      <P>
        Some resources only work on Okta Identity Engine (OIE) orgs. On Classic orgs, these will
        return <strong>404 errors</strong> or fail silently — not a configuration mistake.
      </P>

      <div className="overflow-x-auto my-3">
        <table className="w-full text-xs border border-gray-200 rounded">
          <thead className="bg-gray-50">
            <tr>
              <th className="text-left p-2 font-medium text-gray-600">Resource</th>
              <th className="text-left p-2 font-medium text-gray-600">OIE Only?</th>
              <th className="text-left p-2 font-medium text-gray-600">Why</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            <tr><td className="p-2 font-mono">okta_policy_device_assurance_*</td><td className="p-2 text-red-600 font-medium">OIE only</td><td className="p-2">Device assurance policies require OIE</td></tr>
            <tr><td className="p-2 font-mono">okta_app_signon_policy</td><td className="p-2 text-red-600 font-medium">OIE only</td><td className="p-2">App-level sign-on policies are OIE feature</td></tr>
            <tr><td className="p-2 font-mono">okta_app_signon_policy_rule</td><td className="p-2 text-red-600 font-medium">OIE only</td><td className="p-2">Same as above</td></tr>
            <tr><td className="p-2 font-mono">okta_app_signon_policy_rules</td><td className="p-2 text-red-600 font-medium">OIE only</td><td className="p-2">Same as above</td></tr>
            <tr><td className="p-2 font-mono">okta_entity_risk_policy</td><td className="p-2 text-red-600 font-medium">OIE only</td><td className="p-2">Entity risk requires OIE + Risk Scoring</td></tr>
            <tr><td className="p-2 font-mono">okta_entity_risk_policy_rule</td><td className="p-2 text-red-600 font-medium">OIE only</td><td className="p-2">Same as above</td></tr>
            <tr><td className="p-2 font-mono">okta_session_violation_policy</td><td className="p-2 text-red-600 font-medium">OIE only</td><td className="p-2">Session violation detection requires OIE</td></tr>
            <tr><td className="p-2 font-mono">okta_session_violation_policy_rule</td><td className="p-2 text-red-600 font-medium">OIE only</td><td className="p-2">Same as above</td></tr>
            <tr><td className="p-2 font-mono">okta_post_auth_session_policy_rule</td><td className="p-2 text-red-600 font-medium">OIE only</td><td className="p-2">Continuous access evaluation requires OIE</td></tr>
            <tr><td className="p-2 font-mono">okta_authenticator</td><td className="p-2 text-amber-600 font-medium">OIE preferred</td><td className="p-2">Works on Classic but with limited authenticator options</td></tr>
            <tr><td className="p-2 font-mono">okta_app_access_policy_assignment</td><td className="p-2 text-red-600 font-medium">OIE only</td><td className="p-2">Access policies are OIE feature</td></tr>
            <tr><td className="p-2 font-mono">okta_realm</td><td className="p-2 text-red-600 font-medium">OIE only</td><td className="p-2">Realms require OIE</td></tr>
            <tr><td className="p-2 font-mono">okta_realm_assignment</td><td className="p-2 text-red-600 font-medium">OIE only</td><td className="p-2">Same as above</td></tr>
            <tr><td className="p-2 font-mono">okta_identity_source_*</td><td className="p-2 text-red-600 font-medium">OIE only</td><td className="p-2">Profile sourcing requires OIE</td></tr>
          </tbody>
        </table>
      </div>

      <Caution>
        The provider returns <code className="bg-amber-100 px-1 rounded">404</code> or a diagnostic
        error for OIE-only resources on Classic orgs — not a Terraform bug. Verify your org type in
        the Okta Admin Console under{' '}
        <strong>Settings &rarr; Account &rarr; Okta Identity Engine</strong>.
      </Caution>
    </>
  );
}

export default function ResourceLimitations() {
  const [activeSection, setActiveSection] = useState<SectionId>('import-support');
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const scrollTo = useCallback((id: SectionId) => {
    setActiveSection(id);
    sectionRefs.current[id]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  return (
    <div className="flex gap-4">
      {/* Sidebar nav */}
      <div className="w-44 flex-shrink-0">
        <nav className="sticky top-0 space-y-0.5">
          {SECTIONS.map(section => (
            <button
              key={section.id}
              onClick={() => scrollTo(section.id)}
              className={`w-full text-left px-2 py-1.5 text-xs rounded transition-colors ${
                activeSection === section.id
                  ? 'bg-surface-3 text-accent-teal font-medium'
                  : 'text-text-muted hover:text-text-secondary hover:bg-surface-2'
              }`}
            >
              {section.title}
            </button>
          ))}
        </nav>
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0 space-y-8">
        {SECTIONS.map(section => (
          <div
            key={section.id}
            ref={el => { sectionRefs.current[section.id] = el; }}
          >
            <h2 className="text-base font-semibold text-gray-800 mb-3 pb-2 border-b border-gray-200">
              {section.title}
            </h2>
            {section.id === 'import-support' && <ImportSupportContent />}
            {section.id === 'destroy-behavior' && <DestroyBehaviorContent />}
            {section.id === 'oie-vs-classic' && <OieVsClassicContent />}
          </div>
        ))}
      </div>
    </div>
  );
}
