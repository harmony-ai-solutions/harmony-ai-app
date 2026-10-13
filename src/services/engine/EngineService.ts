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
import type { EngineReadyPayload } from '../../types/engineSidecar';
import { selectEngineHost } from './EngineHost';
import type { EngineStartOptions } from '../../types/engineSidecar';
import { checkContractVersion, ENGINE_CONTRACT_VERSION } from './engineContract';
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
  // Host readiness → re-evaluate the contract canary (plan 7-10 §3).
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
  }
}

/**
 * Best-effort reconciliation of the in-memory connection with the host's
 * lifecycle state — used on app foreground. `ready` without a payload cannot
 * rebuild the token, so it only clears on a non-ready status.
 */
export async function syncEngineConnectionState(): Promise<void> {
  const status = await selectEngineHost().getState();
  if (status !== 'ready') {
    clearEngineConnection();
  }
}

// ── Engine version / contract canary (plan 7-10 §3) ──────────────────────
// The app knows which engine it shipped but nothing verified the RUNNING
// engine at startup (the 5-1 gate existed but had zero runtime consumers).
// On host readiness we probe the engine's advertised version
// (`GET /public/appversion`), normalize it, and evaluate the contract gate
// against ENGINE_CONTRACT_VERSION. The HTTP probe is INJECTED
// (`setEngineVersionProbe`) so this module stays free of the EngineApiClient
// import cycle and unit tests never hit the network.

/** The contract-gate outcome surfaced to the UI. */
export type EngineContractState = 'ok' | 'too_old' | 'unknown';

/** The observable engine-version state. */
export interface EngineVersionState {
  /** Normalized (leading `v` stripped) running-engine version, or null. */
  engineVersion: string | null;
  /** Contract gate vs {@link ENGINE_CONTRACT_VERSION}. */
  contract: EngineContractState;
  /** Why `too_old`/`unknown` (diagnostics). */
  reason?: string;
}

const UNKNOWN_VERSION_STATE: EngineVersionState = { engineVersion: null, contract: 'unknown' };

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
 * Probe the running engine's version and evaluate the contract gate. Called on
 * host readiness (and on demand by the UI). NEVER throws: a missing connection
 * or probe, or a probe failure, yields `contract: 'unknown'` (the app must not
 * block on a canary that could not run).
 */
export async function refreshEngineVersion(): Promise<EngineVersionState> {
  if (!connection || !versionProbe) {
    emitVersionState(UNKNOWN_VERSION_STATE);
    return versionState;
  }
  try {
    const raw = await versionProbe();
    const engineVersion = normalizeVersion(raw);
    const check = checkContractVersion(engineVersion, ENGINE_CONTRACT_VERSION);
    emitVersionState({
      engineVersion,
      contract: check.ok ? 'ok' : 'too_old',
      reason: check.reason,
    });
  } catch (e) {
    emitVersionState({
      engineVersion: null,
      contract: 'unknown',
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
});

/** Test-only: drop all state + listeners. */
export function resetEngineServiceForTests(): void {
  connection = null;
  listeners.clear();
  versionState = UNKNOWN_VERSION_STATE;
  versionListeners.clear();
  versionProbe = null;
}
