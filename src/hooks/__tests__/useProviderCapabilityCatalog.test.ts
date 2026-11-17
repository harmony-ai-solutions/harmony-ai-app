/**
 * useProviderCapabilityCatalog — normalization of the engine's tier-2
 * capability registry (`GET /api/providers/capabilities`).
 *
 * The engine answers with `{meta, providers: {<type>: {wire, models: MAP}}}`;
 * the hook exposes the app's flat `{catalog, paramMapping}` view. These tests
 * pin the map→array conversion, the catalog stamps/meta, the wire-derived param
 * mapping (dropped routes excluded), the legacy fallback and the cache/error
 * behaviour.
 */

import { renderHook, waitFor } from '@testing-library/react-native';
import {
  resetProviderCapabilityCatalogCache,
  useProviderCapabilityCatalog,
} from '../useProviderCapabilityCatalog';
import { engineApiClient } from '../../services/engine/EngineApiClient';
import type { ProviderCapabilitiesDto } from '../../services/engine/EngineApiClient';

jest.mock('../../services/engine/EngineApiClient', () => ({
  engineApiClient: {
    getProviderCapabilities: jest.fn(),
  },
}));

const getProviderCapabilities = engineApiClient.getProviderCapabilities as jest.Mock;

/** Engine-shaped payload (`providers/catalog.go:CapabilitiesPayload`). */
const ENGINE_PAYLOAD: ProviderCapabilitiesDto = {
  meta: {
    source: 'soulbits-tier2',
    license: 'CC-BY-4.0',
    snapshot_date: '2026-11-01',
    generator: 'harmony-link/2.4.0',
  },
  providers: {
    openai: {
      wire: {
        seed: { wire: 'seed', route: 'native' },
        max_completion_tokens: { wire: 'max_completion_tokens', route: 'native' },
        // Dropped routes and empty wire names have no provider field.
        presence_penalty: { wire: '', route: 'drop' },
        frequency_penalty: { wire: 'frequency_penalty', route: 'drop' },
      },
      strict: false,
      strict_allowed: ['temperature', 'top_p'],
      temperature_max: 2,
      models: {
        'gpt-4o': {
          label: 'GPT-4o',
          family: 'gpt-4o',
          context: 128000,
          output_limit: 16384,
          modalities: ['text', 'image'],
          capabilities: ['chat', 'tools', 'vision'],
          param_support: ['temperature', 'max_tokens'],
          reasoning_effort: ['low', 'medium', 'high'],
          unsupported_params: ['top_k'],
          status: 'current',
          source: 'curated',
        },
        'gpt-4o-mini': {
          context: 128000,
          modalities: ['text'],
          capabilities: ['chat'],
          status: 'current',
          source: 'tier2',
        },
      },
    },
    soulbitscloud: {
      models: {
        chatterbox: {
          label: 'Chatterbox',
          family: 'chatterbox',
          modalities: ['text', 'audio'],
          capabilities: ['text_to_speech'],
          speech_options: {
            operation_modes: ['single_speaker_tts', 'voice_cloning'],
            supports_voice_cloning: true,
            languages: ['en'],
          },
          status: 'current',
          source: 'curated',
        },
      },
    },
  },
};

beforeEach(() => {
  resetProviderCapabilityCatalogCache();
  getProviderCapabilities.mockReset();
});

