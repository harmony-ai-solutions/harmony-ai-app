/**
 * Shared audio fixtures for the audio-format / AudioPlayer / TtsTestPanel
 * suites. Not a test file (no `*.test.ts` suffix), so Jest never runs it.
 */
import { Buffer } from 'buffer';

export interface WavFixtureOptions {
  sampleRate?: number;
  channels?: number;
  bitsPerSample?: number;
  /** Data-chunk duration in seconds (drives the byte size). */
  durationSeconds?: number;
  /** Override the exact data-chunk byte size (defaults to byteRate * duration). */
  dataBytes?: number;
  /** Override the byteRate written into the fmt chunk (0 = invalid header). */
  byteRateOverride?: number;
}

export interface WavFixture {
  buffer: Buffer;
  base64: string;
  byteRate: number;
  dataSize: number;
  durationSeconds: number;
}

/**
 * Build a minimal, valid PCM WAV: RIFF/WAVE header + `fmt ` (16 bytes) +
 * `data` chunk. Sizes are internally consistent unless overridden.
 */
export function makeWavFixture(options: WavFixtureOptions = {}): WavFixture {
  const sampleRate = options.sampleRate ?? 8000;
  const channels = options.channels ?? 1;
  const bitsPerSample = options.bitsPerSample ?? 16;
  const blockAlign = (channels * bitsPerSample) / 8;
  const byteRate = options.byteRateOverride ?? sampleRate * blockAlign;
  const durationSeconds = options.durationSeconds ?? 2.5;
  const dataSize =
    options.dataBytes ?? Math.round(byteRate * durationSeconds);

  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8, 'ascii');
  buffer.write('fmt ', 12, 'ascii');
  buffer.writeUInt32LE(16, 16); // fmt chunk size
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.write('data', 36, 'ascii');
  buffer.writeUInt32LE(dataSize, 40);

  return {
    buffer,
    base64: buffer.toString('base64'),
    byteRate,
    dataSize,
    durationSeconds: dataSize / byteRate,
  };
}

/** Base64 of an arbitrary byte sequence (latin1 string → bytes). */
export function base64OfBytes(bytes: string | number[]): string {
  const buffer = Array.isArray(bytes)
    ? Buffer.from(bytes)
    : Buffer.from(bytes, 'latin1');
  return buffer.toString('base64');
}
