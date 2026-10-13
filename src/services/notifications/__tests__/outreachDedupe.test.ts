/**
 * outreachDedupe — unit tests (plan 7-12 §2/§5).
 *
 * The shared `message_id` seen-set: new-vs-duplicate, the short window,
 * bounded size, blank-id handling, and reset.
 */

jest.mock('../../../utils/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

import {
  OutreachDedupe,
  DEFAULT_DEDUPE_WINDOW_MS,
  outreachDedupe,
} from '../outreachDedupe';

describe('OutreachDedupe', () => {
  it('reports a first id as new and a repeat as duplicate', () => {
    const dedupe = new OutreachDedupe();
    expect(dedupe.recordIfNew('msg-1')).toBe(true);
    expect(dedupe.recordIfNew('msg-1')).toBe(false);
    expect(dedupe.hasSeen('msg-1')).toBe(true);
    expect(dedupe.recordIfNew('msg-2')).toBe(true);
  });

  it('trims whitespace around the id', () => {
    const dedupe = new OutreachDedupe();
    expect(dedupe.recordIfNew('  msg-1 ')).toBe(true);
    expect(dedupe.recordIfNew('msg-1')).toBe(false);
  });

  it('treats a blank id as non-dedupable (returns false, never records)', () => {
    const dedupe = new OutreachDedupe();
    expect(dedupe.recordIfNew('')).toBe(false);
    expect(dedupe.recordIfNew('   ')).toBe(false);
    expect(dedupe.size()).toBe(0);
  });

  it('expires ids after the window', () => {
    let now = 1_000_000;
    const dedupe = new OutreachDedupe({ windowMs: 1000, now: () => now });
    expect(dedupe.recordIfNew('msg-1')).toBe(true);
    expect(dedupe.recordIfNew('msg-1')).toBe(false);

    // Past the window → the id is forgotten and can be recorded again.
    now += 1001;
    expect(dedupe.hasSeen('msg-1')).toBe(false);
    expect(dedupe.recordIfNew('msg-1')).toBe(true);
  });

  it('defaults to a 10-minute window', () => {
    expect(DEFAULT_DEDUPE_WINDOW_MS).toBe(600_000);
  });

  it('bounds the store and evicts the oldest first', () => {
    const dedupe = new OutreachDedupe({ maxEntries: 3 });
    dedupe.recordIfNew('a');
    dedupe.recordIfNew('b');
    dedupe.recordIfNew('c');
    dedupe.recordIfNew('d'); // evicts 'a'
    expect(dedupe.size()).toBe(3);
    expect(dedupe.hasSeen('a')).toBe(false);
    expect(dedupe.hasSeen('b')).toBe(true);
    expect(dedupe.hasSeen('d')).toBe(true);
  });

  it('reset clears every id', () => {
    const dedupe = new OutreachDedupe();
    dedupe.recordIfNew('msg-1');
    dedupe.reset();
    expect(dedupe.size()).toBe(0);
    expect(dedupe.recordIfNew('msg-1')).toBe(true);
  });

  it('exposes a process-wide singleton', () => {
    expect(outreachDedupe).toBeInstanceOf(OutreachDedupe);
    outreachDedupe.reset();
    expect(outreachDedupe.recordIfNew('singleton-1')).toBe(true);
    expect(outreachDedupe.recordIfNew('singleton-1')).toBe(false);
    outreachDedupe.reset();
  });
});
