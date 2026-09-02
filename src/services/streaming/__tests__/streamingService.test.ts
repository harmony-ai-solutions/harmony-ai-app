/**
 * StreamingService — reusable live audio streaming (persona-modules 5-2).
 *
 * Verifies the engine's PULL protocol over a mocked session:
 *  - STT_START_LISTEN is sent with the pinned payload shape
 *    ({auto_vad, result_mode, channels, bit_depth, sample_rate})
 *  - STT_FETCH_MICROPHONE → STT_FETCH_MICROPHONE_RESULT round-trip slices the
 *    ring buffer and answers with the AudioChunk contract
 *  - STT_OUTPUT_TEXT fans out to the onTranscript subscriber
 *  - stop() sends STT_STOP_LISTEN and guarantees teardown (disconnect)
 *  - the fetch responder NEVER blocks the event loop (a waiting fetch does not
 *    prevent other events like STT_OUTPUT_TEXT from being processed)
 *
 * The connection/session layer is MOCKED; no live engine is touched.
 */

import { startAudioStream } from '../streamingService';

jest.mock('../../voiceInput/moduleTestSessionService', () => ({
  __esModule: true,
  openTestSession: jest.fn(),
  ModuleTestSessionError: class extends Error {},
}));

import { openTestSession } from '../../voiceInput/moduleTestSessionService';

const mockOpenTestSession = openTestSession as jest.Mock;

let capturedHandler: ((event: any) => void) | null = null;
let sends: any[];
let disconnects: jest.Mock;

function makeSession(): any {
  sends = [];
  disconnects = jest.fn();
  capturedHandler = null;
  return {
    connectionId: 'debug-module-test-claire-abc',
    entityId: 'claire',
    awaitEvent: jest.fn(),
    sendEvent: jest.fn(async (ev: any) => {
      sends.push(ev);
    }),
    disconnect: disconnects,
    subscribeEvents: jest.fn((handler: any) => {
      capturedHandler = handler;
      return () => {
        capturedHandler = null;
      };
    }),
  };
}

async function flush(times = 8) {
  for (let i = 0; i < times; i++) {
    await Promise.resolve();
  }
}

const DEFAULT_OPTS = {
  entityId: 'claire',
  onTranscript: jest.fn(),
  onError: jest.fn(),
};

beforeEach(() => {
  jest.clearAllMocks();
  mockOpenTestSession.mockResolvedValue(makeSession());
});

describe('startAudioStream — session + START', () => {
  it('opens a debug session and sends STT_START_LISTEN with the pinned payload', async () => {
    const handle = await startAudioStream({ ...DEFAULT_OPTS });

    expect(mockOpenTestSession).toHaveBeenCalledWith('claire', { deviceType: 'debug' });

    const start = sends.find((s) => s.event_type === 'STT_START_LISTEN');
    expect(start).toBeTruthy();
    expect(start.status).toBe('NEW');
    expect(start.payload).toEqual({
      auto_vad: true,
      result_mode: 'return',
      channels: 1,
      bit_depth: 16,
      sample_rate: 16000,
    });

    expect(handle.entityId).toBe('claire');
  });

  it('honors caller-provided deviceType, format, autoVad and resultMode', async () => {
    await startAudioStream({
      ...DEFAULT_OPTS,
      deviceType: 'phone',
      format: { channels: 2, bitDepth: 24, sampleRate: 48000 },
      autoVad: false,
      resultMode: 'process',
    });

    expect(mockOpenTestSession).toHaveBeenCalledWith('claire', { deviceType: 'phone' });
    const start = sends.find((s) => s.event_type === 'STT_START_LISTEN');
    expect(start.payload).toEqual({
      auto_vad: false,
      result_mode: 'process',
      channels: 2,
      bit_depth: 24,
      sample_rate: 48000,
    });
  });
});

