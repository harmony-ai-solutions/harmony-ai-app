/**
 * AudioPlayer — duration sniffing, file-based playback + session-owned stop.
 *
 * `getDurationFromBase64` regression: the TTS cloud API declares mp3 but
 * returns WAV bytes. The old implementation passed the DECLARED mime to
 * music-metadata, which sniffed `audio/wav` from the bytes and refused it
 * (`Guessed MIME-type not supported`), leaving the player row's time label and
 * seeker dead.
 *
 * `playAudio`/`loadAudioForMessage` regression (owner device, 2026-10-21):
 * tracks were played from `data:` URIs. TrackPlayer serializes the URL into
 * every MediaSession binder reply, so SystemUI's media poll loop received
 * 386–774 KB "Large Bundle" replies, overflowed its ~1 MB async binder buffer
 * and crashed (→ keyguard over the app → screen sleep/re-lock loop). Tracks are
 * now ALWAYS materialized to the cache and played from `file://…` — these
 * tests pin that, plus the no-`data:`-fallback rule on write failure.
 *
 * `stopSessionAudio` regression (owner device, 2026-10-21): the session
 * teardown's unconditional `stop()` killed a config-screen TTS preview that
 * shares this singleton.
 */
import TrackPlayer from 'react-native-track-player';
import RNFS from 'react-native-fs';
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

