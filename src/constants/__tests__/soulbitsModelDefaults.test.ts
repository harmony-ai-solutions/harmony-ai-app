/**
 * soulbitsModelDefaults — per-model default capability values for the
 * soulbitscloud provider (research/soulbits-model-defaults.md).
 *
 * Core invariants under test:
 *  - defaults never contain a key the model REJECTS (HSE raises on
 *    cross-family params — `0`/`false` are just as fatal as any value);
 *  - the unsupported map is disjoint from each model's defaults;
 *  - model switches prune rejected + module-foreign keys and overlay the
 *    researched defaults, including module-scoped sampling overrides;
 *  - unknown catalog models degrade gracefully (pruned prev + model id).
 */

import {
  nextSoulbitsCapability,
  SOULBITS_MODEL_DEFAULTS,
  SOULBITS_MODEL_MODULE_OVERRIDES,
  SOULBITS_MODEL_UNSUPPORTED,
  SOULBITS_MODULE_DEFAULT_MODEL,
} from '../soulbitsModelDefaults';

describe('SOULBITS_MODEL_DEFAULTS', () => {
  it('seeds the documented LLM sampling recommendations', () => {
    expect(SOULBITS_MODEL_DEFAULTS['qwen-35-9b']).toMatchObject({
      temperature: 0.7,
      top_p: 0.8,
      max_tokens: 1024,
    });
    // Google's standardized generation config for the Gemma 4 base.
    expect(SOULBITS_MODEL_DEFAULTS['gemma4-meromero-26b-a4b']).toMatchObject({
      temperature: 1.0,
      top_p: 0.95,
    });
    // Derived (Mistral-Small-3.2 base) — roleplay-tuned, not Mistral's 0.15.
    expect(SOULBITS_MODEL_DEFAULTS['starfallen-24b']).toMatchObject({
      temperature: 0.75,
      top_p: 0.95,
    });
  });

  it('keeps Qwen presence_penalty at 0 (documented 1.5 is a thinking-mode value that risks language mixing)', () => {
    expect(SOULBITS_MODEL_DEFAULTS['qwen-35-9b'].presence_penalty).toBe(0);
  });

  it('seeds only truthful TTS format/sample_rate values (HSE always emits WAV natively)', () => {
    for (const model of [
      'kitten-tts-mini',
      'kitten-tts-micro',
      'kitten-tts-nano',
      'harmonyspeech',
      'openvoice_v1',
      'openvoice_v2',
      'chatterbox',
      'chatterbox_multilingual',
      'chatterbox_turbo',
    ]) {
      expect(SOULBITS_MODEL_DEFAULTS[model].format).toBe('wav');
    }
    expect(SOULBITS_MODEL_DEFAULTS['openvoice_v2'].sample_rate).toBe('44100');
    expect(SOULBITS_MODEL_DEFAULTS['kitten-tts-mini'].sample_rate).toBe('24000');
  });

  it('satisfies kitten-tts hard requirements (language default, exact-cased voice)', () => {
    expect(SOULBITS_MODEL_DEFAULTS['kitten-tts-mini']).toMatchObject({
      language: 'default',
      voice: 'Bella',
      speed: 1.0,
    });
  });

  it('seeds official Silero VAD defaults', () => {
    expect(SOULBITS_MODEL_DEFAULTS['silero-vad']).toEqual({
      threshold: 0.5,
      min_speech_duration_ms: 250,
      min_silence_duration_ms: 100,
      speech_pad_ms: 30,
      return_seconds: 0,
    });
  });

  it('never defaults a key the model rejects (defaults ∩ unsupported = ∅)', () => {
    for (const [model, unsupported] of Object.entries(SOULBITS_MODEL_UNSUPPORTED)) {
      const defaults = Object.keys(SOULBITS_MODEL_DEFAULTS[model] ?? {});
      const overlap = unsupported.filter((key) => defaults.includes(key));
      expect(overlap).toEqual([] as string[]);
    }
  });

  it('turbo exposes norm_loudness and nothing the worker would raise on', () => {
    expect(SOULBITS_MODEL_DEFAULTS['chatterbox_turbo']).toEqual({
      norm_loudness: true,
      format: 'wav',
      sample_rate: '24000',
    });
    expect(SOULBITS_MODEL_UNSUPPORTED['chatterbox_turbo']).toEqual(
      expect.arrayContaining(['exaggeration', 'cfg_weight', 'style', 'speed']),
    );
  });
});

