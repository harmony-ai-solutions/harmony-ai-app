/**
 * ConnectSessionService — the phone app's portal sign-in ("Option B").
 *
 * Owner-ruled 2026-10-17: the portal connect-session flow IS the phone app's
 * sign-in. The app announces itself to the cloud (`POST
 * /v1/devices/connect-session`), opens the returned portal URL in the system
 * browser, and polls until the user clicks **Allow** there. On approval the
 * poll returns the token pair EXACTLY ONCE; this service hands it to
 * {@link AuthService} so it takes the IDENTICAL Keychain + `auth:changed` path
 * as the retired email/password login (NO parallel token path).
 *
 * ── SECURITY MODEL ────────────────────────────────────────────────────────
 * The `connect_id` + `session_secret` live in memory ONLY — never persisted,
 * never logged. The deep-link return (`soulbits://connect-return`) carries no
 * secrets: it merely foregrounds the app so the poll fires immediately; the
 * app still redeems through its own secret-authenticated poll.
 *
 * ── TRANSPORT ─────────────────────────────────────────────────────────────
 * The pinned first-party JS client (`@harmony-ai-solutions/soulbits-api-client`
 * v0.4.0) exposes `createDeviceConnectSession` / `getDeviceConnectSession` in
 * its generated *types* but NOT on its `devices` facade, so — exactly like
 * `AuthService` does for login/refresh — this service calls the cloud REST
 * endpoints directly via `fetch`. Host resolution reuses
 * `CLOUD_HOSTS.session` (the API gateway host that also fronts `/v1/devices/*`).
 *
 * ── TESTABILITY ───────────────────────────────────────────────────────────
 * Everything impure (fetch, timers, clock, AppState, Linking, device identity,
 * the redeem sink) is injectable, and the state is exposed through
 * `getState()` / `subscribe()` so the poll lifecycle is unit-testable without
 * React or the RN runtime.
 */

import { AppState, Linking, Platform } from 'react-native';
import type { AppStateStatus } from 'react-native';
import DeviceInfo from 'react-native-device-info';
import { CLOUD_HOSTS } from '../../config/cloud';
import AuthService from '../auth/AuthService';
import { getDeviceId } from './DeviceIdProvider';
import { parseConnectReturnDeepLink } from './deviceDeepLink';
import { createLogger } from '../../utils/logger';

const log = createLogger('[ConnectSession]');

// ── Types ───────────────────────────────────────────────────────────────────

export type ConnectSessionStatus =
  | 'idle'
  | 'starting'
  | 'pending'
  | 'approved'
  | 'expired'
  | 'consumed'
  | 'errored';

/** Public (secret-free) snapshot of the session state. */
export interface ConnectSessionState {
  status: ConnectSessionStatus;
  /** The portal URL the user must open (available once created). */
  connectUrl: string | null;
  /** Whole seconds remaining until expiry (pending only; 0 otherwise). */
  remainingSeconds: number;
  /** Human-readable message (errored only). */
  message: string | null;
}

/** The create response, reduced to what the app keeps (secret included). */
export interface ConnectSessionCreated {
  connectId: string;
  sessionSecret: string;
  connectUrl: string;
  expiresIn: number;
}

/** A single poll result (wire `status` + token pair on approval). */
export type ConnectSessionPoll =
  | { status: 'pending' }
  | { status: 'approved'; token: string; refreshToken: string; expiresAt: string }
  | { status: 'consumed' }
  | { status: 'expired' };

/** The token pair handed to the redeem sink on approval. */
export interface ConnectSessionTokens {
  token: string;
  refreshToken: string;
  expiresAt: string;
}

// ── Injectable seams ──────────────────────────────────────────────────────

/** The AppState surface the service needs (injectable for tests). */
export interface AppStateSource {
  currentState: AppStateStatus;
  addEventListener(type: 'change', handler: (state: AppStateStatus) => void): { remove(): void };
}