describe('startAudioStream — FETCH → RESULT round-trip', () => {
  it('answers an STT_FETCH_MICROPHONE by slicing the ring buffer with the AudioChunk contract', async () => {
    const handle = await startAudioStream({ ...DEFAULT_OPTS });

    // Mic produces raw PCM before the engine pulls.
    handle.feedAudio(new Uint8Array([1, 2, 3, 4]));

    // Engine pulls absolute bytes 0..4.
    capturedHandler!({
      event_type: 'STT_FETCH_MICROPHONE',
      status: 'SUCCESS',
      payload: { start_byte: 0, bytes_count: 4 },
    });
    await flush();

    const result = sends.find((s) => s.event_type === 'STT_FETCH_MICROPHONE_RESULT');
    expect(result).toBeTruthy();
    expect(result.status).toBe('NEW');
    expect(result.payload).toEqual({
      audio_bytes: Buffer.from([1, 2, 3, 4]).toString('base64'),
      channels: 1,
      bit_depth: 16,
      sample_rate: 16000,
    });
  });

  it('never blocks the event loop: other events are processed while a fetch waits for audio', async () => {
    jest.useFakeTimers();
    const onTranscript = jest.fn();
    const handle = await startAudioStream({ ...DEFAULT_OPTS, onTranscript });

    // Engine pulls before any mic data — the responder must WAIT, not block.
    capturedHandler!({
      event_type: 'STT_FETCH_MICROPHONE',
      status: 'SUCCESS',
      payload: { start_byte: 0, bytes_count: 4 },
    });
    await Promise.resolve();

    // No mic data → no RESULT yet.
    expect(sends.find((s) => s.event_type === 'STT_FETCH_MICROPHONE_RESULT')).toBeUndefined();

    // A transcript arriving while the fetch waits is still delivered (non-blocking).
    capturedHandler!({
      event_type: 'STT_OUTPUT_TEXT',
      status: 'NEW',
      payload: { message_id: 'vid-1', content: 'hello there' },
    });
    expect(onTranscript).toHaveBeenCalledWith({ text: 'hello there', messageId: 'vid-1' });

    // Mic data arrives → the wait resolves → RESULT is sent. The service's
    // read-ahead poll defaults to 16ms — advance past it and flush microtasks.
    handle.feedAudio(new Uint8Array([1, 2, 3, 4]));
    jest.advanceTimersByTime(20);
    await flush();
    const result = sends.find((s) => s.event_type === 'STT_FETCH_MICROPHONE_RESULT');
    expect(result).toBeTruthy();
    expect(result.payload.audio_bytes).toBe(Buffer.from([1, 2, 3, 4]).toString('base64'));

    jest.useRealTimers();
  });
});

describe('startAudioStream — result fan-out + teardown', () => {
  it('fans out STT_OUTPUT_TEXT to onTranscript', async () => {
    const onTranscript = jest.fn();
    await startAudioStream({ ...DEFAULT_OPTS, onTranscript });

    capturedHandler!({
      event_type: 'STT_OUTPUT_TEXT',
      status: 'NEW',
      payload: { message_id: 'm1', content: 'first' },
    });
    capturedHandler!({
      event_type: 'STT_OUTPUT_TEXT',
      status: 'NEW',
      payload: { message_id: 'm2', content: 'second' },
    });

    expect(onTranscript).toHaveBeenNthCalledWith(1, { text: 'first', messageId: 'm1' });
    expect(onTranscript).toHaveBeenNthCalledWith(2, { text: 'second', messageId: 'm2' });
  });

  it('stop() sends STT_STOP_LISTEN and guarantees teardown (disconnect)', async () => {
    const handle = await startAudioStream({ ...DEFAULT_OPTS });

    await handle.stop();

    expect(sends.find((s) => s.event_type === 'STT_STOP_LISTEN')).toBeTruthy();
    expect(disconnects).toHaveBeenCalledTimes(1);
  });

  it('stop() is idempotent — a second stop does not re-disconnect', async () => {
    const handle = await startAudioStream({ ...DEFAULT_OPTS });
    await handle.stop();
    await handle.stop();
    expect(disconnects).toHaveBeenCalledTimes(1);
  });
});
