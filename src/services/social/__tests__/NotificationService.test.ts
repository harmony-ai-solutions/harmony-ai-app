/**
 * NotificationService tests.
 *
 * Covers:
 *   - seeded feed (list) + unread count
 *   - markRead / markAllRead reduce unread and emit the 'unread' event
 *   - subscribe returns an unsubscribe that stops delivery (listenerCount)
 *   - registerPushToken is an in-memory no-op that resolves and stores the
 *     token (observable via the test-only getter)
 *   - mutations that don't change the unread count do NOT emit (no spurious
 *     re-renders)
 *
 * The service is a module-level singleton — `__resetForTests()` runs in
 * beforeEach for order independence. No stub-backend latency (the feed is
 * purely in-memory).
 */

// Mock the logger so it doesn't emit after tests finish.
jest.mock('../../../utils/logger', () => ({
  createLogger: () => ({
    warn: jest.fn(),
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }),
}));

import { notificationService } from '../NotificationService';

beforeEach(() => {
  notificationService.__resetForTests();
});

describe('NotificationService — seeded feed', () => {
  it('list() returns the seeded fixtures (welcome + marketplace/social events)', () => {
    const items = notificationService.list();
    expect(items.length).toBeGreaterThanOrEqual(3);
    const types = items.map(n => n.type);
    expect(types).toContain('welcome');
    expect(types).toContain('listing_sold');
    expect(types).toContain('listing_purchased');
    expect(types).toContain('follow');
  });

  it('getUnreadCount matches the seeded unread fixtures', () => {
    expect(notificationService.getUnreadCount()).toBe(3);
  });

  it('list() returns copies — callers cannot mutate the store', () => {
    const items = notificationService.list();
    items[0].isRead = true;
    expect(notificationService.getUnreadCount()).toBe(3);
  });
});

describe('NotificationService — read mutations', () => {
  it('markRead reduces unread and emits the new count', () => {
    const cb = jest.fn();
    const unsubscribe = notificationService.subscribe(cb);

    const unreadBefore = notificationService.getUnreadCount();
    const firstUnread = notificationService.list().find(n => !n.isRead)!;

    notificationService.markRead(firstUnread.id);
    expect(notificationService.getUnreadCount()).toBe(unreadBefore - 1);
    expect(cb).toHaveBeenLastCalledWith(unreadBefore - 1);
    unsubscribe();
  });

  it('markAllRead zeroes unread, marks every item and emits 0', () => {
    const cb = jest.fn();
    const unsubscribe = notificationService.subscribe(cb);

    notificationService.markAllRead();
    expect(notificationService.getUnreadCount()).toBe(0);
    expect(notificationService.list().every(n => n.isRead)).toBe(true);
    expect(cb).toHaveBeenLastCalledWith(0);
    unsubscribe();
  });

  it('does not emit when the unread count does not change (no spurious renders)', () => {
    const cb = jest.fn();
    const unsubscribe = notificationService.subscribe(cb);

    // markRead on an already-read notification: no change, no emit.
    const readItem = notificationService.list().find(n => n.isRead)!;
    notificationService.markRead(readItem.id);
    expect(cb).not.toHaveBeenCalled();

    // markAllRead when everything is already read: no change, no emit.
    notificationService.markAllRead();
    cb.mockClear();
    notificationService.markAllRead();
    expect(cb).not.toHaveBeenCalled();
    unsubscribe();
  });
});

describe('NotificationService — subscribe', () => {
  it('subscribe returns an unsubscribe that stops delivery', () => {
    const cb = jest.fn();
    const unsubscribe = notificationService.subscribe(cb);
    expect(notificationService.listenerCount('unread')).toBe(1);

    notificationService.markAllRead();
    expect(cb).toHaveBeenCalled();

    unsubscribe();
    expect(notificationService.listenerCount('unread')).toBe(0);

    const callsAfterUnsubscribe = cb.mock.calls.length;
    notificationService.__resetForTests(); // restores unread fixtures
    notificationService.markAllRead();
    expect(cb.mock.calls.length).toBe(callsAfterUnsubscribe);
  });
});

describe('NotificationService — registerPushToken (interface-only no-op)', () => {
  it('resolves, stores the token in memory and leaves the feed untouched', async () => {
    await expect(notificationService.registerPushToken('fcm-token-123')).resolves.toBeUndefined();

    expect(notificationService.__getRegisteredPushTokensForTests()).toEqual(['fcm-token-123']);
    expect(notificationService.getUnreadCount()).toBe(3); // feed unaffected
    expect(notificationService.list().length).toBeGreaterThanOrEqual(3);
  });

  it('ignores blank tokens', async () => {
    await notificationService.registerPushToken('   ');
    expect(notificationService.__getRegisteredPushTokensForTests()).toHaveLength(0);
  });
});