jest.mock('electron', () => ({ app: { getPath: () => '/tmp' } }));
jest.mock('child_process', () => ({ spawnSync: jest.fn() }));

const create = jest.fn();
const list = jest.fn();
jest.mock('@anthropic-ai/sdk', () => {
  class APIError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  }
  const Anthropic: any = jest.fn().mockImplementation(() => ({ baseURL: 'https://gw', messages: { create }, models: { list } }));
  Anthropic.APIError = APIError;
  return { __esModule: true, default: Anthropic };
});

const modelDenied = () => {
  const Anthropic = require('@anthropic-ai/sdk').default;
  return new Anthropic.APIError(
    403,
    `403 {"error":{"message":"The requested model 'x' is not available for this API key, or the model name is invalid.","type":"team_model_access_denied","param":"model","code":"403"}}`,
  );
};

function load() {
  return require('../main/api/claude');
}

beforeEach(() => {
  create.mockReset();
  list.mockReset();
  list.mockRejectedValue(new Error('no list')); // default: lookup unavailable, blind chain
  jest.resetModules();
  process.env.CLAUDE_API_KEY = 'sk-test';
});

afterAll(() => {
  delete process.env.CLAUDE_API_KEY;
});

const params = { max_tokens: 8, messages: [{ role: 'user' as const, content: 'hi' }] };

describe('createMessage model fallback', () => {
  it('uses the first model when it works', async () => {
    create.mockResolvedValue({ ok: true });
    await load().createMessage(params);
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0].model).toBe(load().MODEL_CHAIN[0]);
  });

  it('falls through to the next model on a model-access error', async () => {
    create.mockRejectedValueOnce(modelDenied()).mockResolvedValueOnce({ ok: true });
    const mod = load();
    await mod.createMessage(params);
    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[1][0].model).toBe(mod.MODEL_CHAIN[1]);
  });

  it('does not fall back on unrelated errors', async () => {
    const Anthropic = require('@anthropic-ai/sdk').default;
    create.mockRejectedValue(new Anthropic.APIError(401, 'invalid token'));
    await expect(load().createMessage(params)).rejects.toThrow('invalid token');
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('throws a clear error when every model is denied', async () => {
    create.mockRejectedValue(modelDenied());
    const mod = load();
    await expect(mod.createMessage(params)).rejects.toThrow(/No available Claude model/);
    expect(create).toHaveBeenCalledTimes(mod.MODEL_CHAIN.length);
  });

  describe('live model discovery', () => {
    it('skips chain models the gateway does not offer', async () => {
      list.mockResolvedValue({ data: [{ id: 'claude-sonnet-5' }, { id: 'gpt-6-sol' }] });
      create.mockResolvedValue({ ok: true });
      await load().createMessage(params);
      expect(create).toHaveBeenCalledTimes(1);
      expect(create.mock.calls[0][0].model).toBe('claude-sonnet-5');
    });

    it('uses a newer sonnet the chain does not know about when the chain is gone', async () => {
      list.mockResolvedValue({ data: [{ id: 'claude-sonnet-6' }, { id: 'claude-sonnet-5-9' }, { id: 'claude-opus-5' }] });
      create.mockResolvedValue({ ok: true });
      await load().createMessage(params);
      expect(create.mock.calls[0][0].model).toBe('claude-sonnet-6');
    });

    it('caches the model list across calls', async () => {
      list.mockResolvedValue({ data: [{ id: 'claude-sonnet-5-5' }] });
      create.mockResolvedValue({ ok: true });
      const mod = load();
      await mod.createMessage(params);
      await mod.createMessage(params);
      expect(list).toHaveBeenCalledTimes(1);
    });

    it('errors clearly when the gateway offers no usable Claude model', async () => {
      list.mockResolvedValue({ data: [{ id: 'gpt-6-sol' }] });
      await expect(load().createMessage(params)).rejects.toThrow(/gateway offers no supported Claude model/);
      expect(create).not.toHaveBeenCalled();
    });
  });
});
