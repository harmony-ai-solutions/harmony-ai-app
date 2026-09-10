/**
 * streamingService — reusable live audio streaming orchestrator
 * (persona-modules 5-2).
 *
 * ## Engine PULL protocol (verified in engine `modules/stt.go` + VNGE
 *    `speech_to_text.py` — do not invent events)
 *
 *  1. client → engine  `STT_START_LISTEN`  `{auto_vad, result_mode, channels,
 *     bit_depth, sample_rate}` (`result_mode` = "return" | "process").
 *  2. engine → client  `STT_FETCH_MICROPHONE` (status SUCCESS) with
 *     `{start_byte, bytes_count}` — sequential, fixed time-sliced ranges; the
 *     next pull is only issued after the previous chunk is answered.
 *  3. client → engine  `STT_FETCH_MICROPHONE_RESULT` (status NEW) with an
 *     `AudioChunk` `{audio_bytes: base64 PCM, channels, bit_depth, sample_rate}`
 *     sliced from a local RING BUFFER; if the engine reads ahead of the mic the
 *     responder WAITS inside the ring-buffer slice call (non-blocking).
 *  4. engine → client  `STT_OUTPUT_TEXT` (status NEW) with
 *     `{message_id, type, content}` — the single transcript event in return mode
 *     (engine `onTranscriptionFinished` → RESULT_MODE_RETURN). Consumed exactly
 *     this way.
 *  5. client → engine  `STT_STOP_LISTEN` `{}` ends the stream after the
 *     outstanding chunk; this service then drains in-flight responders and
 *     guarantees teardown (disconnect).
 *
 * ## Reusable, video-extensible
 *
 * The track is generic (audio v1) and the session source is parameterized: the
 * module-test panel opens a transient `debug` session, while a future voice/
 * video call passes its own `deviceType`. The mic source is injected from
 * outside via `feedAudio`, so the service never hardcodes a recorder.
 */

import { Buffer } from 'buffer';
import { openTestSession } from '../voiceInput/moduleTestSessionService';
import type { ModuleTestSession } from '../voiceInput/moduleTestSessionService';
import { AudioRingBuffer } from './audioRingBuffer';
import type {
  AudioFormat,
  AudioStreamHandle,
  StartAudioStreamOptions,
} from './types';
import { createLogger } from '../../utils/logger';

const log = createLogger('[streamingService]');

/** Default PCM format — the app records 16 kHz / 16-bit / mono. */
const DEFAULT_FORMAT: AudioFormat = { channels: 1, bitDepth: 16, sampleRate: 16000 };

/** Ring-buffer capacity in seconds (VNGE `buffer_clip_duration`). */
const DEFAULT_BUFFER_SECONDS = 10;

/** Bounded grace (ms) to drain in-flight fetch responders on stop. */
const STOP_DRAIN_MS = 3000;

