import {
  SUPPORTED_VERSIONS,
  DEFAULT_VERSION,
  VERSION_RESOURCE_ADDITIONS,
  VERSION_ATTRIBUTE_NOTES,
  getAdditionsForVersion,
  isAvailableIn,
} from '../shared/versions';
import { RESOURCE_DICTIONARY } from '../shared/resource-dictionary';

describe('v6.12.0 version registration', () => {
  it('includes 6.12.0 in SUPPORTED_VERSIONS', () => {
    expect(SUPPORTED_VERSIONS).toContain('6.12.0');
  });

  it('sets DEFAULT_VERSION to 6.13.0', () => {
    expect(DEFAULT_VERSION).toBe('6.13.0');
  });

  it('isAvailableIn returns true for 6.12.0 in 6.12.0', () => {
    expect(isAvailableIn('6.12.0', '6.12.0')).toBe(true);
  });

  it('isAvailableIn returns false for 6.12.0 in 6.11.0', () => {
    expect(isAvailableIn('6.12.0', '6.11.0')).toBe(false);
  });
});

describe('v6.12.0 resource additions', () => {
  it('has VERSION_RESOURCE_ADDITIONS entry for 6.12.0', () => {
    expect(VERSION_RESOURCE_ADDITIONS['6.12.0']).toBeDefined();
    expect(VERSION_RESOURCE_ADDITIONS['6.12.0'].length).toBeGreaterThan(0);
  });

  it('has applications addition for 6.12.0 (CIBA + keep_me_signed_in)', () => {
    const apps = VERSION_RESOURCE_ADDITIONS['6.12.0'].find((a) => a.type === 'applications');
    expect(apps).toBeDefined();
    expect(apps!.config).toMatch(/backchannel_custom_authenticator_id/);
    expect(apps!.config).toMatch(/keep_me_signed_in/);
  });

  it('has policies addition for 6.12.0 (new policy rule data sources)', () => {
    const policies = VERSION_RESOURCE_ADDITIONS['6.12.0'].find((a) => a.type === 'policies');
    expect(policies).toBeDefined();
    expect(policies!.config).toMatch(/okta_app_sign_on_policy_rule/);
    expect(policies!.config).toMatch(/okta_authorization_servers_policies_rule/);
  });

  it('has users addition for 6.12.0 (assignees data source)', () => {
    const users = VERSION_RESOURCE_ADDITIONS['6.12.0'].find((a) => a.type === 'users');
    expect(users).toBeDefined();
    expect(users!.config).toMatch(/okta_iam_assignees_user/);
  });

  it('getAdditionsForVersion includes 6.12.0 additions when version is 6.12.0', () => {
    const additions = getAdditionsForVersion('6.12.0');
    expect(additions.some((a) => a.config.includes('backchannel_custom_authenticator_id'))).toBe(true);
  });
});

describe('v6.12.0 attribute notes', () => {
  it('has VERSION_ATTRIBUTE_NOTES entry for 6.12.0', () => {
    expect(VERSION_ATTRIBUTE_NOTES['6.12.0']).toBeDefined();
    expect(VERSION_ATTRIBUTE_NOTES['6.12.0'].length).toBeGreaterThan(0);
  });

  it('mentions DPoP rate limit deferral in 6.12.0 notes', () => {
    const notes = VERSION_ATTRIBUTE_NOTES['6.12.0'];
    expect(notes.some((n) => /DPoP/i.test(n))).toBe(true);
  });

  it('mentions backchannel_custom_authenticator_id in 6.12.0 notes', () => {
    const notes = VERSION_ATTRIBUTE_NOTES['6.12.0'];
    expect(notes.some((n) => n.includes('backchannel_custom_authenticator_id'))).toBe(true);
  });

  it('mentions keep_me_signed_in in 6.12.0 notes', () => {
    const notes = VERSION_ATTRIBUTE_NOTES['6.12.0'];
    expect(notes.some((n) => n.includes('keep_me_signed_in'))).toBe(true);
  });
});

describe('v6.12.0 data source entries', () => {
  it('has okta_app_sign_on_policy_rule data source with sinceVersion 6.12.0', () => {
    const entry = RESOURCE_DICTIONARY.find(
      (r) => r.terraformResource === 'okta_app_sign_on_policy_rule',
    );
    expect(entry).toBeDefined();
    expect(entry!.parentType).toBe('policies');
    expect(entry!.sinceVersion).toBe('6.12.0');
  });

  it('has okta_authorization_servers_policies_rule data source with sinceVersion 6.12.0', () => {
    const entry = RESOURCE_DICTIONARY.find(
      (r) => r.terraformResource === 'okta_authorization_servers_policies_rule',
    );
    expect(entry).toBeDefined();
    expect(entry!.parentType).toBe('authServers');
    expect(entry!.sinceVersion).toBe('6.12.0');
  });

  it('has okta_iam_assignees_user data source with sinceVersion 6.12.0', () => {
    const entry = RESOURCE_DICTIONARY.find(
      (r) => r.terraformResource === 'okta_iam_assignees_user',
    );
    expect(entry).toBeDefined();
    expect(entry!.parentType).toBe('users');
    expect(entry!.sinceVersion).toBe('6.12.0');
  });
});
