/**
 * AudioPlayer — the ONE choke point for every sound the app plays through
 * react-native-track-player (https://github.com/doublesymmetry/react-native-track-player).
 * Installation: npm install react-native-track-player
 *               npx pod-install (iOS)
 *
 * This module is the only `src/` file that hands track URLs to TrackPlayer
 * (`playbackState.ts` imports `State` only), so it is also the only place the
 * rule below has to hold. Keep it that way.
 *
 * ## Why file-based playback is MANDATORY (never a `data:` URI)
 *
 * TrackPlayer (v5 alpha, media3) serializes the track URL into the MediaSession
 * queue/metadata, so EVERY binder reply to a media controller carries that URL
 * verbatim. With `url: "data:audio/wav;base64,…"` that means carrying the ENTIRE
 * base64 sample — hundreds of KB — in every single reply.
 *
 * Owner-device evidence (Xiaomi garnet / 2312DRA50G, HyperOS 2.0.206.0,
 * Android 15). Activating the session makes SystemUI
 * (`ActiveAudioSessionManager`) and the Bluetooth AVRCP stack poll the session
 * controller in a tight loop. An adb capture on 2026-10-21 16:28:38–16:28:54
 * shows 49+ "Large Bundle" replies of 386–774 KB within ~500 ms. That overflows
 * SystemUI's ~1 MB async binder buffer → `DeadSystemException` → **SystemUI
 * crashes** (FATAL in `ActiveAudioSessionManager_export-api`) → keyguard
 * restarts over the app. The whole app then gets ON_STOP ~1.5 s after play, and
 * keyguard installs a 10 s user-activity timeout → screen sleeps → device
 * re-locks, in a loop. On bad days the crash loop wedged system_server until
 * the phone rebooted.
 *
 * A ~196 KB chat voice message survived (below the kill threshold), so chat
 * playback is NOT exempt from the mechanism — it simply carried fewer bytes.
 *
 * RULE (blunt): audio for TrackPlayer playback is ALWAYS written to filespace
 * and played from `file://…`, NEVER played from memory/base64. This is the same
 * principle as the chat image byte cache (`getCachedImageBytes`,
 * `src/services/engine/repositories/characters.ts`), which exists because
 * Fabric forced files for images; binder size forces files for audio.
 *
 * Consequences that must stay true:
 *  - `materializeTrackFile()` is the ONLY producer of a track URL.
 *  - A cache write FAILURE throws — never fall back to a `data:` URI, or the
 *    phone-crashing payload is silently re-armed.
 *  - The cache keeps the 8 newest files (one per message id, plus `preview`),
 *    so a long chat cannot grow it without bound.
 */
import TrackPlayer, {
  State,
  Capability,
  Track,
  PlaybackState,
} from 'react-native-track-player';
import { parseBuffer } from 'music-metadata';
import { Buffer } from 'buffer';
import RNFS from 'react-native-fs';
import { createLogger } from '../utils/logger';
import {
  audioExtensionFor,
  audioMimeFor,
  detectAudioFormat,
  getWavDurationSeconds,
} from '../utils/audioFormat';

const log = createLogger('[AudioPlayer]');

/**
 * Cache directory for playable audio files (see the file header). Lives under
 * the OS cache root so the system may also reclaim it under storage pressure;
 * our own prune keeps it small in normal use.
 */
const AUDIO_CACHE_DIR = `${RNFS.CachesDirectoryPath}/soulbits-audio`;

/** Newest files kept after each write: chat history replay + the preview slot. */
const AUDIO_CACHE_MAX_FILES = 8;

export class AudioPlayer {
  private isInitialized: boolean = false;
  private currentMessageId: string | null = null;

