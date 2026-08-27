import { migrateAttributesForVersion, convertConfigDeterministic, applyMigrationToConvertedConfig } from '../main/api/sync-convert';

describe('migrateAttributesForVersion', () => {
  it('renames network_excludes to exclude_zones inside okta_threat_insight_settings only', () => {
    const hcl = `resource "okta_threat_insight_settings" "example" {
  network_excludes = ["1.2.3.0/24"]
}

resource "okta_network_zone" "other" {
  network_excludes = ["9.9.9.0/24"]
}`;
    const { content, warnings } = migrateAttributesForVersion(hcl, '7.0.0');
    expect(content).toContain('exclude_zones = ["1.2.3.0/24"]');
    // Unrelated resource with the same attribute name must be untouched.
    expect(content).toContain('okta_network_zone" "other" {\n  network_excludes = ["9.9.9.0/24"]');
    expect(warnings.length).toBe(0); // clean rename, no warning needed
  });

  it('renames role_type to role_ref inside okta_role_subscription', () => {
    const hcl = `resource "okta_role_subscription" "example" {
  role_type = "SUPER_ADMIN"
}`;
    const { content } = migrateAttributesForVersion(hcl, '7.0.0');
    expect(content).toContain('role_ref = "SUPER_ADMIN"');
    expect(content).not.toContain('role_type');
  });

  it('drops the removed status attribute and emits a warning', () => {
    const hcl = `resource "okta_role_subscription" "example" {
  role_ref = "SUPER_ADMIN"
  status   = "subscribed"
}`;
    const { content, warnings } = migrateAttributesForVersion(hcl, '7.0.0');
    expect(content).not.toContain('status');
    expect(warnings.some(w => w.includes('status') && w.includes('okta_role_subscription.example'))).toBe(true);
  });

  it('leaves translations untouched but emits a manual-fix warning (type_changed)', () => {
    const hcl = `resource "okta_template_sms" "example" {
  translations = [
    { language = "en", template = "Hello" }
  ]
}`;
    const { content, warnings } = migrateAttributesForVersion(hcl, '7.0.0');
    expect(content).toContain('translations = [');
    expect(warnings.some(w => w.includes('translations') && w.includes('manually'))).toBe(true);
  });

  it('does nothing when targeting 6.15.0 (no applicable breaking changes)', () => {
    const hcl = `resource "okta_threat_insight_settings" "example" {
  network_excludes = ["1.2.3.0/24"]
}`;
    const { content, warnings } = migrateAttributesForVersion(hcl, '6.15.0');
    expect(content).toBe(hcl);
    expect(warnings.length).toBe(0);
  });

  it('does NOT drop status inside a data "okta_role_subscription" block (blockKind: resource only)', () => {
    const hcl = `data "okta_role_subscription" "example" {
  role_ref = "SUPER_ADMIN"
  status   = "subscribed"
}`;
    const { content, warnings } = migrateAttributesForVersion(hcl, '7.0.0');
    expect(content).toContain('status   = "subscribed"');
    expect(warnings.some(w => w.includes('status'))).toBe(false);
  });

  it('warns about the notification_type requiredness change inside a data "okta_role_subscription" block', () => {
    const hcl = `data "okta_role_subscription" "example" {
  notification_type = "APP_ASSIGNMENT"
}`;
    const { warnings } = migrateAttributesForVersion(hcl, '7.0.0');
    expect(warnings.some(w =>
      w.includes('data.okta_role_subscription.example') && w.includes('notification_type')
    )).toBe(true);
  });

  it('does not rewrite a commented-out block', () => {
    const hcl = `# resource "okta_role_subscription" "example" {
#   role_ref = "SUPER_ADMIN"
#   status   = "subscribed"
# }`;
    const { content, warnings } = migrateAttributesForVersion(hcl, '7.0.0');
    expect(content).toBe(hcl);
    expect(warnings.length).toBe(0);
  });

  it('correctly rewrites two separate blocks in the same file without offset corruption', () => {
    const hcl = `resource "okta_threat_insight_settings" "first" {
  network_excludes = ["1.2.3.0/24"]
}

resource "okta_role_subscription" "second" {
  role_type = "SUPER_ADMIN"
  status    = "subscribed"
}`;
    const { content, warnings } = migrateAttributesForVersion(hcl, '7.0.0');
    expect(content).toContain('exclude_zones = ["1.2.3.0/24"]');
    expect(content).toContain('role_ref = "SUPER_ADMIN"');
    expect(content).not.toContain('network_excludes');
    expect(content).not.toContain('role_type');
    expect(content).not.toContain('status');
    expect(warnings.some(w => w.includes('okta_role_subscription.second') && w.includes('status'))).toBe(true);
  });
});

describe('convertConfigDeterministic applies breaking-change migration', () => {
  it('rewrites network_excludes to exclude_zones when targetVersion is 7.0.0', () => {
    const tfContent = `resource "okta_threat_insight_settings" "example" {
  network_excludes = ["1.2.3.0/24"]
}`;
    const result = convertConfigDeterministic(tfContent, [], 'https://acme.okta.com', '7.0.0');
    expect(result.portableHcl).toContain('exclude_zones');
    expect(result.portableHcl).not.toContain('network_excludes');
  });

  it('does not rewrite anything when targetVersion is omitted (backward compatible)', () => {
    const tfContent = `resource "okta_threat_insight_settings" "example" {
  network_excludes = ["1.2.3.0/24"]
}`;
    const result = convertConfigDeterministic(tfContent, [], 'https://acme.okta.com');
    expect(result.portableHcl).toContain('network_excludes');
  });
});

describe('applyMigrationToConvertedConfig (AI-path post-processing)', () => {
  it('rewrites network_excludes to exclude_zones on AI-generated output, mirroring the deterministic path', () => {
    // Simulates the shape convertConfig (the AI path) would return — the AI copies
    // attributes verbatim and never applies version-aware rewrites itself, so the
    // IPC handler applies this as a uniform post-processing step for that path.
    const aiOutput = {
      portableHcl: `resource "okta_threat_insight_settings" "example" {
  network_excludes = ["1.2.3.0/24"]
}`,
      importBlocks: '',
      instructions: ['some instruction'],
      warnings: ['some prior warning'],
    };

    const result = applyMigrationToConvertedConfig(aiOutput, '7.0.0');

    expect(result.portableHcl).toContain('exclude_zones');
    expect(result.portableHcl).not.toContain('network_excludes');
    // Prior warnings/instructions must be preserved, not clobbered.
    expect(result.warnings).toContain('some prior warning');
    expect(result.instructions).toEqual(['some instruction']);
  });
});
