/**
 * EngineSidecarModule — JS wrapper around the native engine-sidecar manager
 * (task 1-2).
 *
 * The native side (`ai.soulbits.chat.engine.EngineSidecarModule` on Android)
 * execs the Soulbits Engine (`libengine.so`) from `nativeLibraryDir`,
 * scans its stdout for the `ENGINE_READY {...}` readiness line, watches the
 * process, restarts it with backoff on unexpected exits, and stops it with
 * SIGTERM (WAL checkpoint). This wrapper:
 *
 *  - exposes a thin, promise-based API (start / stop / state / availability)
 *  - re-parses the raw readiness line into the typed `EngineReadyPayload`
 *    (the TS side owns the wire→domain mapping; the native side only detects
 *    the prefix and forwards the line)
 *  - fans the native lifecycle events out to typed listeners
 *    (`engine:ready`, `engine:restarting`, `engine:crashed`,
 *    `engine:stopped`, `engine:state`, `engine:exit`)
 *  - owns the canonical restart-backoff schedule and the status reducer
 *    (pure, unit-tested) that the native manager mirrors
 *
 * The app's local-engine connection state is absorbed into the 3-2
 * engine-service layer later; this module deliberately exposes only the
 * process/port/readiness surface (never a connection), so 3-2 can build the
 * management-API client + repository seam on top of `getEngineSidecarState()`
 * and the readiness payload.
 */

import { NativeModules, NativeEventEmitter, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createLogger } from '../../utils/logger';
import type {
  EngineExitInfo,
  EngineReadyPayload,
  EngineSidecarEvent,
  EngineStartOptions,
  EngineStatus,
  NativeEngineStartResult,
} from '../../types/engineSidecar';

const log = createLogger('[EngineSidecar]');

// ── Contract constants (mirror the engine's docs/Sidecar-Deployment.md) ──
/** The stdout prefix the sidecar writes exactly once when both servers are up. */
export const ENGINE_READY_PREFIX = 'ENGINE_READY ';
/** Base delay for the first restart attempt (ms). */
export const ENGINE_BACKOFF_BASE_MS = 500;
/** Ceiling for the exponential restart backoff (ms). */
export const ENGINE_BACKOFF_MAX_MS = 8000;
/** Default max automatic restarts before surfacing the engine-error state. */
export const ENGINE_MAX_RESTARTS = 3;
/** How long `start()` waits for the readiness line before rejecting (ms). */
export const ENGINE_READY_TIMEOUT_MS = 30000;

// ── Feature flag (rollback: set false to disable the whole module) ───────
/** Build-time default. Flip to false (or call setEngineSidecarEnabled) to roll back. */
export const ENGINE_SIDECAR_ENABLED = true;
let engineSidecarEnabledOverride: boolean | null = null;

/** True when the sidecar module is enabled (rollback knob for the whole feature). */
export function isEngineSidecarEnabled(): boolean {
  return engineSidecarEnabledOverride ?? ENGINE_SIDECAR_ENABLED;
}

/** Runtime override for the feature flag (pass null to restore the default). */
export function setEngineSidecarEnabled(enabled: boolean | null): void {
  engineSidecarEnabledOverride = enabled;
}

// ── Native module resolution (mirrors ChatBubbleService.ts) ──────────────
const native: any = Platform.OS === 'android' ? (NativeModules as any).EngineSidecar : null;

let emitter: NativeEventEmitter | null = null;
if (Platform.OS === 'android' && native) {
  emitter = new NativeEventEmitter(native as any);
}

// ── Pure helpers (exported for unit tests) ───────────────────────────────

/**
 * Map a decoded readiness object (the engine's readiness JSON — keys `ws`,
 * `wss`, `admin`, `bind`, `pid`, `dataDir`, `token`) into the typed payload.
 *
 * Shared by the sidecar (`parseReadyLine`, which finds the prefix on a stdout
 * line) and the iOS embedded host (`parseReadyPayload`, whose facade returns the
 * bare JSON document). Returns null when the required ports are absent/invalid.
 */
