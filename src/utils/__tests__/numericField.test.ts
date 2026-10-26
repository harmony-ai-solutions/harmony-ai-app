/**
 * numericField — pure parsing / clamping / validation helpers for config
 * number fields (the floating-point validator rework).
 *
 * The behavioural contract under test:
 *  - a decimal separator survives typing ('0' + '.' + '7' commits 0.7, never 7);
 *  - partial ('-', '0.', '1e') and garbage ('abc', 'NaN') drafts never commit;
 *  - commits are clamped to the field's declared min/max and rounded to step;
 *  - the save-time sweep flags out-of-range and NaN values, ignores unset
 *    values and sentinels;
 *  - clamp-on-load repairs persisted values and reports what changed.
 */

import {
  clampToField,
  isCompleteNumber,
  roundToStep,
  sanitizeNumericValues,
  stepPrecision,
  toFiniteNumber,
  validateNumericFields,
} from '../numericField';

describe('isCompleteNumber', () => {
  it.each(['0', '7', '0.7', '.5', '-1', '+2', '1e3', '1.5e-2', ' 0.7 '])(
    'accepts %s',
    (text) => {
      expect(isCompleteNumber(text)).toBe(true);
    },
  );

  it.each(['', ' ', '.', '-', '+', '0.', '1e', 'abc', 'NaN', 'Infinity', '0x1', '1..2', '0.7.5'])(
    'rejects the partial/garbage draft %s',
    (text) => {
      expect(isCompleteNumber(text)).toBe(false);
    },
  );
});

describe('stepPrecision / roundToStep', () => {
  it('derives decimal places from the step', () => {
    expect(stepPrecision(0.01)).toBe(2);
    expect(stepPrecision(0.05)).toBe(2);
    expect(stepPrecision(1)).toBe(0);
    expect(stepPrecision(0.0001)).toBe(4);
  });

  it('rounds to the step precision', () => {
    expect(roundToStep(0.707, 0.01)).toBe(0.71);
    expect(roundToStep(0.6049999, 0.05)).toBe(0.6);
    expect(roundToStep(1234.5678, undefined)).toBe(1234.5678);
    expect(roundToStep(5, 0)).toBe(5);
  });
});

describe('clampToField', () => {
  const temperature = { key: 'temperature', label: 'Temperature', type: 'number' as const, min: 0, max: 2, step: 0.01 };

  it('clamps out-of-range values into the declared bounds', () => {
    expect(clampToField(42, temperature)).toBe(2);
    expect(clampToField(-1, temperature)).toBe(0);
  });

  it('passes in-range values through, rounded to step', () => {
    expect(clampToField(0.7, temperature)).toBe(0.7);
    expect(clampToField(1.999, temperature)).toBe(2);
  });

  it('is a no-op for fields without bounds', () => {
    const maxCompletionTokens = {
      key: 'max_completion_tokens',
      label: 'Max Completion Tokens',
      type: 'number' as const,
    };
    expect(clampToField(99999, maxCompletionTokens)).toBe(99999);
  });
});

describe('toFiniteNumber', () => {
  it('parses numbers and numeric strings', () => {
    expect(toFiniteNumber(0.7)).toBe(0.7);
    expect(toFiniteNumber('0.7')).toBe(0.7);
    expect(toFiniteNumber('1e3')).toBe(1000);
    expect(toFiniteNumber(-2)).toBe(-2);
  });

  it('returns null for anything non-numeric', () => {
    expect(toFiniteNumber(NaN)).toBeNull();
    expect(toFiniteNumber(Infinity)).toBeNull();
    expect(toFiniteNumber('abc')).toBeNull();
    expect(toFiniteNumber('')).toBeNull();
    expect(toFiniteNumber(null)).toBeNull();
    expect(toFiniteNumber(undefined)).toBeNull();
    expect(toFiniteNumber({})).toBeNull();
  });
});

describe('validateNumericFields (save-time sweep)', () => {
  const fields = [
    { key: 'temperature', label: 'Temperature', type: 'number', min: 0, max: 2, step: 0.01 },
    { key: 'max_completion_tokens', label: 'Max Completion Tokens', type: 'number', disabledValue: 0 },
    { key: 'seed', label: 'Seed', type: 'number', disabledValue: 0 },
    { key: 'model', label: 'Model', type: 'text' },
  ] as const;

  it('flags out-of-range values with their bounds', () => {
    const issues = validateNumericFields(fields, { temperature: 5 });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ key: 'temperature', problem: 'range', min: 0, max: 2 });
  });

  it('flags NaN persisted by the old inputs', () => {
    const issues = validateNumericFields(fields, { temperature: NaN });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ key: 'temperature', problem: 'nan' });
  });

  it('ignores unset values, sentinels, numeric strings and non-number fields', () => {
    expect(
      validateNumericFields(fields, {
        temperature: null,
        max_completion_tokens: 0,
        seed: 0,
        model: 'gpt-4o',
      }),
    ).toEqual([]);
    expect(validateNumericFields(fields, { temperature: '0.7' })).toEqual([]);
  });

  it('flags one-sided violations separately', () => {
    const oneSided = [{ key: 'cfg_weight', label: 'CFG Weight', type: 'number', min: 0.2 }] as const;
    const issues = validateNumericFields(oneSided, { cfg_weight: 0 });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ key: 'cfg_weight', problem: 'range', min: 0.2 });
  });
});

describe('sanitizeNumericValues (clamp-on-load)', () => {
  const fields = [
    { key: 'temperature', label: 'Temperature', type: 'number', min: 0, max: 2, step: 0.01 },
    { key: 'threshold', label: 'Speech Threshold', type: 'number', min: 0.05, max: 0.95, step: 0.05 },
    { key: 'seed', label: 'Seed', type: 'number', disabledValue: 0 },
  ] as const;

  it('pulls persisted values into bounds and reports the changed keys', () => {
    const { values, changed } = sanitizeNumericValues(fields, {
      temperature: 5,
      threshold: 99,
      seed: 0,
    });
    expect(values.temperature).toBe(2);
    expect(values.threshold).toBe(0.95);
    expect(values.seed).toBe(0); // sentinel untouched
    expect(changed).toEqual(['temperature', 'threshold']);
  });

  it('turns persisted NaN into unset', () => {
    const { values, changed } = sanitizeNumericValues(fields, { temperature: NaN });
    expect(values.temperature).toBeNull();
    expect(changed).toEqual(['temperature']);
  });

  it('leaves valid values and non-numeric keys untouched', () => {
    const { values, changed } = sanitizeNumericValues(fields, {
      temperature: 0.7,
      model: 'qwen-35-9b',
    });
    expect(values).toEqual({ temperature: 0.7, model: 'qwen-35-9b' });
    expect(changed).toEqual([]);
  });

  it('does not report in-bounds values as changed even when they equal defaults', () => {
    const { changed } = sanitizeNumericValues(fields, { threshold: 0.5 });
    expect(changed).toEqual([]);
  });
});
