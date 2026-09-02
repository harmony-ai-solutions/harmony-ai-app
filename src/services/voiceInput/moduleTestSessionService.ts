/**
 * moduleTestSessionService — transient eventserver `debug` session for the
 * STT/TTS module test blocks (persona-modules 2-2 / 2-3 rework).
 *
 * ## Why not HTTP
 *
 * The app must NOT call the engine's management server over HTTP (not
 * cloud-reachable). The test blocks instead drive the EXISTING STT/TTS events
 * over the app's normal eventserver WebSocket connection layer, on a single
 * transient connection opened with the engine's new `debug` device type
 * (engine phase 1-3). A `debug` session initializes ALL modules but has NO
 * interaction / memory / lifecycle side effects and is cleaned up immediately
 * on disconnect (non-phone path).
 *
 * ## Why a dedicated service (not EntitySessionService)
 *
 * It must NEVER touch live chat sessions. It opens its OWN connection id
 * (`debug-module-test-<entityId>-<uuid>`) and its OWN event listener on that
 * socket, keyed by its own message ids. A test cannot read or consume a live
 * chat session's pending transcriptions or interactions, and a live chat
 * session's ConnectionManager-level routing sees only benign "unknown session"
 * noise for the test's events.
 *
 * It REUSES the EXISTING connection primitives from
 * EntitySessionService.startInteractionSession — connection creation via
 * ConnectionManager, URL/mode resolution via ConnectionStateManager, and the
 * INIT_ENTITY payload construction — without duplicating them and without
 * touching any live session object.
 */

import { Platform } from 'react-native';
import DeviceInfo from 'react-native-device-info';
import { v7 as uuidv7 } from 'uuid';
import ConnectionManager from '../connection/ConnectionManager';
import ConnectionStateManager from '../ConnectionStateManager';
import { CLOUD_HOSTS, WS_PATHS } from '../../config/cloud';
import { createLogger } from '../../utils/logger';

const log = createLogger('[moduleTestSessionService]');

/** Pinned device_type for transient module-test sessions (engine 1-3). */
export const DEBUG_DEVICE_TYPE = 'debug';

/** Default timeout for awaiting a single engine response (INIT or module event). */
const DEFAULT_AWAIT_TIMEOUT_MS = 15000;

/** Incoming event envelope (matches the engine's HarmonyLinkEvent JSON shape). */
export interface ModuleTestEvent {
  event_id?: string;
  event_type: string;
  status?: string;
  payload?: any;
  [key: string]: any;
}

/** Thrown when a test session cannot be established or an engine response is rejected/times out. */
export class ModuleTestSessionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ModuleTestSessionError';
  }
}

interface PendingWaiter {
  eventType: string;
  predicate?: (event: ModuleTestEvent) => boolean;
  resolve: (event: ModuleTestEvent) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/** Helpers handed to the test block's callback. */
export interface ModuleTestSessionHelpers {
  sendEvent: (event: { event_type: string; payload?: any; status?: string; event_id?: string }) => Promise<void>;
  awaitEvent: (eventType: string, opts?: { timeoutMs?: number; predicate?: (event: ModuleTestEvent) => boolean }) => Promise<ModuleTestEvent>;
}

/** A live module-test session (own connection, own event namespace). */
export interface ModuleTestSession extends ModuleTestSessionHelpers {
  connectionId: string;
  entityId: string;
  disconnect: () => Promise<void>;
}

/** Resolve the engine WebSocket URL + security mode, mirroring startInteractionSession. */
async function resolveEngineConnection(): Promise<{ url: string; mode: string }> {
  const source = await ConnectionStateManager.getCurrentSource();
  if (source === 'cloud') {
    return { url: `${CLOUD_HOSTS.conductProxyWs}${WS_PATHS.worker}`, mode: 'cloud' };
  }
  const mode = (await ConnectionStateManager.getSecurityMode()) || 'secure';
  const url =
    mode === 'unencrypted'
      ? (await ConnectionStateManager.getWSUrl()) ?? ''
      : (await ConnectionStateManager.getWSSUrl()) ?? '';
  if (!url) {
    throw new ModuleTestSessionError('Not connected to Harmony Link');
  }
  return { url, mode };
}

/**
 * Internal session implementation — owns the single WebSocket connection, a
 * pending-event queue, and one-shot waiters for `awaitEvent`.
 */
class TestSession implements ModuleTestSession {
  readonly connectionId: string;
  readonly entityId: string;
  private socket: any;
  private pendingEvents: ModuleTestEvent[] = [];
  private waiters: PendingWaiter[] = [];
  private detached = false;

  constructor(connectionId: string, entityId: string, socket: any) {
    this.connectionId = connectionId;
    this.entityId = entityId;
    this.socket = socket;
  }

  /** Attach the event listener. Must be called before sending INIT. */
  attach(): void {
    this.socket.on('event', this.onEvent);
  }

  private onEvent = (event: ModuleTestEvent): void => {
    // Resolve a matching waiting waiter first; otherwise queue for a later await.
    for (let i = 0; i < this.waiters.length; i++) {
      const waiter = this.waiters[i];
      if (waiter.eventType === event.event_type) {
        if (!waiter.predicate || waiter.predicate(event)) {
          this.waiters.splice(i, 1);
          clearTimeout(waiter.timer);
          waiter.resolve(event);
          return;
        }
      }
    }
    this.pendingEvents.push(event);
  };

