/**
 * PNG Writer — minimal PNG encoder with tEXt chunks (4-2).
 *
 * Inverts the chunk-walking logic of `pngParser.ts` to WRITE a PNG. Per
 * SPEC_V3:24, the CharacterCardV3 object MUST be embedded in a tEXt chunk named
 * `ccv3` whose value is the JSON string of the card, utf-8 → base64 encoded.
 *
 * The PNG we emit is a minimal valid 1×1 truecolor image whose only payload is
 * the card chunk. Readers (ours, SillyTavern, Risu) prefer the `ccv3` chunk
 * when both `chara` and `ccv3` are present (SPEC_V3:28), so a single `ccv3`
 * chunk is sufficient.
 *
 * Chunk layout mirrors the reader in `pngParser.ts`:
 *   length(4 BE) | type(4) | data(length) | crc32(type+data)(4 BE)
 *
 * The chunk writer is pure TypeScript with no React Native dependencies (the
 * charactercard package is RN-free — see `index.ts`).
 */

const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

// ============================================================================
// UTF-8 / base64 primitives
// ============================================================================

/**
 * Encode a JS string as UTF-8 bytes (portable — no TextEncoder dependency,
 * mirroring the decoder in `pngParser.ts`).
 */
export function utf8Encode(str: string): Uint8Array {
  const bytes: number[] = [];
  for (let i = 0; i < str.length; i++) {
    let cp = str.codePointAt(i)!;
    if (cp > 0xffff) i += 1; // surrogate pair — consumed both units
    if (cp < 0x80) {
      bytes.push(cp);
    } else if (cp < 0x800) {
      bytes.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f));
    } else if (cp < 0x10000) {
      bytes.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    } else {
      bytes.push(
        0xf0 | (cp >> 18),
        0x80 | ((cp >> 12) & 0x3f),
        0x80 | ((cp >> 6) & 0x3f),
        0x80 | (cp & 0x3f),
      );
    }
  }
  return new Uint8Array(bytes);
}

/** ASCII/Latin-1 string → bytes (safe for chunk types, keywords, base64 text). */
function asciiBytes(str: string): Uint8Array {
  const bytes = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) {
    bytes[i] = str.charCodeAt(i) & 0xff;
  }
  return bytes;
}

// ============================================================================
// CRC-32 (PNG uses the standard zlib CRC-32, polynomial 0xEDB88320)
// ============================================================================

const CRC_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  return table;
})();

/** CRC-32 of `bytes`, returned as an unsigned 32-bit value. */
export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

// ============================================================================
// Chunk + PNG assembly
// ============================================================================

function writeUint32BE(out: number[], value: number): void {
  out.push(
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  );
}

/** Append one chunk (length | type | data | crc32(type+data)) to `out`. */
function writeChunk(out: number[], type: string, data: number[]): void {
  writeUint32BE(out, data.length);
  const typeBytes = asciiBytes(type);
  const crcPayload = new Uint8Array(typeBytes.length + data.length);
  crcPayload.set(typeBytes, 0);
  crcPayload.set(data, typeBytes.length);
  for (let i = 0; i < typeBytes.length; i++) out.push(typeBytes[i]);
  for (let i = 0; i < data.length; i++) out.push(data[i]);
  writeUint32BE(out, crc32(crcPayload));
}

/**
 * Build a minimal valid PNG (1×1 truecolor) carrying the given tEXt chunks.
 *
 * tEXt chunk data layout (same shape the reader in `pngParser.ts` walks):
 *   keyword (null-terminated) | text
 *
 * `text` is written verbatim as latin-1 bytes — callers pass the already
 * base64-encoded payload (base64 is pure ASCII).
 */
export function buildPngWithTextChunks(
  chunks: { keyword: string; text: string }[],
): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < PNG_SIGNATURE.length; i++) out.push(PNG_SIGNATURE[i]);

  // IHDR: width=1, height=1, bit depth=8, color type=2 (truecolor),
  // compression=0, filter=0, interlace=0 (13 bytes).
  writeChunk(out, 'IHDR', [0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0]);

  for (const chunk of chunks) {
    const keyword = asciiBytes(chunk.keyword);
    const text = asciiBytes(chunk.text);
    const data: number[] = [];
    for (let i = 0; i < keyword.length; i++) data.push(keyword[i]);
    data.push(0); // NUL terminator
    for (let i = 0; i < text.length; i++) data.push(text[i]);
    writeChunk(out, 'tEXt', data);
  }

  writeChunk(out, 'IEND', []);
  return new Uint8Array(out);
}
