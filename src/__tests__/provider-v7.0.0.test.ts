import {
  SUPPORTED_VERSIONS,
  DEFAULT_VERSION,
  VERSION_RESOURCE_ADDITIONS,
  VERSION_ATTRIBUTE_NOTES,
  VERSION_BREAKING_CHANGES,
  getAdditionsForVersion,
  getAttributeNotesForVersion,
  getBreakingChangesForVersion,
  isAvailableIn,
} from '../shared/versions';
import { isKnownResource } from '../shared/schema-loader';

describe('v7.0.0 version registration', () => {
  it('includes 7.0.0 in SUPPORTED_VERSIONS', () => {
    expect(SUPPORTED_VERSIONS).toContain('7.0.0');
  });

  it('DEFAULT_VERSION is the newest supported version', () => {
    const newest = SUPPORTED_VERSIONS[SUPPORTED_VERSIONS.length - 1];
    expect(DEFAULT_VERSION).toBe(newest);
    expect(DEFAULT_VERSION).toBe('7.0.0');
  });

  it('isAvailableIn returns true for 7.0.0 in 7.0.0, false in 6.15.0', () => {
    expect(isAvailableIn('7.0.0', '7.0.0')).toBe(true);
    expect(isAvailableIn('7.0.0', '6.15.0')).toBe(false);
  });
});

describe('v7.0.0 resource additions', () => {
  it('has a non-empty VERSION_RESOURCE_ADDITIONS entry for 7.0.0', () => {
    expect(VERSION_RESOURCE_ADDITIONS['7.0.0']).toBeDefined();
    expect(VERSION_RESOURCE_ADDITIONS['7.0.0'].length).toBeGreaterThan(0);
  });

  it('getAdditionsForVersion includes the 7.0.0 user_subscription addition', () => {
    const additions = getAdditionsForVersion('7.0.0');
    expect(additions.some(a => a.config.includes('okta_user_subscription'))).toBe(true);
  });
});

describe('v7.0.0 attribute notes', () => {
  it('has a non-empty VERSION_ATTRIBUTE_NOTES entry for 7.0.0', () => {
    expect(VERSION_ATTRIBUTE_NOTES['7.0.0']).toBeDefined();
    expect(VERSION_ATTRIBUTE_NOTES['7.0.0'].length).toBeGreaterThan(0);
  });

  it('mentions the exclude_zones rename', () => {
    expect(VERSION_ATTRIBUTE_NOTES['7.0.0'].some(n => n.includes('exclude_zones'))).toBe(true);
  });

  it('mentions the role_ref rename', () => {
    expect(VERSION_ATTRIBUTE_NOTES['7.0.0'].some(n => n.includes('role_ref'))).toBe(true);
  });

  it('getAttributeNotesForVersion(7.0.0) includes 7.0.0 notes', () => {
    const notes = getAttributeNotesForVersion('7.0.0');
    expect(notes.some(n => n.includes('exclude_zones'))).toBe(true);
  });
});

describe('v7.0.0 new resources are known in the schema', () => {
  it('okta_user_subscription is known in v7.0.0 schema', () => {
    expect(isKnownResource('7.0.0', 'okta_user_subscription')).toBe(true);
  });

  it('okta_org_captcha is known in v7.0.0 schema', () => {
    expect(isKnownResource('7.0.0', 'okta_org_captcha')).toBe(true);
  });
});

describe('v7.0.0 structured breaking changes', () => {
  it('has a VERSION_BREAKING_CHANGES entry for 7.0.0', () => {
    expect(VERSION_BREAKING_CHANGES['7.0.0']).toBeDefined();
    expect(VERSION_BREAKING_CHANGES['7.0.0'].length).toBeGreaterThan(0);
  });

  it('flags network_excludes as renamed to exclude_zones', () => {
    const change = VERSION_BREAKING_CHANGES['7.0.0'].find(
      c => c.resource === 'okta_threat_insight_settings' && c.attribute === 'network_excludes'
    );
    expect(change).toBeDefined();
    expect(change!.kind).toBe('renamed');
    expect(change!.replacement).toBe('exclude_zones');
  });

  it('flags role_type as renamed to role_ref', () => {
    const change = VERSION_BREAKING_CHANGES['7.0.0'].find(
      c => c.resource === 'okta_role_subscription' && c.attribute === 'role_type'
    );
    expect(change).toBeDefined();
    expect(change!.kind).toBe('renamed');
    expect(change!.replacement).toBe('role_ref');
  });

  it('flags status as no longer settable (computed) on okta_role_subscription', () => {
    const change = VERSION_BREAKING_CHANGES['7.0.0'].find(
      c => c.resource === 'okta_role_subscription' && c.attribute === 'status'
    );
    expect(change).toBeDefined();
    expect(change!.kind).toBe('removed');
    expect(change!.blockKind).toBe('resource');
  });

  it('flags notification_type as requiredness_changed on the okta_role_subscription data source', () => {
    const change = VERSION_BREAKING_CHANGES['7.0.0'].find(
      c => c.resource === 'okta_role_subscription' && c.attribute === 'notification_type'
    );
    expect(change).toBeDefined();
    expect(change!.kind).toBe('requiredness_changed');
    expect(change!.blockKind).toBe('data_source');
  });

  it('flags id as requiredness_changed (now required) on the okta_role_subscription data source', () => {
    const change = VERSION_BREAKING_CHANGES['7.0.0'].find(
      c => c.resource === 'okta_role_subscription' && c.attribute === 'id'
    );
    expect(change).toBeDefined();
    expect(change!.kind).toBe('requiredness_changed');
    expect(change!.blockKind).toBe('data_source');
  });

  it('flags translations as type_changed on okta_template_sms', () => {
    const change = VERSION_BREAKING_CHANGES['7.0.0'].find(
      c => c.resource === 'okta_template_sms' && c.attribute === 'translations'
    );
    expect(change).toBeDefined();
    expect(change!.kind).toBe('type_changed');
  });

  it('getBreakingChangesForVersion(7.0.0) returns the same list (baseline has none earlier)', () => {
    const changes = getBreakingChangesForVersion('7.0.0');
    expect(changes.length).toBe(VERSION_BREAKING_CHANGES['7.0.0'].length);
  });

  it('getBreakingChangesForVersion(6.15.0) returns no 7.0.0 changes', () => {
    const changes = getBreakingChangesForVersion('6.15.0');
    expect(changes.some(c => c.attribute === 'exclude_zones' || c.attribute === 'network_excludes')).toBe(false);
  });
});
