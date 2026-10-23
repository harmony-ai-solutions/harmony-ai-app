/**
 * IOSMaintenanceScheduler — the overnight BGProcessingTask deep-sweep
 * orchestration for the iOS blind-tick lifecycle (task 4-3, step 3; the 0-4
 * `RunOvernightMaintenance` entry point + the 2-6 backup ride-along).
 *
 * The native coordinator registers + submits `com.soulbits.engine.maintenance`
 * (`UIBackgroundModes: processing`, `BGTaskSchedulerPermittedIdentifiers`) and
 * hands the granted window to JS. This pass is the *bonus* window — the system
 * decides the timing (nights, possibly days apart), so it is never the
 * correctness path:
 *
 *   1. Ensure the embedded engine is started.
 *   2. Refresh + inject the credential (best-effort → degraded non-LLM mode):
 *      ensure the account's long-lived `Soulbits Engine` API key is in the
 *      engine's SoulbitsCloud provider row (writes only when it changed).
 *   3. `lifecycle.maintenance` — the 0-4 deep sweep (memory compaction across
 *      the live automatable entities), with a conservative deadline.
 *   4. `lifecycle.batch` — advance any remaining backlog + dream triggers, with
 *      the tier's daily budget and the same deadline.
 *   5. Relay visible pushes for outreach the batch delivered (best-effort).
 *   6. Backup ride-along (2-6): when automatic backup is enabled, run it inside
 *      this window (the BGProcessingTask requests external power + network).
 *   7. Stop the engine cleanly, then record telemetry.
 *
 * The native expiration handler is the hard stop: the engine deadline is set
 * well before it, and the expiration path checkpoints + stops (step 2).
 */

import { createLogger } from '../../utils/logger';
import AuthService from '../auth/AuthService';
import { ensureCloudEngineKey } from '../cloud/engineKeyEnsure';
import { fetchAutonomyBeatsPerDay } from '../cloud/soulbitsClient';
import { connectEngine, disconnectEngine, getEngineConnection } from './EngineService';
import type { EngineConnection } from './EngineService';
import { selectEngineHost } from './EngineHost';
import {
  BATCH_PRIORITY_MOST_OVERDUE,
  LIFECYCLE_BATCH_METHOD,
  LIFECYCLE_MAINTENANCE_METHOD,
  outreachDueEntityIds,
  parseBatchResult,
  parseMaintenanceResult,
  toRfc3339,
} from './engineLifecycleCall';
import type {
  BatchRequestPayload,
  BatchResultDto,
  MaintenanceRequestPayload,
  MaintenanceResultDto,
} from './engineLifecycleCall';
import { createDefaultPushRelayClient, logRelayFailure } from '../lifecycle/PushRelayClient';
import type { PushRelayClient } from '../lifecycle/PushRelayClient';
import { iosLifecycleTelemetry } from './IOSLifecycleTelemetry';
import type { IOSLifecycleTelemetry } from './IOSLifecycleTelemetry';
import type { OutreachNotice } from './IOSLifecycleWakeHandler';

const log = createLogger('[IOSMaintenance]');

/**
 * The default maintenance deadline offset from the sweep start (ms). A
 * BGProcessingTask window is minutes, but its exact length is system-decided;
 * 20 minutes is comfortably inside a typical grant and leaves room for the
 * native expiration handler to stop cleanly.
 */
export const IOS_MAINTENANCE_WINDOW_MS = 20 * 60_000;

/** Injectable seams (production defaults below; tests override). */
export interface IOSMaintenanceDeps {
  ensureEngineStarted: () => Promise<EngineConnection>;
  stopEngine: () => Promise<void>;
  call: (method: string, payloadJSON: string) => Promise<string>;
  getToken: () => Promise<string | null>;
  /** Ensure the long-lived engine API key is applied to the provider row. */
  refreshCredentials: () => Promise<void>;
  fetchBudget: (paseto: string) => Promise<number | null>;
  composeOutreach: (entityId: string) => Promise<OutreachNotice | null>;
  relay: PushRelayClient;
  /** Backup ride-along (2-6). Best-effort; a failure never fails the sweep. */
  runBackup: () => Promise<void>;
  now: () => number;
  telemetry: IOSLifecycleTelemetry;
  maintenanceWindowMs?: number;
}

