/**
 * EngineService — the engine-service layer (tasks 3-2, 4-2).
 *
 * Absorbs the app's local-engine *connection* state: the admin/WS base URLs and
 * the per-process loopback token parsed from the host's readiness payload. The
 * platform host (`EngineHost` — the Android sidecar or the iOS in-process
 * facade) deliberately owns only the process/port/readiness surface; this layer
 * turns a readiness payload into a usable connection and keeps it current across
 * lifecycle events.
 *
 * Consumers:
 *   - `EngineApiClient` reads {@link getEngineConnection} for its base URL +
 *     auth headers.
 *   - The repository seam (`src/database/repositories/index.ts`) indirectly
 *     uses the API-backed repositories, which read through the client.
 *   - 4-2's `EngineLifecycle` drives start/stop via {@link connectEngine} /
 *     {@link disconnectEngine} (foreground-tier semantics).
 *
 * Nothing here opens a socket: it is pure state derived from host readiness.
 */

import { createLogger } from '../../utils/logger';
import type {
  EngineExitInfo,
  EngineReadyPayload,
  EngineSidecarEvent,
  EngineStartOptions,
  EngineStatus,
} from '../../types/engineSidecar';
import { selectEngineHost } from './EngineHost';
import { normalizeVersion } from '../../utils/semver';

const log = createLogger('[EngineService]');

/** A live connection to the embedded engine's local servers. */
export interface EngineConnection {
  /** Management REST base URL, e.g. `http://127.0.0.1:28081`. */
  adminBaseUrl: string;
  /** Event WS base URL, e.g. `ws://127.0.0.1:28080`. */
  wsBaseUrl: string;
  /** Event WSS base URL (empty when the sidecar is WS-only). */
  wssBaseUrl: string;
  /** Per-process loopback token (empty → use `X-Admin-API-Key`). */
  token: string;
  /** Bind address the sidecar advertised (loopback by default). */
  bind: string;
  wsPort: number;
  wssPort: number;
  adminPort: number;
  pid: number;
  dataDir: string;
}

let connection: EngineConnection | null = null;
const listeners = new Set<(connection: EngineConnection | null) => void>();

// ── Engine lifecycle status + last exit (Settings → Engine status) ─────────
// EngineService already receives every host lifecycle event (the subscription
// at the bottom of this file), so it is the single source of truth for the
// observable status the Settings screen renders. Nothing here opens a socket.

/** Observable lifecycle status; null until the host reports one. */
let status: EngineStatus | null = null;
/** The most recent process exit the host reported, or null. */
let lastExit: EngineExitInfo | null = null;
const statusListeners = new Set<(status: EngineStatus | null) => void>();
const exitListeners = new Set<(exit: EngineExitInfo) => void>();

/**
 * Map a host lifecycle event to the status it implies. Mirrors the native
 * status reducer (`nextEngineStatus` in `EngineSidecarModule`) so the JS-side
 * status is deterministic regardless of event ordering.
 */
function statusFromEvent(event: EngineSidecarEvent): EngineStatus | null {
  switch (event.type) {
    case 'state':
      return event.status;
    case 'ready':
      return 'ready';
    case 'restarting':
      return 'restarting';
    case 'crashed':
      return 'failed';
    case 'stopped':
      return 'stopped';
    case 'exit':
      if (event.exit.expected) return 'stopped';
      return event.exit.willRestart ? 'restarting' : 'failed';
    default:
      return null;
  }
}

/** Record a new lifecycle status and notify listeners (only on change). */
function setStatus(next: EngineStatus | null): void {
  if (next === status) return;
  status = next;
  for (const listener of statusListeners) {
    try {
      listener(status);
    } catch (e) {
      log.warn('Engine status listener threw:', e);
    }
  }
}

/** Record a process exit and notify listeners. */
function setLastExit(exit: EngineExitInfo): void {
  lastExit = exit;
  for (const listener of exitListeners) {
    try {
      listener(exit);
    } catch (e) {
      log.warn('Engine exit listener threw:', e);
    }
  }
}

/** The last lifecycle status the host reported, or null when unknown. */
export function getEngineStatus(): EngineStatus | null {
  return status;
}

/** Subscribe to lifecycle-status changes. Returns an unsubscribe function. */
export function onEngineStatusChange(
  listener: (status: EngineStatus | null) => void,
): () => void {
  statusListeners.add(listener);
  return () => {
    statusListeners.delete(listener);
  };
}

/** The most recent process exit the host reported (null when none/unknown). */
export function getLastEngineExit(): EngineExitInfo | null {
  return lastExit;
}

