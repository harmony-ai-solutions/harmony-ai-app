/**
 * IOSLifecycleTelemetry — honored/missed counters for the iOS blind-tick wakes
 * (task 4-3, step 1: "Telemetry: honored/missed counters (expect misses; log
 * only)").
 *
 * iOS decides when (and whether) a silent push or a BGProcessingTask window is
 * honoured; misses are EXPECTED and are not errors — correctness never depends
 * on a wake (0-1 lazy + 0-4 catch-up converge on any later wake). This module
 * is observational only: it never sits on a critical path and never throws.
 *
 * It records one {@link IOSLifecycleWakeRecord} per wake attempt and exposes a
 * counter snapshot the settings/info surface can read after the observation
 * week (plan step 6/7). Records are held in memory for the process lifetime and
 * additionally handed to an optional sink (a future metrics/analytics hook).
 */

import { createLogger } from '../../utils/logger';

const log = createLogger('[IOSLifecycleTelemetry]');

/** Which host window produced the wake. */
export type IOSLifecycleWakeKind = 'keepalive' | 'maintenance';

/** How the wake ended. `missed` covers an overrun or a pre-batch failure. */
export type IOSLifecycleWakeOutcome = 'honored' | 'missed';

/** One wake attempt's record. */
export interface IOSLifecycleWakeRecord {
  kind: IOSLifecycleWakeKind;
  outcome: IOSLifecycleWakeOutcome;
  /** Epoch ms the wake started. */
  startedAt: number;
  /** Epoch ms the wake finished. */
  finishedAt: number;
  durationMs: number;
  /** Entities completed by the batch (0 when the batch never ran). */
  completed: number;
  /** Entities due but not started (deadline/budget truncation). */
  truncated: number;
  /** Entities advanced non-LLM only (credential/backend degradation). */
  degraded: number;
  /** Maintenance-only: entities compacted. */
  compacted?: number;
  /** Failure message when the wake ended in error. */
  error?: string;
}

/** A counter snapshot (the observation-week read). */
export interface IOSLifecycleTelemetrySnapshot {
  keepaliveHonored: number;
  keepaliveMissed: number;
  maintenanceHonored: number;
  maintenanceMissed: number;
  /** The most recent records (bounded). */
  recent: IOSLifecycleWakeRecord[];
}

/** Optional downstream sink (metrics/analytics). Never throws into the caller. */
export type IOSLifecycleTelemetrySink = (record: IOSLifecycleWakeRecord) => void;

/** Bounded ring size for `recent`. */
const MAX_RECENT = 50;

export class IOSLifecycleTelemetry {
  private counts: Record<IOSLifecycleWakeKind, { honored: number; missed: number }> = {
    keepalive: { honored: 0, missed: 0 },
    maintenance: { honored: 0, missed: 0 },
  };
  private recent: IOSLifecycleWakeRecord[] = [];
  private sink: IOSLifecycleTelemetrySink | null = null;

  /** Attach a downstream sink (metrics/analytics). Pass null to clear. */
  setSink(sink: IOSLifecycleTelemetrySink | null): void {
    this.sink = sink;
  }

  /** Record one wake. Never throws; a sink failure is logged and swallowed. */
  record(record: IOSLifecycleWakeRecord): void {
    const bucket = this.counts[record.kind] ?? { honored: 0, missed: 0 };
    if (record.outcome === 'honored') bucket.honored += 1;
    else bucket.missed += 1;
    this.counts[record.kind] = bucket;

    this.recent.push(record);
    if (this.recent.length > MAX_RECENT) this.recent.shift();

    const verb = record.outcome === 'honored' ? 'honored' : 'missed';
    log.info(
      `wake ${verb}: kind=${record.kind} duration=${record.durationMs}ms ` +
        `completed=${record.completed} truncated=${record.truncated} degraded=${record.degraded}` +
        (record.error ? ` error=${record.error}` : ''),
    );

    if (this.sink) {
      try {
        this.sink(record);
      } catch (e) {
        log.warn('telemetry sink threw (ignored):', e instanceof Error ? e.message : String(e));
      }
    }
  }

  /** The current counter snapshot. */
  snapshot(): IOSLifecycleTelemetrySnapshot {
    return {
      keepaliveHonored: this.counts.keepalive.honored,
      keepaliveMissed: this.counts.keepalive.missed,
      maintenanceHonored: this.counts.maintenance.honored,
      maintenanceMissed: this.counts.maintenance.missed,
      recent: [...this.recent],
    };
  }

  /** Test-only: clear all counters + records. */
  reset(): void {
    this.counts = { keepalive: { honored: 0, missed: 0 }, maintenance: { honored: 0, missed: 0 } };
    this.recent = [];
    this.sink = null;
  }
}

/** The shared telemetry singleton. */
export const iosLifecycleTelemetry = new IOSLifecycleTelemetry();