describe('SOULBITS_MODULE_DEFAULT_MODEL', () => {
  it('maps every seedable module to a free-tier catalog model', () => {
    expect(SOULBITS_MODULE_DEFAULT_MODEL).toEqual({
      backend: 'qwen-35-9b',
      cognition: 'qwen-35-9b',
      movement: 'qwen-35-9b',
      vision: 'qwen-35-9b',
      rag: 'harrier-oss-v1-0-6b',
      tts: 'kitten-tts-mini',
      stt: 'faster-whisper-tiny',
      vad: 'silero-vad',
    });
  });
});

describe('SOULBITS_MODEL_MODULE_OVERRIDES', () => {
  it('runs cognition/movement cooler than chat with capped token budgets', () => {
    const qwen = SOULBITS_MODEL_MODULE_OVERRIDES['qwen-35-9b'];
    expect(qwen?.cognition).toMatchObject({ temperature: 0.3, max_tokens: 256 });
    expect(qwen?.movement).toMatchObject({ temperature: 0.2, max_tokens: 256 });
    expect(qwen?.vision).toMatchObject({ temperature: 0.3, max_tokens: 512 });
  });
});

describe('nextSoulbitsCapability', () => {
  it('reseeds the new model defaults on switch and prunes keys HSE rejects', () => {
    // chatterbox → chatterbox_turbo with explicit values the worker raises on.
    const next = nextSoulbitsCapability(
      {
        model: 'chatterbox',
        exaggeration: 1.2,
        cfg_weight: 0.4,
        speed: 1.1,
        format: 'wav',
      },
      'chatterbox_turbo',
      'tts',
    );
    expect(next.model).toBe('chatterbox_turbo');
    expect(next.exaggeration).toBeUndefined(); // turbo RAISES on this
    expect(next.cfg_weight).toBeUndefined(); // …and this
    expect(next.speed).toBeUndefined(); // no-op, pruned
    expect(next.norm_loudness).toBe(true); // turbo's one exposed knob
    expect(next.format).toBe('wav');
  });

  it('drops module-foreign keys (a TTS overlay never carries chat sampling)', () => {
    const next = nextSoulbitsCapability(
      { model: 'qwen-35-9b', temperature: 0.7, top_p: 0.8, max_tokens: 1024, voice: 'Bella' },
      'kitten-tts-mini',
      'tts',
    );
    expect(next.temperature).toBeUndefined();
    expect(next.max_tokens).toBeUndefined();
    expect(next).toMatchObject({ model: 'kitten-tts-mini', voice: 'Bella', language: 'default' });
  });

  it('applies module-scoped sampling overrides for the same model', () => {
    const cognition = nextSoulbitsCapability({ model: 'qwen-35-9b' }, 'qwen-35-9b', 'cognition');
    expect(cognition).toMatchObject({ temperature: 0.3, top_p: 0.8, max_tokens: 256 });

    const backend = nextSoulbitsCapability({ model: 'qwen-35-9b' }, 'qwen-35-9b', 'backend');
    expect(backend).toMatchObject({ temperature: 0.7, top_p: 0.8, max_tokens: 1024 });
  });

  it('keeps the STT slot minimal (model only — no tunables on the schema)', () => {
    const next = nextSoulbitsCapability(
      { model: 'qwen-35-9b', temperature: 0.7 },
      'faster-whisper-tiny',
      'stt',
    );
    expect(next).toEqual({ model: 'faster-whisper-tiny' });
  });

  it('seeds the VAD slot with Silero defaults and nothing else', () => {
    const next = nextSoulbitsCapability({}, 'silero-vad', 'vad');
    expect(next).toEqual({
      threshold: 0.5,
      min_speech_duration_ms: 250,
      min_silence_duration_ms: 100,
      speech_pad_ms: 30,
      return_seconds: 0,
      model: 'silero-vad',
    });
  });

  it('degrades gracefully for unknown catalog models', () => {
    const next = nextSoulbitsCapability(
      { model: 'qwen-35-9b', temperature: 0.9, voice: 'Bella' },
      'future-model-x',
      'backend',
    );
    expect(next.model).toBe('future-model-x');
    // Previous backend-scoped values survive; TTS-foreign key is pruned.
    expect(next.temperature).toBe(0.9);
    expect(next.voice).toBeUndefined();
  });
});
