/**
 * OutreachRelayWatermark — unit tests (plan 7-12 §2/§5, step 5).
 *
 * The persisted high-water mark that makes the wake relay idempotent across
 * wakes: an event is relayed only when strictly newer than the recorded
 * (createdAt, messageId).
 */

jest.mock('../../../utils/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

// In-memory AsyncStorage (the global jest mock is non-persistent). The store
// lives inside the factory so no out-of-scope variable is referenced; tests
// reset it via AsyncStorage.clear().
jest.mock('@react-native-async-storage/async-storage', () => {
  const store = new Map<string, string>();
  return {
    getItem: jest.fn(async (k: string) => (store.has(k) ? store.get(k)! : null)),
    setItem: jest.fn(async (k: string, v: string) => {
      store.set(k, v);
    }),
    removeItem: jest.fn(async (k: string) => {
      store.delete(k);
    }),
    clear: jest.fn(async () => {
      store.clear();
    }),
  };
});

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  OutreachRelayWatermark,
  OUTREACH_RELAY_WATERMARK_KEY,
} from '../OutreachRelayWatermark';

const ev = (messageId: string, createdAt: string) => ({
  message_id: messageId,
  created_at: createdAt,
});

describe('OutreachRelayWatermark', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    (AsyncStorage.getItem as jest.Mock).mockClear();
  });

  it('returns null when nothing has been recorded', async () => {
    const wm = new OutreachRelayWatermark();
    expect(await wm.get()).toBeNull();
  });

  it('relays everything when no watermark exists', async () => {
    const wm = new OutreachRelayWatermark();
    expect(await wm.shouldRelay(ev('m1', '2026-10-13T12:00:00Z'))).toBe(true);
  });

  it('persists and reads back the watermark', async () => {
    const wm = new OutreachRelayWatermark();
    await wm.record(ev('m1', '2026-10-13T12:00:00Z'));
    expect(await wm.get()).toEqual({ messageId: 'm1', createdAt: '2026-10-13T12:00:00Z' });

    // A fresh instance reads the persisted value (survives a restart).
    const reloaded = new OutreachRelayWatermark();
    expect(await reloaded.get()).toEqual({ messageId: 'm1', createdAt: '2026-10-13T12:00:00Z' });
  });

  it('relays only strictly-newer events', async () => {
    const wm = new OutreachRelayWatermark();
    await wm.record(ev('m2', '2026-10-13T12:00:00Z'));

    expect(await wm.shouldRelay(ev('m3', '2026-10-13T12:00:01Z'))).toBe(true); // newer
    expect(await wm.shouldRelay(ev('m1', '2026-10-13T11:59:59Z'))).toBe(false); // older
    expect(await wm.shouldRelay(ev('m2', '2026-10-13T12:00:00Z'))).toBe(false); // same id + instant
    expect(await wm.shouldRelay(ev('m9', '2026-10-13T12:00:00Z'))).toBe(true); // same instant, new id
  });

  it('allows events without a created_at (ordering unknown → dedupe decides)', async () => {
    const wm = new OutreachRelayWatermark();
    await wm.record(ev('m2', '2026-10-13T12:00:00Z'));
    expect(await wm.shouldRelay({ message_id: 'm3', created_at: '' })).toBe(true);
  });

  it('never moves the watermark backwards', async () => {
    const wm = new OutreachRelayWatermark();
    await wm.record(ev('m5', '2026-10-13T12:00:05Z'));
    await wm.record(ev('m1', '2026-10-13T12:00:01Z')); // older — ignored
    expect(await wm.get()).toEqual({ messageId: 'm5', createdAt: '2026-10-13T12:00:05Z' });
  });

  it('ignores a blank message id on record', async () => {
    const wm = new OutreachRelayWatermark();
    await wm.record({ message_id: '', created_at: '2026-10-13T12:00:00Z' });
    expect(await wm.get()).toBeNull();
  });

  it('treats a malformed stored value as absent', async () => {
    await AsyncStorage.setItem(OUTREACH_RELAY_WATERMARK_KEY, 'not-json{');
    const wm = new OutreachRelayWatermark();
    expect(await wm.get()).toBeNull();
  });
});
