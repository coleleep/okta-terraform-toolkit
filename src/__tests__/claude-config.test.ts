import * as fs from 'fs';
import * as path from 'path';
import * as realOs from 'os';

const TMP_USER_DATA = fs.mkdtempSync(path.join(realOs.tmpdir(), 'otto-userdata-'));
const TMP_HOME = fs.mkdtempSync(path.join(realOs.tmpdir(), 'otto-home-'));

jest.mock('electron', () => ({
  app: {
    getPath: (name: string) => {
      if (name === 'userData') return TMP_USER_DATA;
      throw new Error(`unexpected getPath: ${name}`);
    },
  },
}));

jest.mock('os', () => {
  const actual = jest.requireActual('os');
  return { ...actual, homedir: () => TMP_HOME };
});

function ocmKeyDir() {
  return path.join(TMP_HOME, '.config', 'ocm');
}

function writeOcmKey(content: string) {
  fs.mkdirSync(ocmKeyDir(), { recursive: true });
  fs.writeFileSync(path.join(ocmKeyDir(), 'litellm_key'), content);
}

function writeStaticConfig(data: object) {
  fs.writeFileSync(path.join(TMP_USER_DATA, 'claude-config.json'), JSON.stringify(data));
}

function writeLegacyKey(apiKey: string) {
  fs.writeFileSync(path.join(TMP_USER_DATA, 'claude-key.json'), JSON.stringify({ apiKey }));
}

beforeEach(() => {
  fs.rmSync(TMP_USER_DATA, { recursive: true, force: true });
  fs.rmSync(TMP_HOME, { recursive: true, force: true });
  fs.mkdirSync(TMP_USER_DATA, { recursive: true });
  fs.mkdirSync(TMP_HOME, { recursive: true });
  delete process.env.CLAUDE_API_KEY;
  delete process.env.CLAUDE_BASE_URL;
  jest.resetModules();
});

afterAll(() => {
  fs.rmSync(TMP_USER_DATA, { recursive: true, force: true });
  fs.rmSync(TMP_HOME, { recursive: true, force: true });
});

function load() {
  return require('../main/api/claude');
}

describe('getClaudeConfig priority', () => {
  it('returns null when nothing is configured', () => {
    expect(load().getClaudeConfig()).toBeNull();
  });

  it('returns OCM key + LiteLLM baseUrl when OCM key file exists', () => {
    writeOcmKey('sk-ocm-test-key');
    expect(load().getClaudeConfig()).toEqual({
      apiKey: 'sk-ocm-test-key',
      baseUrl: 'https://llm.atko.ai',
      source: 'ocm',
    });
  });

  it('trims trailing whitespace and newlines from OCM key file', () => {
    writeOcmKey('sk-ocm-test-key\n');
    expect(load().getClaudeConfig()?.apiKey).toBe('sk-ocm-test-key');
  });

  it('treats empty OCM key file as not configured', () => {
    writeOcmKey('');
    expect(load().getClaudeConfig()).toBeNull();
  });

  it('static config with source=static wins over OCM key', () => {
    writeOcmKey('sk-ocm');
    writeStaticConfig({ apiKey: 'sk-static', baseUrl: 'https://custom-endpoint', source: 'static' });

    expect(load().getClaudeConfig()).toEqual({
      apiKey: 'sk-static',
      baseUrl: 'https://custom-endpoint',
      source: 'static',
    });
  });

  it('legacy claude-key.json works when no OCM key and no static config', () => {
    writeLegacyKey('sk-legacy');
    expect(load().getClaudeConfig()?.apiKey).toBe('sk-legacy');
  });

  it('env var fallback works when no files exist', () => {
    process.env.CLAUDE_API_KEY = 'sk-env';
    process.env.CLAUDE_BASE_URL = 'https://env-url';
    expect(load().getClaudeConfig()).toMatchObject({
      apiKey: 'sk-env',
      baseUrl: 'https://env-url',
    });
  });

  it('OCM key wins over legacy file when no static config exists', () => {
    writeOcmKey('sk-ocm');
    writeLegacyKey('sk-legacy');
    expect(load().getClaudeConfig()?.apiKey).toBe('sk-ocm');
    expect(load().getClaudeConfig()?.source).toBe('ocm');
  });
});

describe('setClaudeConfig', () => {
  it('marks saved config with source=static so it overrides OCM', () => {
    const mod = load();
    mod.setClaudeConfig({ apiKey: 'sk-user-set', baseUrl: 'https://x' });

    writeOcmKey('sk-ocm');
    expect(mod.getClaudeConfig()).toEqual({
      apiKey: 'sk-user-set',
      baseUrl: 'https://x',
      source: 'static',
    });
  });
});

describe('removeClaudeConfig', () => {
  it('clears legacy claude-key.json so OCM key is revealed', () => {
    writeLegacyKey('sk-legacy');
    writeOcmKey('sk-ocm');
    const mod = load();

    expect(mod.getClaudeConfig()?.source).toBe('ocm');

    mod.removeClaudeConfig();

    // legacy file should also be gone — nothing left to return except OCM
    expect(mod.getClaudeConfig()).toEqual({
      apiKey: 'sk-ocm',
      baseUrl: 'https://llm.atko.ai',
      source: 'ocm',
    });
  });

  it('with no OCM key, removing legacy config returns null', () => {
    writeLegacyKey('sk-legacy');
    const mod = load();
    mod.removeClaudeConfig();
    expect(mod.getClaudeConfig()).toBeNull();
  });

  it('clears static override and reveals OCM key on next read', () => {
    const mod = load();
    mod.setClaudeConfig({ apiKey: 'sk-user-set' });
    writeOcmKey('sk-ocm');

    expect(mod.getClaudeConfig()?.source).toBe('static');

    mod.removeClaudeConfig();

    expect(mod.getClaudeConfig()).toEqual({
      apiKey: 'sk-ocm',
      baseUrl: 'https://llm.atko.ai',
      source: 'ocm',
    });
  });
});

describe('getOcmStatus', () => {
  it('reports fileExists=false and the canonical path when OCM key absent', () => {
    const status = load().getOcmStatus();
    expect(status.fileExists).toBe(false);
    expect(status.path).toBe(path.join(TMP_HOME, '.config', 'ocm', 'litellm_key'));
  });

  it('reports fileExists=true when OCM key file is present', () => {
    writeOcmKey('sk-ocm');
    const status = load().getOcmStatus();
    expect(status.fileExists).toBe(true);
  });
});
