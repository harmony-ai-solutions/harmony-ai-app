/**
 * contextSize — pure preset / feasibility / validation rules for the LLM
 * "Context window" control.
 *
 * The behavioural contract under test:
 *  - preset matching is EXACT (a value between presets is a custom window);
 *  - an untouched slot resolves to Small (8,192), the documented default;
 *  - feasibility is driven by a KNOWN model max only — undefined / 0 / NaN
 *    blocks nothing (the catalog never invents limits);
 *  - an over-limit value clamps to the largest feasible preset and is flagged,
 *    never dropped silently; a sub-8K model's own max is the fallback;
 *  - custom input requires 1,024 tokens and respects a known max;
 *  - clamp-on-blur pulls partial drafts into range;
 *  - the compaction point is 80 % of the window;
 *  - the capability reader tolerates JSON strings, objects and garbage.
 */

import {
  CONTEXT_SIZE_COMPACTION_RATIO,
  CONTEXT_SIZE_DEFAULT,
  CONTEXT_SIZE_MIN_CUSTOM,
  CONTEXT_SIZE_PRESETS,
  CONTEXT_SIZE_QUICK_CHIPS,
  CONTEXT_WINDOW_CAPABILITY_KEY,
  clampCustomContext,
  compactionThreshold,
  formatTokenCount,
  knownModelMax,
  parseCapabilityJson,
  readContextWindow,
  resolveContextSize,
  validateCustomContext,
} from '../contextSize';

describe('preset table', () => {
  it('exposes the four token presets in ascending order', () => {
    expect(CONTEXT_SIZE_PRESETS.map((p) => p.id)).toEqual([
      'small',
      'medium',
      'large',
      'xlarge',
    ]);
    expect(CONTEXT_SIZE_PRESETS.map((p) => p.tokens)).toEqual([8192, 16384, 32768, 65536]);
  });

  it('uses Small 8,192 as the documented default', () => {
    expect(CONTEXT_SIZE_DEFAULT).toBe(8192);
    expect(CONTEXT_SIZE_DEFAULT).toBe(CONTEXT_SIZE_PRESETS[0].tokens);
  });

  it('carries i18n label keys and the documented quick chips', () => {
    for (const preset of CONTEXT_SIZE_PRESETS) {
      expect(preset.labelKey).toMatch(/^contextSizePreset/);
    }
    expect(CONTEXT_SIZE_QUICK_CHIPS).toEqual([16384, 131072]);
  });

  it('pins the capability key and the 80 % compaction ratio', () => {
    expect(CONTEXT_WINDOW_CAPABILITY_KEY).toBe('context_window');
    expect(CONTEXT_SIZE_COMPACTION_RATIO).toBe(0.8);
    expect(CONTEXT_SIZE_MIN_CUSTOM).toBe(1024);
  });
});

describe('formatTokenCount', () => {
  it('formats token counts compactly (the context chips’ vocabulary)', () => {
    expect(formatTokenCount(128000)).toBe('128K');
    expect(formatTokenCount(8192)).toBe('8.2K');
    expect(formatTokenCount(16384)).toBe('16.4K');
    expect(formatTokenCount(32768)).toBe('32.8K');
    expect(formatTokenCount(65536)).toBe('65.5K');
    expect(formatTokenCount(131072)).toBe('131.1K');
    expect(formatTokenCount(500000)).toBe('500K');
    expect(formatTokenCount(1000000)).toBe('1M');
    expect(formatTokenCount(1050000)).toBe('1.05M');
    expect(formatTokenCount(512)).toBe('512');
  });
});

describe('knownModelMax', () => {  it('accepts a finite positive limit and floors it', () => {
    expect(knownModelMax(128000)).toBe(128000);
    expect(knownModelMax(8192.9)).toBe(8192);
  });

  it('treats absent, zero, negative and non-finite limits as unknown', () => {
    expect(knownModelMax(undefined)).toBeUndefined();
    expect(knownModelMax(null)).toBeUndefined();
    expect(knownModelMax(0)).toBeUndefined();
    expect(knownModelMax(-1)).toBeUndefined();
    expect(knownModelMax(NaN)).toBeUndefined();
    expect(knownModelMax(Infinity)).toBeUndefined();
    expect(knownModelMax('8192' as unknown as number)).toBeUndefined();
  });
});

