/**
 * AudioPlayer.getDurationFromBase64 — sniff the bytes, not the declared mime.
 *
 * Regression: the TTS cloud API declares mp3 but returns WAV bytes. The old
 * implementation passed the DECLARED mime to music-metadata, which sniffed
 * `audio/wav` from the bytes and refused it (`Guessed MIME-type not
 * supported`), leaving the player row's time label and seeker dead.
 */
import { parseBuffer } from 'music-metadata';
import { AudioPlayer } from '../AudioPlayer';
import { base64OfBytes, makeWavFixture } from '../../utils/__tests__/audioFixtures';

jest.mock('../../utils/logger', () => ({
  createLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }),
}));

const mockParseBuffer = parseBuffer as jest.Mock;

describe('AudioPlayer.getDurationFromBase64', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockParseBuffer.mockResolvedValue({ format: { duration: 12 } });
  });

  it('parses WAV from the RIFF header and never calls music-metadata', async () => {
    const fixture = makeWavFixture({ durationSeconds: 3.5 });
    await expect(AudioPlayer.getDurationFromBase64(fixture.base64, 'audio/wav')).resolves.toBeCloseTo(
      3.5,
      6,
    );
    expect(mockParseBuffer).not.toHaveBeenCalled();
  });

  it('declared-mp3-but-WAV: uses the WAV header duration (declared label ignored)', async () => {
    const fixture = makeWavFixture({ durationSeconds: 2 });
    await expect(
      AudioPlayer.getDurationFromBase64(fixture.base64, 'audio/mpeg'),
    ).resolves.toBeCloseTo(2, 6);
    expect(mockParseBuffer).not.toHaveBeenCalled();
  });

  it('corrects the mime passed to music-metadata when the bytes disagree', async () => {
    const ogg = base64OfBytes('OggS\u0000\u0002\u0000\u0000\u0000\u0000\u0000\u0000');
    mockParseBuffer.mockResolvedValue({ format: { duration: 7 } });

    await expect(AudioPlayer.getDurationFromBase64(ogg, 'audio/mpeg')).resolves.toBe(7);
    expect(mockParseBuffer).toHaveBeenCalledTimes(1);
    expect(mockParseBuffer.mock.calls[0][1]).toEqual({ mimeType: 'audio/ogg' });
  });

  it('keeps the declared mime when the bytes are unrecognizable', async () => {
    mockParseBuffer.mockResolvedValue({ format: { duration: 4 } });
    await expect(
      AudioPlayer.getDurationFromBase64('QUJDRA==', 'audio/mpeg'),
    ).resolves.toBe(4);
    expect(mockParseBuffer).toHaveBeenCalledWith(expect.anything(), { mimeType: 'audio/mpeg' });
  });

  it('returns null for genuine garbage (parse throws)', async () => {
    mockParseBuffer.mockRejectedValue(
      new Error('Guessed MIME-type not supported: audio/wav'),
    );
    await expect(AudioPlayer.getDurationFromBase64('QUJDRA==')).resolves.toBeNull();
  });

  it('returns null when the WAV header is malformed', async () => {
    const fixture = makeWavFixture({ byteRateOverride: 0, dataBytes: 512 });
    await expect(
      AudioPlayer.getDurationFromBase64(fixture.base64, 'audio/wav'),
    ).resolves.toBeNull();
    expect(mockParseBuffer).not.toHaveBeenCalled();
  });

  it('returns null when the parser yields a zero/absent duration', async () => {
    mockParseBuffer.mockResolvedValue({ format: {} });
    await expect(AudioPlayer.getDurationFromBase64('QUJDRA==')).resolves.toBeNull();
  });
});
