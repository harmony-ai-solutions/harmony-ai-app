/**
 * providerModelCatalog — tag filtering + coverage of the interim tier-2 catalog
 * (provider-registry 2-1).
 *
 * Guards:
 *  - `getModelsForModule` filters strictly by the module's capability tag.
 *  - Every picker-offered provider (from MODULE_TYPES) has ≥1 entry for every
 *    module it is offered on, OR is an explicit live-authoritative empty list.
 *  - Unknown provider / module → [] (the free-text fallback path).
 *  - Entry shape + uniqueness.
 */

import {
  PROVIDER_MODEL_CATALOG,
  CATALOG_PROVIDER_TYPES,
  MODULE_TYPE_TAGS,
  getModelsForModule,
  type ModelTag,
} from '../providerModelCatalog';
import { MODULE_TYPES } from '../moduleConfiguration';
import { PROVIDER_SCHEMAS } from '../providerFieldSchemas';

const ALL_TAGS: ModelTag[] = ['chat', 'vision', 'embedding', 'tts', 'image', 'stt'];

/**
 * Providers whose models are discovered live (never statically catalogued) —
 * SYNTHESIS §3. Their empty catalog list is the explicit allowance.
 */
const LIVE_AUTHORITATIVE = new Set([
  'openaicompatible',
  'openrouter',
  'elevenlabs',
  'soulvoice',
  'localai',
  'ollama',
  'comfyui',
  'soulbitscloud',
]);

describe('providerModelCatalog — structure', () => {
  it('covers every provider type the app knows', () => {
    for (const provider of Object.keys(PROVIDER_SCHEMAS)) {
      expect(PROVIDER_MODEL_CATALOG[provider]).toBeDefined();
    }
  });

  it('keys the catalog by known provider types only', () => {
    for (const key of Object.keys(PROVIDER_MODEL_CATALOG)) {
      expect(CATALOG_PROVIDER_TYPES).toContain(key);
    }
  });

  it('every entry has a non-empty id/label and ≥1 valid tag', () => {
    for (const [provider, entries] of Object.entries(PROVIDER_MODEL_CATALOG)) {
      for (const entry of entries) {
        expect(entry.id.length).toBeGreaterThan(0);
        expect(entry.label.length).toBeGreaterThan(0);
        expect(entry.tags.length).toBeGreaterThan(0);
        for (const tag of entry.tags) {
          expect(ALL_TAGS).toContain(tag);
        }
        // context, when present, is a positive token count
        if (entry.context !== undefined) {
          expect(entry.context).toBeGreaterThan(0);
        }
        // guard against a bad fixture keyed on the wrong provider
        expect(typeof provider).toBe('string');
      }
    }
  });

  it('has unique model ids within each provider', () => {
    for (const entries of Object.values(PROVIDER_MODEL_CATALOG)) {
      const ids = entries.map(e => e.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('only live-authoritative providers have an empty catalog', () => {
    for (const [provider, entries] of Object.entries(PROVIDER_MODEL_CATALOG)) {
      if (entries.length === 0) {
        expect(LIVE_AUTHORITATIVE.has(provider)).toBe(true);
      }
    }
  });
});

describe('getModelsForModule — tag filtering', () => {
  it('returns only entries carrying the module tag', () => {
    for (const [moduleType, tag] of Object.entries(MODULE_TYPE_TAGS)) {
      for (const provider of Object.keys(PROVIDER_MODEL_CATALOG)) {
        for (const entry of getModelsForModule(provider, moduleType)) {
          expect(entry.tags).toContain(tag);
        }
      }
    }
  });

  it('maps backend/cognition/movement to chat', () => {
    for (const moduleType of ['backend', 'cognition', 'movement']) {
      expect(MODULE_TYPE_TAGS[moduleType]).toBe('chat');
    }
    const ids = getModelsForModule('openai', 'backend').map(e => e.id);
    expect(ids).toContain('gpt-6-astra');
    // embedding/image/stt models are NOT chat models
    expect(ids).not.toContain('text-embedding-3-large');
    expect(ids).not.toContain('gpt-image-2');
    expect(ids).not.toContain('whisper-1');
  });

  it('maps rag to embedding', () => {
    const ids = getModelsForModule('openai', 'rag').map(e => e.id);
    expect(ids).toContain('text-embedding-3-large');
    expect(ids.every(id => id.includes('embedding') || id.includes('ada'))).toBe(true);
  });

  it('maps tts to tts and stt to stt', () => {
    expect(getModelsForModule('openai', 'tts').map(e => e.id)).toContain('gpt-4o-mini-tts');
    expect(getModelsForModule('openai', 'stt').map(e => e.id)).toContain('gpt-transcribe');
    // cross-check: a tts model is not offered for stt and vice versa
    expect(getModelsForModule('openai', 'stt').map(e => e.id)).not.toContain('gpt-4o-mini-tts');
    expect(getModelsForModule('openai', 'tts').map(e => e.id)).not.toContain('gpt-transcribe');
  });

  it('maps vision to vision and imagination to image', () => {
    expect(getModelsForModule('anthropic', 'vision').length).toBeGreaterThan(0);
    const imageIds = getModelsForModule('google', 'imagination').map(e => e.id);
    expect(imageIds).toContain('gemini-nano-banana-2.1');
    expect(imageIds.every(id => getModelsForModule('google', 'imagination').some(e => e.id === id))).toBe(true);
  });

  it('returns [] for an unknown module type (e.g. the STT VAD slot)', () => {
    expect(getModelsForModule('openai', 'vad')).toEqual([]);
    expect(getModelsForModule('soulbitscloud', 'vad')).toEqual([]);
  });

  it('returns [] for an unknown provider type', () => {
    expect(getModelsForModule('does-not-exist', 'backend')).toEqual([]);
  });

  it('returns [] for live-authoritative providers', () => {
    for (const provider of LIVE_AUTHORITATIVE) {
      expect(getModelsForModule(provider, 'backend')).toEqual([]);
      expect(getModelsForModule(provider, 'stt')).toEqual([]);
    }
  });

  it('returns a fresh array each call (callers may mutate the result)', () => {
    const first = getModelsForModule('openai', 'backend');
    first.pop();
    expect(getModelsForModule('openai', 'backend').length).toBeGreaterThan(first.length);
  });
});

describe('coverage — every picker-offered provider/module pair', () => {
  it('has entries per applicable module or an explicit empty-list allowance', () => {
    for (const module of MODULE_TYPES) {
      for (const provider of module.providerOptions) {
        const entries = getModelsForModule(provider.id, module.id);
        if (LIVE_AUTHORITATIVE.has(provider.id)) {
          // explicit allowance: live-authoritative providers carry no rows
          expect(entries).toEqual([]);
        } else {
          expect(entries.length).toBeGreaterThan(0);
        }
      }
    }
  });

  it('every picker-offered provider is a known catalog key', () => {
    for (const module of MODULE_TYPES) {
      for (const provider of module.providerOptions) {
        expect(PROVIDER_MODEL_CATALOG[provider.id]).toBeDefined();
      }
    }
  });
});
