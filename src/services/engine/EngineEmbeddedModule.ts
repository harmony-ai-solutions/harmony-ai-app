/**
 * EngineEmbeddedModule — JS wrapper around the iOS in-process engine module
 * (task 4-2, `NativeModules.SoulbitsEngine`).
 *
 * The native side (`ios/EngineModule/SoulbitsEngineModule.m`) links the 4-1
 * gomobile facade (`SoulbitsEngine.xcframework`) and drives it from the app
 * process:
 *
 *   - `EmbedEngineInit(configJSON)` — prepares the engine (data dir + DB key).
 *   - `EmbedEngineStart()` — serves the loopback management + event servers and
 *     returns the readiness JSON `{ws,wss,admin,bind,pid,dataDir,token}`.
 *   - `EmbedEngineStop()` — graceful stop (WAL checkpoint); idempotent.
 *   - `EmbedEngineCall(method, payloadJSON)` — the multiplexed in-process RPC.
 *   - `EmbedEngineSetEventCallback(cb)` — mirrors the engine→client event stream
 *     (and the facade lifecycle events) to the RN bridge.
 *
 * This wrapper mirrors `EngineSidecarModule`'s JS surface EXACTLY (same
 * `EngineReadyPayload`, same `EngineStatus`, same `engine:*` event names) so the
 * engine-service layer is platform-agnostic: the ONLY differences are that the
 * readiness comes from `parseReadyPayload` (bare JSON, no stdout prefix) and the
 * host additionally exposes the `EngineCall` RPC.
 *
 * Task 4-3 adds the blind-tick surface: the native coordinator (AppDelegate +
 * BGTask) bridges OS wakes to JS on `engine:wake` and delivers the APNs device
 * token on `push:token`; JS drives the bounded pass and calls back
 * `finishWake(taskId, resultJSON)` so the native side can complete the OS task.
 *
 * Degrades to a no-op / `unsupported` off iOS (or when the framework is not
 * linked), so the JS layer never branches on the module's presence.
 */

import { NativeModules, NativeEventEmitter, Platform } from 'react-native';
import { createLogger } from '../../utils/logger';
import type {
  EngineExitInfo,
  EngineReadyPayload,
  EngineSidecarEvent,
  EngineStartOptions,
  EngineStatus,
  NativeEngineStartResult,
} from '../../types/engineSidecar';
import {
  ENGINE_MAX_RESTARTS,
  parseReadyPayload,
} from './EngineSidecarModule';

const log = createLogger('[EngineEmbedded]');

// ── Task 4-3: blind-tick wake / push-token types ─────────────────────────

/** The OS window that produced a wake (task 4-3). */
export type EngineWakeKind = 'keepalive' | 'relay' | 'maintenance';

/** A wake handed from the native coordinator to JS. */
export interface EngineWakeEvent {
  /** Opaque id used to complete the OS task via `finishWake`. */
  taskId: string;
  kind: EngineWakeKind;
  /** Optional wake metadata (never entity data — the cloud stays data-blind). */
  payload?: Record<string, unknown>;
}

/** The APNs device token (hex), delivered once registered. */
export interface PushTokenEvent {
  token: string;
}

/** Coerce the native `kind` into a known wake kind (default: keepalive). */
function normalizeWakeKind(value: any): EngineWakeKind {
  if (value === 'relay' || value === 'maintenance' || value === 'keepalive') return value;
  return 'keepalive';
}


// ── Feature flag (rollback: set false to disable the whole module) ───────
/** Build-time default. Flip to false (or call setEngineEmbeddedEnabled) to roll back. */
export const ENGINE_EMBEDDED_ENABLED = true;
let engineEmbeddedEnabledOverride: boolean | null = null;

/** True when the embedded engine module is enabled (rollback knob). */
export function isEngineEmbeddedEnabled(): boolean {
  return engineEmbeddedEnabledOverride ?? ENGINE_EMBEDDED_ENABLED;
}

/** Runtime override for the feature flag (pass null to restore the default). */
export function setEngineEmbeddedEnabled(enabled: boolean | null): void {
  engineEmbeddedEnabledOverride = enabled;
}

// ── Native module resolution (iOS only) ──────────────────────────────────
const native: any = Platform.OS === 'ios' ? (NativeModules as any).SoulbitsEngine : null;

let emitter: NativeEventEmitter | null = null;
if (Platform.OS === 'ios' && native) {
  emitter = new NativeEventEmitter(native as any);
}

// ── Event fan-out (same event names + shapes as the Android sidecar) ─────

const eventListeners = new Set<(event: EngineSidecarEvent) => void>();

function emit(event: EngineSidecarEvent): void {
  eventListeners.forEach(listener => listener(event));
}

// ── Task 4-3: wake / push-token fan-out ──────────────────────────────────