export class AudioStreamingService {
  /**
   * Start a live audio stream against `entityId` (its SYNCED STT config), open
   * the engine session, send STT_START_LISTEN and return a live handle. Do not
   * await streaming completion — the stream runs until `handle.stop()`.
   */
  async startAudioStream(options: StartAudioStreamOptions): Promise<AudioStreamHandle> {
    const format = options.format ?? DEFAULT_FORMAT;
    const deviceType = options.deviceType ?? 'debug';
    const autoVad = options.autoVad ?? true;
    const resultMode = options.resultMode ?? 'return';
    const bytesPerSample = format.bitDepth / 8;
    const blockAlign = format.channels * bytesPerSample;
    const bytesPerSecond = format.sampleRate * blockAlign;
    const bufferDurationSeconds = options.bufferDurationSeconds ?? DEFAULT_BUFFER_SECONDS;

    // Rolling PCM buffer sized to a few seconds of audio; the engine reads
    // ahead of the mic so the responder waits (non-blocking) for growth.
    const ringBuffer = new AudioRingBuffer({
      maxBytes: bytesPerSecond * bufferDurationSeconds,
      blockAlign,
    });

    const onStateChange = options.onStateChange ?? (() => undefined);
    onStateChange('starting');

    const session = await openTestSession(options.entityId, { deviceType });
    onStateChange('listening');

    const inFlight: Promise<void>[] = [];
    let stopped = false;
    const abortController = new AbortController();

    const unsubscribe = session.subscribeEvents((event) => {
      if (event.event_type === 'STT_FETCH_MICROPHONE') {
        const payload = (event.payload ?? {}) as { start_byte?: unknown; bytes_count?: unknown };
        const startByte = Number(payload.start_byte);
        const bytesCount = Number(payload.bytes_count);
        if (Number.isFinite(startByte) && Number.isFinite(bytesCount) && bytesCount > 0) {
          // Fire-and-forget: a slow mic makes this promise WAIT (read-ahead) while
          // the event loop keeps processing other events. The signal lets stop()
          // cancel a pending read-ahead so no timer outlives the stream.
          inFlight.push(
            this.respondToFetch(session, ringBuffer, format, startByte, bytesCount, abortController.signal),
          );
        }
      } else if (event.event_type === 'STT_OUTPUT_TEXT') {
        const payload = (event.payload ?? {}) as { message_id?: unknown; content?: unknown };
        const transcript = {
          text: String(payload.content ?? ''),
          ...(payload.message_id !== undefined ? { messageId: String(payload.message_id) } : {}),
        };
        try {
          options.onTranscript(transcript);
        } catch (err) {
          log.error('onTranscript handler threw:', err);
          options.onError?.(err instanceof Error ? err : new Error(String(err)));
        }
      }
    });

    try {
      await session.sendEvent({
        event_type: 'STT_START_LISTEN',
        status: 'NEW',
        payload: {
          auto_vad: autoVad,
          result_mode: resultMode,
          channels: format.channels,
          bit_depth: format.bitDepth,
          sample_rate: format.sampleRate,
        },
      });
    } catch (err) {
      onStateChange('error');
      unsubscribe();
      await session.disconnect();
      const wrapped = err instanceof Error ? err : new Error(String(err));
      options.onError?.(wrapped);
      throw wrapped;
    }

    return {
      entityId: options.entityId,
      feedAudio: (pcmBytes) => ringBuffer.append(pcmBytes),
      stop: async () => {
        if (stopped) return;
        stopped = true;
        try {
          await session.sendEvent({ event_type: 'STT_STOP_LISTEN', status: 'NEW', payload: {} });
          // Drain in-flight fetch responders within a bounded grace period — the
          // engine exits its loop only after the outstanding chunk is delivered.
          await Promise.race([
            Promise.allSettled(inFlight),
            new Promise<void>((resolve) => setTimeout(resolve, STOP_DRAIN_MS)),
          ]);
          // Cancel any still-pending read-ahead responder so no timer survives.
          abortController.abort();
        } catch (err) {
          log.warn('Failed to send STT_STOP_LISTEN:', err);
        } finally {
          onStateChange('ended');
          unsubscribe();
          await session.disconnect();
        }
      },
    };
  }

  /** Answer one STT_FETCH_MICROPHONE by slicing the ring buffer (read-ahead). */
  private async respondToFetch(
    session: ModuleTestSession,
    ringBuffer: AudioRingBuffer,
    format: AudioFormat,
    startByte: number,
    bytesCount: number,
    signal?: AbortSignal,
  ): Promise<void> {
    try {
      const chunk = await ringBuffer.fetchSlice(startByte, bytesCount, signal);
      // A range that was already dropped is irrecoverable — don't answer empty.
      if (chunk.length === 0) return;
      const audioBytes = Buffer.from(chunk).toString('base64');
      await session.sendEvent({
        event_type: 'STT_FETCH_MICROPHONE_RESULT',
        status: 'NEW',
        payload: {
          audio_bytes: audioBytes,
          channels: format.channels,
          bit_depth: format.bitDepth,
          sample_rate: format.sampleRate,
        },
      });
    } catch (err) {
      log.error('Failed to answer STT_FETCH_MICROPHONE:', err);
    }
  }
}

const streamingService = new AudioStreamingService();

/**
 * @see AudioStreamingService.startAudioStream — the standalone entry point.
 */
export async function startAudioStream(options: StartAudioStreamOptions): Promise<AudioStreamHandle> {
  return streamingService.startAudioStream(options);
}

export default streamingService;
