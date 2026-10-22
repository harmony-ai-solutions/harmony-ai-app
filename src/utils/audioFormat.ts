/**
 * Audio format sniffing + WAV duration parsing.
 *
 * The Soulbits TTS cloud API currently returns WAV bytes even when mp3 is
 * requested (backend bug). Trusting the engine-DECLARED format produced a
 * data-URI mime, a download filename and a duration parse that all lied about
 * the actual bytes (music-metadata refuses `audio/wav` as a guessed mime).
 * These helpers inspect the magic bytes instead, so every consumer can use the
 * ACTUAL format regardless of what the backend declared.
 */
import { Buffer } from 'buffer';

export type AudioFormat = 'wav' | 'mp3' | 'ogg' | 'flac' | 'unknown';

/**
 * Bytes needed to identify every supported container: WAV needs the `WAVE`
 * marker at offset 8, everything else fits in the first 4 bytes. Base64
 * encodes 3 bytes per 4 chars, so 16 chars cover 12 bytes.
 */
const PEEK_BYTES = 12;
const PEEK_BASE64_CHARS = 16;

/** Mime type for a detected (or declared) format. */
const MIME_BY_FORMAT: Record<Exclude<AudioFormat, 'unknown'>, string> = {
  wav: 'audio/wav',
  mp3: 'audio/mpeg',
  ogg: 'audio/ogg',
  flac: 'audio/flac',
};

/** File extension for a detected (or declared) format. */
const EXTENSION_BY_FORMAT: Record<Exclude<AudioFormat, 'unknown'>, string> = {
  wav: 'wav',
  mp3: 'mp3',
  ogg: 'ogg',
  flac: 'flac',
};

/** Read `length` ASCII bytes at `offset`, or null when out of range. */
function asciiAt(buffer: Buffer, offset: number, length: number): string | null {
  if (offset < 0 || offset + length > buffer.length) return null;
  return buffer.toString('ascii', offset, offset + length);
}

/**
 * Decode just the head of a base64 payload (enough for magic-byte matching).
 * Returns null for empty / non-string input.
 */
function peekHeaderBytes(base64Audio: string): Buffer | null {
  if (typeof base64Audio !== 'string' || base64Audio.length === 0) return null;
  // Strip an accidental data-URI prefix (`data:audio/wav;base64,...`).
  const commaIndex = base64Audio.indexOf(',');
  const payload =
    base64Audio.startsWith('data:') && commaIndex >= 0
      ? base64Audio.slice(commaIndex + 1)
      : base64Audio;
  const head = payload.slice(0, PEEK_BASE64_CHARS);
  if (head.length === 0) return null;
  const buffer = Buffer.from(head, 'base64');
  return buffer.length > 0 ? buffer : null;
}

/**
 * Identify an audio container from its magic bytes.
 *
 * - WAV  → `RIFF` at 0 + `WAVE` at 8
 * - MP3  → `ID3` at 0, or an MPEG frame sync (0xFF + top 3 bits set)
 * - OGG  → `OggS`
 * - FLAC → `fLaC`
 *
 * Short/truncated input (or anything else) → `'unknown'`.
 */
export function detectAudioFormat(base64Audio: string): AudioFormat {
  const head = peekHeaderBytes(base64Audio);
  if (!head) return 'unknown';
  // WAV needs 12 bytes for the `WAVE` marker; a shorter RIFF head is truncated.
  if (asciiAt(head, 0, 4) === 'RIFF' && asciiAt(head, 8, 4) === 'WAVE') {
    return 'wav';
  }
  if (asciiAt(head, 0, 3) === 'ID3') return 'mp3';
  // MPEG audio frame sync: 11 set bits (0xFF followed by 0xE0|version|layer).
  if (head.length >= 2 && head[0] === 0xff && (head[1] & 0xe0) === 0xe0) {
    return 'mp3';
  }
  if (asciiAt(head, 0, 4) === 'OggS') return 'ogg';
  if (asciiAt(head, 0, 4) === 'fLaC') return 'flac';
  return 'unknown';
}

/** Mime type for a format (`'unknown'` → `application/octet-stream`). */
export function audioMimeFor(format: AudioFormat): string {
  if (format === 'unknown') return 'application/octet-stream';
  return MIME_BY_FORMAT[format];
}

/** File extension for a format (`'unknown'` → `bin`). */
export function audioExtensionFor(format: AudioFormat): string {
  if (format === 'unknown') return 'bin';
  return EXTENSION_BY_FORMAT[format];
}

/**
 * Duration in seconds of a PCM WAV payload, parsed straight from the RIFF
 * header — no music-metadata involved (its bundled mime guesser rejects
 * `audio/wav`, which is exactly the failure this replaces).
 *
 * Walks the chunk list starting at offset 12 (4-byte ASCII id + 4-byte LE size
 * per descriptor), finds `fmt ` for `byteRate` (LE uint32 at chunk start + 16)
 * and `data` for its size, then `duration = dataSize / byteRate`.
 *
 * Returns null for non-WAV input, missing chunks, zero/absent byteRate, an
 * empty data chunk, or a truncated payload.
 */
export function getWavDurationSeconds(base64Audio: string): number | null {
  if (typeof base64Audio !== 'string' || base64Audio.length === 0) return null;
  // Strip an accidental data-URI prefix before the full decode.
  const commaIndex = base64Audio.indexOf(',');
  const payload =
    base64Audio.startsWith('data:') && commaIndex >= 0
      ? base64Audio.slice(commaIndex + 1)
      : base64Audio;

  let buffer: Buffer;
  try {
    buffer = Buffer.from(payload, 'base64');
  } catch {
    return null;
  }
  if (buffer.length < 12) return null;
  if (asciiAt(buffer, 0, 4) !== 'RIFF' || asciiAt(buffer, 8, 4) !== 'WAVE') {
    return null;
  }

  let byteRate = 0;
  let dataSize = 0;
  let offset = 12;

  while (offset + 8 <= buffer.length) {
    const chunkId = asciiAt(buffer, offset, 4);
    if (chunkId == null) return null; // truncated chunk descriptor
    const chunkSize = buffer.readUInt32LE(offset + 4);
    const chunkDataStart = offset + 8;

    if (chunkId === 'fmt ') {
      // fmt layout: audioFormat(2) channels(2) sampleRate(4) byteRate(4) …
      if (chunkSize < 16 || chunkDataStart + 16 > buffer.length) return null;
      byteRate = buffer.readUInt32LE(chunkDataStart + 8);
    } else if (chunkId === 'data') {
      // A data chunk that runs past the payload is truncated.
      if (chunkDataStart + chunkSize > buffer.length) return null;
      dataSize = chunkSize;
    }

    if (byteRate > 0 && dataSize > 0) {
      return dataSize / byteRate;
    }

    // Chunks are word-aligned: odd-sized chunks carry one pad byte.
    const nextOffset = chunkDataStart + chunkSize + (chunkSize % 2);
    if (nextOffset <= offset) return null; // malformed size — never loop forever
    offset = nextOffset;
  }

  return null;
}
