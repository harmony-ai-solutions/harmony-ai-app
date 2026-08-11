/**
 * Lorebook data helpers (3-4).
 *
 * The `CharacterProfile.character_book` column is a JSON **string** (§1-3).
 * Defensive parsing for parity with the engine, which may sync a profile whose
 * book is `""`, `'null'`, or invalid JSON:
 *
 *   parseLorebook(col): `!col || col === '' || col === 'null'` → null;
 *   else `JSON.parse(col)` (try/catch → null).
 *
 * All edits write back through `JSON.stringify` — the book round-trips
 * losslessly through the editor (the engine re-embeds on profile save).
 */

import type {
  CharacterBook,
  CharacterBookEntry,
} from '../../utils/charactercard/types';

/**
 * Parse a `character_book` column value into a `CharacterBook`, or `null` when
 * the column is empty / `'null'` / invalid JSON (defensive — engine parity).
 */
export function parseLorebook(
  col: string | null | undefined,
): CharacterBook | null {
  if (!col || col === '' || col === 'null') return null;
  try {
    const parsed = JSON.parse(col);
    return parsed && typeof parsed === 'object' ? (parsed as CharacterBook) : null;
  } catch {
    return null;
  }
}

/** Parse a generic JSON-string column (tags/extensions/assets/…). */
export function parseJsonColumn<T>(col: string | null | undefined): T | null {
  if (!col || col === '' || col === 'null') return null;
  try {
    return JSON.parse(col) as T;
  } catch {
    return null;
  }
}

/** An empty book scaffold for "add first entry". */
export function createEmptyLorebook(): CharacterBook {
  return { entries: [], extensions: {} };
}

/** Sensible defaults for newly created entries (3-4). */
export function createDefaultLorebookEntry(): CharacterBookEntry {
  return {
    keys: [],
    content: '',
    extensions: {},
    enabled: true,
    insertion_order: 10,
    position: 'before_char',
    case_sensitive: false,
    use_regex: false,
    constant: false,
    selective: false,
    secondary_keys: [],
  };
}

/** Count of constant entries (header badge). */
export function countConstantEntries(book: CharacterBook | null): number {
  return (book?.entries ?? []).filter(e => e.constant).length;
}
