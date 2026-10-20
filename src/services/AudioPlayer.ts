import TrackPlayer, {
  State,
  Capability,
  Track,
  PlaybackState,
} from 'react-native-track-player';
import { parseBuffer } from 'music-metadata';
import { Buffer } from 'buffer';
import { createLogger } from '../utils/logger';
import {
  audioMimeFor,
  detectAudioFormat,
  getWavDurationSeconds,
} from '../utils/audioFormat';

const log = createLogger('[AudioPlayer]');

// Use react-native-track-player (https://github.com/doublesymmetry/react-native-track-player)
// Installation: npm install react-native-track-player
//               npx pod-install (iOS)

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
   * Play audio from base64 string
   */
  async playAudio(base64Audio: string, mimeType: string = 'audio/wav', messageId?: string): Promise<void> {
    try {
      if (!this.isInitialized) {
        await this.initialize();
      }

      // Use the sniffed format when the bytes are recognizable: the TTS API
      // may declare mp3 while returning WAV (backend bug), and the data-URI
      // mime should describe the payload we actually hand to ExoPlayer.
      const sniffedFormat = detectAudioFormat(base64Audio);
      const effectiveMime =
        sniffedFormat === 'unknown' ? mimeType : audioMimeFor(sniffedFormat);

      const uri = `data:${effectiveMime};base64,${base64Audio}`;

      const track: Track = {
        id: `audio_${Date.now()}`,
        url: uri,
        title: 'Voice Message',
        artist: 'Soulbits',
      };

      await TrackPlayer.reset();
      await TrackPlayer.add(track);
      await TrackPlayer.play();
      
      // Track which message is currently loaded
      if (messageId) {
        this.currentMessageId = messageId;
      }
      
      log.info(`Playing audio${messageId ? ` for message ${messageId}` : ''}`);
    } catch (error) {
      log.error('Failed to play audio:', error);
      throw error;
    }
  }

  /**
   * Load audio for a specific message (without playing)
   */
  async loadAudioForMessage(messageId: string, base64Audio: string, mimeType: string = 'audio/wav'): Promise<void> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    const uri = `data:${mimeType};base64,${base64Audio}`;

    const track: Track = {
      id: `audio_${Date.now()}`,
      url: uri,
      title: 'Voice Message',
      artist: 'Soulbits',
    };

    await TrackPlayer.reset();
    await TrackPlayer.add(track);
    
    // Store the message ID but don't play yet
    this.currentMessageId = messageId;
    
    log.info(`Loaded audio for message ${messageId}`);
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
   * Stop playback
   */
  async stop(): Promise<void> {
    await TrackPlayer.stop();
    await TrackPlayer.reset();
    // Clear the current message ID when stopping
    this.currentMessageId = null;
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
