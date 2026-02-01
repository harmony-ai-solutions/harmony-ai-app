import { NativeModules, Platform } from 'react-native';
import { createLogger } from '../utils/logger';

const log = createLogger('[AudioRecorder]');

// Use react-native-audio-record (https://github.com/goodatlas/react-native-audio-record)
// Installation: npm install react-native-audio-record
//               npx pod-install (iOS)
import AudioRecord from 'react-native-audio-record';

export interface RecordingResult {
  data: Uint8Array;
  mimeType: string;
  duration: number; // seconds
}

export class AudioRecorder {
  private isRecording: boolean = false;
  private startTime: number = 0;

  /**
   * Initialize audio recorder with options
   */
  async initialize(): Promise<void> {
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
    
    // Read the WAV file and convert to Uint8Array
    // Using react-native-fs to read the file
    const RNFS = require('react-native-fs');
    const filePath = Platform.OS === 'android' 
      ? audioFile 
      : `${RNFS.DocumentDirectoryPath}/${audioFile}`;
    
    const fileContent = await RNFS.readFile(filePath, 'base64');
    const binaryString = atob(fileContent);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    // Clean up temp file
    await RNFS.unlink(filePath);

    log.info(`Recording stopped. Duration: ${duration}s, Size: ${bytes.length} bytes`);

    return {
      data: bytes,
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