describe('resolveContextSize', () => {
  it('resolves an untouched slot to the Small default', () => {
    expect(resolveContextSize(undefined)).toEqual({
      presetId: 'small',
      tokens: 8192,
      disabledPresets: [],
    });
    expect(resolveContextSize(undefined, 128000)).toEqual({
      presetId: 'small',
      tokens: 8192,
      disabledPresets: [],
    });
  });

  it('matches exact preset values', () => {
    expect(resolveContextSize(16384).presetId).toBe('medium');
    expect(resolveContextSize(32768).presetId).toBe('large');
    expect(resolveContextSize(65536).presetId).toBe('xlarge');
    expect(resolveContextSize(8192).presetId).toBe('small');
  });

  it('treats a non-preset value as custom and keeps it verbatim', () => {
    expect(resolveContextSize(24576)).toEqual({
      presetId: 'custom',
      tokens: 24576,
      disabledPresets: [],
    });
    expect(resolveContextSize(4096)).toEqual({
      presetId: 'custom',
      tokens: 4096,
      disabledPresets: [],
    });
  });

  it('floors fractional values and ignores zero / negative / NaN stored values', () => {
    expect(resolveContextSize(24576.8)).toMatchObject({ presetId: 'custom', tokens: 24576 });
    expect(resolveContextSize(0)).toMatchObject({ presetId: 'small', tokens: 8192 });
    expect(resolveContextSize(-5)).toMatchObject({ presetId: 'small', tokens: 8192 });
    expect(resolveContextSize(NaN)).toMatchObject({ presetId: 'small', tokens: 8192 });
  });

  it('disables presets above a known model max', () => {
    const resolved = resolveContextSize(8192, 32768);
    expect(resolved.disabledPresets).toEqual(['xlarge']);
    expect(resolveContextSize(8192, 16384).disabledPresets).toEqual(['large', 'xlarge']);
    expect(resolveContextSize(8192, 1000000).disabledPresets).toEqual([]);
  });

  it('blocks nothing when the max is unknown', () => {
    expect(resolveContextSize(65536, undefined).disabledPresets).toEqual([]);
    expect(resolveContextSize(65536, 0).disabledPresets).toEqual([]);
    expect(resolveContextSize(65536, NaN).disabledPresets).toEqual([]);
  });

  it('clamps an over-limit value to the largest feasible preset and flags it', () => {
    const resolved = resolveContextSize(65536, 32768);
    expect(resolved).toEqual({
      presetId: 'large',
      tokens: 32768,
      clamped: true,
      disabledPresets: ['xlarge'],
    });
    expect(resolveContextSize(24576, 16384)).toEqual({
      presetId: 'medium',
      tokens: 16384,
      clamped: true,
      disabledPresets: ['large', 'xlarge'],
    });
  });

  it('clamps the untouched default when the model cannot honor 8K', () => {
    expect(resolveContextSize(undefined, 4096)).toEqual({
      presetId: 'custom',
      tokens: 4096,
      clamped: true,
      disabledPresets: ['small', 'medium', 'large', 'xlarge'],
    });
    expect(resolveContextSize(undefined, 60000)).toEqual({
      presetId: 'small',
      tokens: 8192,
      disabledPresets: ['xlarge'],
    });
  });

  it('falls back to the model max when a value exceeds a sub-8K ceiling', () => {
    expect(resolveContextSize(8192, 4096)).toEqual({
      presetId: 'custom',
      tokens: 4096,
      clamped: true,
      disabledPresets: ['small', 'medium', 'large', 'xlarge'],
    });
  });

  it('does not flag an in-range value as clamped', () => {
    expect(resolveContextSize(32768, 32768).clamped).toBeUndefined();
    expect(resolveContextSize(24576, 128000).clamped).toBeUndefined();
  });
});

