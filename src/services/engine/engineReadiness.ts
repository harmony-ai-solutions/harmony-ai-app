/**
 * Engine readiness deferral — the repo's "engine not ready yet → retry on
 * readiness" pattern, extracted for the boot paths that write through the
 * management-API data layer from an `auth:changed` handler.
 *
 * WHY: on a cold start with a cached sign-in, `auth:changed` fires ~180 ms
 * BEFORE the engine management API connects. Both `soulbitsTokenSync` and the
 * seeding ensure-flow react to that event, so their first write throws
 * `Engine is not connected — start the engine sidecar before using the
 * management-API data layer` (`requireEngineConnection()`, EngineService). The
 * work is not lost: a deferral parks exactly one retry on the next engine-ready
 * event, mirroring `e2eEngineOverride.applyE2EEngineOverride`'s
 * "engine not ready — retried on readiness" contract.
 *
 * CONTRACT:
 *  - At most ONE retry is armed per deferral: arming again REPLACES the pending
 *    task (latest caller wins) and never stacks subscriptions — a burst of boot
 *    races cannot produce duplicate writes.
 *  - The task runs once, on the next truthy connection, then the subscription is
 *    released.
 *  - A throwing task (sync throw or rejected promise) is routed to `onError`; it
 *    never escapes the connection callback.
 *  - `cancel()` disarms without running (e.g. a direct write already succeeded).
 *
 * Callers keep their OWN freshness/concurrency policy: token sync retries with
 * the LATEST pending PASETO, seeding re-runs its full PASETO-less flow so it can
 * re-read the cached token through its own expiry guard.
 */

import { createLogger } from '../../utils/logger';
import { getEngineConnection, onEngineConnectionChange } from './EngineService';

const log = createLogger('[EngineReadiness]');

/**
 * The stable prefix of `requireEngineConnection()`'s error message. Matching on
 * the prefix (not the whole sentence) keeps the check stable when the guidance
 * tail is reworded.
 */
export const ENGINE_NOT_CONNECTED_MESSAGE = 'Engine is not connected';

/** A deferred task: synchronous or promise-returning, result ignored. */
export type EngineReadyTask = () => unknown;

/** One-shot "retry when the engine becomes ready" slot. */
export interface EngineReadinessDeferral {
  /** Arm the retry, replacing any pending one (the latest task wins). */
  arm(task: EngineReadyTask): void;
  /** Disarm without running the pending task. */
  cancel(): void;
  /** True while a retry is armed. */
  isArmed(): boolean;
}

/** True when `error` carries the management-API "engine not connected" message. */
export function isEngineNotConnectedError(error: unknown): boolean {
  const message =
    error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  return message.includes(ENGINE_NOT_CONNECTED_MESSAGE);
}

/**
 * True when `error` is the management-API "not connected" error AND the engine is
 * STILL down — i.e. the boot race, so the work should be parked until readiness
 * rather than surfaced. A not-connected error against a LIVE connection is a
 * genuine write failure and must propagate.
 */
export function shouldDeferForEngineReadiness(error: unknown): boolean {
  return isEngineNotConnectedError(error) && getEngineConnection() === null;
}

/** True for a promise-like value (no `.finally`/`.catch` assumptions). */
function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return typeof (value as { then?: unknown } | null | undefined)?.then === 'function';
}

/**
 * Create a deferral slot. `onError` receives any task failure (sync throw or
 * rejection); it is the caller's log line and must not throw.
 */
export function createEngineReadinessDeferral(
  onError: (error: unknown) => void,
): EngineReadinessDeferral {
  let pending: EngineReadyTask | null = null;
  let unsubscribe: (() => void) | null = null;

  const cancel = (): void => {
    const off = unsubscribe;
    unsubscribe = null;
    pending = null;
    off?.();
  };

  const arm = (task: EngineReadyTask): void => {
    pending = task; // latest caller wins
    if (unsubscribe) return; // already armed — one subscription, replaced task

    unsubscribe = onEngineConnectionChange(connection => {
      if (!connection) return;
      const next = pending;
      cancel();
      if (!next) return;
      try {
        const result = next();
        if (isPromiseLike(result)) {
          void Promise.resolve(result).catch(onError);
        }
      } catch (error) {
        onError(error);
      }
    });
    log.debug('Armed engine-readiness retry');
  };

  return { arm, cancel, isArmed: () => pending !== null };
}
