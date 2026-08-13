/**
 * Character Card Import Service
 *
 * Orchestrates the import of character cards from PNG or JSON files.
 * Fully local (no network). Reads a picked file, detects type, parses,
 * maps to database models, and persists.
 */

import RNFS from 'react-native-fs';
import {
  extractCharacterCardFromPNG,
  parseCharacterCard,
  mapCardToProfile,
  collectDroppedCardFields,
  CharacterCardParseError,
} from '../utils/charactercard';
import {
  createCharacterProfile,
  createCharacterImage,
  setCharacterProfileSource,
} from '../database/repositories/characters';
import { setCharacterCreator } from '../database/repositories/characterSocial';
import { base64ToUint8Array } from '../database/base64';
import { createLogger } from '../utils/logger';

// ============================================================================
// Types
// ============================================================================

export type CharacterCardImportErrorCode =
  | 'no_file'
  | 'read_failed'
  | 'unsupported_type'
  | 'parse_failed'
  | 'name_required';

export class CharacterCardImportError extends Error {
  code: CharacterCardImportErrorCode;

  constructor(code: CharacterCardImportErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'CharacterCardImportError';
    this.code = code;
  }
}

export interface ImportResult {
  profileId: string;
  name: string;
  hadImage: boolean;
  /** Non-spec card keys detected and dropped on import (empty when the card
   *  was fully spec-conformant). Callers can surface this as a user warning. */
  droppedFields: string[];
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Decode a Uint8Array containing UTF-8 encoded bytes to a JavaScript string.
 * Portable implementation (no TextDecoder/Buffer dependency).
 * Handles 1-4 byte sequences per RFC 3629.
 */
function bytesToUtf8(bytes: Uint8Array): string {
  let result = '';
  let i = 0;

  while (i < bytes.length) {
    const b1 = bytes[i];

    if (b1 < 0x80) {
      // 1-byte sequence: U+0000 – U+007F
      result += String.fromCharCode(b1);
      i += 1;
    } else if (b1 >= 0xC0 && b1 < 0xE0) {
      // 2-byte sequence: U+0080 – U+07FF
      const b2 = bytes[i + 1];
      result += String.fromCharCode(((b1 & 0x1F) << 6) | (b2 & 0x3F));
      i += 2;
    } else if (b1 >= 0xE0 && b1 < 0xF0) {
      // 3-byte sequence: U+0800 – U+FFFF
      const b2 = bytes[i + 1];
      const b3 = bytes[i + 2];
      result += String.fromCharCode(
        ((b1 & 0x0F) << 12) | ((b2 & 0x3F) << 6) | (b3 & 0x3F),
      );
      i += 3;
    } else if (b1 >= 0xF0 && b1 < 0xF8) {
      // 4-byte sequence: U+10000 – U+10FFFF → surrogate pair
      const b2 = bytes[i + 1];
      const b3 = bytes[i + 2];
      const b4 = bytes[i + 3];
      let codePoint =
        ((b1 & 0x07) << 18) |
        ((b2 & 0x3F) << 12) |
        ((b3 & 0x3F) << 6) |
        (b4 & 0x3F);
      codePoint -= 0x10000;
      result += String.fromCharCode(
        0xD800 + (codePoint >> 10),
        0xDC00 + (codePoint & 0x3FF),
      );
      i += 4;
    } else {
      // Invalid or stray continuation byte — skip
      i += 1;
    }
  }

  return result;
}

const log = createLogger('[CharacterCardImportService]');

// ============================================================================
// Main API
// ============================================================================

/**
 * Import a character card from a local file URI.
 *
 * Reads the file, detects PNG vs JSON, parses the card, maps it to
 * database models, persists both profile and optional image, and
 * returns the result.
 *
 * @param uri  Local file URI (e.g. from a document picker).
 * @param mime MIME type of the picked file (may be empty).
 * @param creator Optional cloud-user info to record as the character creator
 *                (drives the creator badge + creator-only edit buttons). When
 *                omitted, no creator is recorded for the imported card.
 * @throws CharacterCardImportError on known import failures.
 * @throws Database errors propagate directly (caller's catch handles them).
 */
export async function importCharacterCardFromFile(
  uri: string,
  mime: string,
  creator?: {
    creatorUserId: string;
    creatorDisplayName: string;
    creatorAvatarUrl: string | null;
  },
): Promise<ImportResult> {
  // Step 1: Validate URI
  if (!uri) {
    throw new CharacterCardImportError('no_file');
  }

  // Step 2: Read file as base64
  let b64: string;
  try {
    b64 = await RNFS.readFile(uri, 'base64');
  } catch {
    throw new CharacterCardImportError('read_failed');
  }

  // Step 3: Detect type from MIME and/or file extension
  const lowerMime = (mime || '').toLowerCase();
  const lowerUri = uri.toLowerCase();

  const isPNG = lowerMime === 'image/png' || lowerUri.endsWith('.png');
  const isJSON =
    lowerMime === 'application/json' || lowerUri.endsWith('.json');

  let card: ReturnType<typeof parseCharacterCard>;
  let imageBytes: Uint8Array | undefined;

  if (isPNG) {
    // PNG: decode base64 → bytes → extract embedded card + raw image data
    const bytes = base64ToUint8Array(b64);
    try {
      const result = extractCharacterCardFromPNG(bytes);
      card = result.card;
      imageBytes = result.imageBytes;
    } catch {
      throw new CharacterCardImportError('parse_failed');
    }
  } else if (isJSON) {
    // JSON: decode base64 → bytes → UTF-8 string → parse JSON
    const bytes = base64ToUint8Array(b64);
    const text = bytesToUtf8(bytes);
    try {
      card = parseCharacterCard(text);
    } catch {
      throw new CharacterCardImportError('parse_failed');
    }
    // imageBytes remains undefined — no embedded image for JSON cards
  } else {
    throw new CharacterCardImportError('unsupported_type');
  }

  // Detect non-spec keys before mapping so they can be reported. The mapper
  // drops them (no-unknown-fields policy); surface the list as a warning.
  const droppedFields = collectDroppedCardFields(card);
  if (droppedFields.length > 0) {
    log.warn(
      `Character card "${card.data?.name ?? '?'}" carries ${droppedFields.length} ` +
        `non-spec field(s) that were dropped on import: ${droppedFields.join(', ')}`,
    );
  }

  // Step 4: Map to profile + optional image
  let mapped: ReturnType<typeof mapCardToProfile>;
  try {
    mapped = mapCardToProfile(card, imageBytes);
  } catch (e) {
    if (e instanceof CharacterCardParseError) {
      throw new CharacterCardImportError('name_required');
    }
    throw new CharacterCardImportError('parse_failed');
  }

  // Step 5: Persist
  try {
    await createCharacterProfile(mapped.profile);
    // Imported cards are the CURRENT user's own characters — tag them as
    // 'user' so they do not appear on THIS user's Discover grid. They still
    // sync up to the engine and will appear on OTHER users' Discover grids.
    await setCharacterProfileSource(mapped.profile.id, 'user');
    if (creator) {
      try {
        await setCharacterCreator({
          profileId: mapped.profile.id,
          ...creator,
        });
      } catch (err) {
        log.warn('Failed to record character creator:', err);
      }
    }
    if (mapped.image) {
      await createCharacterImage(mapped.image);
    }
  } catch (e) {
    log.error('Persistence failed:', e);
    throw e;
  }

  // Step 6: Return result
  return {
    profileId: mapped.profile.id,
    name: mapped.profile.name,
    hadImage: !!mapped.image,
    droppedFields,
  };
}
