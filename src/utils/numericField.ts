/**
 * numericField — pure parsing / clamping / validation for config number fields.
 *
 * Why this exists (config-and-partner-ux follow-up): every module-config
 * number input used to run `parseFloat` on each keystroke over a fully
 * controlled TextInput, which
 *   (a) ate the decimal separator while typing (`0` + `.` + `7` became 7),
 *   (b) locked fields on `NaN` (`parseFloat('-')`), and
 *   (c) never enforced the `min`/`max`/`step` declared on the field.
 *
 * The fix pattern (FormField, AdvancedSamplingParams, ModuleConfigEditScreen):
 * keep a local text DRAFT while the input is focused, commit a parsed number
 * only when the text is a COMPLETE number (or on blur), and clamp on commit.
 * This module holds the shared pure helpers so the behaviour is unit-tested
 * independent of React Native.
 */

/** The numeric constraints a {@link FieldDefinition}-like field declares. */
export interface NumericFieldConstraints {
  key: string;
  label: string;
  type?: string;
  min?: number;
  max?: number;
  step?: number;
  /** Sentinel meaning "unset" (`-1` unlimited, `0` random/auto). */
  disabledValue?: number;
}

/** Decimal places implied by `step` (0.01 → 2; handles exponent forms). */
export function stepPrecision(step: number): number {
  if (!Number.isFinite(step) || step <= 0) return 0;
  const text = String(step);
  if (text.includes('e-')) {
    return Math.max(0, -Math.floor(Math.log10(step)));
  }
  return (text.split('.')[1] ?? '').length;
}

/** Round `value` to the precision implied by `step` (no-op without a step). */
export function roundToStep(value: number, step?: number): number {
  if (step === undefined || step === null || !Number.isFinite(step) || step <= 0) {
    return value;
  }
  return Number(value.toFixed(stepPrecision(step)));
}

/** Clamp `value` into `[min, max]` (as declared) and round to `step`. */
export function clampToField(value: number, field: NumericFieldConstraints): number {
  let clamped = value;
  if (typeof field.min === 'number' && Number.isFinite(field.min)) {
    clamped = Math.max(field.min, clamped);
  }
  if (typeof field.max === 'number' && Number.isFinite(field.max)) {
    clamped = Math.min(field.max, clamped);
  }
  return roundToStep(clamped, field.step);
}

/**
 * True when `text` is a COMPLETE base-10 number — i.e. `Number(text)` and
 * `parseFloat(text)` agree AND the text has no dangling separator/exponent
 * (the user may still be typing). Partial drafts (`''`, `'-'`, `'0.'`, `'1e'`)
 * and garbage (`'abc'`, `'NaN'`, `'0x1'`) return false, so callers can keep
 * the draft without committing a wrong number.
 */
export function isCompleteNumber(text: string): boolean {
  const trimmed = (text ?? '').trim();
  if (trimmed === '') return false;
  if (!/^[+-]?(\d+(\.\d+)?|\.\d+)([eE][+-]?\d+)?$/.test(trimmed)) return false;
  const n = Number(trimmed);
  return Number.isFinite(n);
}

/**
 * A stored/committed value as a finite number, or `null` when it is not one
 * (`NaN`, non-numeric strings, objects). Strings are accepted so JSON blobs
 * holding `"0.7"` parse the same way the engine would.
 */
export function toFiniteNumber(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  if (typeof raw === 'string' && isCompleteNumber(raw)) {
    const n = Number(raw.trim());
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** One out-of-range / non-numeric problem found by {@link validateNumericFields}. */
export interface NumericFieldIssue {
  key: string;
  label: string;
  /** `nan` = not a number, `range` = outside [min, max]. */
  problem: 'nan' | 'range';
  min?: number;
  max?: number;
  /** The offending stored value. */
  value: unknown;
}

/**
 * Save-time sweep: every field of `type: 'number'` whose stored value is a
 * finite number must sit inside its declared bounds. Unset values (`null`,
 * `undefined`, `''`) and `disabledValue` sentinels are fine — those mean
 * "unset", not "invalid".
 */
export function validateNumericFields(
  fields: readonly NumericFieldConstraints[],
  values: Record<string, unknown> | null | undefined,
): NumericFieldIssue[] {
  const issues: NumericFieldIssue[] = [];
  for (const field of fields) {
    if (field.type !== 'number') continue;
    const raw = (values ?? {})[field.key];
    if (raw === null || raw === undefined || raw === '') continue;
    if (typeof field.disabledValue === 'number' && Number(raw) === field.disabledValue) {
      continue;
    }
    const n = toFiniteNumber(raw);
    if (n === null) {
      issues.push({ key: field.key, label: field.label, problem: 'nan', value: raw });
      continue;
    }
    const belowMin = typeof field.min === 'number' && n < field.min;
    const aboveMax = typeof field.max === 'number' && n > field.max;
    if (belowMin || aboveMax) {
      issues.push({
        key: field.key,
        label: field.label,
        problem: 'range',
        min: field.min,
        max: field.max,
        value: raw,
      });
    }
  }
  return issues;
}

/**
 * Clamp-on-load repair for persisted values: finite numbers are pulled into
 * the declared bounds (rounded to `step`), `NaN` becomes `null` (unset).
 * Non-numeric keys and fields without constraints pass through untouched.
 *
 * Returns the repaired object plus the keys that changed, so callers can mark
 * those keys as user-explicit (visible overrides) rather than silently
 * rewriting history.
 */
export function sanitizeNumericValues(
  fields: readonly NumericFieldConstraints[],
  values: Record<string, unknown> | null | undefined,
): { values: Record<string, unknown>; changed: string[] } {
  const out: Record<string, unknown> = { ...(values ?? {}) };
  const changed: string[] = [];
  for (const field of fields) {
    if (field.type !== 'number') continue;
    const raw = out[field.key];
    if (raw === null || raw === undefined || raw === '') continue;
    if (typeof field.disabledValue === 'number' && Number(raw) === field.disabledValue) {
      continue;
    }
    const n = toFiniteNumber(raw);
    if (n === null) {
      if (typeof raw === 'number') {
        // NaN / Infinity committed by the old inputs → unset.
        out[field.key] = null;
        changed.push(field.key);
      }
      continue;
    }
    const clamped = clampToField(n, field);
    if (clamped !== n) {
      out[field.key] = clamped;
      changed.push(field.key);
    }
  }
  return { values: out, changed };
}
