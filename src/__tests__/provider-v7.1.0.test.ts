import {
  SUPPORTED_VERSIONS,
  DEFAULT_VERSION,
  VERSION_RESOURCE_ADDITIONS,
  VERSION_ATTRIBUTE_NOTES,
  VERSION_BREAKING_CHANGES,
  getAdditionsForVersion,
  getAttributeNotesForVersion,
  isAvailableIn,
} from '../shared/versions';
import { isKnownResource, getResourceSchema } from '../shared/schema-loader';
import { RESOURCE_DICTIONARY } from '../shared/resource-dictionary';

describe('v7.1.0 version registration', () => {
  it('includes 7.1.0 in SUPPORTED_VERSIONS', () => {
    expect(SUPPORTED_VERSIONS).toContain('7.1.0');
  });

  it('DEFAULT_VERSION is 7.1.0', () => {
    expect(DEFAULT_VERSION).toBe('7.1.0');
  });

  it('isAvailableIn returns true for 7.1.0 in 7.1.0, false in 7.0.0', () => {
    expect(isAvailableIn('7.1.0', '7.1.0')).toBe(true);
    expect(isAvailableIn('7.1.0', '7.0.0')).toBe(false);
  });
});

describe('v7.1.0 resource additions', () => {
  it('has an okta_request_conditions template', () => {
    expect(VERSION_RESOURCE_ADDITIONS['7.1.0'].some(a => a.config.includes('okta_request_conditions'))).toBe(true);
  });

  it('getAdditionsForVersion(7.0.0) does not include the 7.1.0 template', () => {
    expect(getAdditionsForVersion('7.0.0').some(a => a.config.includes('okta_request_conditions'))).toBe(false);
  });
});

describe('v7.1.0 attribute notes', () => {
  const notes = () => VERSION_ATTRIBUTE_NOTES['7.1.0'];

  it('mentions the new okta_request_conditions resource', () => {
    expect(notes().some(n => n.includes('okta_request_conditions'))).toBe(true);
  });

  it('mentions the default rule fix and the new system attribute', () => {
    expect(notes().some(n => n.includes('okta_policy_rule_signon') && n.includes('system'))).toBe(true);
  });

  it('mentions dpop_bound_access_tokens on okta_app_oauth', () => {
    expect(notes().some(n => n.includes('dpop_bound_access_tokens'))).toBe(true);
  });

  it('getAttributeNotesForVersion(7.1.0) is cumulative', () => {
    const all = getAttributeNotesForVersion('7.1.0');
    expect(all.some(n => n.includes('exclude_zones'))).toBe(true);
    expect(all.some(n => n.includes('okta_request_conditions'))).toBe(true);
  });

  it('has no structured breaking changes', () => {
    expect(VERSION_BREAKING_CHANGES['7.1.0']).toEqual([]);
  });
});

describe('v7.1.0 schema ground truth', () => {
  it('okta_request_conditions is known in 7.1.0 but not 7.0.0', () => {
    expect(isKnownResource('7.1.0', 'okta_request_conditions')).toBe(true);
    expect(isKnownResource('7.0.0', 'okta_request_conditions')).toBe(false);
  });

  it('system is computed-only on default-rule-capable policy rules', () => {
    for (const r of ['okta_policy_rule_signon', 'okta_policy_rule_mfa']) {
      const attr = getResourceSchema('7.1.0', r)?.attributes?.system;
      expect(attr?.computed).toBe(true);
      expect(attr?.optional).toBeFalsy();
    }
  });
});

describe('v7.1.0 resource dictionary', () => {
  it('lists okta_request_conditions under Governance', () => {
    const entry = RESOURCE_DICTIONARY.find(e => e.terraformResource === 'okta_request_conditions');
    expect(entry?.parentType).toBe('governance');
  });
});
