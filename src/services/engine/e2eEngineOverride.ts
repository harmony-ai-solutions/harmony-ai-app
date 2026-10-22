/**
 * e2eEngineOverride — E2E-only engine-pairing override (plan 7-13).
 *
 * Since the TS sync/remote stack was deleted (3-4) and the dead
 * `HARMONY_LINK_WS(S)_URL` chain removed (7-9), the app has no *remote* engine
 * connect path: the embedded engine (sidecar / in-process facade) is the single
 * peer, and it pairs with a desktop/authority engine through the changeset-v1
 * sync-client LAN transport + the shared device-approval handshake
 * (`HANDSHAKE_REQUEST` → register PENDING → desktop approves → JWT → sync).
 *
 * The Docker E2E stack runs that same flow against the container
 * `soulbits-engine` — but only if the app's embedded engine is told to dial it.
 * The E2E build therefore injects the container engine's LAN endpoints at BUILD
 * TIME:
 *
 *   gradle -PE2E_DEBUG_SIGNING=true \
 *          -PE2E_ENGINE_PEER_WS_URL=10.0.2.2:28080 \
 *          -PE2E_ENGINE_PEER_WSS_URL=10.0.2.2:28443
 *
 * → `buildConfigField "String"` (declared only for E2E builds, see
 * `android/app/build.gradle`) → react-native-config reflects the app's whole
 * BuildConfig class → `Config.E2E_ENGINE_PEER_WS_URL` / `..._WSS_URL`.
 *
 * When (and only when) those values are present, {@link attachE2EEngineOverride}
 * arms on engine readiness and configures the embedded engine's sync client to
 * dial the container engine (`PUT /api/sync/client`, LAN transport). The
 * container engine then registers this device PENDING and the harness approves
 * it via `e2e/approve-pending-devices.sh` — the SAME real auth path a shipped
 * app uses. There is NO auth shortcut here: the override supplies only the peer
 * address; the device-approval handshake, JWT issuance and sync all run
 * unchanged engine-side (and are refused by the engine until the device is
 * approved).
 *
 * Normal dev/prod builds never declare the BuildConfig fields, so
 * `Config.E2E_ENGINE_PEER_*` is `undefined` and this module is inert (a no-op
 * with no subscription).
 */

import Config from 'react-native-config';
import { createLogger } from '../../utils/logger';
import { engineApiClient } from './EngineApiClient';
import { getEngineConnection, onEngineConnectionChange } from './EngineService';

const log = createLogger('[E2EEngineOverride]');

/** The injected engine-peer target, or null when this is not an E2E build. */
export interface E2EEnginePeerTarget {
  /** Plaintext WS endpoint (host:port) — the container engine's eventserver. */
  peerAddress: string;
  /** WSS endpoint (host:port) — used because the E2E engine serves a self-signed cert. */
  peerWssAddress: string;
}

/**
 * Read the build-time-injected peer target. Returns null (→ override disabled)
 * unless at least the plaintext WS endpoint is present, since the engine's
 * sync-client config requires `peer_address` when `enabled`.
 */
export function readE2EEnginePeerTarget(): E2EEnginePeerTarget | null {
  const ws = (Config as { E2E_ENGINE_PEER_WS_URL?: string })?.E2E_ENGINE_PEER_WS_URL;
  const wss = (Config as { E2E_ENGINE_PEER_WSS_URL?: string })?.E2E_ENGINE_PEER_WSS_URL;
  const peerAddress = typeof ws === 'string' ? ws.trim() : '';
  if (!peerAddress) return null;
  const peerWssAddress = typeof wss === 'string' ? wss.trim() : '';
  return { peerAddress, peerWssAddress };
}

/** True when this build carries an E2E engine-peer override. */
export function hasE2EEngineOverride(): boolean {
  return readE2EEnginePeerTarget() !== null;
}

/**
 * Configure the embedded engine's sync client to dial the injected peer: LAN
 * transport, `insecure-ssl` (the E2E engine's cert is self-signed). Best-effort
 * — returns false (no throw) when the override is absent or the engine is not
 * ready yet; the caller re-arms on the next readiness event.
 */
export async function applyE2EEngineOverride(): Promise<boolean> {
  const target = readE2EEnginePeerTarget();
  if (!target) return false;
  if (!getEngineConnection()) return false; // engine not ready — retried on readiness
  try {
    await engineApiClient.updateSyncClientConfig({
      transport: 'lan',
      enabled: true,
      security_mode: 'insecure-ssl',
      peer_address: target.peerAddress,
      ...(target.peerWssAddress ? { peer_wss_address: target.peerWssAddress } : {}),
    });
    log.info(
      `E2E engine override applied (peer ws=${target.peerAddress}, wss=${
        target.peerWssAddress || '-'
      })`,
    );
    return true;
  } catch (e) {
    log.warn(
      'E2E engine override failed (non-fatal):',
      e instanceof Error ? e.message : String(e),
    );
    return false;
  }
}

let unsubscribe: (() => void) | null = null;
let applying = false;

/** Serialize applies so a burst of readiness events cannot race the PUT. */
async function maybeApply(): Promise<boolean> {
  if (applying) return false;
  applying = true;
  try {
    return await applyE2EEngineOverride();
  } finally {
    applying = false;
  }
}

/**
 * Arm the E2E engine-peer override. A no-op (no subscription) unless the build
 * injected a peer target. Applies now if the engine is already ready, and again
 * whenever a fresh engine connection appears (engine restart). Idempotent.
 * Returns an unsubscribe function.
 */
export function attachE2EEngineOverride(): () => void {
  if (!hasE2EEngineOverride()) return () => {};
  if (unsubscribe) return unsubscribe;
  if (getEngineConnection()) void maybeApply();
  unsubscribe = onEngineConnectionChange(conn => {
    if (conn) void maybeApply();
  });
  return unsubscribe;
}

/** Test-only: reset module state. */
export function resetE2EEngineOverrideForTests(): void {
  unsubscribe?.();
  unsubscribe = null;
  applying = false;
}
