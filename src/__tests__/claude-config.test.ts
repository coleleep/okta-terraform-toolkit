import * as fs from 'fs';
import * as path from 'path';
import * as realOs from 'os';

const TMP_USER_DATA = fs.mkdtempSync(path.join(realOs.tmpdir(), 'otto-userdata-'));

jest.mock('electron', () => ({
  app: {
    getPath: (name: string) => {
      if (name === 'userData') return TMP_USER_DATA;
      throw new Error(`unexpected getPath: ${name}`);
    },
  },
}));

jest.mock('child_process', () => ({
  spawnSync: jest.fn(),
}));

function getSpawnSync() {
  return require('child_process').spawnSync as jest.Mock;
}

function mockOcmAuth(token: string | null) {
  if (token === null) {
    getSpawnSync().mockReturnValue({ status: 1, stdout: '', stderr: '' });
  } else {
    getSpawnSync().mockReturnValue({ status: 0, stdout: token + '\n', stderr: '' });
  }
}

function writeStaticConfig(data: object) {
  fs.writeFileSync(path.join(TMP_USER_DATA, 'claude-config.json'), JSON.stringify(data));
}

function writeLegacyKey(apiKey: string) {
  fs.writeFileSync(path.join(TMP_USER_DATA, 'claude-key.json'), JSON.stringify({ apiKey }));
}

beforeEach(() => {
  fs.rmSync(TMP_USER_DATA, { recursive: true, force: true });
  fs.mkdirSync(TMP_USER_DATA, { recursive: true });
  delete process.env.CLAUDE_API_KEY;
  delete process.env.CLAUDE_BASE_URL;
  mockOcmAuth(null); // default: OCM not available
  jest.resetModules();
});

afterAll(() => {
  fs.rmSync(TMP_USER_DATA, { recursive: true, force: true });
});

function load() {
  return require('../main/api/claude');
}

describe('getClaudeConfig priority', () => {
  it('returns null when nothing is configured', () => {
    expect(load().getClaudeConfig()).toBeNull();
  });

  it('returns OCM JWT + LiteLLM baseUrl when ocm auth litellm succeeds', () => {
    mockOcmAuth('eyJtest-jwt-token');
    expect(load().getClaudeConfig()).toEqual({
      apiKey: 'eyJtest-jwt-token',
      baseUrl: 'https://llm.atko.ai',
      source: 'ocm',
    });
  });

  it('trims trailing whitespace from OCM auth output', () => {
    mockOcmAuth('eyJtest-jwt-token');
    expect(load().getClaudeConfig()?.apiKey).toBe('eyJtest-jwt-token');
  });

  it('treats empty OCM auth output as not available', () => {
    getSpawnSync().mockReturnValue({ status: 0, stdout: '   \n', stderr: '' });
    expect(load().getClaudeConfig()).toBeNull();
  });

  it('static config with source=static wins over OCM auth', () => {
    mockOcmAuth('eyJocm-token');
    writeStaticConfig({ apiKey: 'sk-static', baseUrl: 'https://custom-endpoint', source: 'static' });

    expect(load().getClaudeConfig()).toEqual({
      apiKey: 'sk-static',
      baseUrl: 'https://custom-endpoint',
      source: 'static',
    });
  });

  it('legacy claude-key.json works when OCM unavailable and no static config', () => {
    writeLegacyKey('sk-legacy');
    expect(load().getClaudeConfig()?.apiKey).toBe('sk-legacy');
  });

  it('env var fallback works when no other source configured', () => {
    process.env.CLAUDE_API_KEY = 'sk-env';
    process.env.CLAUDE_BASE_URL = 'https://env-url';
    expect(load().getClaudeConfig()).toMatchObject({
      apiKey: 'sk-env',
      baseUrl: 'https://env-url',
    });
  });

  it('OCM auth wins over legacy file when no static config exists', () => {
    mockOcmAuth('eyJocm-token');
    writeLegacyKey('sk-legacy');
    expect(load().getClaudeConfig()?.apiKey).toBe('eyJocm-token');
    expect(load().getClaudeConfig()?.source).toBe('ocm');
  });
});

describe('setClaudeConfig', () => {
  it('marks saved config with source=static so it overrides OCM', () => {
    mockOcmAuth('eyJocm-token');
    const mod = load();
    mod.setClaudeConfig({ apiKey: 'sk-user-set', baseUrl: 'https://x' });

    expect(mod.getClaudeConfig()).toEqual({
      apiKey: 'sk-user-set',
      baseUrl: 'https://x',
      source: 'static',
    });
  });
});

describe('removeClaudeConfig', () => {
  it('with no OCM available, removing legacy config returns null', () => {
    writeLegacyKey('sk-legacy');
    const mod = load();
    mod.removeClaudeConfig();
    expect(mod.getClaudeConfig()).toBeNull();
  });

  it('clears static override and falls back to OCM on next read', () => {
    mockOcmAuth('eyJocm-token');
    const mod = load();
    mod.setClaudeConfig({ apiKey: 'sk-user-set' });

    expect(mod.getClaudeConfig()?.source).toBe('static');

    mod.removeClaudeConfig();

    expect(mod.getClaudeConfig()).toEqual({
      apiKey: 'eyJocm-token',
      baseUrl: 'https://llm.atko.ai',
      source: 'ocm',
    });
  });

  it('clears legacy key so OCM is revealed on next read', () => {
    mockOcmAuth('eyJocm-token');
    writeLegacyKey('sk-legacy');
    const mod = load();

    mod.removeClaudeConfig();

    expect(mod.getClaudeConfig()).toEqual({
      apiKey: 'eyJocm-token',
      baseUrl: 'https://llm.atko.ai',
      source: 'ocm',
    });
  });
});

describe('getOcmStatus', () => {
  it('reports available=false when ocm auth fails', () => {
    expect(load().getOcmStatus()).toEqual({ available: false });
  });

  it('reports available=true when ocm auth succeeds', () => {
    mockOcmAuth('eyJocm-token');
    expect(load().getOcmStatus()).toEqual({ available: true });
  });
});
