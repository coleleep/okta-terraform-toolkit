import { redact } from '../main/api/redact';

describe('redact', () => {
  // Pattern 1: SSWS token
  it('redacts SSWS token and preserves scheme prefix', () => {
    expect(redact('Authorization: SSWS 00abcDEFGHIJKLMNOPQRSTUVWXYZ1234567890')).toBe(
      'Authorization: SSWS [SSWS_TOKEN]'
    );
  });

  // Pattern 2: Bearer token
  it('redacts Bearer token and preserves scheme prefix', () => {
    expect(redact('Authorization: Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9')).toBe(
      'Authorization: Bearer [BEARER_TOKEN]'
    );
  });

  // Pattern 3: Org URL with https://
  it('redacts org URL with https://', () => {
    expect(redact('connecting to https://dev-123456.okta.com/api/v1')).toBe(
      'connecting to [ORG_URL]/api/v1'
    );
  });

  // Pattern 3: Bare org domain
  it('redacts bare org domain without https://', () => {
    expect(redact('host: dev-123456.okta.com')).toBe('host: [ORG_URL]');
  });

  // Pattern 3: Preview org URL
  it('redacts oktapreview.com domain', () => {
    expect(redact('https://dev-999.oktapreview.com')).toBe('[ORG_URL]');
  });

  // Pattern 4: Okta user ID
  it('redacts Okta user ID', () => {
    expect(redact('GET /api/v1/users/00u1A2B3C4D5E6F7G8HI')).toBe(
      'GET /api/v1/users/[OKTA_ID]'
    );
  });

  // Pattern 4: Okta group ID
  it('redacts Okta group ID', () => {
    expect(redact('group_id = "00g1A2B3C4D5E6F7G8HI"')).toBe(
      'group_id = "[OKTA_ID]"'
    );
  });

  // Pattern 4: Okta app ID
  it('redacts Okta app ID (0oa prefix)', () => {
    expect(redact('app_id = "0oa1A2B3C4D5E6F7G8HI"')).toBe(
      'app_id = "[OKTA_ID]"'
    );
  });

  // Pattern 5: Email address
  it('redacts email address', () => {
    expect(redact('email = "alice@example.com"')).toBe('email = "[EMAIL]"');
  });

  // Pattern 6: HCL firstName field
  it('redacts HCL firstName value but preserves key', () => {
    expect(redact('firstName = "Alice"')).toBe('firstName = "[REDACTED_VALUE]"');
  });

  // Pattern 6: HCL login field
  it('redacts HCL login value but preserves key', () => {
    expect(redact('login = "alice@corp.com"')).toBe('login = "[REDACTED_VALUE]"');
  });

  // Pattern 6: HCL displayName field
  it('redacts HCL displayName value but preserves key', () => {
    expect(redact('displayName = "Alice Smith"')).toBe('displayName = "[REDACTED_VALUE]"');
  });

  // Pattern 7: OAuth client secret in HCL
  it('redacts client_secret value but preserves key', () => {
    expect(redact('client_secret = "supersecretvalue12345"')).toBe(
      'client_secret = "[CLIENT_SECRET]"'
    );
  });

  // Pattern 8: JWT token (3-part base64url)
  it('redacts standalone JWT token', () => {
    const jwt = 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkFsaWNlIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
    expect(redact(`id_token: ${jwt}`)).toBe('id_token: [JWT_TOKEN]');
  });

  // Pattern 9: PEM key block
  it('redacts PEM private key block', () => {
    const pem = '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA1234567890abcdef\n-----END RSA PRIVATE KEY-----';
    expect(redact(pem)).toBe('[PEM_KEY]');
  });

  // Mixed content
  it('redacts multiple patterns in one string', () => {
    const input = [
      'POST https://dev-123456.okta.com/api/v1/users',
      'Authorization: SSWS 00abcDEFGHIJKLMNOPQRSTUVWXYZ1234567890',
      'email: admin@company.com',
    ].join('\n');
    const result = redact(input);
    expect(result).not.toContain('dev-123456.okta.com');
    expect(result).not.toContain('00abcDEFGHIJKLMNOPQRSTUVWXYZ1234567890');
    expect(result).not.toContain('admin@company.com');
    expect(result).toContain('[ORG_URL]');
    expect(result).toContain('SSWS [SSWS_TOKEN]');
    expect(result).toContain('[EMAIL]');
  });

  // Clean passthrough
  it('returns clean Terraform content unchanged', () => {
    const clean = 'resource "okta_group" "engineers" {\n  name        = "Engineers"\n  description = "Engineering team"\n}';
    expect(redact(clean)).toBe(clean);
  });

  // Defensive: non-string input
  it('returns non-string input unchanged', () => {
    expect(redact(null as any)).toBeNull();
    expect(redact(undefined as any)).toBeUndefined();
    expect(redact(42 as any)).toBe(42);
  });
});
