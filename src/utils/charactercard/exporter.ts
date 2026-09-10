/**
 * Character Card V3 Exporter (4-2) — app-side mirror of the Go exporter (4-1).
 *
 * Reverses `mapCardToProfile` (mapper.ts): a `CharacterProfile` (+ images) is
 * lifted back into a spec-conformant `TavernCardV3` card (SPEC_V3).
 *
 * ## Canonical JSON-card output (cross-side parity contract)
 *
 * The JSON-card object is emitted with a **canonical key order** that matches
 * the Go exporter's field order (`harmony-link-private/utils/charactercard/
 * types.go` — `TavernCardV3Data` embeds `TavernCardV2Data`, then the V3-only
 * fields). Both sides MUST emit this exact order so exports are interchangeable
 * at the JSON-card level; the 4-4 parity test asserts spec-conformance against
 * it. Canonical order:
 *
 *   spec, spec_version,
 *   data: {
 *     name, description, personality, scenario, first_mes, mes_example,
 *     creator_notes, system_prompt, post_history_instructions,
 *     alternate_greetings, [character_book], tags, creator, character_version,
 *     extensions, [assets], [nickname], [creator_notes_multilingual],
 *     [source], group_only_greetings, [creation_date], modification_date
 *   }
 *
 * Optional V3 fields (`character_book`, `assets`, `nickname`,
 * `creator_notes_multilingual`, `source`, `creation_date`) are **omitted** when
 * absent (mirrors Go `omitempty`; the spec treats them as undefined — emitting
 * `null` would violate SPEC_V3:135 "Lorebook object or undefined"). Required
 * V3 fields (`group_only_greetings`, `modification_date`) are always present.
 *
 * `modification_date` is always bumped to `now` on export (SPEC_V3:205-207 —
 * "application SHOULD add or modify this field when the character card is
 * exported"). `source`/`creation_date` are preserved from `card_provenance`.
 */

import type {
  TavernCardV3,
  TavernCardV2Data,
  CharacterCardAsset,
  CharacterBook,
} from './types';
import type { CharacterProfile, CharacterImage } from '../../database/models';
import { uint8ArrayToBase64 } from '../../database/base64';
import { buildPngWithTextChunks, utf8Encode } from './pngWriter';

/**
 * The subset of `CharacterProfile` the exporter reads. Exactly the shape
 * `mapCardToProfile` returns (and a full `CharacterProfile` satisfies it), so
 * both the mapper round-trip and the editor's form state can feed the exporter.
 */
export type ExportableCharacterProfile = Omit<
  CharacterProfile,
  'created_at' | 'updated_at' | 'deleted_at'
>;

// ============================================================================
// JSON-column parsing (defensive — engine may sync 'null'/''/invalid JSON)
// ============================================================================

/** Parse a JSON-string array column to `string[]` (defensive, never throws). */
function parseStringArray(col: string | null | undefined): string[] {
  if (!col || col === '' || col === 'null') return [];
  try {
    const parsed = JSON.parse(col);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === 'string');
  } catch {
    return [];
  }
}

/** Parse a JSON-string object column to a record (defensive, never throws). */
function parseObject(col: string | null | undefined): Record<string, unknown> {
  if (!col || col === '' || col === 'null') return {};
  try {
    const parsed = JSON.parse(col);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
}

/**
 * Parse the `character_book` JSON column **verbatim** into a `CharacterBook`.
 * `'null'` / `''` / invalid JSON → `null` (no book; the key is omitted from the
 * card — SPEC_V3:135 allows undefined).
 */
function parseBook(col: string | null | undefined): CharacterBook | null {
  if (!col || col === '' || col === 'null') return null;
  try {
    const parsed = JSON.parse(col);
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      !Array.isArray((parsed as CharacterBook).entries)
    ) {
      return null;
    }
    return parsed as CharacterBook;
  } catch {
    return null;
  }
}

/**
 * Resolve the `assets` array for export.
 *
 * 1. The `assets` JSON column wins when it holds an array (verbatim).
 * 2. Otherwise (absent column), synthesize the spec-default icon asset from the
 *    primary image as a base64 data URL so the exported card is self-contained
 *    (SPEC_V3:174 allows base64 data URLs).
 * 3. Neither → undefined (key omitted).
 */
function resolveAssets(
  col: string | null | undefined,
  images: CharacterImage[],
): CharacterCardAsset[] | undefined {
  if (col && col !== '' && col !== 'null') {
    try {
      const parsed = JSON.parse(col);
      if (Array.isArray(parsed)) return parsed as CharacterCardAsset[];
    } catch {
      // Fall through to image synthesis.
    }
  }
  const primary = images.find(i => i.is_primary) ?? images[0];
  if (primary && primary.image_data) {
    const mime = primary.mime_type || 'image/png';
    return [
      {
        type: 'icon',
        uri: `data:${mime};base64,${primary.image_data}`,
        name: 'main',
        ext: mimeTypeToExt(mime),
      },
    ];
  }
  return undefined;
}

