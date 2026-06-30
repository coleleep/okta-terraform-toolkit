// src/__tests__/resource-names.test.ts
import { RESOURCE_DICTIONARY } from '../shared/resource-dictionary';
import { SUB_RESOURCE_SYNC_CONFIG } from '../shared/constants';
import { VERSION_RESOURCE_ADDITIONS, VERSION_ATTRIBUTE_NOTES } from '../shared/versions';

// These names do NOT exist in the provider — any occurrence is a hallucination
const KNOWN_WRONG_NAMES = new Set([
  'okta_policy_rule_sign_on',
  'okta_policy_sign_on',
  'okta_group_custom_schema_property',
  'okta_user_custom_schema_property',
  'okta_app_user_custom_schema_property',
  'okta_email_smtp_servers',
  'okta_assignees_users',
  'okta_signon_policy_rule',
  'okta_identity_source',
  'okta_device_assurance_policy_android_os',
  'okta_device_assurance_policy_chromeos_os',
  'okta_device_assurance_policy_ios_os',
  'okta_device_assurance_policy_macos_os',
  'okta_device_assurance_policy_windows_os',
]);

// Resources that MUST be present in the dictionary
const REQUIRED_RESOURCES = new Set([
  'okta_policy_rule_signon',
  'okta_policy_signon',
  'okta_group_schema_property',
  'okta_user_schema_property',
  'okta_app_user_schema_property',
  'okta_email_smtp_server',
  'okta_iam_assignees_user',
  'okta_app_sign_on_policy_rule',
  'okta_authorization_servers_policies_rule',
  'okta_policy_device_assurance_android',
  'okta_policy_device_assurance_chromeos',
  'okta_policy_device_assurance_ios',
  'okta_policy_device_assurance_macos',
  'okta_policy_device_assurance_windows',
  'okta_authenticator_webauthn_custom_aaguid',
  'okta_authenticator_method_webauthn',
  'okta_identity_source_group',
  'okta_identity_source_group_membership',
  'okta_identity_source_import',
  'okta_identity_source_user',
  'okta_label',
  'okta_resource_owner',
]);

describe('resource-dictionary accuracy', () => {
  const allNames = RESOURCE_DICTIONARY.map(r => r.terraformResource);

  test('no wrong resource names in RESOURCE_DICTIONARY', () => {
    const found = allNames.filter(n => KNOWN_WRONG_NAMES.has(n));
    expect(found).toEqual([]);
  });

  test('all required resource names are present', () => {
    const nameSet = new Set(allNames);
    const missing = [...REQUIRED_RESOURCES].filter(n => !nameSet.has(n));
    expect(missing).toEqual([]);
  });

  test('no duplicate terraformResource entries', () => {
    const seen = new Set<string>();
    const dupes: string[] = [];
    for (const name of allNames) {
      if (seen.has(name)) dupes.push(name);
      seen.add(name);
    }
    expect(dupes).toEqual([]);
  });
});

describe('SUB_RESOURCE_SYNC_CONFIG accuracy', () => {
  test('no wrong resource names as keys', () => {
    const keys = Object.keys(SUB_RESOURCE_SYNC_CONFIG);
    const found = keys.filter(k => KNOWN_WRONG_NAMES.has(k));
    expect(found).toEqual([]);
  });
});

describe('versions.ts accuracy', () => {
  test('no wrong resource names in VERSION_RESOURCE_ADDITIONS comments', () => {
    const allConfigs = Object.values(VERSION_RESOURCE_ADDITIONS).flat().map(e => e.config);
    const allText = allConfigs.join('\n');
    for (const wrong of KNOWN_WRONG_NAMES) {
      const pattern = new RegExp(`"${wrong}"`, 'g');
      expect(allText).not.toMatch(pattern);
    }
  });

  test('no wrong resource names in VERSION_ATTRIBUTE_NOTES', () => {
    const allNotes = Object.values(VERSION_ATTRIBUTE_NOTES).flat().join('\n');
    for (const wrong of KNOWN_WRONG_NAMES) {
      expect(allNotes).not.toContain(wrong);
    }
  });

  test('6.13.0 is in SUPPORTED_VERSIONS', () => {
    const { SUPPORTED_VERSIONS } = require('../shared/versions');
    expect(SUPPORTED_VERSIONS).toContain('6.13.0');
  });
});

describe('scopes.ts accuracy', () => {
  test('identitySources has a scope requirement entry', () => {
    const { SCOPE_REQUIREMENTS } = require('../shared/scopes');
    const hasIdentitySources = SCOPE_REQUIREMENTS.some(
      (s: { resourceType: string }) => s.resourceType === 'identitySources'
    );
    expect(hasIdentitySources).toBe(true);
  });
});
