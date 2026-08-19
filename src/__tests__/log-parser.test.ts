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

describe('parseLogFile — rate limit bucket keying', () => {
  it('keeps GET and POST limits for the same path in separate buckets', async () => {
    const filePath = writeLog([
      `${PREFIX} performing request: method=GET url=https://acme.okta.com/api/v1/apps/0oa1b2c3d4e5f6g7h8i9/users?limit=200`,
      `${PREFIX} HTTP/2.0 200 OK`,
      `${PREFIX} X-Rate-Limit-Limit: 600`,
      `${PREFIX} X-Rate-Limit-Remaining: 599`,
      `${PREFIX} performing request: method=POST url=https://acme.okta.com/api/v1/apps/0oa1b2c3d4e5f6g7h8i9/users`,
      `${PREFIX} HTTP/2.0 200 OK`,
      `${PREFIX} X-Rate-Limit-Limit: 100`,
      `${PREFIX} X-Rate-Limit-Remaining: 12`,
    ]);

    const result = await parseLogFile(filePath);

    const rows = result.endpoints.filter(e => e.pattern === '/api/v1/apps/{id}/users');
    expect(rows).toHaveLength(2);

    const get = rows.find(r => r.method === 'GET');
    const post = rows.find(r => r.method === 'POST');
    expect(get?.minRateLimit).toBe(600);
    expect(post?.minRateLimit).toBe(100);
    expect(get?.lowestRemaining).toBe(599);
    expect(post?.lowestRemaining).toBe(12);
  });

  it('attributes 429s to the method that was rate limited', async () => {
    const filePath = writeLog([
      `${PREFIX} performing request: method=GET url=https://acme.okta.com/api/v1/users?limit=200`,
      `${PREFIX} HTTP/2.0 200 OK`,
      `${PREFIX} performing request: method=POST url=https://acme.okta.com/api/v1/users`,
      `${PREFIX} HTTP/2.0 429 Too Many Requests`,
    ]);

    const result = await parseLogFile(filePath);

    const get = result.endpoints.find(e => e.pattern === '/api/v1/users' && e.method === 'GET');
    const post = result.endpoints.find(e => e.pattern === '/api/v1/users' && e.method === 'POST');
    expect(get?.rateLimited).toBe(0);
    expect(post?.rateLimited).toBe(1);
    expect(result.rateLimited).toBe(1);
  });

  it('treats DELETE as its own bucket rather than folding it into reads', async () => {
    const filePath = writeLog([
      `${PREFIX} performing request: method=DELETE url=https://acme.okta.com/api/v1/groups/00g1b2c3d4e5f6g7h8i9`,
      `${PREFIX} HTTP/2.0 204 No Content`,
      `${PREFIX} X-Rate-Limit-Limit: 60`,
    ]);

    const result = await parseLogFile(filePath);

    const row = result.endpoints.find(e => e.pattern === '/api/v1/groups/{id}');
    expect(row?.method).toBe('DELETE');
    expect(row?.minRateLimit).toBe(60);
  });

  it('defaults to GET when the log line omits method=', async () => {
    const filePath = writeLog([
      `${PREFIX} performing request: url=https://acme.okta.com/api/v1/users?limit=200`,
      `${PREFIX} HTTP/2.0 200 OK`,
      `${PREFIX} X-Rate-Limit-Limit: 600`,
    ]);

    const result = await parseLogFile(filePath);

    expect(result.endpoints).toHaveLength(1);
    expect(result.endpoints[0].method).toBe('GET');
    expect(result.endpoints[0].minRateLimit).toBe(600);
  });
});
