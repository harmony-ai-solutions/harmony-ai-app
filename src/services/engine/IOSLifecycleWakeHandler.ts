/**
 * IOSLifecycleWakeHandler — the silent-push (keepalive) wake orchestration for
 * the iOS blind-tick lifecycle (task 4-3, steps 1–2, 5).
 *
 * On a `content-available` wake (the 4-4 hourly keepalive, or a data-only relay
 * delivery) the native coordinator hands the wake to JS, which runs this
 * bounded pass:
 *
 *   1. Ensure the embedded engine is started (reuse a live connection, else
 *      start — task 4-2).
 *   2. Refresh + inject the inference credential (best-effort): the cloud
 *      PASETO is written into the engine's SoulbitsCloud provider rows
 *      (`updateAllSoulbitsCloudApiKeys`). A failure — or a signed-out device —
 *      degrades the batch to non-LLM mode (`Degraded`), so state still advances
 *      and no narratives/relay spam are produced (step 5).
 *   3. Fetch the tier's daily beat budget (4-4 policy API) and slice it into a
 *      per-wake budget (see {@link perWakeMaxBeats}).
 *   4. Run `lifecycle.batch` with a deadline STRICTLY before the OS window
 *      (~25 s of the ~30 s iOS gives) and the per-wake budget.
 *   5. Relay a visible push for any completed entity whose executed plan
 *      flagged an outreach due (the device decides; the 4-4 relay is opaque).
 *   6. Stop the engine cleanly, then record honored/missed telemetry.
 *
 * Everything is injectable so the pass is unit-tested deterministically without
 * an engine, a network, or timers.
 */

import { createLogger } from '../../utils/logger';
import AuthService from '../auth/AuthService';
import { updateAllSoulbitsCloudApiKeys } from '../../database/repositories';
import { fetchAutonomyBeatsPerDay } from '../cloud/soulbitsClient';
import { connectEngine, disconnectEngine, getEngineConnection } from './EngineService';
import type { EngineConnection } from './EngineService';
import { selectEngineHost } from './EngineHost';
import { engineApiClient } from './EngineApiClient';
import {
  BATCH_PRIORITY_MOST_OVERDUE,
  LIFECYCLE_BATCH_METHOD,
  outreachDueEntityIds,
  parseBatchResult,
  toRfc3339,
} from './engineLifecycleCall';
import type { BatchRequestPayload, BatchResultDto } from './engineLifecycleCall';
import {
  createDefaultPushRelayClient,
  logRelayFailure,
} from '../lifecycle/PushRelayClient';
import type { PushRelayClient } from '../lifecycle/PushRelayClient';
import { composeLocalNotification } from '../notifications/OutreachNotificationService';
import type { OutreachNotificationEvent } from '../notifications/OutreachNotificationService';
import {
  getHideContentOnLockScreen,
  getNotificationTransport,
} from '../notifications/NotificationSettings';
import type { NotificationTransport } from '../notifications/NotificationSettings';
import { outreachDedupe } from '../notifications/outreachDedupe';
import type { OutreachDedupe } from '../notifications/outreachDedupe';
import { outreachRelayWatermark } from '../notifications/OutreachRelayWatermark';
import type { OutreachRelayWatermark } from '../notifications/OutreachRelayWatermark';
import { SyncAppliedOutreachCollector } from '../notifications/SyncAppliedOutreachCollector';
import { iosLifecycleTelemetry } from './IOSLifecycleTelemetry';
import type { IOSLifecycleTelemetry } from './IOSLifecycleTelemetry';

const log = createLogger('[IOSLifecycleWake]');

/**
 * The batch deadline offset from the wake start (ms). iOS grants ~30 s for a
 * `content-available` wake; the engine deadline must be STRICTLY before the OS
 * deadline so in-flight entities have room to finish (step 2).
 */
export const IOS_WAKE_WINDOW_MS = 25_000;

/** Nominal hourly wakes/day, used to slice the daily tier budget per wake. */
export const NOMINAL_WAKES_PER_DAY = 24;

/** Per-wake beat budget when the tier budget is unavailable/undefined. */
export const DEFAULT_WAKE_MAX_BEATS = 2;