describe('validateCustomContext', () => {
  it('requires at least 1,024 tokens', () => {
    expect(validateCustomContext(1024)).toBeNull();
    expect(validateCustomContext(1023)).toBe('contextSizeErrorTooSmall');
    expect(validateCustomContext(0)).toBe('contextSizeErrorTooSmall');
    expect(validateCustomContext(-10)).toBe('contextSizeErrorTooSmall');
  });

  it('rejects non-finite drafts', () => {
    expect(validateCustomContext(NaN)).toBe('contextSizeErrorTooSmall');
    expect(validateCustomContext(Infinity)).toBe('contextSizeErrorTooSmall');
    expect(validateCustomContext(undefined as unknown as number)).toBe(
      'contextSizeErrorTooSmall',
    );
  });

  it('rejects a value above a known model max', () => {
    expect(validateCustomContext(32768, 32768)).toBeNull();
    expect(validateCustomContext(32769, 32768)).toBe('contextSizeErrorAboveMax');
    expect(validateCustomContext(131072, 128000)).toBe('contextSizeErrorAboveMax');
  });

  it('accepts any value at or above the minimum when the max is unknown', () => {
    expect(validateCustomContext(2000000, undefined)).toBeNull();
    expect(validateCustomContext(2000000, 0)).toBeNull();
    expect(validateCustomContext(2000000, NaN)).toBeNull();
  });
});

describe('clampCustomContext (clamp-on-blur)', () => {
  it('pulls a small draft up to the 1,024 floor', () => {
    expect(clampCustomContext(5)).toBe(1024);
    expect(clampCustomContext(0)).toBe(1024);
  });

  it('pulls an over-limit draft down to a known model max', () => {
    expect(clampCustomContext(131072, 128000)).toBe(128000);
    expect(clampCustomContext(65536, 32768)).toBe(32768);
  });

  it('keeps an in-range value and floors fractions', () => {
    expect(clampCustomContext(24576.9)).toBe(24576);
    expect(clampCustomContext(24576, 128000)).toBe(24576);
  });

  it('treats an unparseable draft as the floor', () => {
    expect(clampCustomContext(NaN)).toBe(1024);
    expect(clampCustomContext(NaN, 32768)).toBe(1024);
  });

  it('never returns less than the floor nor more than the max', () => {
    expect(clampCustomContext(2000, 4096)).toBe(2000);
    expect(clampCustomContext(999999, 4096)).toBe(4096);
    // A sub-1K model max cannot honor the floor — the max wins.
    expect(clampCustomContext(2048, 512)).toBe(512);
  });
});

describe('compactionThreshold', () => {
  it('returns 80 % of the window, floored', () => {
    expect(compactionThreshold(8192)).toBe(6553);
    expect(compactionThreshold(32768)).toBe(26214);
    expect(compactionThreshold(131072)).toBe(104857);
  });

  it('returns 0 for unusable windows', () => {
    expect(compactionThreshold(0)).toBe(0);
    expect(compactionThreshold(-10)).toBe(0);
    expect(compactionThreshold(NaN)).toBe(0);
  });
});

describe('capability overlay readers', () => {
  it('parses JSON strings and objects, and defends against garbage', () => {
    expect(parseCapabilityJson('{"model":"gpt-4o"}')).toEqual({ model: 'gpt-4o' });
    expect(parseCapabilityJson({ model: 'gpt-4o' })).toEqual({ model: 'gpt-4o' });
    expect(parseCapabilityJson('not json')).toEqual({});
    expect(parseCapabilityJson('null')).toEqual({});
    expect(parseCapabilityJson(42)).toEqual({});
    expect(parseCapabilityJson(null)).toEqual({});
    expect(parseCapabilityJson(undefined)).toEqual({});
  });

  it('reads the persisted context_window from either shape', () => {
    expect(readContextWindow('{"context_window":32768}')).toBe(32768);
    expect(readContextWindow({ context_window: 32768 })).toBe(32768);
    expect(readContextWindow({ context_window: '16384' })).toBe(16384);
    expect(readContextWindow({ context_window: 24576.9 })).toBe(24576);
  });

  it('returns undefined when the window is absent or unusable', () => {
    expect(readContextWindow(undefined)).toBeUndefined();
    expect(readContextWindow({})).toBeUndefined();
    expect(readContextWindow({ context_window: 0 })).toBeUndefined();
    expect(readContextWindow({ context_window: -1 })).toBeUndefined();
    expect(readContextWindow({ context_window: 'abc' })).toBeUndefined();
    expect(readContextWindow({ context_window: null })).toBeUndefined();
    expect(readContextWindow('{"context_window":')).toBeUndefined();
    expect(readContextWindow('[1, 2, 3]')).toBeUndefined();
  });
});
