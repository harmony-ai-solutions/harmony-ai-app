// Mock the public catalog client BEFORE importing the service. The service
// builds a credential-less client at module-load time, so we construct the
// listModelsOrThrow fn INSIDE the factory and stash it on the module exports
// (the outer-scope `mock`-prefix trick does not guarantee init-before-import).
jest.mock('@harmony-ai-solutions/soulbits-api-client', () => {
  const listModelsOrThrow = jest.fn();
  return {
    createClient: () => ({ models: { listModelsOrThrow } }),
    __listModelsOrThrow: listModelsOrThrow,
  };
});

// Silence the async logger transport so it doesn't emit after tests finish.
jest.mock('../../../utils/logger', () => ({
  createLogger: () => ({
    warn: jest.fn(),
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }),
}));

import * as SoulbitsClient from '@harmony-ai-solutions/soulbits-api-client';
import {
  fetchModelsForModule,
  clearModelsCache,
} from '../soulbitsModelsCatalog';

const mockListModelsOrThrow = (SoulbitsClient as any)
  .__listModelsOrThrow as jest.Mock;

beforeEach(() => {
  clearModelsCache();
  mockListModelsOrThrow.mockReset();
});

describe('fetchModelsForModule', () => {
  it('returns live models mapped to {id,name} on success', async () => {
    mockListModelsOrThrow.mockResolvedValue([
      {
        model_id: 'soulchat-v1',
        display_name: 'SoulChat v1',
        model_type: 'llm',
        min_tier: 'free',
        description: 'chat model',
      },
    ]);

    const result = await fetchModelsForModule('backend');

    expect(result.source).toBe('live');
    expect(result.models).toEqual([
      { id: 'soulchat-v1', name: 'SoulChat v1', description: 'chat model' },
    ]);
    expect(mockListModelsOrThrow).toHaveBeenCalledTimes(1);
    expect(mockListModelsOrThrow).toHaveBeenCalledWith({ model_type: 'llm' });
  });

  it('serves a second call within TTL from cache (no extra request)', async () => {
    mockListModelsOrThrow.mockResolvedValue([
      {
        model_id: 'm1',
        display_name: 'M1',
        model_type: 'llm',
        min_tier: 'free',
        description: '',
      },
    ]);

    await fetchModelsForModule('backend');
    const second = await fetchModelsForModule('backend');

    expect(second.source).toBe('live');
    expect(mockListModelsOrThrow).toHaveBeenCalledTimes(1);
  });

  it('falls back to the static list when the client throws', async () => {
    mockListModelsOrThrow.mockRejectedValue(new Error('network down'));

    const result = await fetchModelsForModule('backend');

    expect(result.source).toBe('fallback');
    expect(result.models).toEqual([{ id: 'soulchat-v1' }]);
  });

  it('falls back when the live catalog returns an empty array', async () => {
    mockListModelsOrThrow.mockResolvedValue([]);

    const result = await fetchModelsForModule('backend');

    expect(result.source).toBe('fallback');
    expect(result.models.length).toBeGreaterThan(0);
  });

  it('returns fallback for an unmapped module type without calling the client', async () => {
    const result = await fetchModelsForModule('not-a-real-module');

    expect(result.source).toBe('fallback');
    expect(mockListModelsOrThrow).not.toHaveBeenCalled();
  });

  it('never throws — always resolves', async () => {
    mockListModelsOrThrow.mockRejectedValue(new Error('boom'));
    await expect(fetchModelsForModule('tts')).resolves.toBeDefined();
  });
});

describe('clearModelsCache', () => {
  it('is a no-throw synchronous function', () => {
    expect(() => clearModelsCache()).not.toThrow();
  });
});
