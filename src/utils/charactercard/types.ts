/**
 * Character Card Types
 *
 * Faithful port of harmony-link-private/utils/charactercard/types.go
 * Exact JSON keys, field names, and structure.
 *
 * `TavernCardV2Data` is the full Character Card V3 superset (SPEC_V3:75-111):
 * the V2 fields plus the V3-only fields. The `[key: string]: unknown` index
 * signature is a parse-time vessel: unknown keys are DETECTED on parse (for
 * the import warning) and DROPPED on store/export — they are never persisted
 * or re-exported (no-unknown-fields policy).
 */

export class CharacterCardParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CharacterCardParseError';
  }
}

export interface TavernCardV2 {
  spec: string;
  spec_version: string;
  data: TavernCardV2Data;
}

/**
 * Character Card V3 (SPEC_V3). Superset of `TavernCardV2` with a literal
 * `spec` type; `data` is the shared V3 superset (`TavernCardV2Data`).
 */
export interface TavernCardV3 extends TavernCardV2 {
  spec: 'chara_card_v3';
}

/** V3 asset descriptor (SPEC_V3 `assets` field, `:161-193`). */
export interface CharacterCardAsset {
  type: string;
  uri: string;
  name: string;
  ext: string;
}

export interface TavernCardV2Data {
  name: string;
  description: string;
  personality: string;
  scenario: string;
  first_mes: string;
  mes_example: string;
  creator_notes: string;
  system_prompt: string;
  post_history_instructions: string;
  alternate_greetings: string[];
  character_book: CharacterBook | null;
  tags: string[];
  creator: string;
  character_version: string;
  extensions: Record<string, unknown>;
  // --- V3-only fields (SPEC_V3:75-111) ---
  assets?: CharacterCardAsset[];
  nickname?: string;
  creator_notes_multilingual?: Record<string, string>;
  source?: string[];
  group_only_greetings?: string[];
  creation_date?: number;
  modification_date?: number;
  // Parse-time detection vessel: unknown keys captured here are reported via
  // `collectDroppedCardFields` and dropped on store/export (no-unknown-fields
  // policy). `unknown` is the index signature type so typed fields are
  // all compatible.
  [key: string]: unknown;
}

export interface CharacterBook {
  name?: string;
  description?: string;
  scan_depth?: number;
  token_budget?: number;
  recursive_scanning?: boolean;
  extensions: Record<string, unknown>;
  entries: CharacterBookEntry[];
}

export interface CharacterBookEntry {
  keys: string[];
  content: string;
  extensions: Record<string, unknown>;
  enabled: boolean;
  insertion_order: number;
  // --- V3 additions (SPEC_V3:290-372) ---
  case_sensitive?: boolean;
  use_regex?: boolean;
  constant?: boolean;
  name?: string;
  priority?: number;
  id?: number | string;
  comment?: string;
  selective?: boolean;
  secondary_keys?: string[];
  position?: 'before_char' | 'after_char';
  // Parse-time detection vessel for lorebook entries: unknown keys captured
  // here are dropped on store/export (no-unknown-fields policy).
  [key: string]: unknown;
}

export interface TavernCardV1 {
  name: string;
  description: string;
  personality: string;
  scenario: string;
  first_mes: string;
  mes_example: string;
}