const wakeListeners = new Set<(event: EngineWakeEvent) => void>();
const pushTokenListeners = new Set<(event: PushTokenEvent) => void>();

function emitWake(event: EngineWakeEvent): void {
  wakeListeners.forEach(listener => listener(event));
}

function emitPushToken(event: PushTokenEvent): void {
  pushTokenListeners.forEach(listener => listener(event));
}

function normalizeReady(raw: any): EngineSidecarEvent | null {
  // The native module returns either a prefixed `rawLine` (sidecar parity) or
  // the bare readiness JSON document (facade parity); accept both.
  const rawLine = typeof raw?.rawLine === 'string' ? raw.rawLine : '';
  let payload = parseReadyPayload(rawLine);
  if (!payload) {
    // Defensive: an already-parsed bridge result (older/newer native).
    const wsPort = Number(raw?.wsPort);
    const adminPort = Number(raw?.adminPort);
    if (Number.isFinite(wsPort) && wsPort > 0 && Number.isFinite(adminPort) && adminPort > 0) {
      payload = {
        wsPort,
        wssPort: Number(raw?.wssPort) || 0,
        adminPort,
        bind: typeof raw?.bind === 'string' ? raw.bind : '127.0.0.1',
        pid: Number(raw?.pid) || -1,
        dataDir: typeof raw?.dataDir === 'string' ? raw.dataDir : '',
        token: typeof raw?.token === 'string' ? raw.token : '',
      };
    }
  }
  if (!payload) return null;
  return { type: 'ready', payload, rawLine: rawLine || JSON.stringify(payload) };
}

if (emitter) {
  emitter.addListener('engine:ready', (raw: any) => {
    const event = normalizeReady(raw);
    if (!event) {
      log.warn('engine:ready event carried an unparseable readiness document');
      return;
    }
    emit(event);
  });
  emitter.addListener('engine:state', (raw: any) => {
    const status = raw?.status as EngineStatus | undefined;
    if (!status) return;
    emit({ type: 'state', status });
  });
  emitter.addListener('engine:stopped', (raw: any) => {
    emit({
      type: 'stopped',
      code: raw?.code == null ? null : Number(raw.code),
      signal: raw?.signal == null ? null : Number(raw.signal),
    });
  });
  // A fatal facade init/start error has no restart path in-process; surface it
  // as the sidecar's terminal `crashed` event so the shared status reducer and
  // connection-clear paths behave identically.
  emitter.addListener('engine:error', (raw: any) => {
    emit({
      type: 'crashed',
      attempt: Number(raw?.attempt) || 0,
      maxAttempts: Number(raw?.maxAttempts) || ENGINE_MAX_RESTARTS,
      code: raw?.code == null ? null : Number(raw.code),
      signal: raw?.signal == null ? null : Number(raw.signal),
    });
  });

  // ── Task 4-3: blind-tick wake + push-token channels ─────────────────────
  emitter.addListener('engine:wake', (raw: any) => {
    const taskId = typeof raw?.taskId === 'string' ? raw.taskId : '';
    if (!taskId) {
      log.warn('engine:wake event carried no taskId');
      return;
    }
    const kind = normalizeWakeKind(raw?.kind);
    const payload =
      raw?.payload && typeof raw.payload === 'object' ? (raw.payload as Record<string, unknown>) : undefined;
    emitWake({ taskId, kind, payload });
  });
  emitter.addListener('push:token', (raw: any) => {
    const token = typeof raw?.token === 'string' ? raw.token.trim() : '';
    if (!token) return;
    emitPushToken({ token });
  });
}

/** Subscribe to every embedded-engine lifecycle event. Returns an unsubscribe fn. */
export function onEngineEmbeddedEvent(
  listener: (event: EngineSidecarEvent) => void,
): () => void {
  eventListeners.add(listener);
  return () => {
    eventListeners.delete(listener);
  };
}

/** Subscribe to `exit` only — the embedded host never exits a process (no-op). */
export function onEngineEmbeddedExit(
  _listener: (exit: EngineExitInfo) => void,
): () => void {
  return () => undefined;
}

// ── Task 4-3: wake / push-token subscription ─────────────────────────────

/**
 * Subscribe to OS wakes bridged by the native coordinator (`engine:wake`).
 * Returns an unsubscribe function. Off iOS (or without the module) no wakes are
 * ever delivered.
 */
export function onEngineWake(listener: (event: EngineWakeEvent) => void): () => void {
  wakeListeners.add(listener);
  return () => {
    wakeListeners.delete(listener);
  };
}

/** Subscribe to the APNs device token (`push:token`). Returns an unsubscribe. */
export function onPushToken(listener: (event: PushTokenEvent) => void): () => void {
  pushTokenListeners.add(listener);
  return () => {
    pushTokenListeners.delete(listener);
  };
}