  /**
   * Initialize the audio player
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    try {
      await TrackPlayer.setupPlayer({
        autoHandleInterruptions: true,
      });

      await TrackPlayer.updateOptions({
        capabilities: [
          Capability.Play,
          Capability.Pause,
          Capability.Stop,
        ],
        notificationCapabilities: [Capability.Play, Capability.Pause],
      });

      this.isInitialized = true;
      log.info('Audio player initialized successfully');
    } catch (error) {
      log.error('Failed to initialize audio player:', error);
      throw error;
    }
  }

  /**
   * Play audio from base64 string.
   *
   * The bytes are written to the cache and played from `file://…` — see the
   * "Why file-based playback is MANDATORY" section in the file header. Never
   * build a `data:` URI here.
   */
  async playAudio(base64Audio: string, mimeType: string = 'audio/wav', messageId?: string): Promise<void> {
    // Ownership follows the LAST requested track. Assigned BEFORE any await:
    // a session teardown landing between `initialize()`/the file write and the
    // old post-await assignment could otherwise observe the PREVIOUS owner and
    // stop a preview that had just started (owner device, 2026-10-21).
    this.currentMessageId = messageId ?? null;

    try {
      if (!this.isInitialized) {
        await this.initialize();
      }

      // Filespace first: the TTS API may declare mp3 while returning WAV, so
      // the materializer sniffs the actual container and names the file after
      // it (the extension is what ExoPlayer's extractor picks up).
      const path = await this.materializeTrackFile(
        base64Audio,
        mimeType,
        messageId ?? 'preview',
      );

      const track: Track = {
        id: `audio_${Date.now()}`,
        // NEVER use a data: URI here — see file header. A data: URL rides
        // inside every MediaSession binder reply and crashes SystemUI.
        url: `file://${path}`,
        title: 'Voice Message',
        artist: 'Soulbits',
      };

      await TrackPlayer.reset();
      await TrackPlayer.add(track);
      await TrackPlayer.play();

      log.info(`Playing audio${messageId ? ` for message ${messageId}` : ''}`);
    } catch (error) {
      log.error('Failed to play audio:', error);
      throw error;
    }
  }

  /**
   * Load audio for a specific message (without playing).
   *
   * Same file-based rule as {@link playAudio}: the payload is materialized to
   * the cache under the message id (a stable name, so replay reuses the file)
   * and the track points at `file://…`. Never a `data:` URI.
   */
  async loadAudioForMessage(messageId: string, base64Audio: string, mimeType: string = 'audio/wav'): Promise<void> {
    // Ownership FIRST, before any await — see {@link playAudio}.
    this.currentMessageId = messageId;

    if (!this.isInitialized) {
      await this.initialize();
    }

    const path = await this.materializeTrackFile(base64Audio, mimeType, messageId);

    const track: Track = {
      id: `audio_${Date.now()}`,
      // NEVER use a data: URI here — see file header.
      url: `file://${path}`,
      title: 'Voice Message',
      artist: 'Soulbits',
    };

    await TrackPlayer.reset();
    await TrackPlayer.add(track);

    log.info(`Loaded audio for message ${messageId}`);
  }

  /**
   * Write a base64 payload to the audio cache and return the absolute file
   * path handed to TrackPlayer.
   *
   * The bytes (not the declared mime) decide the extension: the TTS API says
   * mp3 but returns WAV, and a `.mp3` name over WAV bytes made ExoPlayer's
   * extractor guess wrong. `detectAudioFormat` is the same sniffer the duration
   * parser uses, so file naming and parsing can never disagree.
   *
   * `key` is the message id (or `'preview'` for config-screen samples),
   * sanitized to `[A-Za-z0-9_-]` so the file name is stable across a
   * load-then-play flow and cannot escape the cache directory. A deterministic
   * name means a rewrite of identical bytes is cheap and harmless.
   *
   * Throws when the write fails: the caller surfaces a playback error. There is
   * deliberately NO `data:` fallback (see the file header).
   */
  private async materializeTrackFile(
    base64Audio: string,
    mimeType: string,
    key: string,
  ): Promise<string> {
    const sniffedFormat = detectAudioFormat(base64Audio);
    const extension = AudioPlayer.extensionFor(sniffedFormat, mimeType);
    const safeKey = AudioPlayer.sanitizeFileKey(key);
    const path = `${AUDIO_CACHE_DIR}/${safeKey}.${extension}`;

    try {
      if (!(await RNFS.exists(AUDIO_CACHE_DIR))) {
        await RNFS.mkdir(AUDIO_CACHE_DIR);
      }
      await RNFS.writeFile(path, base64Audio, 'base64');
    } catch (error) {
      // No data: URI fallback on purpose — that would re-arm the SystemUI
      // binder overflow this whole module exists to avoid.
      log.error(
        `Failed to write audio for ${safeKey} to the cache — refusing to fall back to a data: URI:`,
        error,
      );
      throw error;
    }

    // Best effort: pruning must never break playback, so it is fire-and-forget
    // and every failure (including a missing native readDir) is swallowed.
    void AudioPlayer.pruneAudioCache().catch(() => {});

    return path;
  }

