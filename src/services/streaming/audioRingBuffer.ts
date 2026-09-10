/**
 * audioRingBuffer — byte ring buffer for the engine's PULL protocol
 * (persona-modules 5-2).
 *
 * ## Why a ring buffer
 *
 * The engine drives streaming by sequentially pulling fixed, time-sliced audio
 * ranges from the client (`STT_FETCH_MICROPHONE {start_byte, bytes_count}`). The
 * client holds a rolling buffer of raw PCM; if the engine reads AHEAD of the mic
 * (buffer not yet grown to the requested range) the responder must WAIT rather
 * than answer with a short/empty slice — exactly the VNGE plugin's behavior
 * (`speech_to_text.py`: `get_buffer_fetch_indices` + the read-ahead wait loops).
 *
 * ## Overflow / dropped-bytes accounting (VNGE parity)
 *
 * When appending would exceed `maxBytes`, the OLDEST bytes are dropped in
 * multiples of `blockAlign` (channels * bytesPerSample) to keep PCM frame
 * boundaries intact, and the dropped amount is accumulated in `droppedBytes`.
 * Fetch indices are absolute (`start_byte` counts from mic start); the actual
 * buffer index is `absolute - droppedBytes`. If a requested range has already
 * been dropped, the slice resolves empty (the data is irrecoverable) — the
 * caller is expected to model that as lost audio.
 *
 * ## Non-blocking wait
 *
 * `fetchSlice` never busy-loops: the read-ahead wait is a promise-based poll
 * (`setTimeout`) that yields to the event loop, so an unanswered fetch does NOT
 * block the connection's event processing (verified in streamingService tests).
 */

export interface AudioRingBufferOptions {
  /** Maximum buffered bytes before the oldest are dropped. */
  maxBytes: number;
  /** PCM frame alignment in bytes (channels * bytesPerSample). */
  blockAlign: number;
  /** Poll interval (ms) for the read-ahead wait. */
  waitPollMs?: number;
}

export class AudioRingBuffer {
  private store: Uint8Array = new Uint8Array(0);
  private dropped = 0;
  private readonly maxBytes: number;
  private readonly blockAlign: number;
  private readonly waitPollMs: number;

  constructor(options: AudioRingBufferOptions) {
    this.maxBytes = options.maxBytes;
    this.blockAlign = options.blockAlign;
    this.waitPollMs = options.waitPollMs ?? 16;
  }

  /** Current number of bytes held in the buffer (after any drops). */
  get byteLength(): number {
    return this.store.length;
  }

  /** Total bytes dropped due to overflow (absolute timeline offset). */
  get droppedBytesCount(): number {
    return this.dropped;
  }

  /** Append raw PCM bytes; on overflow drop the oldest in block-align multiples. */
  append(bytes: Uint8Array): void {
    if (bytes.length === 0) return;

    const merged = new Uint8Array(this.store.length + bytes.length);
    merged.set(this.store, 0);
    merged.set(bytes, this.store.length);
    this.store = merged;

    if (this.store.length > this.maxBytes) {
      let excess = this.store.length - this.maxBytes;
      // Keep frames aligned: round the dropped amount down to a blockAlign multiple.
      if (this.blockAlign > 1) {
        const remainder = excess % this.blockAlign;
        if (remainder !== 0) excess -= remainder;
      }
      if (excess > 0) {
        this.dropped += excess;
        this.store = this.store.subarray(excess);
      }
    }
  }

  /**
   * Map an absolute byte range to the current buffer indices (VNGE
   * `get_buffer_fetch_indices`). Indices are clamped to 0 so a range that was
   * already dropped resolves to an empty (or shortened) slice rather than a
   * negative-index wrap.
   */
  getFetchIndices(startByte: number, endByte: number): { actualStart: number; actualEnd: number; bufferSize: number } {
    const actualStart = Math.max(0, startByte - this.dropped);
    const actualEnd = Math.max(0, endByte - this.dropped);
    return { actualStart, actualEnd, bufferSize: this.store.length };
  }

  /**
   * Wait (non-blocking, promise-polled) until the whole range is available.
   * If `signal` is aborted (e.g. the stream was stopped) a pending read-ahead is
   * rejected so no timer survives the stream teardown.
   */
  async waitForAvailable(startByte: number, endByte: number, signal?: AbortSignal): Promise<void> {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (signal?.aborted) {
        throw new Error('audio stream aborted');
      }
      const { actualStart, actualEnd, bufferSize } = this.getFetchIndices(startByte, endByte);
      if (actualStart <= bufferSize && actualEnd <= bufferSize) return;
      await this.sleep(this.waitPollMs);
    }
  }

  /**
   * Fetch a slice of the buffer for the absolute `[startByte, startByte+bytesCount)`
   * range, waiting read-ahead until the microphone has produced enough bytes.
   * The wait yields to the event loop (never blocks it). Passing `signal` lets a
   * caller (e.g. the streaming service on stop) cancel a pending read-ahead.
   */
  async fetchSlice(startByte: number, bytesCount: number, signal?: AbortSignal): Promise<Uint8Array> {
    const endByte = startByte + bytesCount;
    await this.waitForAvailable(startByte, endByte, signal);
    const { actualStart, actualEnd } = this.getFetchIndices(startByte, endByte);
    if (actualEnd <= actualStart) return new Uint8Array(0);
    return this.store.slice(actualStart, actualEnd);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
