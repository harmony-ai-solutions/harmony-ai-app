/**
 * presetYaml — pure TextGen WebUI YAML serializer + name validator (Phase 2-1).
 */

import {
  PRESET_YAML_KEYS,
  buildPresetYamlFromCapability,
  validatePresetName,
} from '../presetYaml';

describe('PRESET_YAML_KEYS', () => {
  it('contains the standard and extended SamplingPreset keys', () => {
    expect(PRESET_YAML_KEYS).toEqual(
      expect.arrayContaining([
        'temperature',
        'top_p',
        'max_tokens',
        'frequency_penalty',
        'presence_penalty',
        'seed',
        'top_k',
        'min_p',
        'repetition_penalty',
        'typical_p',
        'dry_multiplier',
        'xtc_probability',
        'do_sample',
        'ignore_eos',
      ]),
    );
  });
});

describe('buildPresetYamlFromCapability', () => {
  it('emits active sampling params in deterministic key order', () => {
    const yaml = buildPresetYamlFromCapability({
      temperature: 0.7,
      top_p: 0.9,
      max_tokens: 512,
      seed: 42,
    });

    expect(yaml).toBe(
      'temperature: 0.7\ntop_p: 0.9\nmax_tokens: 512\nseed: 42\n',
    );
  });

  it('includes a quoted description header', () => {
    const yaml = buildPresetYamlFromCapability(
      { temperature: 0.2 },
      'Deterministic "cognition" preset',
    );
    expect(yaml).toBe(
      'description: "Deterministic \\"cognition\\" preset"\ntemperature: 0.2\n',
    );
  });

  it('skips sentinel / unset values', () => {
    const yaml = buildPresetYamlFromCapability({
      temperature: 0.7,
      top_p: 1,
      max_tokens: -1,
      seed: 0,
      frequency_penalty: 0,
      presence_penalty: 0,
      top_k: 0,
      empty: '',
      missing: undefined,
      nil: null,
    });
    expect(yaml).toBe('temperature: 0.7\ntop_p: 1\n');
  });

  it('keeps an explicit temperature/top_p of zero (legitimate greedy values)', () => {
    expect(buildPresetYamlFromCapability({ temperature: 0, top_p: 0 })).toBe(
      'temperature: 0\ntop_p: 0\n',
    );
  });

  it('reads extended values from the extra_params JSON blob', () => {
    const yaml = buildPresetYamlFromCapability({
      temperature: 0.6,
      extra_params: JSON.stringify({ typical_p: 0.95, tfs: 0.9, do_sample: true }),
    });
    expect(yaml).toContain('typical_p: 0.95');
    expect(yaml).toContain('tfs: 0.9');
    expect(yaml).toContain('do_sample: true');
  });

  it('normalizes provider aliases (repeat_penalty / random_seed / num_predict / max_output_tokens)', () => {
    const yaml = buildPresetYamlFromCapability({
      repeat_penalty: 1.15,
      random_seed: 7,
      num_predict: 256,
    });
    expect(yaml).toContain('repetition_penalty: 1.15');
    expect(yaml).toContain('seed: 7');
    expect(yaml).toContain('max_tokens: 256');
    expect(yaml).not.toContain('repeat_penalty:');
    expect(yaml).not.toContain('random_seed:');
    expect(yaml).not.toContain('num_predict:');

    const fromGoogle = buildPresetYamlFromCapability({ max_output_tokens: 128 });
    expect(fromGoogle).toBe('max_tokens: 128\n');
  });

  it('prefers max_completion_tokens when both token aliases are present (ONE logical limit)', () => {
    const yaml = buildPresetYamlFromCapability({ max_tokens: 512, max_completion_tokens: 1024 });
    expect(yaml).toBe('max_tokens: 1024\n');

    // The winner is canonical regardless of which blob it came from.
    const fromExtra = buildPresetYamlFromCapability({
      max_tokens: 512,
      extra_params: JSON.stringify({ max_completion_tokens: 2048 }),
    });
    expect(fromExtra).toBe('max_tokens: 2048\n');
    expect(fromExtra.match(/max_tokens:/g)).toHaveLength(1);
  });

  it('falls back to a legacy alias when the canonical value is unset', () => {
    const yaml = buildPresetYamlFromCapability({ max_tokens: 768, max_completion_tokens: 0 });
    expect(yaml).toBe('max_tokens: 768\n');
  });

  it('emits the starter template when nothing is set', () => {
    expect(buildPresetYamlFromCapability({})).toBe(
      'temperature: 0.7\ntop_p: 0.9\ntop_k: 40\nrepetition_penalty: 1.1\n',
    );
    expect(
      buildPresetYamlFromCapability({ extra_params: '{}', max_tokens: 0, seed: 0 }),
    ).toBe('temperature: 0.7\ntop_p: 0.9\ntop_k: 40\nrepetition_penalty: 1.1\n');
  });

  it('tolerates malformed extra_params JSON', () => {
    expect(buildPresetYamlFromCapability({ extra_params: '{not json' })).toContain(
      'temperature: 0.7',
    );
  });

  it('top-level values win over extra_params on collision', () => {
    const yaml = buildPresetYamlFromCapability({
      temperature: 0.3,
      extra_params: JSON.stringify({ temperature: 1.2 }),
    });
    expect(yaml).toBe('temperature: 0.3\n');
  });
});

describe('validatePresetName', () => {
  it('accepts a plain filename stem', () => {
    expect(validatePresetName('creative-writing')).toBeNull();
    expect(validatePresetName('Cognition_Deterministic')).toBeNull();
  });

  it('rejects empty names', () => {
    expect(validatePresetName('')).not.toBeNull();
    expect(validatePresetName('   ')).not.toBeNull();
  });

  it('rejects path separators, parent refs and edge dots', () => {
    expect(validatePresetName('a/b')).not.toBeNull();
    expect(validatePresetName('a\\b')).not.toBeNull();
    expect(validatePresetName('../evil')).not.toBeNull();
    expect(validatePresetName('.hidden')).not.toBeNull();
    expect(validatePresetName('trailing.')).not.toBeNull();
  });
});