/** Subscribe to process-exit events. Returns an unsubscribe function. */
export function onEngineExitChange(
  listener: (exit: EngineExitInfo) => void,
): () => void {
  exitListeners.add(listener);
  return () => {
    exitListeners.delete(listener);
  };
}

/** Build the connection descriptor from a readiness payload. */
export function connectionFromReady(payload: EngineReadyPayload): EngineConnection {
  const host = payload.bind && payload.bind.length > 0 ? payload.bind : '127.0.0.1';
  return {
    adminBaseUrl: `http://${host}:${payload.adminPort}`,
    wsBaseUrl: `ws://${host}:${payload.wsPort}`,
    wssBaseUrl: payload.wssPort > 0 ? `wss://${host}:${payload.wssPort}` : '',
    token: payload.token,
    bind: host,
    wsPort: payload.wsPort,
    wssPort: payload.wssPort,
    adminPort: payload.adminPort,
    pid: payload.pid,
    dataDir: payload.dataDir,
  };
}

function emit(): void {
  for (const listener of listeners) {
    try {
      listener(connection);
    } catch (e) {
      log.warn('Engine connection listener threw:', e);
    }
  }
}

/** Set/replace the current engine connection (from a readiness payload). */
export function setEngineConnection(payload: EngineReadyPayload): EngineConnection {
  connection = connectionFromReady(payload);
  log.info(`Engine connection set (admin ${connection.adminBaseUrl})`);
  emit();
  setStatus('ready');
  // Host readiness → refresh the running-engine version (About row; plan 7-10 §3).
  void refreshEngineVersion();
  return connection;
}

/** The current engine connection, or null when the engine is not ready. */
export function getEngineConnection(): EngineConnection | null {
  return connection;
}

/** Clear the current engine connection (engine stopped / failed). */
export function clearEngineConnection(): void {
  if (connection !== null) {
    connection = null;
    log.info('Engine connection cleared');
    emit();
  }
  // The running engine is gone → its version/contract result no longer applies.
  emitVersionState(UNKNOWN_VERSION_STATE);
}

/**
 * The current engine connection, throwing when the engine is not ready. Used by
 * the API-backed repositories so a read against a down engine surfaces a clear
 * error instead of a fetch against `undefined`.
 */
export function requireEngineConnection(): EngineConnection {
  if (connection === null) {
    throw new Error(
      'Engine is not connected — start the engine sidecar before using the management-API data layer',
    );
  }
  return connection;
}