  async sendEvent(event: { event_type: string; payload?: any; status?: string; event_id?: string }): Promise<void> {
    const envelope = {
      event_id: event.event_id ?? uuidv7(),
      event_type: event.event_type,
      status: event.status ?? 'NEW',
      ...(event.payload !== undefined ? { payload: event.payload } : {}),
    };
    log.info(`Sending module-test event via ${this.connectionId}: ${envelope.event_type}`);
    await ConnectionManager.sendEvent(this.connectionId, envelope);
  }

  awaitEvent(eventType: string, opts: { timeoutMs?: number; predicate?: (event: ModuleTestEvent) => boolean } = {}): Promise<ModuleTestEvent> {
    const { timeoutMs = DEFAULT_AWAIT_TIMEOUT_MS, predicate } = opts;

    // Drain a matching pending event first (already received before await).
    const idx = this.pendingEvents.findIndex((e) => e.event_type === eventType && (!predicate || predicate(e)));
    if (idx >= 0) {
      const [event] = this.pendingEvents.splice(idx, 1);
      return Promise.resolve(event);
    }

    return new Promise<ModuleTestEvent>((resolve, reject) => {
      const waiter: PendingWaiter = {
        eventType,
        predicate,
        resolve,
        reject,
        timer: setTimeout(() => {
          const at = this.waiters.indexOf(waiter);
          if (at >= 0) this.waiters.splice(at, 1);
          reject(new ModuleTestSessionError(`Timed out waiting for ${eventType}`));
        }, timeoutMs),
      };
      this.waiters.push(waiter);
    });
  }

  async disconnect(): Promise<void> {
    if (this.detached) return;
    this.detached = true;

    // Detach the socket listener so late events are ignored.
    this.socket?.off?.('event', this.onEvent);

    // Reject any remaining waiters (a disconnect is a terminal failure).
    for (const waiter of this.waiters) {
      clearTimeout(waiter.timer);
      waiter.reject(new ModuleTestSessionError('Module test session disconnected'));
    }
    this.waiters = [];
    this.pendingEvents = [];

    if (ConnectionManager.isConnected(this.connectionId)) {
      ConnectionManager.disconnectConnection(this.connectionId);
    }
  }
}

/**
 * Open a transient module-test session for `entityId`:
 *  1. open an OWN WebSocket connection (unique connection id);
 *  2. INIT_ENTITY with `device_type: 'debug'` (pinned contract, engine 1-3);
 *  3. await the INIT_ENTITY SUCCESS (throw a ModuleTestSessionError on ERROR).
 */
export async function openTestSession(entityId: string): Promise<ModuleTestSession> {
  const { url, mode } = await resolveEngineConnection();
  const connectionId = `debug-module-test-${entityId}-${uuidv7()}`;
  const deviceId = await DeviceInfo.getUniqueId();

  await ConnectionManager.createConnection(connectionId, 'entity', url, mode as any, entityId);

  const connInfo = ConnectionManager.getConnection(connectionId);
  if (!connInfo?.connection) {
    throw new ModuleTestSessionError('Could not open test connection');
  }

  const session = new TestSession(connectionId, entityId, connInfo.connection);
  session.attach();

  try {
    const initEvent = {
      event_id: uuidv7(),
      event_type: 'INIT_ENTITY',
      status: 'NEW',
      payload: {
        entity_id: entityId,
        participant_ids: [entityId], // Single-entity debug session (no chat partner)
        device_type: DEBUG_DEVICE_TYPE,
        device_id: deviceId,
        device_platform: Platform.OS,
        capabilities: ['chat'],
        tts_output_type: 'binary',
        reply_mode: 'instant',
      },
    };

    log.info(`Sending INIT_ENTITY (device_type=debug) for ${entityId}`);
    await ConnectionManager.sendEvent(connectionId, initEvent);

    const initResponse = await session.awaitEvent('INIT_ENTITY', {
      predicate: (e) => e.status === 'SUCCESS' || e.status === 'ERROR',
    });

    if (initResponse.status !== 'SUCCESS') {
      const message = extractErrorMessage(initResponse);
      log.error(`INIT_ENTITY rejected for ${entityId}: ${message}`);
      throw new ModuleTestSessionError(message);
    }
  } catch (error) {
    await session.disconnect();
    throw error;
  }

  return session;
}

/** Extract a human-readable message from an engine ERROR-status event payload. */
function extractErrorMessage(event: ModuleTestEvent): string {
  const payload = event.payload;
  if (typeof payload === 'string') {
    // Engine encodes the error payload as a JSON string (e.g. `"entity_disabled"`).
    try {
      const parsed = JSON.parse(payload);
      return String(parsed);
    } catch {
      return payload;
    }
  }
  if (payload && typeof payload === 'object') {
    return String(payload.error || payload.message || payload.reason || 'INIT_ENTITY failed');
  }
  return 'INIT_ENTITY failed';
}

/**
 * Run a module test for `entityId`:
 *  1. open a transient `debug` session;
 *  2. run `fn` with the sendEvent/awaitEvent helpers;
 *  3. ALWAYS disconnect — even if `fn` throws.
 *
 * @returns whatever `fn` returns (e.g. a transcript or the synthesized audio).
 */
export async function runTest<T>(
  entityId: string,
  fn: (helpers: ModuleTestSessionHelpers) => Promise<T>,
): Promise<T> {
  const session = await openTestSession(entityId);
  try {
    // Bind the helpers to the session so a destructured `{ sendEvent, awaitEvent }`
    // inside fn keeps its `this`.
    const helpers: ModuleTestSessionHelpers = {
      sendEvent: (event) => session.sendEvent(event),
      awaitEvent: (eventType, opts) => session.awaitEvent(eventType, opts),
    };
    return await fn(helpers);
  } finally {
    await session.disconnect();
  }
}
