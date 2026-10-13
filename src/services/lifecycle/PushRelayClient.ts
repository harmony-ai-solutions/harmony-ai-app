/**
 * PushRelayClient — the device-initiated visible-push relay (task 4-3, step 4;
 * consumes the 4-4 relay endpoint).
 *
 * The DEVICE decides what deserves a notification (outreach delivery,
 * dream-worthy moments); outreach eligibility decay (D-PUSH-04) is evaluated
 * on-device by the engine, which owns last-user-message + prior-outreach data.
 * The relay (`POST /v1/lifecycle/notify`, task 4-4) only enforces a coarse
 * per-user abuse cap and forwards an OPAQUE payload (≤4 KB APNs limit) plus an
 * optional pre-rendered alert to the caller's device(s) over FCM/APNs.
 *
 * This client is the app half of that contract:
 *   - user-PASETO authenticated (`Authorization: Bearer <paseto>`);
 *   - body `{target_device_id?, payload?, alert?{title,body}}` — exactly the
 *     4-4 `relayRequest` shape;
 *   - response `{delivered: number}`.
 *
 * The endpoint is served by the cloud push-service on its existing HTTP port;
 * in cloud mode the ALB routes `/v1/lifecycle/*` there (see the 4-4 report), so
 * the base URL is the shared cloud host ({@link CLOUD_HOSTS}.session, which in
 * cloud mode equals the auth host).
 *
 * Transport is injectable so the wake/maintenance orchestrators are unit-tested
 * without a network.
 */

import { CLOUD_HOSTS } from '../../config/cloud';
import { createLogger } from '../../utils/logger';

const log = createLogger('[PushRelay]');

/** The APNs payload ceiling the 4-4 relay enforces (bytes). */
export const RELAY_MAX_PAYLOAD_BYTES = 4096;

/** The relay path (served by the cloud push-service; ALB-routed). */
export const RELAY_PATH = '/v1/lifecycle/notify';

/** A pre-rendered banner (v1 default plain-text path). */
export interface RelayAlert {
  title?: string;
  body: string;
}

/** A relay request. At least one of `payload` / `alert` must be present. */
export interface RelayNotifyRequest {
  /** Opaque device-authored body (e.g. ciphertext for an on-device NSE). */
  payload?: string;
  /** Optional pre-rendered banner text. */
  alert?: RelayAlert;
  /** One of the caller's devices; omitted → every authorized device. */
  targetDeviceId?: string;
}

/** The relay response. */
export interface RelayNotifyResult {
  delivered: number;
}

/** A relay failure with the backend's status/code for callers to branch on. */
export class PushRelayError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly code?: string,
  ) {
    super(message);
    this.name = 'PushRelayError';
  }
}

export interface PushRelayDeps {
  /** Cloud host base URL. Defaults to {@link CLOUD_HOSTS}.session. */
  baseUrl?: string;
  /** Returns the current cloud PASETO, or null when signed out. */
  getToken: () => Promise<string | null>;
  /** Transport (tests inject a fake). Defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
}

export class PushRelayClient {
  private readonly baseUrl: string;
  private readonly getToken: () => Promise<string | null>;
  private readonly fetchImpl: typeof fetch;

  constructor(deps: PushRelayDeps) {
    this.baseUrl = (deps.baseUrl ?? CLOUD_HOSTS.session).replace(/\/+$/, '');
    this.getToken = deps.getToken;
    this.fetchImpl = deps.fetchImpl ?? (globalThis.fetch as typeof fetch);
  }

  /**
   * Post one relay request. Resolves `{delivered}` on 200. Throws
   * {@link PushRelayError} for a signed-out caller (no token), an oversized
   * payload, a rate-limit (429), or any non-2xx/transport failure.
   */
  async notify(req: RelayNotifyRequest): Promise<RelayNotifyResult> {
    if (!req.payload && !req.alert) {
      throw new PushRelayError('relay: nothing to deliver (payload and alert both empty)');
    }
    if (req.payload && byteLength(req.payload) > RELAY_MAX_PAYLOAD_BYTES) {
      throw new PushRelayError(
        `relay: payload exceeds ${RELAY_MAX_PAYLOAD_BYTES} bytes`,
        undefined,
        'payload_too_large',
      );
    }

    let paseto: string | null = null;
    try {
      paseto = await this.getToken();
    } catch {
      paseto = null;
    }
    if (!paseto) {
      throw new PushRelayError('relay: no cloud token (signed out)', undefined, 'unauthorized');
    }

    const body: Record<string, unknown> = {};
    if (req.targetDeviceId) body.target_device_id = req.targetDeviceId;
    if (req.payload) body.payload = req.payload;
    if (req.alert) body.alert = { title: req.alert.title ?? '', body: req.alert.body };

    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}${RELAY_PATH}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${paseto}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
    } catch (e) {
      throw new PushRelayError(
        `relay: network error (${e instanceof Error ? e.message : String(e)})`,
        undefined,
        'network',
      );
    }

    if (!res.ok) {
      const code = await readErrorCode(res);
      if (res.status === 429) {
        throw new PushRelayError('relay: rate limited', 429, code ?? 'rate_limited');
      }
      if (res.status === 413) {
        throw new PushRelayError('relay: payload too large', 413, code ?? 'payload_too_large');
      }
      throw new PushRelayError(`relay: HTTP ${res.status}`, res.status, code);
    }

    let delivered = 0;
    try {
      const json = (await res.json()) as { delivered?: unknown };
      delivered = typeof json?.delivered === 'number' ? json.delivered : 0;
    } catch {
      delivered = 0;
    }
    return { delivered };
  }
}

/** UTF-8 byte length of a string (APNs payloads are byte-bounded). */
function byteLength(value: string): number {
  // RN's Hermes has no TextEncoder; count UTF-8 bytes by hand (no Buffer dep).
  let bytes = 0;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      // Surrogate pair → 4 bytes; skip the low surrogate.
      bytes += 4;
      i += 1;
    } else bytes += 3;
  }
  return bytes;
}

/** Best-effort extraction of the backend's `{error: code}` body. */
async function readErrorCode(res: Response): Promise<string | undefined> {
  try {
    const json = (await res.json()) as { error?: unknown };
    return typeof json?.error === 'string' ? json.error : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The shared relay client (production transport: the global `fetch` + the
 * app's AuthService token). Imported lazily to avoid a cycle with AuthService.
 */
export function createDefaultPushRelayClient(): PushRelayClient {
  return new PushRelayClient({
    getToken: async () => {
      try {
        const AuthService = require('../auth/AuthService').default;
        const token = await AuthService.getToken();
        return token || null;
      } catch {
        return null;
      }
    },
  });
}

/** Log a relay failure without throwing (best-effort outreach delivery). */
export function logRelayFailure(e: unknown): void {
  if (e instanceof PushRelayError) {
    log.warn(`relay failed (${e.code ?? e.status ?? 'error'}): ${e.message}`);
  } else {
    log.warn('relay failed:', e instanceof Error ? e.message : String(e));
  }
}