/** The outcome of one overnight sweep. */
export interface IOSMaintenanceResult {
  /** True when the maintenance + batch ran (a wake that was honoured). */
  honored: boolean;
  /** True when the sweep ran in non-LLM mode. */
  degraded: boolean;
  /** Entities compacted by `lifecycle.maintenance`. */
  compacted: number;
  /** Entities the batch completed. */
  completed: number;
  /** Entities truncated (deadline). */
  truncated: number;
  /** Relay pushes delivered for outreach. */
  relayed: number;
  /** True when the backup ride-along ran. */
  backedUp: boolean;
  /**
   * Set when the sweep was skipped because this device is not the cognition
   * authority (plan 7-8; `"not_authoritative"`). A well-formed skip, not an
   * error.
   */
  skippedReason?: string;
  error?: string;
}

/** Production default seams. */
export function defaultIOSMaintenanceDeps(): IOSMaintenanceDeps {
  return {
    ensureEngineStarted,
    stopEngine: disconnectEngine,
    call: (method, payloadJSON) => selectEngineHost().call(method, payloadJSON),
    getToken: async () => {
      try {
        return (await AuthService.getToken()) || null;
      } catch {
        return null;
      }
    },
    refreshCredentials: async () => {
      await ensureCloudEngineKey();
    },
    fetchBudget: fetchAutonomyBeatsPerDay,
    composeOutreach: defaultComposeOutreach,
    relay: createDefaultPushRelayClient(),
    runBackup: defaultRunBackup,
    now: () => Date.now(),
    telemetry: iosLifecycleTelemetry,
  };
}

async function ensureEngineStarted(): Promise<EngineConnection> {
  const existing = getEngineConnection();
  if (existing) return existing;
  await connectEngine();
  const connection = getEngineConnection();
  if (!connection) {
    throw new Error('ios-maintenance: engine started but no connection was published');
  }
  return connection;
}

/** Best-effort outreach composer (see the wake handler for the rationale). */
async function defaultComposeOutreach(entityId: string): Promise<OutreachNotice | null> {
  return { entityId, body: '', payload: JSON.stringify({ kind: 'outreach', entityId }) };
}

/** Run the 2-6 automatic backup inside the overnight window when enabled. */
async function defaultRunBackup(): Promise<void> {
  const { backupOrchestrator } = require('../backup/BackupOrchestrator');
  const settings = await backupOrchestrator.getSettings();
  if (!settings.enabled || settings.cadence === 'off') return;
  await backupOrchestrator.backUpNow();
}

/**
 * Run one overnight deep sweep. Never throws — a failure is recorded as a
 * missed wake and returned. The engine is always stopped before returning.
 */
