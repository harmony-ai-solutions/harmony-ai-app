/**
 * audioRingBuffer — byte ring buffer for the engine's pull protocol
 * (persona-modules 5-2).
 *
 * Mirrors the VNGE plugin's semantics (`speech_to_text.py` `get_buffer_fetch_indices`
 * + `process_recording_request`): append PCM bytes; on overflow drop the OLDEST
 * bytes in block-align multiples and count them in `dropped_bytes`; the fetch
 * indices are offset by `dropped_bytes` (`actual = absolute - dropped`); a fetch
 * that reads ahead of the mic WAITS (non-blocking) until the buffer grows.
 *
 * Pure + deterministic; the read-ahead wait uses fake timers.
 */

import { AudioRingBuffer } from '../audioRingBuffer';

const BLOCK_ALIGN = 2; // 16-bit mono

function makeBuffer(maxBytes = 100, waitPollMs = 10): AudioRingBuffer {
  return new AudioRingBuffer({ maxBytes, blockAlign: BLOCK_ALIGN, waitPollMs });
}

describe('AudioRingBuffer — append + slice correctness', () => {
  it('slices raw PCM bytes by absolute byte range', async () => {
    const rb = makeBuffer();
    rb.append(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]));
    const slice = await rb.fetchSlice(0, 4);
    expect(Array.from(slice)).toEqual([1, 2, 3, 4]);
  });

  it('slices a mid-range absolute byte range after multiple appends', async () => {
    const rb = makeBuffer();
    rb.append(new Uint8Array([1, 2, 3, 4]));
    rb.append(new Uint8Array([5, 6, 7, 8]));
    const slice = await rb.fetchSlice(4, 4);
    expect(Array.from(slice)).toEqual([5, 6, 7, 8]);
  });

  it('returns an empty slice when the requested range was already dropped', async () => {
    const rb = makeBuffer(8);
    rb.append(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]));
    rb.append(new Uint8Array([9, 10, 11, 12])); // overflow → drops oldest bytes
    // Absolute bytes 0..1 were dropped; the fetch resolves to an empty slice.
    const slice = await rb.fetchSlice(0, 2);
    expect(Array.from(slice)).toEqual([]);
  });
});

describe('AudioRingBuffer — read-ahead wait (non-blocking)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('does not resolve until enough bytes have been appended', async () => {
    const rb = makeBuffer(100, 10);
    rb.append(new Uint8Array([1, 2, 3])); // only 3 of 6 requested bytes

    let settled = false;
    const pending = rb.fetchSlice(0, 6).then((s) => {
      settled = true;
      return s;
    });

    // Not yet available — the responder yields to the event loop (no block).
    await Promise.resolve();
    expect(settled).toBe(false);

    // Feed the remaining bytes and advance the wait poll → resolves.
    rb.append(new Uint8Array([4, 5, 6]));
    jest.advanceTimersByTime(10);
    const slice = await pending;
    expect(settled).toBe(true);
    expect(Array.from(slice)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('stays pending while reading ahead of the mic (repeated waits)', async () => {
    const rb = makeBuffer(100, 10);
    rb.append(new Uint8Array([1, 2]));

    let settled = false;
    // Absolute range [2,6) needs buffer indices 2..5 → 6 bytes must be present.
    const pending = rb.fetchSlice(2, 4).then((s) => {
      settled = true;
      return s;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    rb.append(new Uint8Array([3, 4])); // 4 bytes present, 6 needed → still waiting
    jest.advanceTimersByTime(10);
    await Promise.resolve();
    expect(settled).toBe(false);

    rb.append(new Uint8Array([5, 6])); // 6 bytes present → available
    jest.advanceTimersByTime(10);
    const slice = await pending;
    expect(Array.from(slice)).toEqual([3, 4, 5, 6]);
  });
});

describe('AudioRingBuffer — overflow + dropped-bytes accounting', () => {
  it('drops the oldest bytes in block-align multiples and tallies dropped_bytes', () => {
    const rb = makeBuffer(10);
    rb.append(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]));
    // 12 present > 10 → excess 2, aligned to 2 dropped; store keeps last 10.
    expect(rb.byteLength).toBe(10);
    expect(rb.droppedBytesCount).toBe(2);
  });

  it('rounds the dropped excess down to a block-align multiple', () => {
    // blockAlign 4 (stereo 16-bit), maxBytes 10, appending 14 → excess 4 (aligned).
    const rb = new AudioRingBuffer({ maxBytes: 10, blockAlign: 4, waitPollMs: 10 });
    rb.append(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]));
    expect(rb.droppedBytesCount).toBe(4);
    expect(rb.byteLength).toBe(10);
  });

  it('offsets fetch indices by dropped_bytes so recent audio stays addressable', async () => {
    const rb = makeBuffer(10);
    rb.append(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]));
    rb.append(new Uint8Array([9, 10, 11, 12])); // overflow → drop [1,2]
    // Absolute bytes 2..5 → buffer indices 0..3 = [3,4,5,6].
    const slice = await rb.fetchSlice(2, 4);
    expect(Array.from(slice)).toEqual([3, 4, 5, 6]);
  });
});
