/**
 * audioFormat — magic-byte sniffing + RIFF WAV duration parsing.
 *
 * Why these exist: the Soulbits TTS API returns WAV bytes even when mp3 is
 * requested (backend bug), so every consumer must trust the bytes rather than
 * the declared mime. `getWavDurationSeconds` replaces music-metadata for WAV
 * (its bundled mime guesser rejects `audio/wav`, leaving the seeker dead).
 */
import {
  audioExtensionFor,
  audioMimeFor,
  detectAudioFormat,
  getWavDurationSeconds,
} from '../audioFormat';
import { base64OfBytes, makeWavFixture } from './audioFixtures';
import { Buffer } from 'buffer';

describe('detectAudioFormat — magic bytes', () => {
  it('detects WAV (RIFF + WAVE)', () => {
    expect(detectAudioFormat(makeWavFixture().base64)).toBe('wav');
  });

  it('detects MP3 with an ID3 tag', () => {
    // 'ID3' + version 2.4.0 + flags + syncsafe size
    expect(detectAudioFormat(base64OfBytes('ID3\u0004\u0000\u0000\u0000\u0000\u0000\u0000'))).toBe(
      'mp3',
    );
  });

  it('detects MP3 from an MPEG frame sync (0xFF 0xEx)', () => {
    expect(detectAudioFormat(base64OfBytes([0xff, 0xfb, 0x90, 0x00, 0x11, 0x22]))).toBe('mp3');
    expect(detectAudioFormat(base64OfBytes([0xff, 0xe3, 0x18, 0xc4]))).toBe('mp3');
  });

  it('detects OGG (OggS)', () => {
    expect(detectAudioFormat(base64OfBytes('OggS\u0000\u0002\u0000\u0000'))).toBe('ogg');
  });

  it('detects FLAC (fLaC)', () => {
    expect(detectAudioFormat(base64OfBytes('fLaC\u0000\u0000\u0000"'))).toBe('flac');
  });

  it('returns unknown for truncated headers', () => {
    expect(detectAudioFormat('')).toBe('unknown');
    expect(detectAudioFormat(base64OfBytes('RIF'))).toBe('unknown');
    // RIFF without the WAVE marker at offset 8 is an AVI/other RIFF container.
    expect(detectAudioFormat(base64OfBytes('RIFF\u0000\u0000\u0000\u0000AVI '))).toBe('unknown');
    // A lone sync byte is not an MPEG frame.
    expect(detectAudioFormat(base64OfBytes([0xff]))).toBe('unknown');
    expect(detectAudioFormat(base64OfBytes([0x00, 0xff, 0xfb]))).toBe('unknown');
  });

  it('returns unknown for unrecognized payloads', () => {
    expect(detectAudioFormat('QUJDRA==')).toBe('unknown'); // "ABCD"
    expect(detectAudioFormat(base64OfBytes('not audio at all'))).toBe('unknown');
  });

  it('tolerates a data-URI prefix', () => {
    const wav = makeWavFixture().base64;
    expect(detectAudioFormat(`data:audio/mpeg;base64,${wav}`)).toBe('wav');
  });
});

describe('getWavDurationSeconds', () => {
  it('computes dataSize / byteRate from the fmt + data chunks', () => {
    const fixture = makeWavFixture({
      sampleRate: 8000,
      channels: 1,
      bitsPerSample: 16,
      durationSeconds: 2.5,
    });
    // 8000 Hz * 2 bytes/frame = 16000 B/s; 2.5 s → 40000 bytes.
    expect(fixture.byteRate).toBe(16000);
    expect(fixture.dataSize).toBe(40000);
    expect(getWavDurationSeconds(fixture.base64)).toBeCloseTo(2.5, 6);
  });

  it('handles stereo 44.1 kHz and non-round durations', () => {
    const fixture = makeWavFixture({
      sampleRate: 44100,
      channels: 2,
      bitsPerSample: 16,
      durationSeconds: 1.25,
    });
    expect(fixture.byteRate).toBe(44100 * 4);
    expect(getWavDurationSeconds(fixture.base64)).toBeCloseTo(1.25, 6);
  });

  it('returns null when byteRate is zero', () => {
    const fixture = makeWavFixture({ byteRateOverride: 0, dataBytes: 1024 });
    expect(getWavDurationSeconds(fixture.base64)).toBeNull();
  });

  it('returns null for an empty data chunk', () => {
    const fixture = makeWavFixture({ durationSeconds: 0 });
    expect(fixture.dataSize).toBe(0);
    expect(getWavDurationSeconds(fixture.base64)).toBeNull();
  });

  it('returns null for a truncated data chunk', () => {
    const fixture = makeWavFixture({ durationSeconds: 2 });
    // Cut the payload in half — the data chunk header now overruns the buffer.
    const truncated = fixture.buffer.subarray(0, fixture.buffer.length - 1000);
    expect(getWavDurationSeconds(truncated.toString('base64'))).toBeNull();
  });

  it('returns null for a truncated chunk descriptor', () => {
    const fixture = makeWavFixture({ durationSeconds: 1 });
    // 12-byte header + 6 bytes: "fmt " with no full size field.
    const truncated = Buffer.from(fixture.buffer.subarray(0, 18));
    expect(getWavDurationSeconds(truncated.toString('base64'))).toBeNull();
  });

  it('returns null for non-WAV input', () => {
    expect(getWavDurationSeconds('')).toBeNull();
    expect(getWavDurationSeconds('QUJDRA==')).toBeNull();
    expect(getWavDurationSeconds(base64OfBytes('OggS\u0000\u0002\u0000\u0000'))).toBeNull();
  });

  it('tolerates a data-URI prefix', () => {
    const fixture = makeWavFixture({ durationSeconds: 1 });
    expect(
      getWavDurationSeconds(`data:audio/mpeg;base64,${fixture.base64}`),
    ).toBeCloseTo(1, 6);
  });
});

describe('format → mime / extension mappings', () => {
  it('maps each known format to its mime type', () => {
    expect(audioMimeFor('wav')).toBe('audio/wav');
    expect(audioMimeFor('mp3')).toBe('audio/mpeg');
    expect(audioMimeFor('ogg')).toBe('audio/ogg');
    expect(audioMimeFor('flac')).toBe('audio/flac');
  });

  it('maps each known format to its file extension', () => {
    expect(audioExtensionFor('wav')).toBe('wav');
    expect(audioExtensionFor('mp3')).toBe('mp3');
    expect(audioExtensionFor('ogg')).toBe('ogg');
    expect(audioExtensionFor('flac')).toBe('flac');
  });

  it('returns neutral fallbacks for unknown', () => {
    expect(audioMimeFor('unknown')).toBe('application/octet-stream');
    expect(audioExtensionFor('unknown')).toBe('bin');
  });
});
