/**
 * Character Card Mapper
 *
 * Faithful port of harmony-link-private/utils/charactercard/mapper.go
 *
 * Maps a TavernCardV2 to CharacterProfile + CharacterImage,
 * matching the database models exactly.
 *
 * 1:1 field mapping: card fields map directly to profile columns with no
 * reformatting. JSON columns (arrays, objects) are stored via JSON.stringify.
 * The character_book is stripped to spec-modeled fields (top-level + entries)
 * before storage; non-spec keys are dropped on import (no-unknown-fields
 * policy). Use `collectDroppedCardFields` to surface dropped keys as an import
 * warning.
 */

import { CharacterCardParseError, TavernCardV2, CharacterBook, CharacterBookEntry } from './types';
import { generateId } from '../uuid';
import { uint8ArrayToBase64 } from '../../database/base64';
import type { CharacterProfile, CharacterImage } from '../../database/models';

/**
 * Map a TavernCardV2 to a CharacterProfile and optional CharacterImage.
 *
 * Mirrors Go MapToCharacterProfile exactly, adapting for the TS type system:
 * - Generates a new UUID v7 id via generateId()
 * - Maps card fields 1:1 to the CharacterProfile schema (JSON.stringify for
 *   array/object columns; character_book stripped to spec fields)
 * - Keeps the Harmony-extension defaults (voice_characteristics='',
 *   typing_speed_wpm=60, audio_response_chance_percent=50)
 * - If imageBytes provided (the PNG's embedded primary image), creates a
 *   CharacterImage with base64-encoded PNG data (display icon extraction)
 *
 * @throws CharacterCardParseError if card.data.name is empty
 */
export function mapCardToProfile(
  card: TavernCardV2,
  imageBytes?: Uint8Array,
): {
  profile: Omit<CharacterProfile, 'created_at' | 'updated_at' | 'deleted_at'>;
  image: Omit<CharacterImage, 'id' | 'created_at' | 'deleted_at'> | null;
} {
  if (!card.data?.name) {
    throw new CharacterCardParseError('character card must have a name');
  }

  const profileId = generateId();

  // Fold the V3 provenance fields (card-level spec/spec_version + data-level
  // source/creation_date/modification_date/creator_notes_multilingual) into a
  // single JSON object. Keys are always present (missing -> null) so the shape
  // is deterministic and stays in lockstep with the Go mapper. Unknown data
  // keys are NOT stored (no-unknown-fields policy); use collectDroppedCardFields
  // to surface them as an import warning.
  const cardProvenance: Record<string, unknown> = {
    spec: card.spec ?? null,
    spec_version: card.spec_version ?? null,
    source: card.data.source ?? null,
    creation_date: card.data.creation_date ?? null,
    modification_date: card.data.modification_date ?? null,
    creator_notes_multilingual: card.data.creator_notes_multilingual ?? null,
  };

  const profile: Omit<CharacterProfile, 'created_at' | 'updated_at' | 'deleted_at'> = {
    id: profileId,
    name: card.data.name,
    description: card.data.description ?? '',
    personality: card.data.personality ?? '',
    voice_characteristics: '', // Harmony-extension default
    base_prompt: card.data.system_prompt ?? '',
    scenario: card.data.scenario ?? '',
    typing_speed_wpm: 60, // Harmony-extension default
    audio_response_chance_percent: 50, // Harmony-extension default
    vision_config_id: null,
    lifecycle_config: '{}',
    // --- Character Card V3 standard fields (1:1 mapping; migration 000037) ---
    first_mes: card.data.first_mes ?? '',
    mes_example: card.data.mes_example ?? '',
    alternate_greetings: JSON.stringify(card.data.alternate_greetings ?? null),
    post_history_instructions: card.data.post_history_instructions ?? '',
    creator_notes: card.data.creator_notes ?? '',
    creator: card.data.creator ?? '',
    character_version: card.data.character_version ?? '',
    nickname: card.data.nickname ?? '',
    tags: JSON.stringify(card.data.tags ?? null),
    group_only_greetings: JSON.stringify(card.data.group_only_greetings ?? null),
    extensions: JSON.stringify(card.data.extensions ?? null),
    assets: JSON.stringify(card.data.assets ?? null),
    card_provenance: JSON.stringify(cardProvenance),
    // character_book stripped to spec-modeled fields; non-spec keys dropped.
    character_book: JSON.stringify(
      card.data.character_book ? stripBookToSpec(card.data.character_book) : null,
    ),
  };

  let image: Omit<CharacterImage, 'id' | 'created_at' | 'deleted_at'> | null = null;

  if (imageBytes && imageBytes.length > 0) {
    image = {
      character_profile_id: profileId,
      image_data: uint8ArrayToBase64(imageBytes),
      mime_type: 'image/png',
      description: '',
      is_primary: true,
      display_order: 0,
      vl_model_interpretation: '',
      vl_model: '',
      updated_at: new Date(),
    };
  }

  return { profile, image };
}

// ============================================================================
// Spec key sets + detection / stripping helpers (no-unknown-fields policy)
//
// Mirrors harmony-link-private/utils/charactercard/types.go known-key sets.
// Unknown keys are detected for the import warning and stripped before storage;
// they are never persisted or re-exported.
// ============================================================================