/**
 * Complete the OS task the native coordinator opened for a wake. Fire-and-
 * forget; resolves when the native side has ended its background assertion and
 * called the OS completion handler.
 */
export async function finishEngineWake(taskId: string, resultJSON = ''): Promise<void> {
  if (!native || typeof native.finishWake !== 'function') return;
  try {
    await native.finishWake(taskId, resultJSON);
  } catch (e) {
    log.warn('finishWake failed:', e);
  }
}

/**
 * Drain a wake the native coordinator queued before JS was ready (a background
 * launch can deliver the push before the bridge finishes booting). Resolves the
 * queued wake, or null when there is none.
 */
export async function consumePendingEngineWake(): Promise<EngineWakeEvent | null> {
  if (!native || typeof native.consumePendingWake !== 'function') return null;
  try {
    const raw = await native.consumePendingWake();
    if (!raw || typeof raw.taskId !== 'string' || !raw.taskId) return null;
    const payload =
      raw.payload && typeof raw.payload === 'object' ? (raw.payload as Record<string, unknown>) : undefined;
    return { taskId: raw.taskId, kind: normalizeWakeKind(raw.kind), payload };
  } catch (e) {
    log.warn('consumePendingWake failed:', e);
    return null;
  }
}

/** Drain the APNs token queued before JS was ready. Resolves the token or null. */
export async function consumePendingPushToken(): Promise<string | null> {
  if (!native || typeof native.consumePendingPushToken !== 'function') return null;
  try {
    const token = await native.consumePendingPushToken();
    return typeof token === 'string' && token ? token : null;
  } catch (e) {
    log.warn('consumePendingPushToken failed:', e);
    return null;
  }
}

// ── Native-backed API ────────────────────────────────────────────────────

/** True when the in-process engine module is present for this build. */
export async function isEngineEmbeddedAvailable(): Promise<boolean> {
  if (!native || typeof native.isAvailable !== 'function') return false;
  try {
    return Boolean(await native.isAvailable());
  } catch (e) {
    log.error('isAvailable failed:', e);
    return false;
  }
}

/**
 * Start (or reuse) the in-process engine. Resolves with the parsed readiness
 * payload once the loopback servers accept connections (ports + token known).
 */
export async function startEngineEmbedded(
  options: EngineStartOptions = {},
): Promise<EngineReadyPayload> {
  if (!isEngineEmbeddedEnabled()) {
    throw new Error('EngineEmbedded disabled (ENGINE_EMBEDDED_ENABLED=false)');
  }
  if (!native || typeof native.start !== 'function') {
    throw new Error('SoulbitsEngine native module unavailable (iOS in-process engine not linked)');
  }
  const result: NativeEngineStartResult = await native.start({
    dbKey: options.dbKey,
    dataDir: options.dataDir,
    logLevel: options.logLevel,
  });
  const parsed = normalizeReady(result);
  if (parsed && parsed.type === 'ready') return parsed.payload;
  throw new Error('SoulbitsEngine.start resolved without a parseable readiness payload');
}

/** Stop the in-process engine (graceful; WAL checkpoint). Idempotent. */
export async function stopEngineEmbedded(): Promise<void> {
  if (!native || typeof native.stop !== 'function') return;
  await native.stop();
}

/** Current lifecycle status tracked by the native module. */
export async function getEngineEmbeddedState(): Promise<EngineStatus> {
  if (!native || typeof native.getState !== 'function') {
    return 'unsupported';
  }
  try {
    const status = (await native.getState()) as EngineStatus;
    return status ?? 'stopped';
  } catch (e) {
    log.error('getState failed:', e);
    return 'failed';
  }
}

/**
 * The multiplexed in-process RPC (`EmbedEngineCall`): lifecycle/control calls
 * that are not plain management reads (catch-up, batch, maintenance, sync
 * control, generic management proxy). Resolves the JSON result string; rejects
 * when the engine is not started.
 */
export async function callEngineEmbedded(
  method: string,
  payloadJSON = '',
): Promise<string> {
  if (!native || typeof native.call !== 'function') {
    throw new Error('SoulbitsEngine native module unavailable (iOS in-process engine not linked)');
  }
  return (await native.call(method, payloadJSON)) as string;
}

export default {
  ENGINE_EMBEDDED_ENABLED,
  isEngineEmbeddedEnabled,
  setEngineEmbeddedEnabled,
  onEngineEmbeddedEvent,
  onEngineEmbeddedExit,
  isEngineEmbeddedAvailable,
  startEngineEmbedded,
  stopEngineEmbedded,
  getEngineEmbeddedState,
  callEngineEmbedded,
  onEngineWake,
  onPushToken,
  finishEngineWake,
  consumePendingEngineWake,
  consumePendingPushToken,
};
