import { vaultProject } from '../main/api/validator';

describe('vaultProject', () => {
  it('masks an Okta ID and records a reversible vault entry', () => {
    const files = { 'main.tf': 'resource "okta_app_oauth" "x" { app_id = "0oaABCDEFGHIJKLMNOPQ" }' };
    const result = vaultProject(files);

    expect(result.maskedFiles['main.tf']).not.toContain('0oaABCDEFGHIJKLMNOPQ');
    expect(result.maskedFiles['main.tf']).toMatch(/\{\{OKTA_ID_1\}\}/);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]).toMatchObject({
      token: '{{OKTA_ID_1}}',
      value: '0oaABCDEFGHIJKLMNOPQ',
      kind: 'okta_id',
      sourceFile: 'main.tf',
    });
  });

  it('reuses the same token when the same value appears in multiple files', () => {
    const files = {
      'main.tf': 'app_id = "0oaABCDEFGHIJKLMNOPQ"',
      'other.tf': 'related_app = "0oaABCDEFGHIJKLMNOPQ"',
    };
    const result = vaultProject(files);

    const tokens = result.entries.map(e => e.token);
    expect(new Set(tokens).size).toBe(1);
    expect(result.maskedFiles['main.tf']).toContain(tokens[0]);
    expect(result.maskedFiles['other.tf']).toContain(tokens[0]);
  });

  it('masks an email address', () => {
    const files = { 'main.tf': 'login = "jane.doe@example.com"' };
    const result = vaultProject(files);

    expect(result.maskedFiles['main.tf']).not.toContain('jane.doe@example.com');
    expect(result.entries[0].kind).toBe('email');
  });

  it('masks a client_secret value', () => {
    const files = { 'main.tf': 'client_secret = "super-secret-value-123"' };
    const result = vaultProject(files);

    expect(result.maskedFiles['main.tf']).not.toContain('super-secret-value-123');
    expect(result.entries[0].kind).toBe('client_secret');
  });

  it('returns an empty entries array for a file with no PII', () => {
    const files = { 'main.tf': 'resource "okta_group" "x" { name = "Engineering" }' };
    const result = vaultProject(files);

    expect(result.entries).toHaveLength(0);
    expect(result.maskedFiles['main.tf']).toBe(files['main.tf']);
  });

  it('tracks sourceAttr from the HCL attribute name when detectable', () => {
    const files = { 'main.tf': 'app_id = "0oaABCDEFGHIJKLMNOPQ"' };
    const result = vaultProject(files);

    expect(result.entries[0].sourceAttr).toBe('app_id');
  });
});
