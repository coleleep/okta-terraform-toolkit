import { vaultProject } from '../main/api/redact-vault';
import { redact } from '../main/api/redact';

// Mirrors the masking call interpretLog will make: wrap the stringified
// log analysis as a single-entry record, same shape vaultProject expects.
function maskLogAnalysis(analysisJson: string): string {
  const { maskedFiles } = vaultProject({ 'log-analysis': analysisJson });
  return maskedFiles['log-analysis'];
}

describe('TF_LOG analysis redaction before sending to the LLM', () => {
  it('masks an oty-prefixed Okta ID (missed by the old redact.ts prefix list)', () => {
    const json = JSON.stringify({ terraformErrors: ['404 on oty1a2b3c4d5e6f7g8h9'] });
    // Prove this is a real regression fix, not just a forward-only claim:
    // the old redact.ts's prefix list doesn't know about "oty" and leaves it in plaintext.
    expect(redact(json)).toContain('oty1a2b3c4d5e6f7g8h9');
    expect(maskLogAnalysis(json)).not.toContain('oty1a2b3c4d5e6f7g8h9');
  });

  it('masks an exk-prefixed Okta ID (missed by the old redact.ts prefix list)', () => {
    const json = JSON.stringify({ terraformErrors: ['exk9z8y7x6w5v4u3t2s1 not found'] });
    expect(maskLogAnalysis(json)).not.toContain('exk9z8y7x6w5v4u3t2s1');
  });

  it('masks a Bearer token', () => {
    const json = JSON.stringify({ terraformErrors: ['Authorization: Bearer abcdefghijklmnopqrstuvwxyz012345'] });
    expect(maskLogAnalysis(json)).not.toContain('abcdefghijklmnopqrstuvwxyz012345');
  });

  it('masks a secret embedded as a substring inside a larger blob', () => {
    const json = JSON.stringify({
      terraformErrors: ['response body: {"links":{"self":{"href":"https://acme.okta.com/api/v1/users/00u1a2b3c4d5e6f7g8h9"}}}'],
    });
    expect(maskLogAnalysis(json)).not.toContain('00u1a2b3c4d5e6f7g8h9');
  });
});
