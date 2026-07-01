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

  it('masks an org_url value', () => {
    const files = { 'main.tf': 'org_url = "https://dev-123456.okta.com"' };
    const result = vaultProject(files);

    expect(result.maskedFiles['main.tf']).not.toContain('dev-123456.okta.com');
    expect(result.entries[0].kind).toBe('org_url');
  });

  it('masks a JWT value', () => {
    const jwt =
      'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
    const files = { 'main.tf': `id_token = "${jwt}"` };
    const result = vaultProject(files);

    expect(result.maskedFiles['main.tf']).not.toContain(jwt);
    expect(result.entries[0].kind).toBe('jwt');
  });

  it('masks an SSWS token value', () => {
    const files = {
      'main.tf': 'auth_header = "SSWS 00abcDEFGHIJKLMNOPQRSTUVWXYZ1234567890"',
    };
    const result = vaultProject(files);

    expect(result.maskedFiles['main.tf']).not.toContain(
      'SSWS 00abcDEFGHIJKLMNOPQRSTUVWXYZ1234567890'
    );
    expect(result.entries[0].kind).toBe('token');
  });

  it('masks a PEM private key value', () => {
    const pem =
      '-----BEGIN PRIVATE KEY-----\nMIIBase64content\n-----END PRIVATE KEY-----';
    const files = { 'main.tf': `private_key = "${pem}"` };
    const result = vaultProject(files);

    expect(result.maskedFiles['main.tf']).not.toContain('MIIBase64content');
    expect(result.entries[0].kind).toBe('pem_key');
  });

  it('masks a hcl_pii_attr value and records the hcl_pii_attr kind', () => {
    const files = { 'main.tf': 'firstName = "Jane"' };
    const result = vaultProject(files);

    expect(result.maskedFiles['main.tf']).not.toContain('"Jane"');
    expect(result.entries[0].kind).toBe('hcl_pii_attr');
  });

  it('correctly masks the value, not the attribute name, when client_secret is used as both attr and value', () => {
    const files = { 'main.tf': 'client_secret = "client_secret"' };
    const result = vaultProject(files);

    expect(result.maskedFiles['main.tf']).toBe('client_secret = "{{CLIENT_SECRET_1}}"');
    expect(result.entries[0]).toMatchObject({
      value: 'client_secret',
      kind: 'client_secret',
      sourceAttr: 'client_secret',
    });
  });

  it('does not hang on a large malformed PEM block with no matching END marker', () => {
    const junk = 'A'.repeat(200_000);
    const files = { 'main.tf': `private_key = "-----BEGIN PRIVATE KEY-----${junk}"` };

    const start = Date.now();
    const result = vaultProject(files);
    const elapsedMs = Date.now() - start;

    expect(elapsedMs).toBeLessThan(1000);
    expect(result.entries).toHaveLength(0);
  });

  it('masks a realistic large JWT whose payload segment exceeds 20,000 characters', () => {
    // A large Okta JWT (e.g. a token with a `groups` claim covering hundreds
    // of groups) can have a payload segment well beyond a few KB. The exact
    // content of the payload doesn't matter for this pattern (it only checks
    // charset/length), so a synthetic base64url-shaped run of 'a' stands in
    // for a real large claims payload.
    const header = 'eyJhbGciOiJIUzI1NiJ9';
    const payload = 'a'.repeat(20_000);
    const signature = 'dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
    const jwt = `${header}.${payload}.${signature}`;
    const files = { 'main.tf': `id_token = "${jwt}"` };

    const result = vaultProject(files);

    expect(result.maskedFiles['main.tf']).not.toContain(jwt);
    expect(result.maskedFiles['main.tf']).not.toContain(payload);
    expect(result.entries[0].kind).toBe('jwt');
  });

  it('does not hang on a large malformed/unterminated JWT-like value with no closing quote', () => {
    const junk = 'A'.repeat(200_000);
    const files = { 'main.tf': `id_token = "${junk}` };

    const start = Date.now();
    const result = vaultProject(files);
    const elapsedMs = Date.now() - start;

    expect(elapsedMs).toBeLessThan(1000);
    expect(result.entries).toHaveLength(0);
  });

  it('masks a legitimate value that happens to contain a literal "{{" placeholder', () => {
    const files = { 'main.tf': 'client_secret = "{{not-a-real-token}}"' };
    const result = vaultProject(files);

    expect(result.maskedFiles['main.tf']).not.toContain('{{not-a-real-token}}');
    expect(result.entries[0]).toMatchObject({
      value: '{{not-a-real-token}}',
      kind: 'client_secret',
    });
  });
});