describe('useProviderCapabilityCatalog — engine providers payload', () => {
  it('converts each provider model MAP to an id-sorted ModelInfo array', async () => {
    getProviderCapabilities.mockResolvedValue(ENGINE_PAYLOAD);
    const { result } = await renderHook(() => useProviderCapabilityCatalog());

    await waitFor(() => expect(result.current.catalog.openai).toHaveLength(2));
    expect(result.current.catalog.openai.map((m) => m.id)).toEqual(['gpt-4o', 'gpt-4o-mini']);
    expect(result.current.catalog.soulbitscloud.map((m) => m.id)).toEqual(['chatterbox']);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('maps catalog fields, stamps source/provenance and carries the extras in meta', async () => {
    getProviderCapabilities.mockResolvedValue(ENGINE_PAYLOAD);
    const { result } = await renderHook(() => useProviderCapabilityCatalog());

    await waitFor(() => expect(result.current.catalog.openai).toHaveLength(2));
    const gpt = result.current.catalog.openai.find((m) => m.id === 'gpt-4o')!;
    expect(gpt.label).toBe('GPT-4o');
    expect(gpt.context).toBe(128000);
    expect(gpt.output_limit).toBe(16384);
    expect(gpt.modalities).toEqual(['text', 'image']);
    expect(gpt.capabilities).toEqual(['chat', 'tools', 'vision']);
    expect(gpt.param_support).toEqual(['temperature', 'max_tokens']);
    expect(gpt.source).toBe('catalog');
    expect(gpt.provenance).toBe('known');
    expect(gpt.meta).toEqual({
      family: 'gpt-4o',
      status: 'current',
      reasoning_effort: ['low', 'medium', 'high'],
      unsupported_params: ['top_k'],
      source: 'curated',
    });
    // No TTS tree on this model → no `speech_options` key at all.
    expect(gpt.meta).not.toHaveProperty('speech_options');
  });

  it('falls back to the model id when no label is provided', async () => {
    getProviderCapabilities.mockResolvedValue(ENGINE_PAYLOAD);
    const { result } = await renderHook(() => useProviderCapabilityCatalog());

    await waitFor(() => expect(result.current.catalog.openai).toHaveLength(2));
    const mini = result.current.catalog.openai.find((m) => m.id === 'gpt-4o-mini')!;
    expect(mini.label).toBe('gpt-4o-mini');
    expect(mini.meta).toEqual({ status: 'current', source: 'tier2' });
  });

  it('exposes speech_options under meta for TTS catalog entries', async () => {
    getProviderCapabilities.mockResolvedValue(ENGINE_PAYLOAD);
    const { result } = await renderHook(() => useProviderCapabilityCatalog());

    await waitFor(() => expect(result.current.catalog.soulbitscloud).toHaveLength(1));
    const chatterbox = result.current.catalog.soulbitscloud[0];
    expect(chatterbox.capabilities).toEqual(['text_to_speech']);
    expect(chatterbox.meta?.speech_options).toEqual({
      operation_modes: ['single_speaker_tts', 'voice_cloning'],
      supports_voice_cloning: true,
      languages: ['en'],
    });
  });

  it('derives paramMapping from wire, excluding dropped routes / empty wire names', async () => {
    getProviderCapabilities.mockResolvedValue(ENGINE_PAYLOAD);
    const { result } = await renderHook(() => useProviderCapabilityCatalog());

    await waitFor(() => expect(result.current.catalog.openai).toHaveLength(2));
    expect(result.current.paramMapping.openai).toEqual({
      seed: 'seed',
      max_completion_tokens: 'max_completion_tokens',
    });
    expect(result.current.paramMapping.openai).not.toHaveProperty('presence_penalty');
    expect(result.current.paramMapping.openai).not.toHaveProperty('frequency_penalty');
    // A provider without a wire block contributes no mapping entry.
    expect(result.current.paramMapping).not.toHaveProperty('soulbitscloud');
  });

  it('keeps a provider key with an empty list when it declares no models', async () => {
    getProviderCapabilities.mockResolvedValue({
      providers: { mistral: { strict: true } },
    });
    const { result } = await renderHook(() => useProviderCapabilityCatalog());

    await waitFor(() => expect(result.current.catalog.mistral).toEqual([]));
    expect(result.current.paramMapping).toEqual({});
  });

  it('orders rows by catalog status (current → previous → deprecated → other) then id', async () => {
    getProviderCapabilities.mockResolvedValue({
      providers: {
        openai: {
          models: {
            'scribe_v1': { label: 'Scribe v1', status: 'deprecated' },
            'scribe_v3': { label: 'Scribe v3', status: 'current' },
            'scribe_v2': { label: 'Scribe v2', status: 'previous' },
            'zeta-preview': { label: 'Zeta preview', status: 'preview' },
            'alpha-nostatus': { label: 'Alpha' },
          },
        },
      },
    });
    const { result } = await renderHook(() => useProviderCapabilityCatalog());

    await waitFor(() => expect(result.current.catalog.openai).toHaveLength(5));
    expect(result.current.catalog.openai.map((m) => m.id)).toEqual([
      'scribe_v3',
      'scribe_v2',
      'scribe_v1',
      'alpha-nostatus',
      'zeta-preview',
    ]);
  });

  it('serves the cached registry to a second mount (one request)', async () => {
    getProviderCapabilities.mockResolvedValue(ENGINE_PAYLOAD);
    await renderHook(() => useProviderCapabilityCatalog());
    await waitFor(() => expect(getProviderCapabilities).toHaveBeenCalledTimes(1));

    const { result } = await renderHook(() => useProviderCapabilityCatalog());
    await waitFor(() => expect(result.current.catalog.openai).toHaveLength(2));
    expect(getProviderCapabilities).toHaveBeenCalledTimes(1);
  });

  it('surfaces a fetch error and keeps an empty catalog (never throws)', async () => {
    getProviderCapabilities.mockRejectedValue(new Error('engine down'));
    const { result } = await renderHook(() => useProviderCapabilityCatalog());

    await waitFor(() => expect(result.current.error).toBe('engine down'));
    expect(result.current.catalog).toEqual({});
    expect(result.current.paramMapping).toEqual({});
  });
});

describe('useProviderCapabilityCatalog — legacy payload fallback', () => {
  it('uses catalog/param_mapping when providers is absent', async () => {
    getProviderCapabilities.mockResolvedValue({
      catalog: { openai: [{ id: 'gpt-4o', label: 'GPT-4o', source: 'catalog' }] },
      param_mapping: { mistral: { seed: 'random_seed' } },
    } satisfies ProviderCapabilitiesDto);
    const { result } = await renderHook(() => useProviderCapabilityCatalog());

    await waitFor(() => expect(result.current.catalog.openai).toHaveLength(1));
    expect(result.current.catalog.openai[0].id).toBe('gpt-4o');
    expect(result.current.paramMapping.mistral).toEqual({ seed: 'random_seed' });
  });

  it('degrades to empty maps on an empty/missing response', async () => {
    getProviderCapabilities.mockResolvedValue(undefined);
    const { result } = await renderHook(() => useProviderCapabilityCatalog());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.catalog).toEqual({});
    expect(result.current.paramMapping).toEqual({});
  });
});

describe('useProviderCapabilityCatalog — kinded audio tags (tts-voice-ux Phase 1)', () => {
  const AUDIO_TAGS = {
    syntax: '[{}]',
    cues: { mode: 'open', vocabulary: ['laughs', 'sighs'] },
    tones: { mode: 'open', vocabulary: ['whispers'] },
    breaks: { mode: 'open', vocabulary: ['pause'] },
  };

  it('copies audio_tags into meta.audio_tags only when present', async () => {
    getProviderCapabilities.mockResolvedValue({
      providers: {
        elevenlabs: {
          models: {
            eleven_v3: {
              label: 'Eleven v3',
              capabilities: ['text_to_speech'],
              audio_tags: AUDIO_TAGS,
              status: 'current',
            },
            eleven_multilingual_v2: {
              label: 'Eleven Multilingual v2',
              capabilities: ['text_to_speech'],
              status: 'current',
            },
          },
        },
      },
    } satisfies ProviderCapabilitiesDto);
    const { result } = await renderHook(() => useProviderCapabilityCatalog());

    await waitFor(() => expect(result.current.catalog.elevenlabs).toHaveLength(2));
    const tagged = result.current.catalog.elevenlabs.find((m) => m.id === 'eleven_v3')!;
    expect(tagged.meta?.audio_tags).toEqual(AUDIO_TAGS);
    // The block survives normalization verbatim (no key renaming/reshaping).
    expect(Object.keys(tagged.meta?.audio_tags as object)).toEqual([
      'syntax',
      'cues',
      'tones',
      'breaks',
    ]);

    const tagFree = result.current.catalog.elevenlabs.find(
      (m) => m.id === 'eleven_multilingual_v2',
    )!;
    expect(tagFree.meta).not.toHaveProperty('audio_tags');
  });
});