// react-native-fs: the audio file cache (write + prune). `CachesDirectoryPath`
// is read at module load, so it must exist on the hoisted mock.
jest.mock('react-native-fs', () => ({
  __esModule: true,
  default: {
    CachesDirectoryPath: '/mock/caches',
    exists: jest.fn(),
    mkdir: jest.fn(),
    writeFile: jest.fn(),
    readDir: jest.fn(),
    unlink: jest.fn(),
  },
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
const mockRNFS = RNFS as unknown as {
  exists: jest.Mock;
  mkdir: jest.Mock;
  writeFile: jest.Mock;
  readDir: jest.Mock;
  unlink: jest.Mock;
};

const AUDIO_DIR = '/mock/caches/soulbits-audio';

/** Drain the fire-and-forget prune (all fs mocks settle on microtasks). */
async function flushAsync(): Promise<void> {
  for (let i = 0; i < 8; i++) {
    await Promise.resolve();
  }
}

/** A deferred promise for mid-flight ownership assertions. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockRNFS.exists.mockResolvedValue(false);
  mockRNFS.mkdir.mockResolvedValue(undefined);
  mockRNFS.writeFile.mockResolvedValue(undefined);
  mockRNFS.readDir.mockResolvedValue([]);
  mockRNFS.unlink.mockResolvedValue(undefined);
  mockTrackPlayer.setupPlayer.mockResolvedValue(undefined);
  mockTrackPlayer.reset.mockResolvedValue(undefined);
  mockTrackPlayer.add.mockResolvedValue(undefined);
  mockTrackPlayer.play.mockResolvedValue(undefined);
});

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

describe('AudioPlayer.playAudio / loadAudioForMessage — file-based playback', () => {
  let player: AudioPlayer;

  beforeEach(() => {
    player = new AudioPlayer();
  });

  it('writes WAV bytes under a .wav name and hands TrackPlayer a file:// URL', async () => {
    const fixture = makeWavFixture({ durationSeconds: 1 });

    // Declared mp3, actual WAV (the TTS backend bug): the extension follows
    // the BYTES, exactly like the duration parser does.
    await player.playAudio(fixture.base64, 'audio/mpeg', 'msg-42');

    expect(mockRNFS.writeFile).toHaveBeenCalledWith(
      `${AUDIO_DIR}/msg-42.wav`,
      fixture.base64,
      'base64',
    );
    expect(mockTrackPlayer.add).toHaveBeenCalledTimes(1);
    const track = mockTrackPlayer.add.mock.calls[0][0];
    expect(track.url).toBe(`file://${AUDIO_DIR}/msg-42.wav`);
    expect(track.url).not.toMatch(/^data:/);
    expect(track.title).toBe('Voice Message');
  });

  it('creates the cache directory only when it is missing', async () => {
    await player.playAudio('QUJD', 'audio/wav', 'msg-dir');

    expect(mockRNFS.exists).toHaveBeenCalledWith(AUDIO_DIR);
    expect(mockRNFS.mkdir).toHaveBeenCalledWith(AUDIO_DIR);

    mockRNFS.exists.mockResolvedValue(true);
    mockRNFS.mkdir.mockClear();
    await player.playAudio('QUJD', 'audio/wav', 'msg-dir-2');
    expect(mockRNFS.mkdir).not.toHaveBeenCalled();
  });

  it('uses the stable `preview` key for config-screen samples and clears ownership', async () => {
    await player.playAudio('QUJD', 'audio/wav', 'msg-1');
    await player.playAudio('QUJD', 'audio/wav');

    expect(mockRNFS.writeFile).toHaveBeenLastCalledWith(
      `${AUDIO_DIR}/preview.wav`,
      'QUJD',
      'base64',
    );
    expect(mockTrackPlayer.add.mock.calls[1][0].url).toBe(`file://${AUDIO_DIR}/preview.wav`);
    expect(player.getCurrentMessageId()).toBeNull();
  });

  it('loadAudioForMessage sanitizes the message id and loads a file:// URL', async () => {
    await player.loadAudioForMessage('msg 1/2', 'QUJD', 'audio/wav');

    expect(mockRNFS.writeFile).toHaveBeenCalledWith(
      `${AUDIO_DIR}/msg_1_2.wav`,
      'QUJD',
      'base64',
    );
    expect(mockTrackPlayer.add).toHaveBeenCalledWith(
      expect.objectContaining({ url: `file://${AUDIO_DIR}/msg_1_2.wav` }),
    );
    expect(mockTrackPlayer.play).not.toHaveBeenCalled();
    expect(player.getCurrentMessageId()).toBe('msg 1/2');
    expect(player.isMessageLoaded('msg 1/2')).toBe(true);
  });

  it('derives the extension from the declared mime when the bytes are unknown', async () => {
    await player.playAudio(base64OfBytes('not audio at all'), 'audio/ogg', 'msg-ogg');

    expect(mockRNFS.writeFile).toHaveBeenCalledWith(
      `${AUDIO_DIR}/msg-ogg.ogg`,
      expect.any(String),
      'base64',
    );
  });

  it('sets ownership BEFORE the first await (teardown race)', async () => {
    const setup = deferred<void>();
    mockTrackPlayer.setupPlayer.mockReturnValueOnce(setup.promise);

    const playing = player.playAudio('QUJD', 'audio/wav', 'msg-early');

    // Still inside initialize()/the file write: the id must already be visible.
    expect(player.getCurrentMessageId()).toBe('msg-early');

    setup.resolve();
    await playing;
    expect(player.getCurrentMessageId()).toBe('msg-early');
  });

  it('rejects when the cache write fails and NEVER falls back to a data: URI', async () => {
    mockRNFS.writeFile.mockRejectedValueOnce(new Error('ENOSPC: no space left'));

    await expect(player.playAudio('QUJD', 'audio/wav', 'msg-fail')).rejects.toThrow(
      'ENOSPC: no space left',
    );

    expect(mockTrackPlayer.add).not.toHaveBeenCalled();
    expect(mockTrackPlayer.play).not.toHaveBeenCalled();
    // Ownership was claimed first; the failure surfaces as a playback error
    // instead of a silent, phone-crashing data: payload.
    expect(player.getCurrentMessageId()).toBe('msg-fail');
  });

  it('loadAudioForMessage also rejects on a failed write (no data: fallback)', async () => {
    mockRNFS.writeFile.mockRejectedValueOnce(new Error('disk full'));

    await expect(player.loadAudioForMessage('msg-2', 'QUJD', 'audio/wav')).rejects.toThrow(
      'disk full',
    );
    expect(mockTrackPlayer.add).not.toHaveBeenCalled();
    expect(player.getCurrentMessageId()).toBe('msg-2');
  });

  it('prunes the cache to the 8 newest files after a write', async () => {
    const entries = Array.from({ length: 10 }, (_, index) => ({
      name: `msg-${index}.wav`,
      path: `${AUDIO_DIR}/msg-${index}.wav`,
      mtime: new Date(2026, 9, 1, 12, index), // index 0 = oldest
      isFile: () => true,
      isDirectory: () => false,
    }));
    mockRNFS.readDir.mockResolvedValue(entries);

    await player.playAudio('QUJD', 'audio/wav', 'msg-new');
    await flushAsync();

    expect(mockRNFS.readDir).toHaveBeenCalledWith(AUDIO_DIR);
    expect(mockRNFS.unlink).toHaveBeenCalledTimes(2);
    expect(mockRNFS.unlink).toHaveBeenCalledWith(`${AUDIO_DIR}/msg-0.wav`);
    expect(mockRNFS.unlink).toHaveBeenCalledWith(`${AUDIO_DIR}/msg-1.wav`);
    expect(mockRNFS.unlink).not.toHaveBeenCalledWith(`${AUDIO_DIR}/msg-9.wav`);
  });

  it('never lets a failing prune break playback', async () => {
    mockRNFS.readDir.mockRejectedValueOnce(new Error('readDir unavailable'));

    await expect(player.playAudio('QUJD', 'audio/wav', 'msg-3')).resolves.toBeUndefined();
    await flushAsync();
    expect(mockTrackPlayer.add).toHaveBeenCalledTimes(1);
  });

  it('skips pruning when the cache holds no more than 8 files', async () => {
    mockRNFS.readDir.mockResolvedValue(
      Array.from({ length: 8 }, (_, index) => ({
        name: `f${index}.wav`,
        path: `${AUDIO_DIR}/f${index}.wav`,
        mtime: new Date(2026, 9, 1, 12, index),
        isFile: () => true,
        isDirectory: () => false,
      })),
    );

    await player.playAudio('QUJD', 'audio/wav', 'msg-4');
    await flushAsync();

    expect(mockRNFS.unlink).not.toHaveBeenCalled();
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