/** A composed outreach notice (the relay request's content). */
export interface OutreachNotice {
  entityId: string;
  /** Optional pre-rendered banner title. */
  title?: string;
  /** The banner body (v1 plain-text default). */
  body: string;
  /** The opaque relay payload (device-authored; never inspected by the relay). */
  payload: string;
  /**
   * The `message_id` the payload carries (plan 7-12 §5 — the opaque blob gains
   * `messageId`). Present for sync-applied notices; the batch-flag composer adds
   * it when the engine's `last_message` carries one.
   */
  messageId?: string;
}

/**
 * The sync-applied outreach source (the wake pass opens it before the batch and
 * drains it after — see {@link SyncAppliedOutreachCollector}). Injectable so the
 * pass is unit-tested without a socket.
 */
export interface SyncAppliedOutreachSource {
  start(): void;
  take(): OutreachNotificationEvent[];
  stop(): void;
}

/** Injectable seams (production defaults below; tests override). */
export interface IOSLifecycleWakeDeps {
  /** Start (or reuse) the engine and return its connection. */
  ensureEngineStarted: () => Promise<EngineConnection>;
  /** Stop the engine cleanly (idempotent). */
  stopEngine: () => Promise<void>;
  /** The facade RPC (`EngineCall`). */
  call: (method: string, payloadJSON: string) => Promise<string>;
  /** Read the cached cloud PASETO (null when signed out). */
  getToken: () => Promise<string | null>;
  /** Inject the fresh PASETO into the engine's SoulbitsCloud provider rows. */
  refreshCredentials: (paseto: string) => Promise<void>;
  /** Fetch the tier's daily beat budget (null when unknown/undefined). */
  fetchBudget: (paseto: string) => Promise<number | null>;
  /** Compose the relay notice for an entity that delivered outreach. */
  composeOutreach: (entityId: string) => Promise<OutreachNotice | null>;
  /** The visible-push relay client. */
  relay: PushRelayClient;
  /** Clock (epoch ms). */
  now: () => number;
  /** Telemetry sink. */
  telemetry: IOSLifecycleTelemetry;
  /** The OS wake window (ms). Defaults to {@link IOS_WAKE_WINDOW_MS}. */
  wakeWindowMs?: number;
  /**
   * Read the transport preference (defaults to `NotificationSettings`). The
   * wake relay is the CLOUD path: it fires only for `auto`/`cloud`; `direct`
   * (engine-side FCM owns the notification) and `off` (silence) skip it
   * entirely — plan 7-12 §5.
   */
  getTransport?: () => Promise<NotificationTransport>;
  /** Read the lock-screen hide-content preference (defaults to NotificationSettings). */
  getHideContent?: () => Promise<boolean>;
  /** Shared `message_id` dedupe store (defaults to the process-wide singleton). */
  dedupe?: OutreachDedupe;
  /** Persisted relay/surface watermark (defaults to the process-wide singleton). */
  watermark?: OutreachRelayWatermark;
  /**
   * Factory for the sync-applied outreach collector. Defaults to the engine
   * events-WS {@link SyncAppliedOutreachCollector}. Opened before the batch and
   * drained after it, so sync-applied outreach that lands during the wake window
   * is captured (the events WS has no replay).
   */
  collectorFactory?: () => SyncAppliedOutreachSource;
}

/** The outcome of one wake pass. */
export interface IOSLifecycleWakeResult {
  /** True when the batch ran within the window (a wake that was honoured). */
  honored: boolean;
  /** True when the batch ran in non-LLM mode. */
  degraded: boolean;
  /** Entities completed by the batch (0 when it never ran). */
  completed: number;
  /** Entities due but not started. */
  truncated: number;
  /** Entities advanced non-LLM only. */
  degradedCount: number;
  /** Relay pushes delivered for outreach (0 when none / relay failed). */
  relayed: number;
  /**
   * Set when the batch was skipped because this device is not the cognition
   * authority (plan 7-8; `"not_authoritative"`). A well-formed skip, not an
   * error — surfaced honestly on the lifecycle-limits screen.
   */
  skippedReason?: string;
  /** Failure message when the pass ended in error. */
  error?: string;
}