export function mapReadyJson(raw: any): EngineReadyPayload | null {
  if (!raw || typeof raw !== 'object') return null;
  const wsPort = Number(raw.ws);
  const adminPort = Number(raw.admin);
  if (!Number.isFinite(wsPort) || wsPort <= 0) return null;
  if (!Number.isFinite(adminPort) || adminPort <= 0) return null;
  const wssPort = Number(raw.wss);
  const pid = Number(raw.pid);
  return {
    wsPort,
    wssPort: Number.isFinite(wssPort) ? wssPort : 0,
    adminPort,
    bind: typeof raw.bind === 'string' ? raw.bind : '127.0.0.1',
    pid: Number.isFinite(pid) ? pid : -1,
    dataDir: typeof raw.dataDir === 'string' ? raw.dataDir : '',
    token: typeof raw.token === 'string' ? raw.token : '',
  };
}

/**
 * Parse the engine's bare readiness JSON document (no `ENGINE_READY ` prefix).
 *
 * The iOS facade's `EngineStart` returns exactly `{"ws":..,"admin":..,...}`;
 * the native module forwards it verbatim (and may also wrap it as a prefixed
 * `rawLine`, which `parseReadyLine` handles). We accept both here so the
 * embedded host never depends on the prefix. Returns null for a non-object or a
 * document missing the required ports.
 */
export function parseReadyPayload(jsonString: string): EngineReadyPayload | null {
  const trimmed = (jsonString ?? '').trim();
  if (!trimmed) return null;
  // Defensive: tolerate a prefixed line passed in by mistake.
  const idx = trimmed.indexOf(ENGINE_READY_PREFIX);
  const body = idx === -1 ? trimmed : trimmed.slice(idx + ENGINE_READY_PREFIX.length).trim();
  try {
    return mapReadyJson(JSON.parse(body));
  } catch {
    return null;
  }
}

/**
 * Parse a single stdout line into a typed readiness payload.
 *
 * The line may carry trailing CR/LF and may be preceded by unrelated stdout
 * noise (Gin route dumps, the seeder). We locate the `ENGINE_READY ` prefix,
 * parse the JSON that follows, and validate the required ports. Returns null
 * for anything that is not a well-formed readiness line.
 */
export function parseReadyLine(line: string): EngineReadyPayload | null {
  if (!line) return null;
  const idx = line.indexOf(ENGINE_READY_PREFIX);
  if (idx === -1) return null;
  return parseReadyPayload(line.slice(idx + ENGINE_READY_PREFIX.length));
}

/**
 * Line-buffered scan of a stdout chunk for the readiness line.
 *
 * The last (possibly partial) line is returned as `carry` so the caller can
 * prepend it to the next chunk. Once a payload is found, `carry` is cleared —
 * readiness is a one-shot event.
 */
export function scanStdoutForReady(
  chunk: string,
  carry = '',
): { payload: EngineReadyPayload | null; carry: string } {
  const combined = carry + (chunk ?? '');
  const lines = combined.split('\n');
  const nextCarry = lines.pop() ?? '';
  for (const line of lines) {
    const payload = parseReadyLine(line);
    if (payload) {
      return { payload, carry: '' };
    }
  }
  return { payload: null, carry: nextCarry };
}

/**
 * Exponential restart backoff for a 1-based attempt number.
 *
 * `base * 2^(attempt-1)` clamped to `maxMs` (500, 1000, 2000, 4000, 8000, …).
 */
export function computeBackoffDelayMs(
  attempt: number,
  baseMs: number = ENGINE_BACKOFF_BASE_MS,
  maxMs: number = ENGINE_BACKOFF_MAX_MS,
): number {
  const a = Math.max(1, Math.floor(attempt));
  return Math.min(baseMs * Math.pow(2, a - 1), maxMs);
}

/**
 * Status reducer — fold a lifecycle event into the current status. Pure and
 * total so the JS-facing status is deterministic regardless of event ordering
 * (e.g. a stray `state` after `stopped`).
 */
export function nextEngineStatus(
  current: EngineStatus,
  event: EngineSidecarEvent,
): EngineStatus {
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
      // A crash with a pending restart keeps us in `restarting`; a final
      // (non-restarting) unexpected exit is a failure; a host-initiated exit
      // lands on `stopped`.
      if (event.exit.expected) return 'stopped';
      return event.exit.willRestart ? 'restarting' : 'failed';
    default:
      return current;
  }
}