  /** Extension for a sniffed format, else the declared mime, else `wav`. */
  private static extensionFor(
    sniffedFormat: ReturnType<typeof detectAudioFormat>,
    mimeType: string,
  ): string {
    if (sniffedFormat !== 'unknown') {
      return audioExtensionFor(sniffedFormat);
    }
    const declared = (mimeType || '').toLowerCase();
    if (declared.includes('mpeg') || declared.includes('mp3')) return 'mp3';
    if (declared.includes('ogg') || declared.includes('opus')) return 'ogg';
    if (declared.includes('flac')) return 'flac';
    // `audio/wav`, `audio/x-wav`, empty or anything else: WAV is the TTS
    // service's de-facto default, and a wrong-but-known extension is still
    // sniffed correctly by ExoPlayer from the bytes.
    return 'wav';
  }

  /** Collapse anything outside `[A-Za-z0-9_-]` so a message id is a safe name. */
  private static sanitizeFileKey(key: string): string {
    const sanitized = (key || '').replace(/[^A-Za-z0-9_-]/g, '_');
    return sanitized.length > 0 ? sanitized : 'preview';
  }

  /**
   * Keep only the {@link AUDIO_CACHE_MAX_FILES} newest cache files.
   *
   * Called fire-and-forget after every successful write; the caller wraps the
   * promise in `.catch(() => {})`. Entries without a usable `mtime` sort last
   * (i.e. are pruned first) and a mock/partial FS that omits `isFile` is
   * treated as a file list rather than crashing playback.
   */
  private static async pruneAudioCache(): Promise<void> {
    const entries = await RNFS.readDir(AUDIO_CACHE_DIR);
    const files = (entries || []).filter(entry =>
      typeof entry.isFile === 'function' ? entry.isFile() : true,
    );
    if (files.length <= AUDIO_CACHE_MAX_FILES) return;

    const mtimeMs = (entry: { mtime?: Date | string | number }): number => {
      if (entry.mtime == null) return 0;
      const value =
        entry.mtime instanceof Date
          ? entry.mtime.getTime()
          : new Date(entry.mtime).getTime();
      return Number.isFinite(value) ? value : 0;
    };

    const stale = [...files]
      .sort((a, b) => mtimeMs(b) - mtimeMs(a))
      .slice(AUDIO_CACHE_MAX_FILES);

    await Promise.all(stale.map(entry => RNFS.unlink(entry.path).catch(() => {})));
  }

  /**
   * Check if a specific message's audio is currently loaded
   */
  isMessageLoaded(messageId: string): boolean {
    return this.currentMessageId === messageId;
  }

  /**
   * Get the currently loaded message ID
   */
  getCurrentMessageId(): string | null {
    return this.currentMessageId;
  }

  /**
   * Pause playback
   */
  async pause(): Promise<void> {
    await TrackPlayer.pause();
  }

  /**
   * Resume playback
   */
  async resume(): Promise<void> {
    await TrackPlayer.play();
  }

  /**
   * Full stop: halt playback AND empty the queue. Panels call this when they
   * own the player; session teardown must use {@link stopSessionAudio} so a
   * config-screen preview is never killed by a chat teardown.
   */
  async stop(): Promise<void> {
    await TrackPlayer.stop();
    await TrackPlayer.reset();
    // Clear the current message ID when stopping
    this.currentMessageId = null;
  }

  /**
   * Stop playback ONLY when the loaded track belongs to a chat message (a voice
   * message). Config-screen previews (TTS test panel, voice clone/design) share
   * this singleton but load their track WITHOUT a message id.
   *
   * Why: androidx ProcessLifecycleOwner ON_STOP tears every entity session down
   * (deliberate — battery), and that teardown used to call `stop()`
   * unconditionally. On the owner device (2026-10-21) it fired ~2.3 s into a
   * TTS preview, resetting the queue under a panel that still thought a sample
   * was loaded, so the player looked dead until a full remount.
   *
   * Silent no-op when TrackPlayer was never set up (the chat never played
   * audio): this removes the recurring 'player_not_initialized' WARN the old
   * unconditional call produced on every chat exit.
   */
  async stopSessionAudio(): Promise<void> {
    if (!this.isInitialized) return;
    if (this.currentMessageId === null) return;
    await this.stop();
  }

