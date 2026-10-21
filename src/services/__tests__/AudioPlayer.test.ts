/**
 * AudioPlayer — duration sniffing + session-owned stop.
 *
 * `getDurationFromBase64` regression: the TTS cloud API declares mp3 but
 * returns WAV bytes. The old implementation passed the DECLARED mime to
 * music-metadata, which sniffed `audio/wav` from the bytes and refused it
 * (`Guessed MIME-type not supported`), leaving the player row's time label and
 * seeker dead.
 *
 * `stopSessionAudio` regression (owner device, 2026-10-21): the session
 * teardown's unconditional `stop()` killed a config-screen TTS preview that
 * shares this singleton.
 */
import TrackPlayer from 'react-native-track-player';
import { parseBuffer } from 'music-metadata';
import { AudioPlayer } from '../AudioPlayer';
import { base64OfBytes, makeWavFixture } from '../../utils/__tests__/audioFixtures';

jest.mock('react-native-track-player', () => ({
  __esModule: true,
  default: {
    setupPlayer: jest.fn().mockResolvedValue(undefined),
    updateOptions: jest.fn().mockResolvedValue(undefined),
    reset: jest.fn().mockResolvedValue(undefined),
    add: jest.fn().mockResolvedValue(undefined),
    play: jest.fn().mockResolvedValue(undefined),
    stop: jest.fn().mockResolvedValue(undefined),
    pause: jest.fn().mockResolvedValue(undefined),
  },
  State: { Playing: 'playing' },
  Capability: { Play: 'play', Pause: 'pause', Stop: 'stop' },
}));

jest.mock('../../utils/logger', () => ({
  createLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }),
}));

const mockParseBuffer = parseBuffer as jest.Mock;
const mockTrackPlayer = TrackPlayer as unknown as Record<string, jest.Mock>;

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

describe('AudioPlayer.stopSessionAudio (ownership-aware session teardown)', () => {
  let player: AudioPlayer;

  beforeEach(() => {
    jest.clearAllMocks();
    mockTrackPlayer.stop.mockResolvedValue(undefined);
    mockTrackPlayer.reset.mockResolvedValue(undefined);
    player = new AudioPlayer();
  });

  it('is a silent no-op before setup (no player_not_initialized warn)', async () => {
    await expect(player.stopSessionAudio()).resolves.toBeUndefined();
    expect(mockTrackPlayer.stop).not.toHaveBeenCalled();
    expect(mockTrackPlayer.reset).not.toHaveBeenCalled();
    expect(mockTrackPlayer.setupPlayer).not.toHaveBeenCalled();
  });

  it('stops a voice message owned by a chat message', async () => {
    await player.playAudio('QUJD', 'audio/wav', 'msg-1');
    mockTrackPlayer.stop.mockClear();
    mockTrackPlayer.reset.mockClear();

    await player.stopSessionAudio();

    expect(mockTrackPlayer.stop).toHaveBeenCalledTimes(1);
    expect(mockTrackPlayer.reset).toHaveBeenCalledTimes(1);
    expect(player.getCurrentMessageId()).toBeNull();
  });

  it('leaves a config preview playing (no message id)', async () => {
    await player.playAudio('QUJD', 'audio/wav');
    mockTrackPlayer.stop.mockClear();
    mockTrackPlayer.reset.mockClear();

    await player.stopSessionAudio();

    expect(mockTrackPlayer.stop).not.toHaveBeenCalled();
    expect(mockTrackPlayer.reset).not.toHaveBeenCalled();
    expect(player.getCurrentMessageId()).toBeNull();
  });

  it('a preview clears a previously played message ownership', async () => {
    await player.playAudio('QUJD', 'audio/wav', 'msg-1');
    // Same singleton: loading the preview must take ownership away from the
    // message, or the teardown would still stop the preview.
    await player.playAudio('QUJD', 'audio/wav');
    mockTrackPlayer.stop.mockClear();
    mockTrackPlayer.reset.mockClear();

    await player.stopSessionAudio();

    expect(mockTrackPlayer.stop).not.toHaveBeenCalled();
  });
});
