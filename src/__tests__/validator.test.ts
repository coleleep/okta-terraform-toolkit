import { vaultProject, exportProject, createSession, getSession, clearSession, touchSession } from '../main/api/validator';

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

  it('masks a realistic multi-cert chain whose combined body exceeds 10,000 characters', () => {
    // A `ca_bundle` or `certificate_chain` attribute holding a CA bundle,
    // cross-signed intermediates, or an mTLS chain routinely concatenates
    // six or more PEM blocks. The exact base64 content doesn't matter for
    // this pattern (it only checks the BEGIN/END markers and charset), so a
    // synthetic repeating run stands in for real certificate bodies.
    const makeCert = (bodyLen: number) => {
      const body = 'MIIB'.repeat(Math.ceil(bodyLen / 4)).slice(0, bodyLen);
      return `-----BEGIN CERTIFICATE-----\n${body}\n-----END CERTIFICATE-----`;
    };
    const chain = Array.from({ length: 6 }, () => makeCert(1874)).join('\n');
    expect(chain.length).toBeGreaterThan(10_000);

    const files = { 'main.tf': `ca_bundle = "${chain}"` };
    const result = vaultProject(files);

    expect(result.maskedFiles['main.tf']).not.toContain('BEGIN CERTIFICATE');
    expect(result.maskedFiles['main.tf']).not.toContain('MIIB');
    expect(result.entries.length).toBeGreaterThan(0);
    expect(result.entries[0].kind).toBe('pem_key');
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

describe('exportProject', () => {
  it('promotes a .tf-sourced value to variables.tf + terraform.tfvars, not inlined', () => {
    const original = { 'main.tf': 'resource "okta_app_oauth" "x" { app_id = "0oaABCDEFGHIJKLMNOPQ" }' };
    const { maskedFiles, entries } = vaultProject(original);

    const result = exportProject(maskedFiles, entries);

    expect(result.files['main.tf']).not.toContain('0oaABCDEFGHIJKLMNOPQ');
    expect(result.files['main.tf']).toMatch(/var\.app_id_1/);
    expect(result.files['variables.tf']).toContain('variable "app_id_1"');
    expect(result.files['variables.tf']).not.toContain('0oaABCDEFGHIJKLMNOPQ');
    expect(result.files['variables.tf']).not.toContain('default');
    expect(result.files['terraform.tfvars']).toContain('app_id_1 = "0oaABCDEFGHIJKLMNOPQ"');
  });

  it('restores a .tfvars-sourced value in place without promoting it', () => {
    const original = { 'terraform.tfvars': 'app_id = "0oaABCDEFGHIJKLMNOPQ"' };
    const { maskedFiles, entries } = vaultProject(original);

    const result = exportProject(maskedFiles, entries);

    expect(result.files['terraform.tfvars']).toBe('app_id = "0oaABCDEFGHIJKLMNOPQ"');
    expect(result.files['variables.tf']).toBeUndefined();
  });

  it('appends to an existing variables.tf without disturbing existing declarations', () => {
    const original = {
      'main.tf': 'app_id = "0oaABCDEFGHIJKLMNOPQ"',
      'variables.tf': 'variable "region" {\n  type = string\n}\n',
    };
    const { maskedFiles, entries } = vaultProject(original);

    const result = exportProject(maskedFiles, entries);

    expect(result.files['variables.tf']).toContain('variable "region"');
    expect(result.files['variables.tf']).toContain('variable "app_id_1"');
  });

  it('deduplicates variable names when the same sourceAttr appears more than once', () => {
    const original = {
      'main.tf': 'a = "0oaAAAAAAAAAAAAAAAAA"\nb = "0oaBBBBBBBBBBBBBBBBB"',
    };
    // Force both entries to share sourceAttr "app_id" to exercise the dedup counter.
    const vaulted = vaultProject(original);
    const entries = vaulted.entries.map(e => ({ ...e, sourceAttr: 'app_id' }));

    const result = exportProject(vaulted.maskedFiles, entries);

    expect(result.files['variables.tf']).toContain('variable "app_id_1"');
    expect(result.files['variables.tf']).toContain('variable "app_id_2"');
  });

  it('promotes a value in .tf and restores the real value in place in .tfvars when the same value appears in both files', () => {
    const original = {
      'main.tf': 'app_id = "0oaABCDEFGHIJKLMNOPQ"',
      'terraform.tfvars': 'other_ref = "0oaABCDEFGHIJKLMNOPQ"',
    };
    const { maskedFiles, entries } = vaultProject(original);

    // vaultProject dedups by value, so there should be exactly one entry for
    // this shared value (sourceFile reflects whichever file was iterated first).
    expect(entries).toHaveLength(1);

    const result = exportProject(maskedFiles, entries);

    // main.tf must reference the promoted variable, never the literal token.
    expect(result.files['main.tf']).toMatch(/var\.app_id_1/);
    expect(result.files['main.tf']).not.toContain('0oaABCDEFGHIJKLMNOPQ');
    expect(result.files['main.tf']).not.toMatch(/\{\{OKTA_ID_1\}\}/);

    // terraform.tfvars must have the REAL VALUE restored in place — not the
    // literal token, and not a var. reference (tfvars files can't use var.).
    expect(result.files['terraform.tfvars']).toContain('other_ref = "0oaABCDEFGHIJKLMNOPQ"');
    expect(result.files['terraform.tfvars']).not.toMatch(/\{\{OKTA_ID_1\}\}/);
    expect(result.files['terraform.tfvars']).not.toContain('var.app_id_1');

    // Only one variable declaration should be created for this shared value.
    const declarationMatches = result.files['variables.tf'].match(/variable\s+"app_id_1"/g) ?? [];
    expect(declarationMatches).toHaveLength(1);
  });

  it('avoids colliding with a variable name already declared in an existing variables.tf', () => {
    const original = {
      'main.tf': 'app_id = "0oaABCDEFGHIJKLMNOPQ"',
      'variables.tf': 'variable "app_id_1" {\n  type = string\n}\n',
    };
    const { maskedFiles, entries } = vaultProject(original);

    const result = exportProject(maskedFiles, entries);

    // The pre-existing declaration must survive untouched.
    expect(result.files['variables.tf']).toContain('variable "app_id_1" {\n  type = string\n}');

    // The newly generated variable must not collide with the pre-existing name.
    expect(result.files['variables.tf']).not.toMatch(/variable\s+"app_id_1"\s*\{\s*type\s*=\s*string\s*\n\s*sensitive/);
    expect(result.files['variables.tf']).toContain('variable "app_id_2"');
    expect(result.files['main.tf']).toMatch(/var\.app_id_2/);
    expect(result.files['terraform.tfvars']).toContain('app_id_2 = "0oaABCDEFGHIJKLMNOPQ"');
  });
});

describe('validator session store', () => {
  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it('creates and retrieves a session by id', () => {
    const id = createSession({ maskedFiles: { 'main.tf': 'x' }, entries: [] });
    const session = getSession(id);

    expect(session).not.toBeNull();
    expect(session!.vault.maskedFiles['main.tf']).toBe('x');
  });

  it('returns null for an unknown session id', () => {
    expect(getSession('does-not-exist')).toBeNull();
  });

  it('clearSession removes the session', () => {
    const id = createSession({ maskedFiles: {}, entries: [] });
    clearSession(id);

    expect(getSession(id)).toBeNull();
  });

  it('auto-clears a session after 15 minutes of inactivity', () => {
    jest.useFakeTimers();
    const id = createSession({ maskedFiles: {}, entries: [] });

    jest.advanceTimersByTime(15 * 60 * 1000 + 1000);

    expect(getSession(id)).toBeNull();
  });

  it('touchSession resets the idle timer', () => {
    jest.useFakeTimers();
    const id = createSession({ maskedFiles: {}, entries: [] });

    jest.advanceTimersByTime(10 * 60 * 1000);
    touchSession(id);
    jest.advanceTimersByTime(10 * 60 * 1000);

    expect(getSession(id)).not.toBeNull(); // 20 min total elapsed, but touched at 10 min mark
  });
});
