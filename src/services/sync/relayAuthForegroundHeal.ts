/**
 * RelayAuthSelfHeal — the app-wide foreground self-heal for the relay token
 * (2026-10-23 production incident).
 *
 * The engine's relay token is the account PASETO (≤1h). It expires overnight,
 * so the FIRST foreground after that surfaces `auth_needed`. Before this
 * module the honest recovery only ran while the Desktop Sync screen was open,
 * so a user who never opened it kept a dead sync transport (the engine paused
 * its own reconnect loop truthfully, and nothing re-injected a credential).
 *
 * This module closes that gap with the least intrusive possible surface:
 *
 *   - ONE look per AppState → `active` transition (no timers, no polling);
 *   - the engine must be running (`getEngineConnection()`), otherwise there is
 *     nothing to heal;
 *   - one status read; if the engine does not need auth, nothing happens;
 *   - otherwise the shared, verify-before-PUT recovery
 *     ({@link recoverRelayAuth}) runs silently — no banner, no toast, no modal;
 *   - failures are swallowed into honest logs. The non-intrusive surfaces that
 *     remain (the Desktop Sync banner pattern + the Settings chip) are the
 *     screen's job, not this module's.
 *
 * The engine is NEVER stopped or restarted here, and nothing outside the sync
 * client config is touched: entities and providers are unaffected by cloud auth.
 */

import { AppState } from 'react-native';
import type { AppStateStatus } from 'react-native';
import { engineApiClient } from '../engine/EngineApiClient';
import type { SyncClientStatusDto } from '../engine/EngineApiClient';
import { getEngineConnection } from '../engine/EngineService';
import {
  needsRelayAuth,
  recoverRelayAuth,
  type RelayAuthRecoveryOutcome,
} from './relayAuthRecovery';
import { createLogger } from '../../utils/logger';

const log = createLogger('[RelayAuthSelfHeal]');

/** The AppState surface the foreground heal needs (injectable for tests). */
export interface RelayAuthAppStateSource {
  currentState: AppStateStatus;
  addEventListener(type: 'change', handler: (state: AppStateStatus) => void): { remove(): void };
}

export interface RelayAuthSelfHealDeps {
  /** AppState source (defaults to RN `AppState`). */
  appState?: RelayAuthAppStateSource;
  /** The engine status read (defaults to the shared engine client). */
  getStatus?: () => Promise<SyncClientStatusDto>;
  /** The engine-running probe (defaults to the live engine connection). */
  isEngineRunning?: () => boolean;
  /** The verified recovery (defaults to the shared service). */
  recover?: () => Promise<RelayAuthRecoveryOutcome>;
}

/** Singleton guard — the process keeps one listener for its lifetime. */
let attached = false;

/**
 * One foreground pass (exported so the trigger can be tested without a real
 * AppState). Resolves when the pass is done; never throws.
 */
export async function runRelayAuthForegroundPass(
  deps: RelayAuthSelfHealDeps = {},
): Promise<void> {
  const isEngineRunning = deps.isEngineRunning ?? (() => getEngineConnection() !== null);
  if (!isEngineRunning()) {
    log.debug('foreground self-heal skipped: engine not running');
    return;
  }

  const getStatus =
    deps.getStatus ?? (() => engineApiClient.getSyncClientStatus());

  let status: SyncClientStatusDto;
  try {
    status = await getStatus();
  } catch (e: any) {
    // Engine went away between the probe and the read (or the read failed):
    // nothing to heal, and this must never surface to the user.
    log.warn('foreground self-heal skipped: status read failed:', e?.message ?? String(e));
    return;
  }

  if (!needsRelayAuth(status)) return;

  const recover = deps.recover ?? (() => recoverRelayAuth());
  let outcome: RelayAuthRecoveryOutcome;
  try {
    outcome = await recover();
  } catch (e: any) {
    // The recovery itself is total (it returns outcomes, it does not throw);
    // this is belt and braces so a foreground pass can never crash the app.
    log.warn('foreground self-heal failed:', e?.message ?? String(e));
    return;
  }

  if (outcome === 'recovered') {
    log.info('relay auth self-healed on foreground');
  } else {
    // Honest, quiet: the screen's banner/chip are the user-facing surfaces.
    log.warn(`foreground self-heal could not recover the relay token (${outcome})`);
  }
}

/**
 * Attach the foreground self-heal (idempotent; boot code calls this once —
 * see `DatabaseContext`, next to `attachUpdateForegroundChecks`). Mirrors the
 * singleton-guard pattern of the other app-wide attach helpers.
 *
 * Re-entrancy: a second `active` transition that arrives while a pass is still
 * running is ignored — one pass per foreground transition at most.
 */
export function attachRelayAuthSelfHeal(deps: RelayAuthSelfHealDeps = {}): void {
  if (attached) return;
  attached = true;

  const appState = deps.appState ?? (AppState as unknown as RelayAuthAppStateSource);
  let passInFlight = false;

  appState.addEventListener('change', next => {
    if (next !== 'active') return;
    if (passInFlight) return;
    passInFlight = true;
    void runRelayAuthForegroundPass(deps)
      .catch((e: any) => {
        log.warn('foreground self-heal crashed:', e?.message ?? String(e));
      })
      .finally(() => {
        passInFlight = false;
      });
  });
}

/** Test-only: forget that the listener was attached (allows re-attach). */
export function detachRelayAuthSelfHealForTests(): void {
  attached = false;
}