// ── Event fan-out ────────────────────────────────────────────────────────

const eventListeners = new Set<(event: EngineSidecarEvent) => void>();

const READY_CACHE_KEY = '@soulbits:engine_ready_cache';

function fallbackPayloadFromBridge(raw: any): EngineReadyPayload | null {
  const wsPort = Number(raw?.wsPort);
  const adminPort = Number(raw?.adminPort);
  if (!Number.isFinite(wsPort) || wsPort <= 0 || !Number.isFinite(adminPort) || adminPort <= 0) {
    return null;
  }
  return {
    wsPort,
    wssPort: Number(raw?.wssPort) || 0,
    adminPort,
    bind: raw?.bind ?? '127.0.0.1',
    pid: Number(raw?.pid) || -1,
    dataDir: raw?.dataDir ?? '',
    token: typeof raw?.token === 'string' ? raw.token : '',
  };
}

function normalizeReady(raw: any): EngineSidecarEvent | null {
  const rawLine = typeof raw?.rawLine === 'string' ? raw.rawLine : '';
  const parsed = parseReadyLine(rawLine) ?? fallbackPayloadFromBridge(raw);
  if (!parsed) return null;
  return { type: 'ready', payload: parsed, rawLine };
}

if (emitter) {
  emitter.addListener('engine:ready', (raw: any) => {
    const event = normalizeReady(raw);
    if (!event) {
      log.warn('engine:ready event carried an unparseable readiness line');
      return;
    }
    eventListeners.forEach(listener => listener(event));
  });
  emitter.addListener('engine:restarting', (raw: any) => {
    const event: EngineSidecarEvent = {
      type: 'restarting',
      attempt: Number(raw?.attempt) || 0,
      delayMs: Number(raw?.delayMs) || 0,
    };
    eventListeners.forEach(listener => listener(event));
  });
  emitter.addListener('engine:crashed', (raw: any) => {
    const event: EngineSidecarEvent = {
      type: 'crashed',
      attempt: Number(raw?.attempt) || 0,
      maxAttempts: Number(raw?.maxAttempts) || ENGINE_MAX_RESTARTS,
      code: raw?.code == null ? null : Number(raw.code),
      signal: raw?.signal == null ? null : Number(raw.signal),
    };
    eventListeners.forEach(listener => listener(event));
  });
  emitter.addListener('engine:stopped', (raw: any) => {
    const event: EngineSidecarEvent = {
      type: 'stopped',
      code: raw?.code == null ? null : Number(raw.code),
      signal: raw?.signal == null ? null : Number(raw.signal),
    };
    eventListeners.forEach(listener => listener(event));
  });
  emitter.addListener('engine:state', (raw: any) => {
    const status = raw?.status as EngineStatus | undefined;
    if (!status) return;
    eventListeners.forEach(listener => listener({ type: 'state', status }));
  });
  emitter.addListener('engine:exit', (raw: any) => {
    const exit: EngineExitInfo = {
      code: raw?.code == null ? null : Number(raw.code),
      signal: raw?.signal == null ? null : Number(raw.signal),
      expected: Boolean(raw?.expected),
      restartAttempt: Number(raw?.restartAttempt) || 0,
      willRestart: Boolean(raw?.willRestart),
    };
    eventListeners.forEach(listener => listener({ type: 'exit', exit }));
  });
}

/**
 * Subscribe to every sidecar lifecycle event. Returns an unsubscribe function.
 */
export function onEngineSidecarEvent(
  listener: (event: EngineSidecarEvent) => void,
): () => void {
  eventListeners.add(listener);
  return () => {
    eventListeners.delete(listener);
  };
}

/** Subscribe to `engine:exit` only (the plan's `onExit(error?)` contract). */
export function onEngineExit(listener: (exit: EngineExitInfo) => void): () => void {
  return onEngineSidecarEvent(event => {
    if (event.type === 'exit') listener(event.exit);
  });
}

// ── Native-backed API ────────────────────────────────────────────────────

/** True when a sidecar binary exists for this device ABI (Android only). */
export async function isEngineSidecarAvailable(): Promise<boolean> {
  if (!native || typeof native.isAvailable !== 'function') return false;
  try {
    return Boolean(await native.isAvailable());
  } catch (e) {
    log.error('isAvailable failed:', e);
    return false;
  }
}

