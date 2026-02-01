import TrackPlayer, {
  State,
  Capability,
  Track,
  PlaybackState,
} from 'react-native-track-player';
import { Buffer } from 'buffer';
import { createLogger } from '../utils/logger';

const log = createLogger('[AudioPlayer]');

const btoa = (data: string) => Buffer.from(data, 'binary').toString('base64');

// Use react-native-track-player (https://github.com/doublesymmetry/react-native-track-player)
// Installation: npm install react-native-track-player
//               npx pod-install (iOS)

export class AudioPlayer {
  private isInitialized: boolean = false;

  /**
   * Initialize the audio player
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

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
    log.info('Audio player initialized');
  }

  /**
   * Play audio from blob data
   */
  async playAudioBlob(audioData: Uint8Array, mimeType: string): Promise<void> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    // Convert blob to base64 data URL
    const base64 = btoa(String.fromCharCode(...audioData));
    const uri = `data:${mimeType};base64,${base64}`;

    const track: Track = {
      id: `audio_${Date.now()}`,
      url: uri,
      title: 'Voice Message',
      artist: 'Harmony AI',
    };

    await TrackPlayer.reset();
    await TrackPlayer.add(track);
    await TrackPlayer.play();
    
    log.info('Playing audio blob');
  }

  /**
   * Play audio from base64 string (for events)
   */
  async playAudioBase64(base64Audio: string, mimeType: string = 'audio/wav'): Promise<void> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    const uri = `data:${mimeType};base64,${base64Audio}`;

    const track: Track = {
      id: `audio_${Date.now()}`,
      url: uri,
      title: 'Voice Message',
      artist: 'Harmony AI',
    };

    await TrackPlayer.reset();
    await TrackPlayer.add(track);
    await TrackPlayer.play();
    
    log.info('Playing audio base64');
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
}

export default new AudioPlayer();