/** Best-effort extension from a mime type (spec `ext` must be lowercase, no dot). */
function mimeTypeToExt(mime: string | null | undefined): string {
  const m = (mime ?? '').toLowerCase();
  if (m.includes('png')) return 'png';
  if (m.includes('jpeg') || m.includes('jpg')) return 'jpg';
  if (m.includes('webp')) return 'webp';
  if (m.includes('gif')) return 'gif';
  if (m.includes('avif')) return 'avif';
  if (m.includes('heic')) return 'heic';
  return 'unknown';
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Lift a `CharacterProfile` (+ images) into a spec-conformant V3 card.
 *
 * Column mapping (reverses mapper.ts):
 *   base_prompt → system_prompt; JSON columns (alternate_greetings / tags /
 *   group_only_greetings / extensions / assets) are JSON-decoded;
 *   `character_book` is taken verbatim from its JSON column (defensive);
 *   `card_provenance` → `source` / `creation_date` /
 *   `creator_notes_multilingual`, with `modification_date` bumped to now.
 */
export function exportProfileToCardV3(
  profile: ExportableCharacterProfile,
  images: CharacterImage[],
): TavernCardV3 {
  const provenance = parseObject(profile.card_provenance);

  const book = parseBook(profile.character_book);
  const assets = resolveAssets(profile.assets, images);
  const nickname = profile.nickname?.trim();
  const source = Array.isArray(provenance.source)
    ? (provenance.source as string[])
    : undefined;
  const creationDate =
    typeof provenance.creation_date === 'number'
      ? (provenance.creation_date as number)
      : undefined;
  const multilingual =
    provenance.creator_notes_multilingual &&
    typeof provenance.creator_notes_multilingual === 'object' &&
    !Array.isArray(provenance.creator_notes_multilingual)
      ? (provenance.creator_notes_multilingual as Record<string, string>)
      : undefined;
  // Unknown data keys are NOT restored: the no-unknown-fields policy drops them
  // on import, so there is nothing to restore on export (mirrors Go exporter).

  // Canonical key order (see header) — conditionals are inlined so the emitted
  // JSON key sequence is byte-stable and matches the Go exporter.
  const data = {
    name: profile.name,
    description: profile.description ?? '',
    personality: profile.personality ?? '',
    scenario: profile.scenario ?? '',
    first_mes: profile.first_mes ?? '',
    mes_example: profile.mes_example ?? '',
    creator_notes: profile.creator_notes ?? '',
    system_prompt: profile.base_prompt ?? '', // base_prompt → system_prompt
    post_history_instructions: profile.post_history_instructions ?? '',
    alternate_greetings: parseStringArray(profile.alternate_greetings),
    ...(book ? { character_book: book } : {}),
    tags: parseStringArray(profile.tags),
    creator: profile.creator ?? '',
    character_version: profile.character_version ?? '',
    extensions: parseObject(profile.extensions),
    ...(assets ? { assets } : {}),
    ...(nickname ? { nickname } : {}),
    ...(multilingual ? { creator_notes_multilingual: multilingual } : {}),
    ...(source ? { source } : {}),
    group_only_greetings: parseStringArray(profile.group_only_greetings),
    ...(creationDate !== undefined ? { creation_date: creationDate } : {}),
    // modification_date is always bumped on export (SPEC_V3:205-207).
    modification_date: Math.floor(Date.now() / 1000),
  } as TavernCardV2Data;

  return {
    spec: 'chara_card_v3',
    spec_version: '3.0',
    data,
  };
}

/**
 * Serialize a card to the canonical JSON-card string (compact).
 * Spec embedding: JSON files MUST be a CharacterCardV3 object (SPEC_V3:34).
 */
export function exportToJSON(card: TavernCardV3): string {
  return JSON.stringify(card);
}

/**
 * Encode a card into a PNG carrying a `ccv3` tEXt chunk.
 *
 * Spec embedding (SPEC_V3:24): the chunk value MUST be the JSON string of the
 * card, utf-8 → base64 encoded. The emitted PNG is a minimal 1×1 truecolor
 * image whose only payload is the `ccv3` chunk.
 */
export function exportToPNG(card: TavernCardV3): Uint8Array {
  const json = exportToJSON(card);
  const b64 = uint8ArrayToBase64(utf8Encode(json));
  return buildPngWithTextChunks([{ keyword: 'ccv3', text: b64 }]);
}
