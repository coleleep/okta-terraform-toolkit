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

describe('interpretLog sends LogIssue.title to the LLM unmasked', () => {
  it('does not tokenize the app-generated issue title (hcl_pii_attr false positive)', async () => {
    jest.resetModules();
    jest.doMock('electron', () => ({ app: { getPath: () => '/tmp' } }));
    jest.doMock('child_process', () => ({ spawnSync: jest.fn() }));
    const create = jest.fn().mockResolvedValue({
      content: [{ type: 'text', text: '{"narrative":"n","rootCause":"r","remediation":[]}' }],
    });
    jest.doMock('@anthropic-ai/sdk', () => {
      const Anthropic: any = jest.fn().mockImplementation(() => ({
        baseURL: 'https://gw',
        messages: { create },
        models: { list: jest.fn().mockRejectedValue(new Error('no list')) },
      }));
      Anthropic.APIError = class extends Error {};
      return { __esModule: true, default: Anthropic };
    });
    process.env.CLAUDE_API_KEY = 'sk-test';

    const { interpretLog } = require('../main/api/claude');
    const title = '6 requests (19%) hit rate limits (429)';
    await interpretLog({
      detectedConfig: { minWait: 30, maxWait: 300, maxRetries: 10 },
      startTime: '', endTime: '', durationSeconds: 1, totalRequests: 1, successfulRequests: 0,
      rateLimited: 1, errors: 0, deadlineExceeded: 0, rateLimitExhausted: 0, estimatedBackoffSeconds: 0,
      endpoints: [], issues: [{ severity: 'warning', title, detail: 'd', recommendation: 'r' }],
      errorsByStatus: {}, errorDetails: [],
    });

    const sent = create.mock.calls[0][0].messages[0].content as string;
    expect(sent).toContain(title);
    delete process.env.CLAUDE_API_KEY;
  });
});