/** The Linking surface the service needs (injectable for tests). */
export interface LinkingSource {
  addEventListener(type: 'url', handler: (event: { url: string }) => void): { remove(): void };
  getInitialURL(): Promise<string | null>;
}

/** Timer surface (injectable for tests). */
export interface TimerSource {
  setInterval(handler: () => void, ms: number): any;
  clearInterval(handle: any): void;
}

export interface ConnectSessionDeps {
  fetch?: typeof fetch;
  timers?: TimerSource;
  now?: () => number;
  appState?: AppStateSource;
  linking?: LinkingSource;
  getDeviceId?: () => Promise<string>;
  platform?: () => 'android' | 'ios' | 'web';
  deviceName?: () => Promise<string>;
  /** Redeem the approved pair. Defaults to AuthService.applyConnectSessionTokens. */
  redeem?: (tokens: ConnectSessionTokens) => Promise<void>;
  /** Poll cadence (ms). Defaults to 2500. */
  pollIntervalMs?: number;
  /** Countdown tick cadence (ms). Defaults to 1000. */
  tickIntervalMs?: number;
  onStateChange?: (state: ConnectSessionState) => void;
}

export interface ConnectSessionController {
  /** Create a session and begin polling. Resolves with the portal URL. */
  start(): Promise<{ connectUrl: string }>;
  /** Stop polling and forget the in-memory secret. */
  cancel(): void;
  /** Force an immediate poll (AppState→active / connect-return deep link). */
  pollNow(): void;
  /** Current secret-free snapshot. */
  getState(): ConnectSessionState;
  /** Subscribe to state changes. Returns an unsubscribe fn. */
  subscribe(listener: (state: ConnectSessionState) => void): () => void;
  /** Detach listeners + clear timers (tests / teardown). */
  dispose(): void;
}

// ── HTTP errors ─────────────────────────────────────────────────────────────

/** An HTTP failure from the connect-session endpoints (carries the status). */
export class ConnectSessionHttpError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = 'ConnectSessionHttpError';
  }
}

// ── Default seams ───────────────────────────────────────────────────────────

function defaultPlatform(): 'android' | 'ios' | 'web' {
  return Platform.OS === 'web' ? 'web' : (Platform.OS as 'android' | 'ios');
}

/** Best-effort human device name; falls back to "Soulbits <platform>". */
async function defaultDeviceName(): Promise<string> {
  const platform = defaultPlatform();
  try {
    const model = await DeviceInfo.getModel();
    if (model && model.trim().length > 0) {
      return model.trim();
    }
  } catch {
    // fall through to the platform label
  }
  return `Soulbits ${platform}`;
}

