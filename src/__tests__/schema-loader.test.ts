import { loadSchema, isKnownResource, getResourceSchema } from '../shared/schema-loader';

describe('loadSchema', () => {
  it('loads v6.13.0 and returns resource_schemas', () => {
    const schema = loadSchema('6.13.0');
    expect(schema.resource_schemas).toBeDefined();
    expect(schema.data_source_schemas).toBeDefined();
  });

  it('contains okta_app_oauth in v6.13.0', () => {
    const schema = loadSchema('6.13.0');
    expect(schema.resource_schemas['okta_app_oauth']).toBeDefined();
  });

  it('throws for an unknown version', () => {
    expect(() => loadSchema('0.0.0')).toThrow('No schema snapshot for provider version 0.0.0');
  });
});

describe('isKnownResource', () => {
  it('returns true for okta_app_signon_policy_rules — the false-positive that triggered this feature', () => {
    expect(isKnownResource('6.13.0', 'okta_app_signon_policy_rules')).toBe(true);
  });

  it('returns true for okta_app_signon_policy_rule (singular)', () => {
    expect(isKnownResource('6.13.0', 'okta_app_signon_policy_rule')).toBe(true);
  });

  it('returns false for invented resource names', () => {
    expect(isKnownResource('6.13.0', 'okta_not_a_real_resource')).toBe(false);
  });

  it('returns true for known data sources', () => {
    expect(isKnownResource('6.13.0', 'okta_app')).toBe(true);
  });
});

describe('getResourceSchema', () => {
  it('returns schema for okta_app_oauth with attributes', () => {
    const schema = getResourceSchema('6.13.0', 'okta_app_oauth');
    expect(schema).not.toBeNull();
    expect(schema!.attributes).toBeDefined();
    expect(schema!.attributes!['label']).toBeDefined();
  });

  it('returns null for unknown resource', () => {
    expect(getResourceSchema('6.13.0', 'okta_not_real')).toBeNull();
  });
});
