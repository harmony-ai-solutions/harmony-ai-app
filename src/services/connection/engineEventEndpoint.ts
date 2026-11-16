/**
 * engineEventEndpoint — ONE resolver for the engine event-server WebSocket URL
 * and its security mode, shared by every consumer that dials the eventserver
 * directly (chat entity sessions, the STT/TTS module-test sessions, …).
 *
 * ## Why one shared resolver (the three worlds)
 *
 * The app can reach the engine in three different deployment shapes, and each
 * one needs a different endpoint:
 *
 *  1. **CLOUD** — `connection_mode === 'cloud'`: the engine sits behind the
 *     hosted conduct proxy, so the dial target is the cloud worker WS and the
 *     mode is `'cloud'` (no loopback token, no pairing keys involved).
 *  2. **EMBEDDED** — the engine ships WITH the app (mobile sidecar /
 *     in-process facade; `isPaired: false`, NO persisted pairing keys).
 *     `EngineService` publishes the live loopback connection + its per-process
 *     token. Prefer the PLAIN loopback WS (`ws://` + `?token=`) — that keeps
 *     the self-signed-TLS native library off the hot path and satisfies the
 *     token check without the (producerless) `soulbits_jwt` — and fall back to
 *     `wss://` + `'insecure-ssl'` only when the sidecar advertises no plain WS
 *     port.
 *  3. **PAIRED self-hosted** (legacy / desktop pairing / E2E): the pairing
 *     persisted `soulbits_ws_url` / `soulbits_wss_url` /
 *     `soulbits_security_mode` in AsyncStorage.
 *
 * Copies of this resolution drifted before: the module-test service knew only
 * (1) and (3), so on a pure embedded install it threw "Not connected to
 * Soulbits Engine" while the engine was up and chat sessions were connected
 * (STT test panel, v0.4.53-dev). Keep this the single implementation — every
 * new consumer must delegate here rather than re-deriving the URL.
 *
 * The resolver is deliberately dependency-light: ConnectionStateManager (state
 * reader), EngineService (readiness snapshot), the loopback-token helper, and
 * the static cloud config. It opens no socket and imports no service that
 * imports it back.
 */

import ConnectionStateManager from '../ConnectionStateManager';
import { getEngineConnection } from '../engine/EngineService';
import { appendLoopbackToken } from '../websocket/loopbackToken';
import { CLOUD_HOSTS, WS_PATHS } from '../../config/cloud';

/** A resolved engine event-server endpoint: where to dial and how to secure it. */
export interface EngineEventEndpoint {
  /** WebSocket URL (already carrying the loopback `token` query param when embedded). */
  url: string;
  /** Connection security mode: 'cloud' | 'secure' | 'insecure-ssl' | 'unencrypted'. */
  mode: string;
}

/**
 * Thrown when no engine endpoint can be resolved (not cloud, no live embedded
 * engine, and no persisted pairing URL). The message is kept verbatim for the
 * existing UI copy/tests.
 */
export class EngineConnectionUnavailableError extends Error {
  constructor(message = 'Not connected to Soulbits Engine') {
    super(message);
    this.name = 'EngineConnectionUnavailableError';
  }
}

/**
 * Resolve the engine event-server URL + security mode for the CURRENT
 * deployment shape (cloud → embedded → paired, in that order).
 *
 * @throws {EngineConnectionUnavailableError} when none of the three worlds
 *   yields a URL.
 */
export async function resolveEngineEventEndpoint(): Promise<EngineEventEndpoint> {
  const source = await ConnectionStateManager.getCurrentSource();
  if (source === 'cloud') {
    return { url: `${CLOUD_HOSTS.conductProxyWs}${WS_PATHS.worker}`, mode: 'cloud' };
  }

  const engine = getEngineConnection();
  if (engine) {
    // Embedded engine: the engine itself is the peer. Plain loopback WS +
    // per-process loopback token first; WSS (+ insecure-ssl) only when the
    // sidecar advertises no plain WS port.
    if (engine.wsBaseUrl) {
      return {
        url: appendLoopbackToken(engine.wsBaseUrl, engine.token),
        mode: 'unencrypted',
      };
    }
    return {
      url: appendLoopbackToken(engine.wssBaseUrl, engine.token),
      mode: 'insecure-ssl',
    };
  }

  // Paired self-hosted (E2E / legacy): the URL + mode the pairing persisted.
  const mode = (await ConnectionStateManager.getSecurityMode()) || 'secure';
  const url =
    mode === 'unencrypted'
      ? (await ConnectionStateManager.getWSUrl()) ?? ''
      : (await ConnectionStateManager.getWSSUrl()) ?? '';
  if (!url) {
    throw new EngineConnectionUnavailableError('Not connected to Soulbits Engine');
  }
  return { url, mode };
}