/** Production default seams. */
export function defaultIOSLifecycleWakeDeps(): IOSLifecycleWakeDeps {
  return {
    ensureEngineStarted: ensureEngineStarted,
    stopEngine: disconnectEngine,
    call: (method, payloadJSON) => selectEngineHost().call(method, payloadJSON),
    getToken: async () => {
      try {
        return (await AuthService.getToken()) || null;
      } catch {
        return null;
      }
    },
    refreshCredentials: updateAllSoulbitsCloudApiKeys,
    fetchBudget: fetchAutonomyBeatsPerDay,
    composeOutreach: composeOutreachFromEngine,
    relay: createDefaultPushRelayClient(),
    now: () => Date.now(),
    telemetry: iosLifecycleTelemetry,
    getTransport: getNotificationTransport,
    getHideContent: getHideContentOnLockScreen,
    dedupe: outreachDedupe,
    watermark: outreachRelayWatermark,
    collectorFactory: () => new SyncAppliedOutreachCollector(),
  };
}

/** Reuse a live engine connection, else start the engine. */
async function ensureEngineStarted(): Promise<EngineConnection> {
  const existing = getEngineConnection();
  if (existing) return existing;
  await connectEngine();
  const connection = getEngineConnection();
  if (!connection) {
    throw new Error('ios-wake: engine started but no connection was published');
  }
  return connection;
}

/**
 * Slice the daily tier budget into a per-wake budget. iOS wakes are hourly at
 * best (and far sparser in practice), so `daily / 24` keeps a day of wakes
 * within the cooperative on-device ceiling; the deadline is the practical bound
 * inside the ~25 s window. Unknown budget → {@link DEFAULT_WAKE_MAX_BEATS}.
 */
export function perWakeMaxBeats(dailyBudget: number | null): number {
  if (dailyBudget == null || !Number.isFinite(dailyBudget) || dailyBudget <= 0) {
    return DEFAULT_WAKE_MAX_BEATS;
  }
  return Math.max(1, Math.ceil(dailyBudget / NOMINAL_WAKES_PER_DAY));
}

/**
 * Default outreach composer: read the entity's newest conversation's last
 * message and relay it as a banner (best-effort — a read failure yields a
 * data-only notice so the relay still fires, or null to skip).
 */
async function composeOutreachFromEngine(entityId: string): Promise<OutreachNotice | null> {
  try {
    const chat = await engineApiClient.entityChatList(entityId, { limit: 1 });
    const row = chat.conversations?.[0];
    const body = row?.last_message?.content?.trim();
    const messageId = row?.last_message?.id?.trim();
    if (body) {
      return { entityId, body, messageId, payload: outreachPayload(entityId, messageId) };
    }
  } catch (e) {
    log.warn(`outreach compose read failed for ${entityId} (non-fatal):`, e);
  }
  // No readable text — deliver a data-only relay push (an on-device NSE can
  // compose the banner later; the relay itself never inspects it).
  return { entityId, body: '', payload: outreachPayload(entityId) };
}

/**
 * The opaque relay blob (device-authored; the relay never inspects it). The
 * `messageId` field is additive (plan 7-12 §5) — present when the device knows
 * it, absent otherwise (a batch-flag notice with no readable engine message id).
 */
function outreachPayload(entityId: string, messageId?: string): string {
  const blob: { kind: string; entityId: string; messageId?: string } = {
    kind: 'outreach',
    entityId,
  };
  if (messageId) blob.messageId = messageId;
  return JSON.stringify(blob);
}

/**
 * Run one silent-push wake pass. Never throws — a failure is recorded as a
 * missed wake and returned. The engine is always stopped before returning.
 */
