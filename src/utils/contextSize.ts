/**
 * contextSize — pure presets / resolution / validation for the LLM
 * "Context window" control (`ContextSizeSelect`, Backend / Cognition /
 * Movement capability cards).
 *
 * Why a preset resolver instead of a bare number input:
 *  - The engine trims replies and starts memory compaction relative to the
 *    configured window, so the value is a first-class, user-visible choice —
 *    not an advanced mystery knob.
 *  - The engine catalog "never invents" limits: a custom model id has NO
 *    `context`, so feasibility (which presets a model can honor) must be a
 *    non-blocking signal — never a fabricated ceiling.
 *
 * The module is deliberately UI-free so the rules (preset matching, feasible
 * presets, clamping on a model switch, custom-token validation) are unit-tested
 * without React Native. `ContextSizeSelect` and the cross-slot advisory in
 * `CreateAIScreen` both consume these helpers.
 */

/** The smallest custom window the control accepts (1K tokens). */
export const CONTEXT_SIZE_MIN_CUSTOM = 1024;

/**
 * The share of the configured window after which the engine starts memory
 * compaction. Mirrors the "compaction starts at ~80 %" hint under the control.
 */
export const CONTEXT_SIZE_COMPACTION_RATIO = 0.8;

/** Pill ids: the four token presets plus the free-form editor. */
export type ContextSizePresetId = 'small' | 'medium' | 'large' | 'xlarge' | 'custom';

/** One token preset of the pill row. */
export interface ContextSizePreset {
  id: Exclude<ContextSizePresetId, 'custom'>;
  /** i18n key (moduleConfig namespace) for the pill label. */
  labelKey: string;
  tokens: number;
}

/**
 * The pill row's token presets, ascending. `small` is the default applied to a
 * slot that has never been edited (`context_window` absent from the overlay).
 */
export const CONTEXT_SIZE_PRESETS: readonly ContextSizePreset[] = [
  { id: 'small', labelKey: 'contextSizePresetSmall', tokens: 8192 },
  { id: 'medium', labelKey: 'contextSizePresetMedium', tokens: 16384 },
  { id: 'large', labelKey: 'contextSizePresetLarge', tokens: 32768 },
  { id: 'xlarge', labelKey: 'contextSizePresetXLarge', tokens: 65536 },
];

/** The default window (preset "Small") written when the slot is untouched. */
export const CONTEXT_SIZE_DEFAULT = CONTEXT_SIZE_PRESETS[0].tokens;

/** Quick-fill chips offered inside the custom editor. */
export const CONTEXT_SIZE_QUICK_CHIPS: readonly number[] = [16384, 131072];

/**
 * Format a token count compactly for the pills / badges / hints:
 * 8192 → "8.2K", 128000 → "128K", 1050000 → "1.05M", 512 → "512".
 *
 * Single source of truth shared by `CatalogModelSelect`'s context chip (which
 * re-exports it as `formatContextWindow`) and `ContextSizeSelect`.
 */
export function formatTokenCount(tokens: number): string {
  if (tokens >= 1_000_000) {
    return `${(tokens / 1_000_000).toFixed(2).replace(/\.?0+$/, '')}M`;
  }
  if (tokens >= 1_000) {
    return `${(tokens / 1_000).toFixed(1).replace(/\.?0+$/, '')}K`;
  }
  return String(tokens);
}

/** The capability-overlay key the control persists into (tokens, number). */
export const CONTEXT_WINDOW_CAPABILITY_KEY = 'context_window';

/**
 * The model's usable ceiling, or `undefined` when the catalog does not know it.
 * A missing / zero / non-finite limit is "unknown" — callers must not block or
 * clamp on it (the catalog never invents limits).
 */
export function knownModelMax(modelMax?: number | null): number | undefined {
  if (typeof modelMax !== 'number' || !Number.isFinite(modelMax) || modelMax <= 0) {
    return undefined;
  }
  return Math.floor(modelMax);
}

/** The largest preset at or below `max`, or `undefined` when none fits. */
function largestFeasiblePreset(max: number): ContextSizePreset | undefined {
  let best: ContextSizePreset | undefined;
  for (const preset of CONTEXT_SIZE_PRESETS) {
    if (preset.tokens <= max) best = preset;
  }
  return best;
}

/** Pull an over-limit value down: largest feasible preset, else the model max. */
function clampToFeasible(
  tokens: number,
  max: number,
): Pick<ResolvedContextSize, 'presetId' | 'tokens' | 'clamped'> {
  const preset = largestFeasiblePreset(max);
  if (preset) {
    return { presetId: preset.id, tokens: preset.tokens, clamped: true };
  }
  // Sub-8K models (an old 4K endpoint) fit no preset: the model's own max is
  // the only honest ceiling, and the value belongs in the custom editor.
  return { presetId: 'custom', tokens: Math.min(tokens, max), clamped: true };
}