export async function runIOSMaintenanceSweep(
  deps: IOSMaintenanceDeps,
): Promise<IOSMaintenanceResult> {
  const windowMs = deps.maintenanceWindowMs ?? IOS_MAINTENANCE_WINDOW_MS;
  const startedAt = deps.now();
  const deadlineMs = startedAt + windowMs;

  let honored = false;
  let degraded = false;
  let compacted = 0;
  let completed = 0;
  let truncated = 0;
  let relayed = 0;
  let backedUp = false;
  let skippedReason: string | undefined;
  let error: string | undefined;

  try {
    await deps.ensureEngineStarted();

    let paseto: string | null = null;
    try {
      paseto = await deps.getToken();
    } catch {
      paseto = null;
    }

    let dailyBudget: number | null = null;
    if (paseto) {
      try {
        await deps.refreshCredentials();
      } catch (e) {
        degraded = true;
        log.warn('credential injection failed — sweep runs degraded (non-LLM):', e);
      }
      try {
        dailyBudget = await deps.fetchBudget(paseto);
      } catch (e) {
        log.warn('tier budget fetch failed (non-fatal):', e);
      }
    }

    // 1) Deep maintenance (memory compaction) — the 0-4 overnight entry point.
    const maintPayload: MaintenanceRequestPayload = {
      now: toRfc3339(startedAt),
      deadline: toRfc3339(deadlineMs),
    };
    if (degraded) maintPayload.degraded = true;
    const maintJson = await deps.call(
      LIFECYCLE_MAINTENANCE_METHOD,
      JSON.stringify(maintPayload),
    );
    const maint: MaintenanceResultDto = parseMaintenanceResult(maintJson);
    compacted = maint.compacted.length;
    skippedReason = maint.skippedReason ?? undefined;

    // 2) Advance the remaining backlog + dream triggers. The overnight window is
    //    the one place the full daily budget is spent (the per-wake handler
    //    slices it); `maxBeats <= 0` (unknown budget) means the deadline bounds.
    const batchPayload: BatchRequestPayload = {
      now: toRfc3339(startedAt),
      deadline: toRfc3339(deadlineMs),
      maxBeats: dailyBudget != null && dailyBudget > 0 ? dailyBudget : 0,
      priority: BATCH_PRIORITY_MOST_OVERDUE,
    };
    if (degraded) batchPayload.degraded = true;
    const batchJson = await deps.call(LIFECYCLE_BATCH_METHOD, JSON.stringify(batchPayload));
    const batch: BatchResultDto = parseBatchResult(batchJson);
    completed = batch.completed.length;
    truncated = batch.truncated.length;
    skippedReason = skippedReason ?? batch.skippedReason ?? undefined;
    honored = true;

    // 3) Relay outreach (best-effort).
    relayed = await relayOutreach(deps, batch);

    // 4) Backup ride-along (2-6) — best-effort, never fails the sweep.
    try {
      await deps.runBackup();
      backedUp = true;
    } catch (e) {
      log.warn('overnight backup ride-along failed (non-fatal):', e);
    }
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
    log.warn('overnight sweep failed (missed):', error);
  } finally {
    try {
      await deps.stopEngine();
    } catch (e) {
      log.warn('engine stop failed after sweep (non-fatal):', e);
    }
  }

  const finishedAt = deps.now();
  deps.telemetry.record({
    kind: 'maintenance',
    outcome: honored ? 'honored' : 'missed',
    startedAt,
    finishedAt,
    durationMs: Math.max(0, finishedAt - startedAt),
    completed,
    truncated,
    degraded: degraded ? 1 : 0,
    compacted,
    error,
  });

  return { honored, degraded, compacted, completed, truncated, relayed, backedUp, skippedReason, error };
}

async function relayOutreach(
  deps: IOSMaintenanceDeps,
  result: BatchResultDto,
): Promise<number> {
  const ids = outreachDueEntityIds(result);
  let relayed = 0;
  for (const entityId of ids) {
    try {
      const notice = await deps.composeOutreach(entityId);
      if (!notice) continue;
      const alert = notice.body ? { title: notice.title, body: notice.body } : undefined;
      const res = await deps.relay.notify({ payload: notice.payload, alert });
      relayed += res.delivered;
    } catch (e) {
      logRelayFailure(e);
    }
  }
  return relayed;
}

/**
 * The entry point the native coordinator calls for a BGProcessingTask window.
 * Never throws.
 */
export async function handleIOSMaintenance(
  overrides: Partial<IOSMaintenanceDeps> = {},
): Promise<IOSMaintenanceResult> {
  return runIOSMaintenanceSweep({ ...defaultIOSMaintenanceDeps(), ...overrides });
}
