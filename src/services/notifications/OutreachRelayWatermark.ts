/**
 * OutreachRelayWatermark — the persisted high-water mark of the last outreach
 * notification the device relayed (or surfaced) — plan 7-12 §2/§5, step 5.
 *
 * ## Why
 *
 * The iOS wake pass (`IOSLifecycleWakeHandler`) now relays outreach that landed
 * via **sync** during a suspended period (desktop-authority topology B) in
 * addition to the batch-flag path. The relay source is the engine's events WS
 * (`/api/notifications/stream`), which only streams live — it has no replay. To
 * make the relay idempotent ACROSS wakes (a re-delivered changeset, a re-emitted
 * event, or the app re-observing the same row), the device keeps a persisted
 * watermark of the last relayed message and only relays events strictly newer
 * than it.
 *
 * This mirrors the engine's own observer watermark
 * (`lifecycle/outreach_notify_observer.go`: a `conversation_messages.created_at`
 * high-water mark scoped to outreach/greeting rows) — the app-side counterpart
 * of the same "notify once, never on every re-apply" intent.
 *
 * ## Storage
 *
 * Persisted in AsyncStorage under the app's reserved `@soulbits_*` convention
 * (a plain JSON `{messageId, createdAt}`), cached in memory after the first read
 * so a wake pass touches storage at most once. `createdAt` is the engine's
 * RFC3339 (UTC) wire string — lexicographically ordered, so comparison is exact
 * and clock-skew-free (the same reasoning as the engine observer).
 *
 * The short-window `message_id` dedupe ({@link outreachDedupe}) remains the
 * primary in-process collapse; this watermark is the durable belt for the wake
 * relay across process restarts.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createLogger } from '../../utils/logger';

const log = createLogger('[OutreachWatermark]');

/** AsyncStorage key for the persisted relay/surface watermark. */
export const OUTREACH_RELAY_WATERMARK_KEY = '@soulbits_outreach_relay_watermark';

/** The last relayed/surfaced outreach message. */
export interface OutreachWatermark {
  /** The `message_id` of the last relayed/surfaced message. */
  messageId: string;
  /** Its engine `created_at` (RFC3339 UTC; lexicographically ordered). */
  createdAt: string;
}

/** The minimal event shape the watermark compares. */
export interface WatermarkEvent {
  message_id?: string;
  created_at?: string;
}

/** Parse a stored watermark (defensive; null when absent/malformed). */
function parseWatermark(raw: string | null): OutreachWatermark | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<OutreachWatermark>;
    if (value && typeof value.messageId === 'string' && typeof value.createdAt === 'string') {
      return { messageId: value.messageId, createdAt: value.createdAt };
    }
  } catch {
    /* malformed → treat as absent */
  }
  return null;
}

/** True when `next` should advance the watermark past `current`. */
function isNewer(next: OutreachWatermark, current: OutreachWatermark): boolean {
  if (next.createdAt !== current.createdAt) return next.createdAt > current.createdAt;
  // Same instant, different message → still a new (later-observed) message.
  return next.messageId !== current.messageId;
}

/**
 * The persisted relay/surface watermark. Injectable (tests use a fake clock-free
 * instance or an in-memory AsyncStorage mock).
 */
export class OutreachRelayWatermark {
  /** `undefined` = not yet loaded; `null` = loaded and absent. */
  private cached: OutreachWatermark | null | undefined = undefined;

  /** The stored watermark, or null when none has been recorded. Never throws. */
  async get(): Promise<OutreachWatermark | null> {
    if (this.cached !== undefined) return this.cached;
    try {
      const raw = await AsyncStorage.getItem(OUTREACH_RELAY_WATERMARK_KEY);
      this.cached = parseWatermark(raw);
    } catch (e) {
      log.warn('watermark read failed; treating as absent', e);
      this.cached = null;
    }
    return this.cached;
  }

  /**
   * True when `event` is strictly newer than the stored watermark (or no
   * watermark exists). An event without a `created_at` cannot be ordered; it is
   * allowed through and left to the in-process dedupe.
   */
  async shouldRelay(event: WatermarkEvent): Promise<boolean> {
    const createdAt = (event.created_at ?? '').trim();
    if (!createdAt) return true;
    const watermark = await this.get();
    if (!watermark) return true;
    if (createdAt > watermark.createdAt) return true;
    if (createdAt === watermark.createdAt && (event.message_id ?? '') !== watermark.messageId) {
      return true;
    }
    return false;
  }

  /**
   * Advance the watermark to `event` when it is at/after the current one. Never
   * moves backwards (a late/out-of-order event cannot re-open the window).
   */
  async record(event: WatermarkEvent): Promise<void> {
    const messageId = (event.message_id ?? '').trim();
    if (!messageId) return;
    const next: OutreachWatermark = {
      messageId,
      createdAt: (event.created_at ?? '').trim(),
    };
    const current = await this.get();
    if (current && !isNewer(next, current)) return;
    this.cached = next;
    try {
      await AsyncStorage.setItem(OUTREACH_RELAY_WATERMARK_KEY, JSON.stringify(next));
    } catch (e) {
      log.warn('watermark write failed (non-fatal)', e);
    }
  }

  /** Test-only: drop the in-memory cache (storage is left as-is). */
  resetCache(): void {
    this.cached = undefined;
  }
}

/** The process-wide watermark. Shared by every relay/surface producer. */
export const outreachRelayWatermark = new OutreachRelayWatermark();

export default outreachRelayWatermark;