/**
 * Start the engine sidecar. Resolves with the parsed readiness payload once
 * the `ENGINE_READY` line is observed (ports are known; safe to connect).
 */
export async function startEngineSidecar(
  options: EngineStartOptions = {},
): Promise<EngineReadyPayload> {
  if (!isEngineSidecarEnabled()) {
    throw new Error('EngineSidecar disabled (ENGINE_SIDECAR_ENABLED=false)');
  }
  if (!native || typeof native.start !== 'function') {
    throw new Error('EngineSidecar native module unavailable');
  }
  const nativeOpts = {
    dbKey: options.dbKey,
    dataDir: options.dataDir,
    logLevel: options.logLevel,
    maxRestarts: options.maxRestarts,
  };
  let result: NativeEngineStartResult = await native.start(nativeOpts);
  let parsed = parseReadyLine(typeof result?.rawLine === 'string' ? result.rawLine : '');
  if (parsed) {
    if (parsed.token) {
      AsyncStorage.setItem(READY_CACHE_KEY, JSON.stringify(parsed)).catch(() => {});
    }
    return parsed;
  }

  // Defensive fallback: an already-running sidecar where an older native bridge
  // resolved from `lastReady` with `rawLine: ""` and no `token` field.
  const fallback = fallbackPayloadFromBridge(result);
  if (fallback) {
    if (!fallback.token) {
      try {
        const cachedRaw = await AsyncStorage.getItem(READY_CACHE_KEY);
        if (cachedRaw) {
          const cached = JSON.parse(cachedRaw) as EngineReadyPayload;
          if (
            cached?.token &&
            cached.wsPort === fallback.wsPort &&
            cached.adminPort === fallback.adminPort &&
            (fallback.pid <= 0 || cached.pid === fallback.pid)
          ) {
            fallback.token = cached.token;
          }
        }
      } catch {
        // Ignore cache read failures.
      }
    }
    // If still missing token from an already-running process with empty rawLine,
    // cycle the sidecar once so it emits a fresh `ENGINE_READY` line with token.
    if (
      !fallback.token &&
      result?.rawLine === '' &&
      typeof native.stop === 'function'
    ) {
      try {
        log.info('Sidecar already running without cached loopback token; cycling sidecar to recover token');
        await native.stop();
        result = await native.start(nativeOpts);
        parsed = parseReadyLine(typeof result?.rawLine === 'string' ? result.rawLine : '');
        if (parsed) {
          if (parsed.token) {
            AsyncStorage.setItem(READY_CACHE_KEY, JSON.stringify(parsed)).catch(() => {});
          }
          return parsed;
        }
      } catch (e) {
        log.warn('Failed to cycle sidecar for token recovery:', e);
      }
    }
    if (fallback.token) {
      AsyncStorage.setItem(READY_CACHE_KEY, JSON.stringify(fallback)).catch(() => {});
    }
    return fallback;
  }
  throw new Error('EngineSidecar.start resolved without a parseable readiness payload');
}

/**
 * Stop the engine sidecar (SIGTERM; the engine checkpoints the WAL and exits
 * within its 10s budget, SIGKILL only on timeout).
 */
export async function stopEngineSidecar(): Promise<void> {
  if (!native || typeof native.stop !== 'function') return;
  await native.stop();
}

/** Current lifecycle status tracked by the native manager. */
export async function getEngineSidecarState(): Promise<EngineStatus> {
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

export default {
  ENGINE_READY_PREFIX,
  ENGINE_BACKOFF_BASE_MS,
  ENGINE_BACKOFF_MAX_MS,
  ENGINE_MAX_RESTARTS,
  ENGINE_READY_TIMEOUT_MS,
  ENGINE_SIDECAR_ENABLED,
  isEngineSidecarEnabled,
  setEngineSidecarEnabled,
  parseReadyLine,
  parseReadyPayload,
  mapReadyJson,
  scanStdoutForReady,
  computeBackoffDelayMs,
  nextEngineStatus,
  onEngineSidecarEvent,
  onEngineExit,
  isEngineSidecarAvailable,
  startEngineSidecar,
  stopEngineSidecar,
  getEngineSidecarState,
};