export async function runIOSLifecycleWake(
  deps: IOSLifecycleWakeDeps,
  opts: { kind?: 'keepalive' | 'relay' } = {},
): Promise<IOSLifecycleWakeResult> {
  const wakeWindowMs = deps.wakeWindowMs ?? IOS_WAKE_WINDOW_MS;
  const startedAt = deps.now();
  const deadlineMs = startedAt + wakeWindowMs;
  log.info(`wake start (${opts.kind ?? 'keepalive'}) window=${wakeWindowMs}ms`);

  let honored = false;
  let degraded = false;
  let completed = 0;
  let truncated = 0;
  let degradedCount = 0;
  let relayed = 0;
  let skippedReason: string | undefined;
  let error: string | undefined;
  let collector: SyncAppliedOutreachSource | null = null;

  try {
    await deps.ensureEngineStarted();

    // Open the sync-applied outreach collector BEFORE the batch: the engine
    // applies pending authority changesets during the catch-up/batch, and the
    // events WS has no replay — we must be subscribed while they land. A
    // collector failure never fails the wake.
    try {
      collector = (deps.collectorFactory ?? (() => new SyncAppliedOutreachCollector()))();
      collector.start();
    } catch (e) {
      collector = null;
      log.warn('sync-applied collector start failed (non-fatal):', e);
    }

    // Credential refresh + injection (best-effort). A failure — or a signed-out
    // device — degrades the batch to non-LLM mode.
    let paseto: string | null = null;
    try {
      paseto = await deps.getToken();
    } catch {
      paseto = null;
    }

    let dailyBudget: number | null = null;
    if (paseto) {
      try {
        await deps.refreshCredentials(paseto);
      } catch (e) {
        degraded = true;
        log.warn('credential injection failed — batch runs degraded (non-LLM):', e);
      }
      try {
        dailyBudget = await deps.fetchBudget(paseto);
      } catch (e) {
        log.warn('tier budget fetch failed (non-fatal):', e);
      }
    }

    const payload: BatchRequestPayload = {
      now: toRfc3339(startedAt),
      deadline: toRfc3339(deadlineMs),
      maxBeats: perWakeMaxBeats(dailyBudget),
      priority: BATCH_PRIORITY_MOST_OVERDUE,
    };
    if (degraded) payload.degraded = true;

    const resultJson = await deps.call(LIFECYCLE_BATCH_METHOD, JSON.stringify(payload));
    const result: BatchResultDto = parseBatchResult(resultJson);
    completed = result.completed.length;
    truncated = result.truncated.length;
    degradedCount = result.degraded.length;
    skippedReason = result.skippedReason ?? undefined;
    honored = true;

    // Relay visible pushes for (a) the outreach the batch flagged and (b) the
    // sync-applied outreach captured during the wake. Both are the CLOUD relay
    // path, so the transport gate applies to both: `auto`/`cloud` relay;
    // `direct` (engine-side FCM owns it) and `off` (silence) skip entirely
    // (plan 7-12 §5).
    const transport = await readTransport(deps);
    if (transport === 'auto' || transport === 'cloud') {
      relayed = await relayOutreach(deps, result);
      relayed += await relaySyncApplied(deps, collector?.take() ?? []);
    } else {
      log.info(`wake relay skipped (transport=${transport})`);
    }
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
    log.warn('silent-push wake failed (missed):', error);
  } finally {
    try {
      collector?.stop();
    } catch (e) {
      log.warn('collector stop failed after wake (non-fatal):', e);
    }
    try {
      await deps.stopEngine();
    } catch (e) {
      log.warn('engine stop failed after wake (non-fatal):', e);
    }
  }

  const finishedAt = deps.now();
  deps.telemetry.record({
    kind: 'keepalive',
    outcome: honored ? 'honored' : 'missed',
    startedAt,
    finishedAt,
    durationMs: Math.max(0, finishedAt - startedAt),
    completed,
    truncated,
    degraded: degradedCount,
    error,
  });

  return { honored, degraded, completed, truncated, degradedCount, relayed, skippedReason, error };
}

/** Relay outreach notices for the entities the batch flagged (best-effort). */
async function relayOutreach(
  deps: IOSLifecycleWakeDeps,
  result: BatchResultDto,
): Promise<number> {
  const ids = outreachDueEntityIds(result);
  const notices: OutreachNotice[] = [];
  for (const entityId of ids) {
    try {
      const notice = await deps.composeOutreach(entityId);
      if (notice) notices.push(notice);
    } catch (e) {
      // Relay downtime → outreach persists on-device; the next foreground
      // surfaces it and retries (4-3 Risks).
      logRelayFailure(e);
    }
  }
  return relayNotices(deps, notices);
}

