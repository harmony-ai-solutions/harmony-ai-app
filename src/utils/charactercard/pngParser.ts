/**
 * PNG Character Card Extractor
 *
 * Faithful port of harmony-link-private/utils/charactercard/png_parser.go
 *
 * Walks PNG chunks looking for tEXt/iTXt chunks with keyword "chara" or "ccv3",
 * base64-decodes the embedded JSON, and parses it into a TavernCardV2.
 */

import { CharacterCardParseError, TavernCardV2 } from './types';
import { parseCharacterCard } from './jsonParser';

// ============================================================================
// Internal helpers
// ============================================================================

/** Read a big-endian uint32 at offset (always unsigned, uses multiplication). */
function readUint32BE(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset] * 0x1000000 +
    bytes[offset + 1] * 0x10000 +
    bytes[offset + 2] * 0x100 +
    bytes[offset + 3]
  );
}

/** Convert Uint8Array to ASCII/Latin-1 string (safe for chunk types, keywords, base64 text). */
function bytesToString(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    out += String.fromCharCode(bytes[i]);
  }
  return out;
}

/** Portable UTF-8 byte sequence decoder (avoids TextDecoder dependency). */
function utf8BytesToString(bytes: Uint8Array): string {
  let result = '';
  let i = 0;
  while (i < bytes.length) {
    const b1 = bytes[i];
    if (b1 < 0x80) {
      result += String.fromCharCode(b1);
      i += 1;
    } else if (b1 < 0xC0) {
      // Stray continuation byte — skip
      i += 1;
    } else if (b1 < 0xE0) {
      const b2 = bytes[i + 1];
      result += String.fromCharCode(((b1 & 0x1F) << 6) | (b2 & 0x3F));
      i += 2;
    } else if (b1 < 0xF0) {
      const b2 = bytes[i + 1];
      const b3 = bytes[i + 2];
      result += String.fromCharCode(
        ((b1 & 0x0F) << 12) | ((b2 & 0x3F) << 6) | (b3 & 0x3F),
      );
      i += 3;
    } else {
      const b2 = bytes[i + 1];
      const b3 = bytes[i + 2];
      const b4 = bytes[i + 3];
      const cp =
        ((b1 & 0x07) << 18) |
        ((b2 & 0x3F) << 12) |
        ((b3 & 0x3F) << 6) |
        (b4 & 0x3F);
      result += String.fromCodePoint(cp);
      i += 4;
    }
  }
  return result;
}

// Base64 lookup table (standard alphabet, same as base64.ts encoding)
const BASE64_LOOKUP: Record<string, number> = {};
const BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
for (let i = 0; i < 64; i++) {
  BASE64_LOOKUP[BASE64_CHARS[i]] = i;
}

/**
 * Decode a standard-base64 string into a UTF-8 string.
 * Returns null on invalid input (mirrors Go: only uses decoded result on success).
 */
export function base64DecodeToUtf8(input: string): string | null {
  try {
    // Strip any whitespace (PNG chunk data may have padding)
    const cleaned = input.replace(/[^A-Za-z0-9+/=]/g, '');
    if (cleaned.length === 0) return null;

    // Remove padding characters
    const padIdx = cleaned.indexOf('=');
    const sanitized = padIdx >= 0 ? cleaned.slice(0, padIdx) : cleaned;

    const bytes: number[] = [];
    for (let i = 0; i < sanitized.length; i += 4) {
      const a = BASE64_LOOKUP[sanitized[i]];
      const b = BASE64_LOOKUP[sanitized[i + 1]];
      if (a === undefined || b === undefined) return null;

      bytes.push((a << 2) | (b >> 4));

      if (i + 2 < sanitized.length) {
        const c = BASE64_LOOKUP[sanitized[i + 2]];
        if (c === undefined) return null;
        bytes.push(((b & 0x0F) << 4) | (c >> 2));

        if (i + 3 < sanitized.length) {
          const d = BASE64_LOOKUP[sanitized[i + 3]];
          if (d === undefined) return null;
          bytes.push(((c & 0x03) << 6) | d);
        }
      }
    }

    return utf8BytesToString(new Uint8Array(bytes));
  } catch {
    return null;
  }
}

// ============================================================================
// Public API
// ============================================================================

const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