/** Modeled card top-level keys. */
const KNOWN_CARD_TOP_LEVEL_KEYS = new Set<string>(['spec', 'spec_version', 'data']);

/** Modeled V3 card `data` keys (V2 + V3 fields). Mirrors Go `cardV3DataKeys`. */
const KNOWN_CARD_DATA_KEYS = new Set<string>([
  'name', 'description', 'personality', 'scenario', 'first_mes', 'mes_example',
  'creator_notes', 'system_prompt', 'post_history_instructions', 'alternate_greetings',
  'character_book', 'tags', 'creator', 'character_version', 'extensions',
  'assets', 'nickname', 'creator_notes_multilingual', 'source',
  'group_only_greetings', 'creation_date', 'modification_date',
]);

/** Modeled lorebook (character_book) keys. Mirrors Go `characterBookKeys`. */
const KNOWN_BOOK_KEYS = new Set<string>([
  'name', 'description', 'scan_depth', 'token_budget', 'recursive_scanning',
  'extensions', 'entries',
]);

/** Modeled lorebook entry keys. Mirrors Go `characterBookEntryKeys`. */
const KNOWN_ENTRY_KEYS = new Set<string>([
  'keys', 'content', 'extensions', 'enabled', 'insertion_order',
  'case_sensitive', 'use_regex', 'constant', 'name', 'priority',
  'id', 'comment', 'selective', 'secondary_keys', 'position',
]);

/**
 * Collect the dotted paths of every non-spec key on the card (top-level,
 * data-level, and nested inside character_book + each entry). Importers should
 * log a warning when this is non-empty so users know foreign/unsupported fields
 * were dropped (and are never stored or re-exported). Mirrors Go
 * `CollectDroppedCardFields`; returns a sorted array.
 */
export function collectDroppedCardFields(card: TavernCardV2): string[] {
  const dropped: string[] = [];

  // Top-level unknown keys.
  for (const key of Object.keys(card)) {
    if (!KNOWN_CARD_TOP_LEVEL_KEYS.has(key)) {
      dropped.push(key);
    }
  }

  // Data-level unknown keys.
  for (const key of Object.keys(card.data ?? {})) {
    if (!KNOWN_CARD_DATA_KEYS.has(key)) {
      dropped.push(`data.${key}`);
    }
  }

  // Nested lorebook unknown keys (book-level + per-entry).
  const book = card.data?.character_book;
  if (book) {
    for (const key of Object.keys(book)) {
      if (!KNOWN_BOOK_KEYS.has(key)) {
        dropped.push(`data.character_book.${key}`);
      }
    }
    for (let i = 0; i < (book.entries?.length ?? 0); i++) {
      const entry = book.entries[i];
      for (const key of Object.keys(entry)) {
        if (!KNOWN_ENTRY_KEYS.has(key)) {
          dropped.push(`data.character_book.entries[${i}].${key}`);
        }
      }
    }
  }

  return dropped.sort();
}

/**
 * Build a spec-conforming lorebook object containing only modeled keys. Unknown
 * book-level and entry-level keys are omitted (no-unknown-fields policy). The
 * `extensions` open map is preserved (it is the spec's designated extension
 * point). Returns `null` when the input is null/undefined.
 */
function stripBookToSpec(book: CharacterBook | null | undefined): CharacterBook | null {
  if (!book) {
    return null;
  }
  return {
    ...(book.name !== undefined ? { name: book.name } : {}),
    ...(book.description !== undefined ? { description: book.description } : {}),
    ...(book.scan_depth !== undefined ? { scan_depth: book.scan_depth } : {}),
    ...(book.token_budget !== undefined ? { token_budget: book.token_budget } : {}),
    ...(book.recursive_scanning !== undefined ? { recursive_scanning: book.recursive_scanning } : {}),
    extensions: book.extensions ?? {},
    entries: (book.entries ?? []).map(stripEntryToSpec),
  };
}

/**
 * Build a spec-conforming lorebook entry containing only modeled keys. Unknown
 * keys are omitted; `extensions` (the spec's open extension map) is preserved.
 */
function stripEntryToSpec(entry: CharacterBookEntry): CharacterBookEntry {
  const clean: CharacterBookEntry = {
    keys: entry.keys ?? [],
    content: entry.content ?? '',
    extensions: entry.extensions ?? {},
    enabled: entry.enabled ?? false,
    insertion_order: entry.insertion_order ?? 0,
  };
  // Optional V3 entry fields — only include when present.
  if (entry.case_sensitive !== undefined) clean.case_sensitive = entry.case_sensitive;
  if (entry.use_regex !== undefined) clean.use_regex = entry.use_regex;
  if (entry.constant !== undefined) clean.constant = entry.constant;
  if (entry.name !== undefined) clean.name = entry.name;
  if (entry.priority !== undefined) clean.priority = entry.priority;
  if (entry.id !== undefined) clean.id = entry.id;
  if (entry.comment !== undefined) clean.comment = entry.comment;
  if (entry.selective !== undefined) clean.selective = entry.selective;
  if (entry.secondary_keys !== undefined) clean.secondary_keys = entry.secondary_keys;
  if (entry.position !== undefined) clean.position = entry.position;
  return clean;
}
