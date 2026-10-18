import {
  MODULE_TYPES,
  STT_SLOT_PROVIDER_OPTIONS,
} from '../moduleConfiguration';
import { SOULBITS_MODEL_QUERY } from '../soulbitsModels';

describe('moduleConfiguration — provider list consistency', () => {
  it('lists the Soulbits Cloud provider for every module that has a Soulbits model catalog', () => {
    // Every module type that has a Soulbits model query MUST also expose the
    // Soulbits Cloud provider chip. This keeps the provider list and the model
    // catalog in sync (regression guard for Dom's feedback that STT/VAD were
    // missing Soulbits even though it is supported).
    for (const module of MODULE_TYPES) {
      if (SOULBITS_MODEL_QUERY[module.id]) {
        const hasSoulbits = module.providerOptions.some(p => p.id === 'soulbitscloud');
        expect(
          hasSoulbits,
        ).toBe(true);
      }
    }
  });

  it('has unique provider ids per module', () => {
    for (const module of MODULE_TYPES) {
      const ids = module.providerOptions.map(p => p.id);
      const unique = new Set(ids);
      expect(unique.size).toBe(ids.length);
    }
  });

  it('every provider option has a name and icon', () => {
    for (const module of MODULE_TYPES) {
      for (const provider of module.providerOptions) {
        expect(typeof provider.name).toBe('string');
        expect(provider.name.length).toBeGreaterThan(0);
        expect(typeof provider.icon).toBe('string');
      }
    }
  });
});

/**
 * Provider → module-type expectation map for the reactivated providers
 * (provider-registry 6-5 step 4). Deliberately a NEW, explicit map — it does
 * NOT extend the SOULBITS_MODEL_QUERY-gated loop above (which is
 * soulbitscloud-specific), so the picker reach of mistral/ollama/localai is
 * pinned directly.
 */
const REACTIVATED_PROVIDER_MODULES: Record<string, string[]> = {
  // Mistral: chat + embeddings only — NO tts/stt (audit: 4-7 builds no STT
  // client; Voxtral is out of engine scope) and no imagination.
  mistral: ['backend', 'cognition', 'movement', 'vision', 'rag'],
  // Ollama: chat family + rag, plus the STT transcription slot only
  // (R-AUDIO: `/v1/audio/transcriptions` exists — no tts, no VAD).
  ollama: ['backend', 'cognition', 'movement', 'vision', 'rag', 'stt'],
  // LocalAI: same set as openaicompatible.
  localai: ['backend', 'cognition', 'movement', 'rag', 'stt', 'tts', 'vision'],
};

describe('moduleConfiguration — reactivated providers (6-5)', () => {
  it('lists each reactivated provider in exactly the expected modules', () => {
    for (const [providerId, expectedModules] of Object.entries(REACTIVATED_PROVIDER_MODULES)) {
      const actualModules = MODULE_TYPES.filter(m =>
        m.providerOptions.some(p => p.id === providerId),
      )
        .map(m => m.id)
        .sort();
      expect(actualModules).toEqual([...expectedModules].sort());
    }
  });

  it('does not offer mistral for tts or stt', () => {
    const withMistral = MODULE_TYPES.filter(m =>
      m.providerOptions.some(p => p.id === 'mistral'),
    ).map(m => m.id);
    expect(withMistral).not.toContain('tts');
    expect(withMistral).not.toContain('stt');
  });

  it('does not offer ollama for tts (R-AUDIO: no stock TTS endpoint)', () => {
    const withOllama = MODULE_TYPES.filter(m =>
      m.providerOptions.some(p => p.id === 'ollama'),
    ).map(m => m.id);
    expect(withOllama).not.toContain('tts');
    expect(withOllama).not.toContain('imagination');
  });
});

describe('moduleConfiguration — STT per-slot provider lists (6-5 step 2 / A11 / R-AUDIO)', () => {
  it('transcription offers the five existing clients + soulvoice + ollama + localai', () => {
    expect(STT_SLOT_PROVIDER_OPTIONS.transcription.map(p => p.id)).toEqual([
      'openai',
      'openaicompatible',
      'openrouter',
      'soulbitscloud',
      'elevenlabs',
      'soulvoice',
      'ollama',
      'localai',
    ]);
  });

  it('VAD offers ONLY the providers with real VAD client implementations', () => {
    expect(STT_SLOT_PROVIDER_OPTIONS.vad.map(p => p.id)).toEqual([
      'soulbitscloud',
      'soulvoice',
    ]);
  });

  it('labels ollama as experimental in the transcription list (R-AUDIO)', () => {
    const ollama = STT_SLOT_PROVIDER_OPTIONS.transcription.find(p => p.id === 'ollama');
    expect(ollama?.name).toMatch(/experimental/i);
  });

  it('does not offer ollama or localai for VAD', () => {
    const vadIds = STT_SLOT_PROVIDER_OPTIONS.vad.map(p => p.id);
    expect(vadIds).not.toContain('ollama');
    expect(vadIds).not.toContain('localai');
    expect(vadIds).not.toContain('openai');
    expect(vadIds).not.toContain('elevenlabs');
  });

  it('the stt module base list mirrors the transcription slot', () => {
    const stt = MODULE_TYPES.find(m => m.id === 'stt');
    expect(stt?.providerOptions.map(p => p.id)).toEqual(
      STT_SLOT_PROVIDER_OPTIONS.transcription.map(p => p.id),
    );
  });
});
