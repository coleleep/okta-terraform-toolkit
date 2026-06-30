import {
  SUPPORTED_VERSIONS,
  DEFAULT_VERSION,
  VERSION_RESOURCE_ADDITIONS,
  VERSION_ATTRIBUTE_NOTES,
  getAdditionsForVersion,
  isAvailableIn,
} from '../shared/versions';
import { RESOURCE_TYPES } from '../shared/constants';
import { RESOURCE_DICTIONARY } from '../shared/resource-dictionary';

describe('v6.11.0 version registration', () => {
  it('includes 6.11.0 in SUPPORTED_VERSIONS', () => {
    expect(SUPPORTED_VERSIONS).toContain('6.11.0');
  });

  it('6.11.0 remains in SUPPORTED_VERSIONS after newer releases', () => {
    expect(SUPPORTED_VERSIONS).toContain('6.11.0');
  });

  it('has VERSION_RESOURCE_ADDITIONS entry for 6.11.0', () => {
    expect(VERSION_RESOURCE_ADDITIONS['6.11.0']).toBeDefined();
    expect(VERSION_RESOURCE_ADDITIONS['6.11.0'].length).toBeGreaterThan(0);
  });

  it('has identitySources in 6.11.0 additions', () => {
    const types = VERSION_RESOURCE_ADDITIONS['6.11.0'].map((a) => a.type);
    expect(types).toContain('identitySources');
  });

  it('has policies in 6.11.0 additions (breached password)', () => {
    const types = VERSION_RESOURCE_ADDITIONS['6.11.0'].map((a) => a.type);
    expect(types).toContain('policies');
  });

  it('has VERSION_ATTRIBUTE_NOTES entry for 6.11.0', () => {
    expect(VERSION_ATTRIBUTE_NOTES['6.11.0']).toBeDefined();
    expect(VERSION_ATTRIBUTE_NOTES['6.11.0'].length).toBeGreaterThan(0);
  });

  it('includes okta_policy_password note in 6.11.0', () => {
    const notes = VERSION_ATTRIBUTE_NOTES['6.11.0'];
    expect(notes.some((n) => n.includes('okta_policy_password'))).toBe(true);
  });

  it('getAdditionsForVersion includes 6.11.0 additions when version is 6.11.0', () => {
    const additions = getAdditionsForVersion('6.11.0');
    const types = additions.map((a) => a.type);
    expect(types).toContain('identitySources');
  });

  it('isAvailableIn returns true for 6.11.0 in 6.11.0', () => {
    expect(isAvailableIn('6.11.0', '6.11.0')).toBe(true);
  });

  it('isAvailableIn returns false for 6.11.0 in 6.10.0', () => {
    expect(isAvailableIn('6.11.0', '6.10.0')).toBe(false);
  });
});

describe('identitySources resource type', () => {
  it('exists in RESOURCE_TYPES', () => {
    const entry = RESOURCE_TYPES.find((r) => r.type === 'identitySources');
    expect(entry).toBeDefined();
    expect(entry!.label).toBe('Identity Sources');
    expect(entry!.category).toBe('advanced');
  });
});

describe('identity source resource dictionary entries', () => {
  it('has okta_identity_source_group resource entry', () => {
    const entry = RESOURCE_DICTIONARY.find(
      (r) => r.terraformResource === 'okta_identity_source_group',
    );
    expect(entry).toBeDefined();
    expect(entry!.parentType).toBe('identitySources');
    expect(entry!.sinceVersion).toBe('6.11.0');
  });

  it('has okta_identity_source_users data source entry', () => {
    const entry = RESOURCE_DICTIONARY.find(
      (r) => r.terraformResource === 'okta_identity_source_users',
    );
    expect(entry).toBeDefined();
    expect(entry!.parentType).toBe('identitySources');
    expect(entry!.sinceVersion).toBe('6.11.0');
  });
});
