/**
 * streaming — reusable live media streaming types (persona-modules 5-2).
 *
 * The engine uses a PULL protocol over the app's eventserver connection:
 * `STT_START_LISTEN` → engine pulls audio via sequential `STT_FETCH_MICROPHONE`
 * (`{start_byte, bytes_count}`) → the client answers each with
 * `STT_FETCH_MICROPHONE_RESULT` (`AudioChunk` = base64 PCM + format) → results
 * stream back as `STT_OUTPUT_TEXT`. This module is track-generic (audio v1,
 * video later via Harmony Link) and session-source agnostic (debug for the
 * module test panel, a regular call session for future voice/video calls).
 */

/** Raw audio format descriptor (channels / bit_depth / sample_rate). */
export interface AudioFormat {
  channels: number;
  bitDepth: number;
  sampleRate: number;
}

/** The engine's result_mode for STT_START_LISTEN. */
export type StreamResultMode = 'return' | 'process';

/**
 * A single accumulated transcript delivered by the engine. In return mode the
 * engine emits `STT_OUTPUT_TEXT` for each completed VAD utterance; the panel
 * accumulates these into a live transcript.
 */
export interface StreamTranscript {
  text: string;
  /** Engine-generated or request-carried message id (may be undefined). */
  messageId?: string;
}

/** Lifecycle state for a running audio stream. */
export type StreamState =
  | 'idle'
  | 'starting'
  | 'listening'
  | 'stopping'
  | 'error'
  | 'ended';

/** Options for starting a reusable audio stream session. */
export interface StartAudioStreamOptions {
  /** The entity whose (synced) STT config is streamed against. */
  entityId: string;
  /**
   * Engine device_type for the session — default `'debug'` (transient module
   * test). Pass a regular device type for a future live-video/voice call; this
   * service must never hardcode debug.
   */
  deviceType?: string;
  /** PCM format — default `{ channels:1, bitDepth:16, sampleRate:16000 }`. */
  format?: AudioFormat;
  /** Whether the engine runs VAD (only transcribes when speech is detected). */
  autoVad?: boolean;
  /** Engine result mode — default `'return'` (transcripts route back to us). */
  resultMode?: StreamResultMode;
  /** Ring-buffer capacity in seconds (VNGE `buffer_clip_duration`) — default 10. */
  bufferDurationSeconds?: number;
  /** Called for every streamed transcript. */
  onTranscript: (transcript: StreamTranscript) => void;
  /** Called on a terminal/async failure. */
  onError?: (error: Error) => void;
  /** Called on lifecycle state changes. */
  onStateChange?: (state: StreamState) => void;
}

/** Live handle returned by startAudioStream. */
export interface AudioStreamHandle {
  entityId: string;
  /**
   * Feed raw PCM bytes from the mic source into the ring buffer. The engine's
   * pull protocol reads-ahead from this buffer; a slow mic merely makes the
   * responder wait (non-blocking) until enough bytes arrive.
   */
  feedAudio: (pcmBytes: Uint8Array) => void;
  /** Send STT_STOP_LISTEN, drain in-flight fetch responders, teardown. */
  stop: () => Promise<void>;
}
