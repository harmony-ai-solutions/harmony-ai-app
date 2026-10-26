/**
 * modelCapabilities — pure helpers over the engine's ModelInfo (provider-registry
 * 6-3): offline catalog module filtering + the R12 param-support warnings.
 */

import {
  MODULE_CAPABILITY_TAGS,
  catalogModelsForModule,
  getSpeechOptions,
  isSamplingParamKey,
  isParamSupported,
  partitionFieldsBySupport,
  resolveEffectiveSpeechOptions,
  supportedParams,
  findModel,
} from '../modelCapabilities';
import type { ModelInfoDto } from '../../services/engine/EngineApiClient';

const chat: ModelInfoDto = { id: 'chat-1', capabilities: ['chat'] };
const embed: ModelInfoDto = { id: 'embed-1', capabilities: ['embedding'] };
const unknown: ModelInfoDto = { id: 'unknown-1' };
const noTemp: ModelInfoDto = { id: 'notemp-1', capabilities: ['chat'], param_support: ['top_p'] };
// The R12 regression: capabilities DECLARED, param_support absent. Modality tags
// must never be treated as a param set.
const visionOnly: ModelInfoDto = { id: 'vision-1', capabilities: ['vision'] };

describe('catalogModelsForModule', () => {
  const models = [chat, embed, unknown];

  it('keeps models carrying the module tag and models with no declared tags', () => {
    const ids = catalogModelsForModule(models, 'backend').map((m) => m.id);
    expect(ids).toContain('chat-1');
    expect(ids).toContain('unknown-1');
    expect(ids).not.toContain('embed-1');
  });

  it('maps rag → embedding', () => {
    expect(MODULE_CAPABILITY_TAGS.rag).toBe('embedding');
    expect(catalogModelsForModule(models, 'rag').map((m) => m.id)).toContain('embed-1');
  });

  it('returns [] for an unknown module (the STT VAD slot is live-only)', () => {
    expect(catalogModelsForModule(models, 'vad')).toEqual([]);
  });

  it('handles a null/undefined list', () => {
    expect(catalogModelsForModule(null, 'backend')).toEqual([]);
    expect(catalogModelsForModule(undefined, 'backend')).toEqual([]);
  });
});

describe('param support (R12 warnings)', () => {
  it('classifies the sampling-param keys', () => {
    expect(isSamplingParamKey('temperature')).toBe(true);
    expect(isSamplingParamKey('top_p')).toBe(true);
    expect(isSamplingParamKey('model')).toBe(false);
    expect(isSamplingParamKey('voice_id')).toBe(false);
  });

  it('returns null (no warning) when the model declares no param set', () => {
    expect(supportedParams(unknown)).toBeNull();
    expect(isParamSupported(unknown, 'temperature')).toBeNull();
    expect(isParamSupported(undefined, 'temperature')).toBeNull();
  });

  it('ignores capabilities (modality tags are not a param set) — R12 regression', () => {
    expect(supportedParams(visionOnly)).toBeNull();
    expect(isParamSupported(visionOnly, 'temperature')).toBeNull();
    expect(isParamSupported(visionOnly, 'vision')).toBeNull();
  });

  it('warns only when a declared set omits the param', () => {
    expect(isParamSupported(noTemp, 'top_p')).toBe(true);
    expect(isParamSupported(noTemp, 'temperature')).toBe(false);
  });

  it('treats the completion-token aliases as ONE logical param', () => {
    const legacyTokens: ModelInfoDto = {
      id: 'tokens-1',
      capabilities: ['chat'],
      param_support: ['max_tokens'],
    };
    expect(isParamSupported(legacyTokens, 'max_completion_tokens')).toBe(true);
    expect(isParamSupported(legacyTokens, 'max_tokens')).toBe(true);
    expect(isParamSupported(legacyTokens, 'temperature')).toBe(false);

    const canonicalTokens: ModelInfoDto = {
      id: 'tokens-2',
      capabilities: ['chat'],
      param_support: ['max_completion_tokens'],
    };
    expect(isParamSupported(canonicalTokens, 'num_predict')).toBe(true);
  });
});