/**
 * Walk PNG chunks and return all tEXt/iTXt chunks whose keyword is "chara" or "ccv3".
 * Does NOT stop at the first match (unlike extractCharacterCardFromPNG which follows Go exactly).
 */
export function findCharacterCardTextChunks(
  bytes: Uint8Array,
): { keyword: string; text: string }[] {
  // Validate PNG signature
  for (let i = 0; i < 8; i++) {
    if (bytes[i] !== PNG_SIGNATURE[i]) {
      throw new CharacterCardParseError('not a valid PNG file');
    }
  }

  const chunks: { keyword: string; text: string }[] = [];
  let offset = 8;

  while (offset < bytes.length) {
    // Read 4-byte length (big-endian uint32)
    if (offset + 4 > bytes.length) break;
    const length = readUint32BE(bytes, offset);
    offset += 4;

    // Read 4-byte chunk type
    if (offset + 4 > bytes.length) break;
    const chunkTypeBytes = bytes.slice(offset, offset + 4);
    offset += 4;

    // Read chunk data (length bytes)
    if (offset + length > bytes.length) break;
    const chunkData = bytes.slice(offset, offset + length);
    offset += length;

    // Skip 4-byte CRC
    if (offset + 4 > bytes.length) break;
    offset += 4;

    // Only process tEXt and iTXt chunks
    const typeStr = bytesToString(chunkTypeBytes);
    if (typeStr !== 'tEXt' && typeStr !== 'iTXt') {
      continue;
    }

    // Find null terminator for keyword
    const nullIdx = chunkData.indexOf(0);
    if (nullIdx === -1) continue;

    const keyword = bytesToString(chunkData.slice(0, nullIdx));
    if (keyword !== 'chara' && keyword !== 'ccv3') {
      continue;
    }

    let text: string;

    if (typeStr === 'iTXt') {
      // iTXt layout:
      //   Keyword (null-terminated)
      //   Compression Flag (1 byte)
      //   Compression Method (1 byte)
      //   Language Tag (null-terminated)
      //   Translated Keyword (null-terminated)
      //   Text
      let dataStart = nullIdx + 1 + 2; // skip keyword null + compression flag + method

      // Skip language tag
      const langIdx = chunkData.subarray(dataStart).indexOf(0);
      if (langIdx === -1) continue;
      dataStart += langIdx + 1;

      // Skip translated keyword
      const transIdx = chunkData.subarray(dataStart).indexOf(0);
      if (transIdx === -1) continue;
      dataStart += transIdx + 1;

      text = bytesToString(chunkData.slice(dataStart));
    } else {
      // tEXt layout:
      //   Keyword (null-terminated)
      //   Text
      text = bytesToString(chunkData.slice(nullIdx + 1));
    }

    chunks.push({ keyword, text });
  }

  return chunks;
}

/**
 * Extract a character card from a PNG image byte buffer.
 *
 * - Validates PNG signature
 * - Scans ALL tEXt/iTXt chunks for the "chara" / "ccv3" keywords
 * - PREFERS the "ccv3" chunk when both are present (SPEC_V3:28); falls back
 *   to the "chara" chunk otherwise (mirrors the Go side)
 * - Base64-decodes the text content
 * - Parses JSON into TavernCardV2
 * - Returns both the card and the original image bytes
 */
export function extractCharacterCardFromPNG(
  bytes: Uint8Array,
): { card: TavernCardV2; imageBytes: Uint8Array } {
  // findCharacterCardTextChunks validates the PNG signature and collects ALL
  // chara/ccv3 tEXt/iTXt chunks (it does not stop at the first match).
  const chunks = findCharacterCardTextChunks(bytes);

  // Prefer the V3 chunk over the backfilled V2 chunk (SPEC_V3:28).
  const ccv3 = chunks.find((chunk) => chunk.keyword === 'ccv3');
  const selected = ccv3 ?? chunks.find((chunk) => chunk.keyword === 'chara');

  if (!selected) {
    throw new CharacterCardParseError('no character card data found in PNG');
  }

  let jsonStr = selected.text;

  // Attempt base64 decode; fall back to raw text on failure (mirrors Go)
  const decoded = base64DecodeToUtf8(jsonStr);
  if (decoded !== null) {
    jsonStr = decoded;
  }

  const card = parseCharacterCard(jsonStr);
  return { card, imageBytes: bytes };
}
