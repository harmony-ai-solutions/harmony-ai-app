/**
 * NotificationService — in-memory notification feed (stub).
 *
 * Replaces the doomed SQLite `notifications` sidecar repo with an in-memory
 * list seeded from `src/constants/socialFixtures.ts` (a few welcome +
 * marketplace/social events). An EventEmitter over the `'unread'` event —
 * screens subscribe via `subscribe(cb)` to refresh their badge whenever the
 * unread count changes.
 *
 * Key design decisions:
 *   - `registerPushToken(token)` is modeled in the interface NOW as a no-op
 *     that stores the token in memory (A3): the engine's `device_push_tokens`
 *     + `DeviceAuthService.registerDevice` pushToken param already anticipate
 *     it. The future backend replaces the in-memory store.
 *   - List reads (`list`, `getUnreadCount`) and mutations (`markRead`,
 *     `markAllRead`) are synchronous — they touch only in-memory state; only
 *     `registerPushToken` is async (wire-shaped for the future backend).
 *   - Mutations that do not change the unread count (marking an already-read
 *     item, marking all when none are unread) do NOT emit — no spurious
 *     re-renders.
 *   - `__resetForTests()` / `__getRegisteredPushTokensForTests()` are
 *     test-only hooks so suites are order-independent and can assert the
 *     in-memory token store.
 *
 * Singleton — use `notificationService` (the exported instance).
 */

import EventEmitter from 'eventemitter3';
import { createLogger } from '../../utils/logger';
import { SOCIAL_NOTIFICATIONS } from '../../constants/socialFixtures';

const log = createLogger('[Notifications]');

// ── Types ─────────────────────────────────────────────────────────────────

export type StubNotificationType =
  | 'welcome'
  | 'follow'
  | 'profile_like'
  | 'image_like'
  | 'image_comment'
  | 'post_like'
  | 'post_comment'
  | 'listing_sold'
  | 'listing_purchased';

export interface StubNotification {
  id: string;
  type: StubNotificationType;
  /** Null for system/automated notifications (filters skip them). */
  actorUserId: string | null;
  actorDisplayName: string;
  text: string;
  /** ISO 8601 timestamp. */
  createdAt: string;
  isRead: boolean;
}

interface NotificationEvents {
  unread: (count: number) => void;
}

// ── Service ───────────────────────────────────────────────────────────────

export class NotificationServiceClass extends EventEmitter<NotificationEvents> {
  private static instance: NotificationServiceClass | null = null;

  private notifications: StubNotification[] = [];
  private pushTokens: string[] = [];

  private constructor() {
    super();
    this.seed();
  }

  static getInstance(): NotificationServiceClass {
    if (!NotificationServiceClass.instance) {
      NotificationServiceClass.instance = new NotificationServiceClass();
    }
    return NotificationServiceClass.instance;
  }

  // ── Feed ────────────────────────────────────────────────────────────────

  /** All notifications, newest first. */
  list(): StubNotification[] {
    return this.notifications.map(n => ({ ...n }));
  }

  /** Number of unread notifications (badge on the header bell). */
  getUnreadCount(): number {
    return this.notifications.filter(n => !n.isRead).length;
  }

  /** Mark one notification as read (emits `unread` only when the count changes). */
  markRead(id: string): void {
    const item = this.notifications.find(n => n.id === id);
    if (!item || item.isRead) return;
    item.isRead = true;
    this.emitUnread();
  }

  /** Mark all notifications as read (emits `unread` only when the count changes). */
  markAllRead(): void {
    if (this.getUnreadCount() === 0) return;
    for (const item of this.notifications) item.isRead = true;
    this.emitUnread();
  }

  /**
   * Subscribe to unread-count changes. Returns an unsubscribe function.
   */
  subscribe(cb: (count: number) => void): () => void {
    this.on('unread', cb);
    return () => {
      this.off('unread', cb);
    };
  }

  // ── Push tokens (A3 — interface-only no-op) ─────────────────────────────

  /**
   * Register a push token for this device. Interface-only no-op for now: the
   * token is stored in memory (the engine's `device_push_tokens` table and
   * `DeviceAuthService.registerDevice` pushToken param already anticipate the
   * real backend call).
   */
  async registerPushToken(token: string): Promise<void> {
    const clean = token.trim();
    if (clean) {
      this.pushTokens.push(clean);
      log.info(`Registered push token (${this.pushTokens.length} stored in memory)`);
    }
  }

  // ── Test-only hooks ─────────────────────────────────────────────────────

  /** Test-only: the push tokens stored in memory (copies). */
  __getRegisteredPushTokensForTests(): string[] {
    return [...this.pushTokens];
  }

  /** Test-only: re-seed the feed + clear tokens so suites are order-independent. */
  __resetForTests(): void {
    this.notifications = [];
    this.pushTokens = [];
    this.seed();
  }

  // ── Internals ───────────────────────────────────────────────────────────

  private seed(): void {
    this.notifications = SOCIAL_NOTIFICATIONS.map(n => ({ ...n }));
  }

  private emitUnread(): void {
    this.emit('unread', this.getUnreadCount());
  }
}

// ── Singleton export ──────────────────────────────────────────────────────

export const notificationService = NotificationServiceClass.getInstance();
export default notificationService;