/** What the control should display for a persisted value + model ceiling. */
export interface ResolvedContextSize {
  /** `small` for an untouched slot; `custom` for any non-preset value. */
  presetId: ContextSizePresetId;
  /** The window (tokens) the control shows as selected. */
  tokens: number;
  /** True only when the stored value exceeded the model's max and was pulled down. */
  clamped?: boolean;
  /** Presets the model cannot honor (empty when the max is unknown). */
  disabledPresets: ContextSizePresetId[];
}

/**
 * Resolve a persisted `context_window` against the selected model's ceiling.
 *
 * Rules (in order):
 *  1. No value → the Small preset, unless the model cannot honor it, in which
 *     case the largest feasible preset (or the model max) is used and flagged.
 *  2. Value above a KNOWN max → clamp to the largest feasible preset (or the
 *     max) and flag `clamped` — never drop the choice silently.
 *  3. Value exactly equal to a preset → that pill is selected.
 *  4. Anything else (including values the user typed) → the custom pill.
 *
 * An unknown max (undefined / 0 / NaN) blocks nothing and clamps nothing.
 */
export function resolveContextSize(
  value?: number | null,
  modelMax?: number | null,
): ResolvedContextSize {
  const max = knownModelMax(modelMax);
  const disabledPresets: ContextSizePresetId[] =
    max === undefined
      ? []
      : CONTEXT_SIZE_PRESETS.filter((preset) => preset.tokens > max).map(
          (preset) => preset.id,
        );

  const requested =
    typeof value === 'number' && Number.isFinite(value) && value > 0
      ? Math.floor(value)
      : undefined;

  if (requested === undefined) {
    if (max === undefined || CONTEXT_SIZE_DEFAULT <= max) {
      return { presetId: 'small', tokens: CONTEXT_SIZE_DEFAULT, disabledPresets };
    }
    return { ...clampToFeasible(CONTEXT_SIZE_DEFAULT, max), disabledPresets };
  }

  if (max !== undefined && requested > max) {
    return { ...clampToFeasible(requested, max), disabledPresets };
  }

  const exact = CONTEXT_SIZE_PRESETS.find((preset) => preset.tokens === requested);
  if (exact) {
    return { presetId: exact.id, tokens: requested, disabledPresets };
  }
  return { presetId: 'custom', tokens: requested, disabledPresets };
}

/** Message keys the control renders under the custom input. */
export type ContextSizeErrorKey = 'contextSizeErrorTooSmall' | 'contextSizeErrorAboveMax';

/**
 * Validate a typed custom window: at least 1,024 tokens, and at most the
 * model's max when it is known. `null` means the value is usable.
 */
export function validateCustomContext(
  tokens: number,
  modelMax?: number | null,
): ContextSizeErrorKey | null {
  if (typeof tokens !== 'number' || !Number.isFinite(tokens) || tokens < CONTEXT_SIZE_MIN_CUSTOM) {
    return 'contextSizeErrorTooSmall';
  }
  const max = knownModelMax(modelMax);
  if (max !== undefined && tokens > max) return 'contextSizeErrorAboveMax';
  return null;
}

/**
 * Clamp a typed custom window into `[1024, modelMax]`. Used on blur (never on
 * keystroke): a half-typed or out-of-range draft commits as the nearest usable
 * window instead of locking the field.
 */
export function clampCustomContext(tokens: number, modelMax?: number | null): number {
  const max = knownModelMax(modelMax);
  const floor = max === undefined ? CONTEXT_SIZE_MIN_CUSTOM : Math.min(CONTEXT_SIZE_MIN_CUSTOM, max);
  const requested =
    typeof tokens === 'number' && Number.isFinite(tokens) ? Math.floor(tokens) : floor;
  const upper = max === undefined ? Number.POSITIVE_INFINITY : max;
  return Math.min(Math.max(requested, floor), upper);
}

/** The token count where the engine starts compacting memory for a window. */
export function compactionThreshold(tokens: number): number {
  if (!Number.isFinite(tokens) || tokens <= 0) return 0;
  return Math.floor(tokens * CONTEXT_SIZE_COMPACTION_RATIO);
}

/**
 * Parse a persisted `capability_json` (JSON string, object, or nothing) into a
 * plain overlay object. Defensive: malformed JSON and non-objects become `{}`.
 */
export function parseCapabilityJson(value: unknown): Record<string, any> {
  if (value && typeof value === 'object') return { ...(value as Record<string, any>) };
  if (typeof value === 'string' && value.trim() !== '') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }
  return {};
}

/**
 * The persisted `context_window` of a capability overlay (`undefined` when the
 * slot was never edited, or the stored value is not a usable number).
 */
export function readContextWindow(capability: unknown): number | undefined {
  const raw = parseCapabilityJson(capability)[CONTEXT_WINDOW_CAPABILITY_KEY];
  const n =
    typeof raw === 'number'
      ? raw
      : typeof raw === 'string' && raw.trim() !== ''
        ? Number(raw)
        : NaN;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined;
}
