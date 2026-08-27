import { vaultProject } from '../main/api/redact-vault';

describe('redact-vault: vaultProject (extracted from validator.ts)', () => {
  it('masks an HCL attribute value', () => {
    const files = { 'main.tf': 'resource "okta_user" "u" {\n  login = "user@example.com"\n}' };
    const { maskedFiles, entries } = vaultProject(files);
    expect(maskedFiles['main.tf']).not.toContain('user@example.com');
    expect(entries.some(e => e.value === 'user@example.com')).toBe(true);
  });

  it('masks a prefix-agnostic 20-char Okta ID anywhere in text (oty prefix)', () => {
    const files = { 'state.tfstate': '{"custom_user_type_id": "oty1a2b3c4d5e6f7g8h9"}' };
    const { maskedFiles } = vaultProject(files);
    expect(maskedFiles['state.tfstate']).not.toContain('oty1a2b3c4d5e6f7g8h9');
  });
});
