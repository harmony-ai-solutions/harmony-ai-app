/**
 * EditorState — pure mapping between a `CharacterProfile` and the editor-suite
 * form state (extracted from the legacy comparison-only editor, Phase 8).
 *
 * The V3/RP columns are snake_case in the DB and camelCase in the UI (§A12).
 * These two functions are the single source of truth for that mapping so the
 * screen, the section components and the round-trip tests never drift:
 *
 *   profileToEditorState(profile)      — snake_case DB → camelCase editor state
 *   editorStateToProfileFields(state)  — camelCase editor state → snake_case
 *                                        columns (mapper JSON conventions)
 *
 * Encoding conventions (mirror `mapCardToProfile` / the Go mapper):
 *   - JSON columns (`alternate_greetings`, `tags`, `extensions`, `assets`,
 *     `group_only_greetings`) use `JSON.stringify(x ?? null)` — lossless,
 *     engine-parity.
 *   - `card_provenance` / `character_book` / `lifecycle_config` pass through
 *     verbatim (raw JSON strings).
 *   - Text columns are trimmed with `''` fallback (NOT NULL DEFAULT '').
 */

import type { CharacterProfile } from '../../../database/models';
import type { LifecycleConfig } from '../LifecycleConfigEditor';
import { parseJsonColumn } from '../lorebook';

export interface EditorState {
  name: string;
  description: string;
  personality: string;
  voiceCharacteristics: string;
  typingSpeedWpm: string;
  audioResponseChance: string;
  basePrompt: string;
  scenario: string;
  // ── Character Card V3 standard fields ─────────────────────────────────────
  firstMes: string;
  alternateGreetings: string[];
  mesExample: string;
  postHistoryInstructions: string;
  creatorNotes: string;
  creator: string;
  characterVersion: string;
  nickname: string;
  tags: string[];
  groupOnlyGreetings: string[];
  extensions: Record<string, unknown>;
  assets: unknown[] | null;
  cardProvenance: Record<string, unknown> | null;
  characterBook: string | null;
  // ── Lifecycle config (JSON column → typed object) ────────────────────────
  lifecycleConfig: LifecycleConfig;
}

/** snake_case DB columns the editor explicitly writes (V3 + base fields). */
export type EditorProfileFields = Pick<
  CharacterProfile,
  | 'name'
  | 'description'
  | 'personality'
  | 'voice_characteristics'
  | 'typing_speed_wpm'
  | 'audio_response_chance_percent'
  | 'base_prompt'
  | 'scenario'
  | 'first_mes'
  | 'mes_example'
  | 'alternate_greetings'
  | 'post_history_instructions'
  | 'creator_notes'
  | 'creator'
  | 'character_version'
  | 'nickname'
  | 'tags'
  | 'group_only_greetings'
  | 'extensions'
  | 'assets'
  | 'card_provenance'
  | 'character_book'
  | 'lifecycle_config'
>;

const toNumber = (raw: string, fallback: number): number => {
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
};

/** A profile as persisted or as returned by `mapCardToProfile` (no timestamps). */
export type EditorProfileSource = Omit<
  CharacterProfile,
  'created_at' | 'updated_at' | 'deleted_at'
>;