  /**
   * Get current playback state
   * In v5, this returns PlaybackState which contains the State as a string
   */
  async getPlaybackState(): Promise<PlaybackState> {
    return await TrackPlayer.getPlaybackState();
  }

  /**
   * Get current playback state enum value
   * Helper method to get just the State (e.g., State.Playing, State.Paused)
   */
  async getState(): Promise<State> {
    const playbackState = await TrackPlayer.getPlaybackState();
    return playbackState.state;
  }

  /**
   * Check if currently playing
   */
  async isPlaying(): Promise<boolean> {
    const state = await this.getState();
    return state === State.Playing;
  }

  /**
   * Seek to position (in seconds)
   */
  async seekTo(position: number): Promise<void> {
    await TrackPlayer.seekTo(position);
  }

  /**
   * Get progress information including position, duration, and buffered
   */
  async getProgress(): Promise<{ position: number; duration: number; buffered: number }> {
    return await TrackPlayer.getProgress();
  }

  /**
   * Get current position (in seconds)
   */
  async getPosition(): Promise<number> {
    const progress = await TrackPlayer.getProgress();
    return progress.position;
  }

  /**
   * Get duration (in seconds)
   */
  async getDuration(): Promise<number> {
    const progress = await TrackPlayer.getProgress();
    return progress.duration;
  }

  /**
   * True when a DECLARED mime type already names the sniffed format. Used only
   * to decide whether a declared-vs-actual mismatch is worth logging.
   */
  private static declaredMimeMatchesFormat(mimeType: string, format: string): boolean {
    const value = (mimeType || '').toLowerCase();
    switch (format) {
      case 'wav':
        return value.includes('wav') || value.includes('x-wave');
      case 'mp3':
        return value.includes('mpeg') || value.includes('mp3');
      case 'ogg':
        return value.includes('ogg') || value.includes('opus');
      case 'flac':
        return value.includes('flac');
      default:
        return true;
    }
  }

  /**
   * Parse audio duration from a base64-encoded audio string.
   *
   * The bytes are sniffed FIRST and the sniffed format wins: the TTS API
   * declares mp3 but returns WAV bytes, which made music-metadata throw
   * (`Guessed MIME-type not supported: audio/wav`) and left the player without
   * a duration. WAV is therefore parsed from its RIFF header directly; every
   * other sniffed format goes to music-metadata with the CORRECTED mime. Only
   * a truly unrecognizable payload falls back to the declared `mimeType`.
   *
   * This is a static, side-effect-free helper that never touches TrackPlayer.
   *
   * @param base64Audio - Base64-encoded audio data
   * @param mimeType    - DECLARED MIME type (e.g. 'audio/wav', 'audio/mpeg')
   * @returns Duration in seconds, or null if it could not be determined
   */
  static async getDurationFromBase64(
    base64Audio: string,
    mimeType: string = 'audio/wav'
  ): Promise<number | null> {
    const declaredMime = mimeType || 'audio/wav';
    const format = detectAudioFormat(base64Audio);
    const effectiveMime =
      format === 'unknown' ? declaredMime : audioMimeFor(format);

    if (format !== 'unknown' && !AudioPlayer.declaredMimeMatchesFormat(declaredMime, format)) {
      log.info(
        `Declared ${declaredMime} but bytes are ${format.toUpperCase()} — using the actual format`
      );
    }

    // WAV: parse the RIFF header ourselves (music-metadata rejects audio/wav in
    // this bundle). A malformed header means we cannot know the duration.
    if (format === 'wav') {
      const wavDuration = getWavDurationSeconds(base64Audio);
      if (wavDuration == null) {
        log.warn('Could not parse WAV duration from the RIFF header');
        return null;
      }
      return wavDuration;
    }

    try {
      const buffer = Buffer.from(base64Audio, 'base64');
      const metadata = await parseBuffer(buffer, { mimeType: effectiveMime });
      const duration = metadata.format.duration;
      return duration != null && duration > 0 ? duration : null;
    } catch (error) {
      log.warn('Could not parse audio duration from buffer:', error);
      return null;
    }
  }
}

export default new AudioPlayer();