async function defaultCreate(
  fetchImpl: typeof fetch,
  req: { deviceId: string; platform: string; deviceName: string },
): Promise<ConnectSessionCreated> {
  const res = await fetchImpl(`${CLOUD_HOSTS.session}/v1/devices/connect-session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      device_id: req.deviceId,
      platform: req.platform,
      device_name: req.deviceName,
    }),
  });
  if (!res.ok) {
    throw new ConnectSessionHttpError(res.status, `create failed: HTTP ${res.status}`);
  }
  const d = (await res.json()) as {
    connect_id: string;
    session_secret: string;
    connect_url: string;
    expires_in: number;
  };
  return {
    connectId: d.connect_id,
    sessionSecret: d.session_secret,
    connectUrl: d.connect_url,
    expiresIn: d.expires_in,
  };
}

async function defaultPoll(
  fetchImpl: typeof fetch,
  connectId: string,
  sessionSecret: string,
): Promise<ConnectSessionPoll> {
  const res = await fetchImpl(
    `${CLOUD_HOSTS.session}/v1/devices/connect-session/${encodeURIComponent(connectId)}`,
    { headers: { Authorization: `Bearer ${sessionSecret}` } },
  );
  if (!res.ok) {
    throw new ConnectSessionHttpError(res.status, `poll failed: HTTP ${res.status}`);
  }
  const d = (await res.json()) as {
    status: ConnectSessionPoll['status'];
    token?: string;
    refresh_token?: string;
    expires_at?: string;
  };
  switch (d.status) {
    case 'approved':
      return {
        status: 'approved',
        token: d.token ?? '',
        refreshToken: d.refresh_token ?? '',
        expiresAt: d.expires_at ?? '',
      };
    case 'consumed':
      return { status: 'consumed' };
    case 'expired':
      return { status: 'expired' };
    default:
      return { status: 'pending' };
  }
}

// ── Controller ──────────────────────────────────────────────────────────────

export function createConnectSessionService(
  deps: ConnectSessionDeps = {},
): ConnectSessionController {
  const fetchImpl = deps.fetch ?? (globalThis.fetch as typeof fetch);
  const timers: TimerSource = deps.timers ?? {
    setInterval: (h, ms) => setInterval(h, ms),
    clearInterval: (h) => clearInterval(h),
  };
  const now = deps.now ?? (() => Date.now());
  const appStateSource: AppStateSource =
    deps.appState ?? (AppState as unknown as AppStateSource);
  const linkingSource: LinkingSource =
    deps.linking ?? (Linking as unknown as LinkingSource);
  const resolveDeviceId = deps.getDeviceId ?? getDeviceId;
  const resolvePlatform = deps.platform ?? defaultPlatform;
  const resolveDeviceName = deps.deviceName ?? defaultDeviceName;
  const redeem =
    deps.redeem ??
    ((tokens) =>
      AuthService.applyConnectSessionTokens({
        token: tokens.token,
        refresh_token: tokens.refreshToken,
        expires_at: tokens.expiresAt,
      }));
  const pollIntervalMs = deps.pollIntervalMs ?? 2500;
  const tickIntervalMs = deps.tickIntervalMs ?? 1000;

  let state: ConnectSessionState = {
    status: 'idle',
    connectUrl: null,
    remainingSeconds: 0,
    message: null,
  };

  // In-memory ONLY — never persisted, never logged.
  let connectId: string | null = null;
  let sessionSecret: string | null = null;
  let expiresAtMs = 0;
  let lastPollAtMs = 0;
  let polling = false;
  let tickHandle: any = null;
  let appStateSub: { remove(): void } | null = null;
  let linkingSub: { remove(): void } | null = null;
  const listeners = new Set<(s: ConnectSessionState) => void>();

  const publish = (next: ConnectSessionState) => {
    state = next;
    deps.onStateChange?.(state);
    for (const l of listeners) {
      try {
        l(state);
      } catch {
        // a listener must never break the poll loop
      }
    }
  };

  const remainingSeconds = (): number =>
    expiresAtMs > 0 ? Math.max(0, Math.ceil((expiresAtMs - now()) / 1000)) : 0;

  const pendingState = (): ConnectSessionState => ({
    status: 'pending',
    connectUrl: state.connectUrl,
    remainingSeconds: remainingSeconds(),
    message: null,
  });

  const stopPolling = () => {
    polling = false;
    if (tickHandle !== null) {
      timers.clearInterval(tickHandle);
      tickHandle = null;
    }
  };

  const finish = (
    status: ConnectSessionStatus,
    message: string | null = null,
  ) => {
    stopPolling();
    connectId = null;
    sessionSecret = null;
    expiresAtMs = 0;
    publish({ status, connectUrl: state.connectUrl, remainingSeconds: 0, message });
  };

  /** One poll attempt; transitions state on terminal outcomes. */
  const doPoll = async () => {
    if (!polling || state.status !== 'pending' || !connectId || !sessionSecret) {
      return;
    }
    lastPollAtMs = now();
    try {
      const result = await defaultPoll(fetchImpl, connectId, sessionSecret);
      if (!polling) return;
      switch (result.status) {
        case 'approved':
          try {
            await redeem({
              token: result.token,
              refreshToken: result.refreshToken,
              expiresAt: result.expiresAt,
            });
          } catch (e) {
            log.warn('Failed to redeem connect-session tokens:', e instanceof Error ? e.message : String(e));
            finish('errored', 'redeem_failed');
            return;
          }
          // Hand off to AuthService → `auth:changed`; stop polling.
          finish('approved');
          return;
        case 'consumed':
          finish('consumed');
          return;
        case 'expired':
          finish('expired');
          return;
        case 'pending':
        default:
          publish(pendingState());
          return;
      }
    } catch (e) {
      if (!polling) return;
      const status = e instanceof ConnectSessionHttpError ? e.status : 0;
      // 401/404 = the secret/connect_id is no longer valid — terminal.
      if (status === 401 || status === 404) {
        finish('errored', 'session_invalid');
        return;
      }
      // Transient (network / 5xx / 429) — keep polling until the TTL.
      log.warn('Transient connect-session poll error:', e instanceof Error ? e.message : String(e));
      publish(pendingState());
    }
  };

  /** 1 s tick: refresh the countdown; poll every `pollIntervalMs`. */
  const onTick = () => {
    if (state.status !== 'pending') return;
    if (expiresAtMs > 0 && now() >= expiresAtMs) {
      finish('expired');
      return;
    }
    publish(pendingState());
    if (now() - lastPollAtMs >= pollIntervalMs) {
      void doPoll();
    }
  };

  const pollNow = () => {
    if (state.status !== 'pending') return;
    void doPoll();
  };

  const attachListeners = () => {
    if (!appStateSub) {
      appStateSub = appStateSource.addEventListener('change', (next) => {
        // RN throttles timers in the background; returning to `active` fires an
        // immediate poll instead of waiting for the next tick.
        if (next === 'active') pollNow();
      });
    }
    if (!linkingSub) {
      linkingSub = linkingSource.addEventListener('url', ({ url }) => {
        if (parseConnectReturnDeepLink(url)) pollNow();
      });
    }
  };

  const detachListeners = () => {
    appStateSub?.remove();
    appStateSub = null;
    linkingSub?.remove();
    linkingSub = null;
  };

  const start = async (): Promise<{ connectUrl: string }> => {
    // A start always supersedes any prior session.
    stopPolling();
    connectId = null;
    sessionSecret = null;
    expiresAtMs = 0;
    publish({ status: 'starting', connectUrl: null, remainingSeconds: 0, message: null });
    attachListeners();

    const deviceId = await resolveDeviceId();
    let created: ConnectSessionCreated;
    try {
      created = await defaultCreate(fetchImpl, {
        deviceId,
        platform: resolvePlatform(),
        deviceName: await resolveDeviceName(),
      });
    } catch (e) {
      finish('errored', 'create_failed');
      throw e;
    }

    connectId = created.connectId;
    sessionSecret = created.sessionSecret;
    expiresAtMs = now() + Math.max(0, created.expiresIn) * 1000;
    lastPollAtMs = 0;
    polling = true;
    publish({
      status: 'pending',
      connectUrl: created.connectUrl,
      remainingSeconds: remainingSeconds(),
      message: null,
    });

    if (tickHandle === null) {
      tickHandle = timers.setInterval(onTick, tickIntervalMs);
    }
    // Fire an immediate first poll so an instant approval isn't delayed.
    void doPoll();

    return { connectUrl: created.connectUrl };
  };

  const cancel = () => {
    stopPolling();
    connectId = null;
    sessionSecret = null;
    expiresAtMs = 0;
    publish({ status: 'idle', connectUrl: null, remainingSeconds: 0, message: null });
  };

  return {
    start,
    cancel,
    pollNow,
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispose: () => {
      stopPolling();
      detachListeners();
      listeners.clear();
    },
  };
}

// ── App-wide singleton ──────────────────────────────────────────────────────

let singleton: ConnectSessionController | null = null;

/** The app-wide connect-session controller (created on first use). */
export function getConnectSessionService(): ConnectSessionController {
  if (!singleton) {
    singleton = createConnectSessionService();
  }
  return singleton;
}

/** Test-only: reset the singleton. */
export function resetConnectSessionServiceForTests(): void {
  singleton?.dispose();
  singleton = null;
}

export default getConnectSessionService;
