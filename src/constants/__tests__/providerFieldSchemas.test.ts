/**
 * providerFieldSchemas — capability schema additions owed by the engine phases
 * (provider-registry 6-5 step 3): full ollama option set, mistral param rules,
 * localai native-name superset, google thinking (4-3), xai image_model (4-4),
 * elevenlabs speed (4-6), soulvoice Silero VAD keys (4-11).
 */

import { PROVIDER_SCHEMAS, withCanonicalCompletionTokens } from '../providerFieldSchemas';

const keys = (type: string): string[] =>
  (PROVIDER_SCHEMAS[type]?.fields ?? []).map(f => f.key);
const field = (type: string, key: string) =>
  (PROVIDER_SCHEMAS[type]?.fields ?? []).find(f => f.key === key);

describe('providerFieldSchemas — 6-5 capability additions', () => {
  it('ollama carries the full native option set (not the shortened list)', () => {
    expect(keys('ollama')).toEqual(
      expect.arrayContaining([
        'model',
        'top_k',
        'min_p',
        'repeat_penalty',
        'repeat_last_n',
        'num_ctx',
        'num_predict',
        'stop',
        'seed',
        'think',
        'format',
        'keep_alive',
      ]),
    );
  });

  it('ollama and localai flip hasModelFetch on (research §8.4/§8.5)', () => {
    expect(PROVIDER_SCHEMAS.ollama.hasModelFetch).toBe(true);
    expect(PROVIDER_SCHEMAS.localai.hasModelFetch).toBe(true);
  });

  it('mistral uses random_seed, drops max_completion_tokens, temperature max 1.5', () => {
    const mistralKeys = keys('mistral');
    expect(mistralKeys).toContain('random_seed');
    expect(mistralKeys).not.toContain('seed');
    expect(mistralKeys).not.toContain('max_completion_tokens');
    expect(field('mistral', 'temperature')?.max).toBe(1.5);
  });

  it('mistral exposes the reasoning_effort enum values', () => {
    const ids = (field('mistral', 'reasoning_effort')?.options ?? []).map(o => o.id);
    expect(ids).toEqual(
      expect.arrayContaining(['', 'none', 'minimal', 'low', 'medium', 'high', 'xhigh']),
    );
  });

  it('localai exposes the native sampling names accepted on /v1', () => {
    expect(keys('localai')).toEqual(
      expect.arrayContaining([
        'top_k',
        'min_p',
        'repeat_penalty',
        'repeat_last_n',
        'reasoning_effort',
      ]),
    );
  });

  it('google carries the thinking_level / thinking_budget fields (4-3)', () => {
    expect(keys('google')).toContain('thinking_level');
    expect(keys('google')).toContain('thinking_budget');
  });

  it('xai carries the dedicated image_model field (4-4)', () => {
    expect(keys('xai')).toContain('image_model');
  });

  it('elevenlabs carries the speed field (4-6)', () => {
    expect(keys('elevenlabs')).toContain('speed');
  });

  it('soulvoice carries the Silero VAD params (4-11)', () => {
    expect(keys('soulvoice')).toEqual(
      expect.arrayContaining([
        'threshold',
        'min_speech_duration_ms',
        'min_silence_duration_ms',
        'speech_pad_ms',
        'return_seconds',
      ]),
    );
  });
});

describe('providerFieldSchemas — one logical completion-token limit', () => {
  const TOKEN_KEYS = ['max_tokens', 'max_completion_tokens', 'num_predict', 'max_output_tokens'];
  const tokenFields = (type: string) =>
    (PROVIDER_SCHEMAS[type]?.fields ?? []).filter((f) => TOKEN_KEYS.includes(f.key));

  it.each(['openai', 'openaicompatible', 'openrouter', 'localai', 'xai', 'soulbitscloud'])(
    '%s exposes ONLY max_completion_tokens, labelled "Max Completion Tokens"',
    (type) => {
      const fields = tokenFields(type);
      expect(fields).toHaveLength(1);
      expect(fields[0]).toMatchObject({
        key: 'max_completion_tokens',
        label: 'Max Completion Tokens',
        disabledValue: 0,
      });
      expect(fields[0].tooltip).toContain('engine sends it');
    },
  );

  it.each([
    ['mistral', 'max_tokens'],
    ['ollama', 'num_predict'],
    ['google', 'max_output_tokens'],
    ['anthropic', 'max_tokens'],
  ])('%s keeps its native alias key %s, relabelled', (type, key) => {
    const fields = tokenFields(type);
    expect(fields).toHaveLength(1);
    expect(fields[0].key).toBe(key);
    expect(fields[0].label).toBe('Max Completion Tokens');
    expect(fields[0].tooltip).toBeTruthy();
  });

  it('no provider exposes "Max Tokens" / "Max Output Tokens" labels any more', () => {
    for (const schema of Object.values(PROVIDER_SCHEMAS)) {
      for (const schemaField of schema.fields) {
        expect(schemaField.label).not.toBe('Max Tokens');
        expect(schemaField.label).not.toBe('Max Output Tokens');
        expect(schemaField.label).not.toBe('Max Tokens (num_predict)');
      }
    }
  });
});

describe('withCanonicalCompletionTokens', () => {
  it('seeds max_completion_tokens from a legacy max_tokens value', () => {
    expect(withCanonicalCompletionTokens('openai', 'backend', { max_tokens: 2048 })).toMatchObject({
      max_tokens: 2048,
      max_completion_tokens: 2048,
    });
  });

  it('keeps the canonical value when both are stored', () => {
    const capability = { max_tokens: 2048, max_completion_tokens: 512 };
    expect(
      withCanonicalCompletionTokens('openai', 'backend', capability).max_completion_tokens,
    ).toBe(512);
  });

  it('ignores unset sentinels (-1 / 0)', () => {
    expect(
      withCanonicalCompletionTokens('openai', 'backend', {
        max_tokens: -1,
        max_completion_tokens: 0,
      }),
    ).toEqual({ max_tokens: -1, max_completion_tokens: 0 });
    expect(withCanonicalCompletionTokens('openai', 'backend', { max_tokens: 0 })).toEqual({
      max_tokens: 0,
    });
  });

  it('leaves single-field providers and non-chat modules untouched', () => {
    expect(withCanonicalCompletionTokens('mistral', 'backend', { max_tokens: 512 })).toEqual({
      max_tokens: 512,
    });
    expect(withCanonicalCompletionTokens('openai', 'tts', { max_tokens: 512 })).toEqual({
      max_tokens: 512,
    });
  });
});