/** Subscribe to connection changes. Returns an unsubscribe function. */
export function onEngineConnectionChange(
  listener: (connection: EngineConnection | null) => void,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Start the engine (sidecar on Android, in-process facade on iOS) and publish
 * the resulting connection. Resolves once the engine is ready (ports + token
 * known). The platform host is selected by `selectEngineHost()`.
 */
export async function connectEngine(
  options: EngineStartOptions = {},
): Promise<EngineReadyPayload> {
  const payload = await selectEngineHost().start(options);
  setEngineConnection(payload);
  return payload;
}

/**
 * Stop the engine and clear the connection. A host `stop` failure still clears
 * the connection (the engine is gone either way).
 */
export async function disconnectEngine(): Promise<void> {
  try {
    await selectEngineHost().stop();
  } finally {
    clearEngineConnection();
    setStatus('stopped');
  }
}

/**
 * In-flight restart, so concurrent callers share ONE stop→start cycle. Cleared
 * as soon as the cycle settles (success or failure).
 */
let restartInFlight: Promise<EngineReadyPayload> | null = null;

/**
 * Restart the engine: `disconnectEngine()` then `connectEngine(options)`.
 *
 * Used by the backup-restore flows to activate a staged restore deterministically
 * (owner ruling 2026-10-18): the engine adopts `<dataDir>/restore-staging/` at
 * boot, so the app must cycle the engine after a successful restore. Clearing the
 * connection then publishing a fresh one re-runs every `onEngineConnectionChange`
 * consumer (the same cold-start re-init path — e.g. `SyncConnectionContext`'s
 * auto-connect), so contexts/repositories re-init against the restored engine.
 *
 * Concurrent calls share a single in-flight restart (the first caller's options
 * win). Rejects if the start leg fails; the stop leg is best-effort (see
 * {@link disconnectEngine}).
 */
export function restartEngine(
  options: EngineStartOptions = {},
): Promise<EngineReadyPayload> {
  if (restartInFlight) return restartInFlight;
  restartInFlight = (async () => {
    try {
      await disconnectEngine();
      return await connectEngine(options);
    } finally {
      restartInFlight = null;
    }
  })();
  return restartInFlight;
}

/**
 * Best-effort reconciliation of the in-memory connection with the host's
 * lifecycle state — used on app foreground. `ready` without a payload cannot
 * rebuild the token, so it only clears on a non-ready status.
 */
export async function syncEngineConnectionState(): Promise<void> {
  const hostStatus = await selectEngineHost().getState();
  if (hostStatus !== 'ready') {
    setStatus(hostStatus);
    clearEngineConnection();
  } else if (connection !== null) {
    setStatus('ready');
  }
  // else: the host reports `ready` but we have no readiness payload to rebuild
  // the token — leave the observed status as-is (the connection stays null).
}

// ── Engine version (plan 7-10 §3) ────────────────────────────────────────
// On host readiness we probe the engine's advertised version
// (`GET /public/appversion`) and normalize it for the About block. This is
// INFORMATIONAL only: the embedded engine ships WITH the app, so there is no
// runtime contract gate — the app↔engine contract match is enforced at BUILD
// time (`scripts/check-engine-contract-build.cjs`). The HTTP probe is INJECTED
// (`setEngineVersionProbe`) so this module stays free of the EngineApiClient
// import cycle and unit tests never hit the network.

/** The observable engine-version state. */
export interface EngineVersionState {
  /** Normalized (leading `v` stripped) running-engine version, or null. */
  engineVersion: string | null;
  /** Why the version is unknown (diagnostics only). */
  reason?: string;
}

const UNKNOWN_VERSION_STATE: EngineVersionState = { engineVersion: null };

let versionState: EngineVersionState = UNKNOWN_VERSION_STATE;
const versionListeners = new Set<(state: EngineVersionState) => void>();

/**
 * The injected probe: resolves the running engine's RAW version string (e.g.
 * `v0.3.0-dev`). Wired at app boot to `engineApiClient.engineAppVersion()`
 * (see `engineVersionProbe.ts`); null in tests.
 */
let versionProbe: (() => Promise<string>) | null = null;

/** Install (or clear) the engine-version probe. */
export function setEngineVersionProbe(probe: (() => Promise<string>) | null): void {
  versionProbe = probe;
}

/** The current engine-version state (synchronous snapshot). */
export function getEngineVersionState(): EngineVersionState {
  return versionState;
}

/** Subscribe to engine-version state changes. Returns an unsubscribe function. */
export function onEngineVersionStateChange(
  listener: (state: EngineVersionState) => void,
): () => void {
  versionListeners.add(listener);
  return () => {
    versionListeners.delete(listener);
  };
}

function emitVersionState(next: EngineVersionState): void {
  versionState = next;
  for (const listener of versionListeners) {
    try {
      listener(next);
    } catch (e) {
      log.warn('Engine version listener threw:', e);
    }
  }
}

/**
 * Probe the running engine's version (About row). Called on host readiness
 * (and on demand by the UI). NEVER throws: a missing connection or probe, or a
 * probe failure, yields `engineVersion: null`.
 */
export async function refreshEngineVersion(): Promise<EngineVersionState> {
  if (!connection || !versionProbe) {
    emitVersionState(UNKNOWN_VERSION_STATE);
    return versionState;
  }
  try {
    const raw = await versionProbe();
    emitVersionState({ engineVersion: normalizeVersion(raw) });
  } catch (e) {
    emitVersionState({
      engineVersion: null,
      reason: e instanceof Error ? e.message : String(e),
    });
  }
  return versionState;
}

// ── Lifecycle wiring ─────────────────────────────────────────────────────
// Keep the connection current across host lifecycle events: a fresh readiness
// payload (initial start or a restart) sets it; a stop or a final failure
// clears it. Subscribed once at module load to the platform host.
selectEngineHost().onEvent(event => {
  switch (event.type) {
    case 'ready':
      setEngineConnection(event.payload);
      break;
    case 'stopped':
      clearEngineConnection();
      break;
    case 'crashed':
      clearEngineConnection();
      break;
    case 'state':
      if (event.status === 'stopped' || event.status === 'failed') {
        clearEngineConnection();
      }
      break;
    default:
      break;
  }
  // Settings → Engine status: record the last exit + the implied lifecycle
  // status from every host event (the connection above is only the readiness
  // signal; this carries `starting`/`failed`/`restarting` nuance).
  if (event.type === 'exit') {
    setLastExit(event.exit);
  }
  const nextStatus = statusFromEvent(event);
  if (nextStatus !== null) setStatus(nextStatus);
});

/** Test-only: drop all state + listeners. */
export function resetEngineServiceForTests(): void {
  connection = null;
  restartInFlight = null;
  listeners.clear();
  status = null;
  lastExit = null;
  statusListeners.clear();
  exitListeners.clear();
  versionState = UNKNOWN_VERSION_STATE;
  versionListeners.clear();
  versionProbe = null;
}
