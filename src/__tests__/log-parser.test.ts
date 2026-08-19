import { writeFileSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { parseLogFile } from '../main/api/log-parser';

function writeLog(lines: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'log-parser-test-'));
  const filePath = join(dir, 'trace.log');
  writeFileSync(filePath, lines.join('\n'));
  return filePath;
}

const PREFIX = '2026-08-11T12:39:22.269-0700 [DEBUG] provider.terraform-provider-okta_v6.4.0:';

describe('parseLogFile — OAuth2/DPoP error bodies', () => {
  it('captures error/error_description fields from OAuth2 token endpoint failures', async () => {
    const filePath = writeLog([
      `${PREFIX} 2026/08/11 12:39:22 [DEBUG] performing request: method=POST url=https://unconv.okta.com/oauth2/v1/token`,
      `${PREFIX} HTTP/2.0 400 Bad Request`,
      `${PREFIX} {`,
      `${PREFIX}  "error": "invalid_dpop_proof",`,
      `${PREFIX}  "error_description": "The DPoP proof JWT header is missing."`,
      `${PREFIX} }`,
    ]);

    const result = await parseLogFile(filePath);

    expect(result.errorsByStatus[400]).toBe(1);
    const detail = result.errorDetails.find(e => e.httpStatus === 400);
    expect(detail?.oktaErrorCode).toBe('invalid_dpop_proof');
    expect(detail?.message).toBe('The DPoP proof JWT header is missing.');

    const dpopIssue = result.issues.find(i => i.title.toLowerCase().includes('dpop'));
    expect(dpopIssue).toBeDefined();
    expect(dpopIssue?.severity).toBe('critical');
  });

  it('normalizes the oauth2 token endpoint instead of leaking the full org URL', async () => {
    const filePath = writeLog([
      `${PREFIX} 2026/08/11 12:39:22 [DEBUG] performing request: method=POST url=https://unconv.okta.com/oauth2/v1/token`,
      `${PREFIX} HTTP/2.0 400 Bad Request`,
      `${PREFIX} {`,
      `${PREFIX}  "error": "invalid_dpop_proof",`,
      `${PREFIX}  "error_description": "The DPoP proof JWT header is missing."`,
      `${PREFIX} }`,
    ]);

    const result = await parseLogFile(filePath);

    expect(result.endpoints).toHaveLength(1);
    expect(result.endpoints[0].pattern).toBe('/oauth2/v1/token');
    expect(result.endpoints[0].label).toBe('Token Endpoint');

    const detail = result.errorDetails.find(e => e.httpStatus === 400);
    expect(detail?.endpoint).toBe('/oauth2/v1/token');
    expect(detail?.label).toBe('Token Endpoint');
  });
});
