import { NativeModules, Platform } from 'react-native';
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

    AudioRecord.init(options);
    log.info('Audio recorder initialized');
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

    this.startTime = Date.now();
    this.isRecording = true;
    AudioRecord.start();
    log.info('Recording started');
  }

  /**
   * Stop recording and return audio data
   */
  async stopRecording(): Promise<RecordingResult> {
    if (!this.isRecording) {
      throw new Error('Not recording');
    }

    const audioFile = await AudioRecord.stop();
    this.isRecording = false;
    
    const duration = (Date.now() - this.startTime) / 1000;
    
    // Read the WAV file using react-native-fs to read the file
    const RNFS = require('react-native-fs');
    const filePath = Platform.OS === 'android' 
      ? audioFile 
      : `${RNFS.DocumentDirectoryPath}/${audioFile}`;
    
    const fileContent = await RNFS.readFile(filePath, 'base64');

    // Clean up temp file
    await RNFS.unlink(filePath);

    log.info(`Recording stopped. Duration: ${duration}s, Size: ${fileContent.length} chars (base64)`);

    return {
      data: fileContent,
      mimeType: 'audio/wav',
      duration
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