describe('partitionFieldsBySupport', () => {
  const fields = [{ key: 'temperature' }, { key: 'top_p' }, { key: 'model' }];

  it('keeps every field supported when the model declares no param set', () => {
    expect(partitionFieldsBySupport(fields, unknown)).toEqual({
      supportedFields: fields,
      unsupportedFields: [],
    });
    expect(partitionFieldsBySupport(fields, visionOnly).unsupportedFields).toEqual([]);
    expect(partitionFieldsBySupport(fields, undefined).unsupportedFields).toEqual([]);
  });

  it('splits a declared set into supported and unsupported fields', () => {
    const { supportedFields, unsupportedFields } = partitionFieldsBySupport(fields, noTemp);
    expect(supportedFields.map((f) => f.key)).toEqual(['top_p']);
    expect(unsupportedFields.map((f) => f.key)).toEqual(['temperature', 'model']);
  });

  it('keeps the canonical completion-token field supported when the model declares an alias', () => {
    const tokenFields = [{ key: 'max_completion_tokens' }, { key: 'temperature' }];
    const legacyTokens: ModelInfoDto = {
      id: 'tokens-1',
      capabilities: ['chat'],
      param_support: ['max_tokens'],
    };
    const { supportedFields, unsupportedFields } = partitionFieldsBySupport(
      tokenFields,
      legacyTokens,
    );
    expect(supportedFields.map((f) => f.key)).toEqual(['max_completion_tokens']);
    expect(unsupportedFields.map((f) => f.key)).toEqual(['temperature']);
  });
});

describe('getSpeechOptions', () => {
  it('reads meta.speech_options', () => {
    const model: ModelInfoDto = {
      id: 'tts-1',
      capabilities: ['tts'],
      meta: { speech_options: { operation_modes: ['voice_design'], languages: ['en'] } },
    };
    expect(getSpeechOptions(model)).toEqual({
      operation_modes: ['voice_design'],
      languages: ['en'],
    });
  });

  it('returns null when absent', () => {
    expect(getSpeechOptions(unknown)).toBeNull();
    expect(getSpeechOptions(undefined)).toBeNull();
    expect(getSpeechOptions({ id: 'x', meta: { speech_options: 'nope' } })).toBeNull();
  });
});

describe('resolveEffectiveSpeechOptions', () => {
  it('only advertises voice_cloning for families that can actually clone', () => {
    // Offline catalog (no declared metadata): the slug decides the family.
    const kitten = resolveEffectiveSpeechOptions(undefined, 'kitten-tts-mini', 'soulbitscloud');
    expect(kitten?.supports_voice_cloning).toBe(false);
    expect(kitten?.operation_modes).toEqual(['single_speaker_tts']);
    expect(kitten?.supported_generation_params).toEqual(['speed']);

    // An unknown model must not get a cloning CTA either (the TTS voice
    // picker shows a "use Voice Cloning" hint based on these flags).
    const unknownTts = resolveEffectiveSpeechOptions(undefined, 'ghost-tts', 'soulbitscloud');
    expect(unknownTts?.supports_voice_cloning).toBe(false);
    expect(unknownTts?.operation_modes).toEqual(['single_speaker_tts']);

    // Chatterbox + HarmonySpeech do clone via embeddings.
    for (const id of ['chatterbox', 'harmonyspeech']) {
      const options = resolveEffectiveSpeechOptions(undefined, id, 'soulbitscloud');
      expect(options?.supports_voice_cloning).toBe(true);
      expect(options?.operation_modes).toContain('voice_cloning');
    }
  });
});

describe('findModel', () => {
  it('finds by id and tolerates a null id', () => {
    expect(findModel([chat, embed], 'embed-1')?.id).toBe('embed-1');
    expect(findModel([chat], null)).toBeUndefined();
    expect(findModel(null, 'chat-1')).toBeUndefined();
  });
});
