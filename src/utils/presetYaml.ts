/**
 * presetYaml — TextGen WebUI YAML preset serializer & name validator (Phase 2-1).
 *
 * The engine (`harmony-link-private/config/presets.go`, `config.SamplingPreset`)
 * unmarshals the `content` string of `POST /api/presets` into a flat YAML
 * document. This module is a pure, deterministic serializer: it converts a
 * module slot's capability overlay (top-level sampling fields + the
 * `extra_params` JSON blob) into the subset of `SamplingPreset` keys the engine
 * understands, normalizing provider-specific aliases first
 * (`repeat_penalty` → `repetition_penalty`, `random_seed` → `seed`,
 * `num_predict` / `max_output_tokens` / `max_completion_tokens` → `max_tokens`).
 */

/**
 * Ordered list of the `config.SamplingPreset` YAML keys the engine accepts.
 * Emission order follows this list so two identical capabilities always produce
 * byte-identical YAML.
 */
export const PRESET_YAML_KEYS: readonly string[] = [
  // Standard
  'temperature',
  'top_p',
  'max_tokens',
  'frequency_penalty',
  'presence_penalty',
  'seed',
  // Extended (common)
  'top_k',
  'min_p',
  'repetition_penalty',
  // Rich samplers
  'typical_p',
  'tfs',
  'dry_multiplier',
  'dry_base',
  'dry_allowed_length',
  'xtc_probability',
  'xtc_threshold',
  'top_a',
  'mirostat_mode',
  'mirostat_tau',
  'mirostat_eta',
  'dynatemp_range',
  'dynatemp_exponent',
  'top_n_sigma',
  // TextGen-specific & additional
  'penalty_alpha',
  'repetition_penalty_range',
  'do_sample',
  'epsilon_cutoff',
  'eta_cutoff',
  'smoothing_factor',
  'temperature_last',
  'encoder_repetition_penalty',
  'no_repeat_ngram_size',
  'smoothing_curve',
  'min_tokens',
  'dynatemp_low',
  'dynatemp_high',
  'ignore_eos',
];

/** Provider-specific capability keys → the engine's canonical preset key. */
export const PRESET_KEY_ALIASES: Readonly<Record<string, string>> = {
  repeat_penalty: 'repetition_penalty',
  random_seed: 'seed',
  num_predict: 'max_tokens',
  max_output_tokens: 'max_tokens',
  max_completion_tokens: 'max_tokens',
};

const PRESET_KEY_SET: ReadonlySet<string> = new Set(PRESET_YAML_KEYS);

/**
 * Keys whose numeric `0` means "unset" (the form's disabled sentinel). A
 * temperature/top_p of `0` is a legitimate value and is always emitted.
 */
const ZERO_MEANS_UNSET: ReadonlySet<string> = new Set([
  'max_tokens',
  'seed',
  'frequency_penalty',
  'presence_penalty',
  'top_k',
  'min_p',
  'repetition_penalty',
  'typical_p',
  'tfs',
  'dry_multiplier',
  'dry_allowed_length',
  'xtc_probability',
  'xtc_threshold',
  'top_a',
  'mirostat_mode',
  'mirostat_tau',
  'mirostat_eta',
  'dynatemp_range',
  'dynatemp_exponent',
  'top_n_sigma',
  'penalty_alpha',
  'repetition_penalty_range',
  'epsilon_cutoff',
  'eta_cutoff',
  'smoothing_factor',
  'encoder_repetition_penalty',
  'no_repeat_ngram_size',
  'smoothing_curve',
  'min_tokens',
  'dynatemp_low',
  'dynatemp_high',
]);

const STARTER_TEMPLATE = 'temperature: 0.7\ntop_p: 0.9\ntop_k: 40\nrepetition_penalty: 1.1\n';

/** Parse a capability's `extra_params` (JSON string or object) into an object. */
function parseExtraParams(raw: unknown): Record<string, unknown> {
  if (!raw) return {};
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    return { ...(raw as Record<string, unknown>) };
  }
  if (typeof raw === 'string' && raw.trim() !== '') {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }
  return {};
}

function yamlQuote(value: string): string {
  return `"${value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')}"`;
}

function formatScalar(value: unknown): string {
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') {
    if (value === 'true' || value === 'false') return value;
    const numeric = Number(value);
    if (value.trim() !== '' && Number.isFinite(numeric)) return value;
    return yamlQuote(value);
  }
  return yamlQuote(String(value));
}

function shouldEmit(key: string, value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === 'string') return value.trim() !== '';
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return false;
    if (key === 'max_tokens' && value <= 0) return false;
    if (value === 0 && ZERO_MEANS_UNSET.has(key)) return false;
  }
  return true;
}

/**
 * Serialize a module slot's capability overlay into a TextGen WebUI
 * `SamplingPreset` YAML document.
 *
 * - Reads top-level capability values plus the parsed `extra_params` JSON
 *   (top-level values win on collision).
 * - Normalizes provider aliases (e.g. `repeat_penalty` → `repetition_penalty`).
 * - Skips unset/sentinel values (`undefined`, `null`, `''`, `max_tokens <= 0`,
 *   `seed === 0`, numeric `0` on optional penalties/cutoffs).
 * - Emits a starter template when no parameter is set yet.
 */
export function buildPresetYamlFromCapability(
  capability: Record<string, any>,
  description?: string,
): string {
  const source: Record<string, unknown> = {
    ...parseExtraParams(capability?.extra_params),
  };
  for (const [key, value] of Object.entries(capability ?? {})) {
    if (key === 'extra_params') continue;
    source[key] = value;
  }

  const candidates: Record<string, unknown> = {};
  for (const [rawKey, value] of Object.entries(source)) {
    const key = PRESET_KEY_ALIASES[rawKey] ?? rawKey;
    if (!PRESET_KEY_SET.has(key)) continue;
    candidates[key] = value;
  }

  const lines: string[] = [];
  if (description && description.trim() !== '') {
    lines.push(`description: ${yamlQuote(description.trim())}`);
  }

  let emitted = 0;
  for (const key of PRESET_YAML_KEYS) {
    if (!(key in candidates)) continue;
    const value = candidates[key];
    if (!shouldEmit(key, value)) continue;
    lines.push(`${key}: ${formatScalar(value)}`);
    emitted += 1;
  }

  if (emitted === 0) return STARTER_TEMPLATE;
  return `${lines.join('\n')}\n`;
}

/**
 * Validate a preset filename stem. Returns an error message, or `null` when the
 * name is safe (`POST /api/presets` rejects `/`, `\` and `..`).
 */
export function validatePresetName(name: string): string | null {
  const trimmed = (name ?? '').trim();
  if (trimmed === '') return 'Preset name is required';
  if (/[\\/]/.test(trimmed)) return 'Preset name cannot contain path separators';
  if (trimmed.includes('..')) return 'Preset name cannot contain ".."';
  if (trimmed.startsWith('.') || trimmed.endsWith('.')) {
    return 'Preset name cannot start or end with a dot';
  }
  return null;
}