/** snake_case DB profile → camelCase editor state (§A12). */
export function profileToEditorState(profile: EditorProfileSource): EditorState {
  return {
    name: profile.name ?? '',
    description: profile.description ?? '',
    personality: profile.personality ?? '',
    voiceCharacteristics: profile.voice_characteristics ?? '',
    typingSpeedWpm: String(profile.typing_speed_wpm ?? 60),
    audioResponseChance: String(profile.audio_response_chance_percent ?? 50),
    basePrompt: profile.base_prompt ?? '',
    scenario: profile.scenario ?? '',
    // V3 columns — defensive JSON decode (engine may sync 'null'/''/invalid).
    firstMes: profile.first_mes ?? '',
    alternateGreetings: parseJsonColumn<string[]>(profile.alternate_greetings) ?? [],
    mesExample: profile.mes_example ?? '',
    postHistoryInstructions: profile.post_history_instructions ?? '',
    creatorNotes: profile.creator_notes ?? '',
    creator: profile.creator ?? '',
    characterVersion: profile.character_version ?? '',
    nickname: profile.nickname ?? '',
    tags: parseJsonColumn<string[]>(profile.tags) ?? [],
    groupOnlyGreetings: parseJsonColumn<string[]>(profile.group_only_greetings) ?? [],
    extensions: parseJsonColumn<Record<string, unknown>>(profile.extensions) ?? {},
    assets: parseJsonColumn<unknown[]>(profile.assets),
    cardProvenance: parseJsonColumn<Record<string, unknown>>(profile.card_provenance),
    characterBook: profile.character_book ?? null,
    lifecycleConfig: parseJsonColumn<LifecycleConfig>(profile.lifecycle_config) ?? {},
  };
}

/** camelCase editor state → snake_case profile columns (mapper conventions). */
export function editorStateToProfileFields(
  state: EditorState,
): EditorProfileFields {
  return {
    name: state.name.trim(),
    description: state.description.trim() || '',
    personality: state.personality.trim() || '',
    voice_characteristics: state.voiceCharacteristics.trim() || '',
    typing_speed_wpm: toNumber(state.typingSpeedWpm, 60),
    audio_response_chance_percent: toNumber(state.audioResponseChance, 50),
    base_prompt: state.basePrompt.trim() || '',
    scenario: state.scenario.trim() || '',
    // JSON columns: `JSON.stringify(x ?? null)` — lossless, engine-parity.
    first_mes: state.firstMes.trim() || '',
    mes_example: state.mesExample.trim() || '',
    alternate_greetings: JSON.stringify(
      state.alternateGreetings.length ? state.alternateGreetings : null,
    ),
    post_history_instructions: state.postHistoryInstructions.trim() || '',
    creator_notes: state.creatorNotes.trim() || '',
    creator: state.creator.trim() || '',
    character_version: state.characterVersion.trim() || '',
    nickname: state.nickname.trim() || '',
    tags: JSON.stringify(state.tags.length ? state.tags : null),
    group_only_greetings: JSON.stringify(
      state.groupOnlyGreetings.length ? state.groupOnlyGreetings : null,
    ),
    extensions: JSON.stringify(state.extensions),
    assets: JSON.stringify(state.assets),
    card_provenance: state.cardProvenance
      ? JSON.stringify(state.cardProvenance)
      : '',
    character_book: state.characterBook ?? '',
    lifecycle_config: JSON.stringify(state.lifecycleConfig),
  };
}

/**
 * All numeric `LifecycleConfig` keys (top-level + beat-type weights).
 * The editor stores raw strings while a field is being typed; the save path
 * validates with an alert instead of silently clamping.
 */
const LIFECYCLE_NUMERIC_KEYS: (keyof LifecycleConfig)[] = [
  'autonomy_level',
  'beat_interval',
  'sleep_threshold',
  'wake_threshold',
  'exhaustion_accumulation_per_beat',
  'exhaustion_decay_per_tick',
  'emotion_decay_tau',
  'emotion_high_threshold',
  'emotion_low_threshold',
  'emotion_crystallize_intensity',
  'emotion_crystallize_min_hours',
  'core_memories_k',
];

/**
 * True when every present lifecycle numeric field parses to a finite number.
 * Strings mid-typing ('' or 'abc') fail → the screen raises a validation
 * alert (Phase 8 Step 2 — validation instead of silent clamping).
 */
export function validateLifecycleConfig(config: LifecycleConfig): boolean {
  for (const key of LIFECYCLE_NUMERIC_KEYS) {
    const value = config[key];
    if (value !== undefined && !Number.isFinite(Number(value))) {
      return false;
    }
  }
  const weights = config.beat_type_weights ?? {};
  for (const key of Object.keys(weights)) {
    const value = weights[key as keyof typeof weights];
    if (value !== undefined && !Number.isFinite(Number(value))) {
      return false;
    }
  }
  return true;
}