/**
 * outreachDedupe — the shared `message_id` dedupe seam for outreach
 * notifications (plan 7-12 §2/§5).
 *
 * ## Why
 *
 * The same outreach message can reach a device more than once: a live event
 * from the engine's events WS (`delivery:"live"`) plus a later re-emission, or
 * a local post plus a future cloud-relay/FCM push carrying the same
 * `message_id`. The doc requires every notification — engine-FCM push, relay
 * push, and local post — to collapse per `message_id` so the user never sees a
 * double.
 *
 * ## The seam
 *
 * This is a tiny, dependency-free, injectable store. It is a **shared
 * singleton** (`outreachDedupe`) so every producer feeds the SAME seen-set:
 *
 *   - `OutreachNotificationService` (step 3, this phase) — the events WS path.
 *   - Step 5 (wake relay) and step 7 (Firebase foreground arrivals) MUST call
 *     {@link OutreachDedupe.recordIfNew} with the incoming `message_id` BEFORE
 *     surfacing, so a wake-relayed/FCM push for an already-seen message is
 *     suppressed.
 *
 * The window is deliberately short (default 10 minutes) and the store is
 * bounded (default 512 ids): it exists to kill near-simultaneous doubles, not
 * to be a durable history. Eviction is time-based first, then insertion-order
 * (oldest-first) once the cap is exceeded.
 */

/** How long a recorded id suppresses a repeat (10 minutes). */
export const DEFAULT_DEDUPE_WINDOW_MS = 10 * 60 * 1000;

/** Hard cap on remembered ids (bounds memory; oldest evicted first). */
export const DEFAULT_DEDUPE_MAX_ENTRIES = 512;

export interface OutreachDedupeOptions {
  /** Suppression window in ms (default {@link DEFAULT_DEDUPE_WINDOW_MS}). */
  windowMs?: number;
  /** Max remembered ids (default {@link DEFAULT_DEDUPE_MAX_ENTRIES}). */
  maxEntries?: number;
  /** Clock (injectable for tests). */
  now?: () => number;
}

/**
 * A short-window, bounded `message_id` seen-set.
 *
 * Contract:
 *   - {@link recordIfNew} returns `true` when the id is NEW (the caller SHOULD
 *     surface the notification) and `false` when it is a duplicate within the
 *     window (the caller MUST suppress).
 *   - An empty/blank id cannot be deduped; {@link recordIfNew} returns `false`
 *     (callers must supply a `message_id` — the service guards this upstream).
 */
export class OutreachDedupe {
  private readonly windowMs: number;
  private readonly maxEntries: number;
  private readonly now: () => number;
  /** message_id → recorded-at (ms epoch), in insertion order. */
  private readonly seen = new Map<string, number>();

  constructor(options: OutreachDedupeOptions = {}) {
    this.windowMs = options.windowMs ?? DEFAULT_DEDUPE_WINDOW_MS;
    this.maxEntries = options.maxEntries ?? DEFAULT_DEDUPE_MAX_ENTRIES;
    this.now = options.now ?? (() => Date.now());
  }

  /** True when `messageId` was recorded within the window (still fresh). */
  hasSeen(messageId: string): boolean {
    const id = (messageId ?? '').trim();
    if (!id) return false;
    this.evictExpired();
    return this.seen.has(id);
  }

  /**
   * Record `messageId` and report whether it is new. `true` ⇒ surface it;
   * `false` ⇒ it is a duplicate within the window (suppress) or the id is blank.
   */
  recordIfNew(messageId: string): boolean {
    const id = (messageId ?? '').trim();
    if (!id) return false;
    this.evictExpired();
    if (this.seen.has(id)) return false;
    this.seen.set(id, this.now());
    this.enforceCap();
    return true;
  }

  /** Number of currently-remembered (non-expired) ids. */
  size(): number {
    this.evictExpired();
    return this.seen.size;
  }

  /** Drop every remembered id (tests / transport resets). */
  reset(): void {
    this.seen.clear();
  }

  private evictExpired(): void {
    const cutoff = this.now() - this.windowMs;
    // Map preserves insertion order, so the oldest entries are first.
    for (const [id, at] of this.seen) {
      if (at > cutoff) break;
      this.seen.delete(id);
    }
  }

  private enforceCap(): void {
    while (this.seen.size > this.maxEntries) {
      const oldest = this.seen.keys().next();
      if (oldest.done) break;
      this.seen.delete(oldest.value);
    }
  }
}

/**
 * The process-wide dedupe store. All outreach producers (this phase's events
 * WS service, and later the wake relay + Firebase foreground handler) share
 * this instance so a message is surfaced at most once.
 */
export const outreachDedupe = new OutreachDedupe();

export default outreachDedupe;
