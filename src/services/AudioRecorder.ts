import { NativeModules, Platform } from 'react-native';
import { Buffer } from 'buffer';
import { createLogger } from '../utils/logger';
import { checkAndRequestPermission, PERMISSIONS } from '../utils/permissions';

const log = createLogger('[AudioRecorder]');

// Use react-native-audio-record (https://github.com/goodatlas/react-native-audio-record)
// Installation: npm install react-native-audio-record
//               npx pod-install (iOS)
import AudioRecord from 'react-native-audio-record';

export interface RecordingResult {
  data: string; // Base64 encoded audio
  mimeType: string;
  duration: number; // seconds
}

export class AudioRecorder {
  private isRecording: boolean = false;
  private isInitialized: boolean = false;
  private startTime: number = 0;

  /**
   * Check if audio recording permission is granted
   */
  private async checkPermission(): Promise<boolean> {
    const hasPermission = await checkAndRequestPermission(PERMISSIONS.RECORD_AUDIO);
    if (!hasPermission) {
      log.error('Audio recording permission denied');
    }
    return hasPermission;
  }

  /**
   * Check if audio recording permission is currently granted
   * Does not request permission, only checks current status
   */
  async hasPermission(): Promise<boolean> {
    // Dynamic import to avoid circular dependency if any, or just use the utility
    const { checkPermission } = require('../utils/permissions');
    return await checkPermission(PERMISSIONS.RECORD_AUDIO);
  }

  /**
   * Initialize audio recorder with options
   */
  async initialize(): Promise<void> {
    // Skip re-initialization — calling AudioRecord.init() while the native
    // module is in a non-clean state (e.g. from a previous failed or
    // abandoned recording) can cause start() to fail silently or throw.
    if (this.isInitialized) {
      log.info('Audio recorder already initialized, skipping');
      return;
    }

    // Check permission before initializing
    const hasPermission = await this.checkPermission();
    if (!hasPermission) {
      throw new Error('RECORD_AUDIO permission is required to record audio');
    }

    const options = {
      sampleRate: 16000,
      channels: 1,
      bitsPerSample: 16,
      audioSource: Platform.OS === 'android' ? 6 : undefined, // Voice recognition (Android)
      wavFile: 'temp_recording.wav'
    };

    try {
      AudioRecord.init(options);
      this.isInitialized = true;
      log.info('Audio recorder initialized');
    } catch (initError: any) {
      // Reset state so a subsequent attempt will retry init
      this.isInitialized = false;
      log.error('AudioRecord.init() failed:', initError);
      throw new Error(`Failed to initialize audio recorder: ${initError?.message || initError}`);
    }
  }

  /**
   * Start recording audio
   */
  async startRecording(): Promise<void> {
    if (this.isRecording) {
      throw new Error('Already recording');
    }

    // Additional safety check for permission
    const hasPermission = await checkAndRequestPermission(PERMISSIONS.RECORD_AUDIO);
    if (!hasPermission) {
      throw new Error('RECORD_AUDIO permission is required to record audio');
    }

    // Ensure the native module has been initialized before attempting to start
    if (!this.isInitialized) {
      await this.initialize();
    }

    try {
      this.startTime = Date.now();
      AudioRecord.start();
      this.isRecording = true;
      log.info('Recording started');
    } catch (startError: any) {
      // CRITICAL: Do NOT leave isRecording = true when start fails.
      // Previously, isRecording was set to true BEFORE start(), which meant
      // a failed start permanently broke all subsequent recording attempts
      // (every call hit the "Already recording" guard).
      this.isRecording = false;
      this.isInitialized = false; // Force re-init on next attempt
      log.error('AudioRecord.start() failed:', startError);
      throw new Error(`Failed to start recording: ${startError?.message || startError}`);
    }
  }

  /**
   * Stop recording and return audio data
   */
  async stopRecording(): Promise<RecordingResult> {
    if (!this.isRecording) {
      throw new Error('Not recording');
    }

    try {
      const audioFile = await AudioRecord.stop();
      this.isRecording = false;

      const duration = (Date.now() - this.startTime) / 1000;

      if (!audioFile) {
        log.warn('AudioRecord.stop() returned empty path');
        this.isInitialized = false; // Force re-init on next attempt
        throw new Error('No audio file produced');
      }

      // Read the WAV file using react-native-fs to read the file
      const RNFS = require('react-native-fs');
      const filePath = Platform.OS === 'android'
        ? audioFile
        : `${RNFS.DocumentDirectoryPath}/${audioFile}`;

      const fileContent = await RNFS.readFile(filePath, 'base64');

      // Clean up temp file
      try {
        await RNFS.unlink(filePath);
      } catch (unlinkError) {
        log.warn('Failed to delete temp recording file:', unlinkError);
      }

      log.info(`Recording stopped. Duration: ${duration}s, Size: ${fileContent.length} chars (base64)`);

      return {
        data: fileContent,
        mimeType: 'audio/wav',
        duration
      };
    } catch (error: any) {
      // Ensure clean state even on failure
      this.isRecording = false;
      this.isInitialized = false; // Force re-init on next attempt
      log.error('stopRecording failed:', error);
      throw error;
    }
  }

  /**
   * Subscribe to the recorder's LIVE raw PCM chunks (react-native-audio-record
   * `data` event → base64 → Uint8Array). On BOTH platforms the native `data`
   * payload is raw 16-bit little-endian PCM WITHOUT a WAV header (Android
   * `RNAudioRecordModule` emits `Buffer.encodeToString(buffer)` from
   * `AudioRecord.read`; iOS `RNAudioRecord.m` emits `inBuffer->mAudioData` from
   * the audio-queue callback) — exactly the engine's `AudioChunk.audio_bytes`.
   *
   * Returns an unsubscribe function. NOTE: the native module keeps a SINGLE
   * `data` listener (it removes prior listeners before adding), so only one live
   * subscription is active at a time — acceptable for the streaming test panel.
   */
  subscribeLivePcm(onChunk: (pcm: Uint8Array) => void): () => void {
    // The library's type declares `on(...): void`, but at runtime the native
    // event subscription is an EmitterSubscription exposing `.remove()`. Cast
    // through unknown to capture the unsubscribe handle safely.
    const subscription = AudioRecord.on('data', (base64Data: string) => {
      try {
        const bytes = Buffer.from(base64Data, 'base64');
        onChunk(new Uint8Array(bytes));
      } catch (decodeError) {
        log.error('Failed to decode live PCM chunk:', decodeError);
      }
    }) as unknown as { remove?: () => void };

    return () => {
      if (subscription && typeof subscription.remove === 'function') {
        subscription.remove();
      }
    };
  }

  /**
   * Check if currently recording
   */
  getRecordingStatus(): boolean {
    return this.isRecording;
  }
}

export default new AudioRecorder();