/**
 * Relay the sync-applied outreach captured during the wake window. Filters to
 * engine-eligible events, applies the persisted watermark + the in-process
 * `message_id` dedupe (belt + braces), composes the alert from the SAME
 * lock-screen-aware code path as local posts, then relays via the shared
 * {@link relayNotices}. Best-effort — never throws.
 */
async function relaySyncApplied(
  deps: IOSLifecycleWakeDeps,
  events: OutreachNotificationEvent[],
): Promise<number> {
  if (events.length === 0) return 0;

  const dedupe = deps.dedupe ?? outreachDedupe;
  const watermark = deps.watermark ?? outreachRelayWatermark;

  let hideContent = false;
  try {
    hideContent = (await deps.getHideContent?.()) ?? false;
  } catch {
    hideContent = false;
  }

  // Oldest-first so the watermark advances monotonically across the batch.
  const ordered = [...events].sort((a, b) =>
    (a.created_at ?? '').localeCompare(b.created_at ?? ''),
  );

  const notices: OutreachNotice[] = [];
  const relayedEvents: OutreachNotificationEvent[] = [];
  for (const event of ordered) {
    if (event.eligibility !== 'eligible') continue; // defensive (engine gates authoritative)
    const messageId = (event.message_id ?? '').trim();
    if (!messageId) continue;
    try {
      if (!(await watermark.shouldRelay(event))) continue;
    } catch {
      /* a watermark read failure must not block the relay */
    }
    if (!dedupe.recordIfNew(messageId)) continue; // belt + braces over the watermark
    notices.push(composeRelayNotice(event, hideContent));
    relayedEvents.push(event);
  }

  const delivered = await relayNotices(deps, notices);

  // Advance the persisted watermark to the newest relayed message.
  const last = relayedEvents[relayedEvents.length - 1];
  if (last) {
    try {
      await watermark.record(last);
    } catch {
      /* best-effort */
    }
  }
  return delivered;
}

/**
 * Build a relay notice from an engine outreach event. The banner title/body come
 * from {@link composeLocalNotification} — the SAME lock-screen-aware composer the
 * local-post path uses (preview vs generic). The opaque blob gains `messageId`
 * (plan 7-12 §5).
 */
function composeRelayNotice(
  event: OutreachNotificationEvent,
  hideContent: boolean,
): OutreachNotice {
  const local = composeLocalNotification(event, hideContent);
  const entityId = event.entity_id ?? '';
  const messageId = event.message_id ?? '';
  return {
    entityId,
    title: local.title,
    body: local.body,
    messageId,
    payload: outreachPayload(entityId, messageId),
  };
}

/** Relay a batch of notices (best-effort per notice). */
async function relayNotices(
  deps: IOSLifecycleWakeDeps,
  notices: OutreachNotice[],
): Promise<number> {
  let relayed = 0;
  for (const notice of notices) {
    try {
      const alert = notice.body ? { title: notice.title, body: notice.body } : undefined;
      const res = await deps.relay.notify({ payload: notice.payload, alert });
      relayed += res.delivered;
    } catch (e) {
      // Relay downtime → outreach persists on-device; the next foreground
      // surfaces it and retries (4-3 Risks).
      logRelayFailure(e);
    }
  }
  return relayed;
}

/** Read the transport preference defensively (default `auto`). */
async function readTransport(deps: IOSLifecycleWakeDeps): Promise<NotificationTransport> {
  try {
    return (await deps.getTransport?.()) ?? 'auto';
  } catch {
    return 'auto';
  }
}

/**
 * The wake entry point the native bridge calls: run one pass with the production
 * seams. Never throws.
 */
export async function handleIOSLifecycleWake(
  opts: { kind?: 'keepalive' | 'relay' } = {},
  overrides: Partial<IOSLifecycleWakeDeps> = {},
): Promise<IOSLifecycleWakeResult> {
  return runIOSLifecycleWake({ ...defaultIOSLifecycleWakeDeps(), ...overrides }, opts);
}
