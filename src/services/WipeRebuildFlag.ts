/**
 * Wipe-Rebuild Flag — one-time boot-window database wipe (phase 3-2, D61).
 *
 * The app converges with the engine authoritatively (D11): after the engine's
 * id-pattern migration (000045) the app wipes its local database once and
 * re-syncs everything from the migrated engine. This module owns the GENERIC
 * persisted flag + boot sequence for that wipe:
 *
 *   set (persisted) ──► next boot: DatabaseContext.initializeDb checks the
 *                        flag FIRST (D61 boot window — strictly before any
 *                        sync trigger; no screen renders against a half-wiped
 *                        database) → wipe + D19 prefs sweep → clear flag.
 *
 * The flag flow is deliberately NOT single-purpose: phase 4-5 (D76 purge-floor
 * rebuild reaction) REUSES it set-only — on a stale-watermark rebuild signal
 * it sets the flag and restarts the process; the SAME boot-window wipe then
 * runs. That phase never touches the boot sequence, only `setWipeRebuildFlag`.
 *
 * The D58 rebuild gate ("Rebuilding from Soulbits Engine…") rides the existing
 * loading screen for the duration of the wipe via the `onStateChange` callback
 * (DatabaseContext feeds it into `isRebuilding`) and clears when the WIPE
 * completes — not when the first post-wipe pull finalizes (empty-DB rendering
 * during the on-connect pull is safe: `sync:data-applied` refreshes the lists).
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createLogger } from '../utils/logger';
import { closeSyncDatabase, wipeDatabaseCompletely } from '../database/connection';
import { SyncService } from './SyncService';
import ChatPreferencesService from './ChatPreferencesService';

const log = createLogger('[WipeRebuildFlag]');

// `@harmony_` prefix matches the app's reserved AsyncStorage key convention
// (cf. `@harmony_chat_reply_mode_`, `@harmony_sync_initial_upload_done`).
const WIPE_REBUILD_FLAG_KEY = '@harmony_wipe_rebuild_pending';

/**
 * In-memory "a wipe-rebuild completed in THIS process lifetime" marker (phase
 * 4-5 / D82 loop guard). Set when `runWipeRebuildIfPending` performs a
 * successful wipe (the boot window — D61), read by SyncService's
 * `rebuild_required` handler.
 *
 * Deliberately NOT persisted: the flag-clears-at-boot semantics mean a fresh
 * process seeing the signal again is the legitimate first occurrence (the
 * rebooted app's flag read + wipe is the rebuild); a re-flag in the SAME
 * process lifetime is the restart-loop case the guard exists to catch.
 */
let rebuildCompletedInProcess = false;

/**
 * Check whether a one-time wipe-and-rebuild is pending.
 * Returns false when the flag is unset or storage read fails (best-effort —
 * a storage failure must never wedge the boot).
 */
export async function getWipeRebuildFlag(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(WIPE_REBUILD_FLAG_KEY)) === 'true';
  } catch (error) {
    log.error('Failed to read wipe-rebuild flag:', error);
    return false;
  }
}

/**
 * Persist the one-time wipe-and-rebuild flag.
 *
 * Reused by phase 4-5 (D76): the engine's purge-floor rebuild signal sets the
 * flag, then the process restarts; the boot window performs the wipe.
 * Crash-safety is the caller's concern (the flag must be persisted BEFORE the
 * restart call — D82).
 */
export async function setWipeRebuildFlag(): Promise<void> {
  await AsyncStorage.setItem(WIPE_REBUILD_FLAG_KEY, 'true');
  log.warn('Wipe-rebuild flag set — next boot will wipe and rebuild');
}

/**
 * Clear the wipe-rebuild flag. Called after a successful boot wipe; the flag
 * deliberately SURVIVES a failed wipe so the next boot retries.
 */
export async function clearWipeRebuildFlag(): Promise<void> {
  await AsyncStorage.removeItem(WIPE_REBUILD_FLAG_KEY);
  log.info('Wipe-rebuild flag cleared');
}

/**
 * Whether a wipe-rebuild completed in THIS process lifetime (phase 4-5 / D82
 * loop guard). True once the boot window performed a successful wipe; a fresh
 * process always starts false.
 */
export function hasRebuildCompletedInProcess(): boolean {
  return rebuildCompletedInProcess;
}

/**
 * Test-only reset of the in-process rebuild-completed marker. Module state
 * persists across tests within a file; call in `beforeEach`.
 */
export function _resetRebuildCompletedInProcessForTests(): void {
  rebuildCompletedInProcess = false;
}

/**
 * Boot-window wipe sequence (D61): read the flag and, if set, run the full
 * wipe + D19 preference sweep, then clear the flag.
 *
 * Returns true when a wipe was performed, false when no flag was pending.
 *
 * Belt-and-braces (kept per plan review 4 — review-4 addenda shrink at boot,
 * where the lazy `syncDb` handle is not yet open and no SyncService in-memory
 * state exists yet):
 *   - close the lazy `syncDb` handle first (connection.ts:406-433),
 *   - reset SyncService in-memory state via `abortSync` (a no-op when no
 *     session is in flight — SyncService.ts:737-744).
 *
 * The production wipe is `wipeDatabaseCompletely` — NEVER the test-only
 * `clearDatabaseData` (which drops `schema_migrations` and re-runs all
 * migrations on the empty DB instead of deleting the file). Wiping also
 * clears the per-source sync watermarks (`clearAllLastSyncTimestamps` inside
 * the wipe helper), which is what escalates the first post-wipe sync to
 * `force_full_sync: true` (SyncService.ts:505-517).
 *
 * The `@harmony_sync_initial_upload_done:{source}` flag is deliberately NOT
 * cleared by either wipe helper — it never gates pulls (it only shapes upload
 * `since`-values, which `forceFullSync` zeroes anyway; an empty DB uploads
 * zero SYNC_DATA events regardless), so its post-wipe inconsistency is
 * harmless.
 */
export async function runWipeRebuildIfPending(
  onStateChange?: (rebuilding: boolean) => void,
): Promise<boolean> {
  if (!(await getWipeRebuildFlag())) {
    return false;
  }

  onStateChange?.(true);
  try {
    // Belt-and-braces: the lazy `syncDb` handle is not yet open at boot, but
    // close it anyway so a stale connection can never survive the file wipe.
    await closeSyncDatabase();

    // Belt-and-braces: no SyncService session exists at boot; abortSync is a
    // no-op then, and a no-op costs nothing.
    SyncService.getInstance().abortSync('wipe rebuild');

    // Production wipe — closes the main connection, clears the per-source sync
    // watermarks, deletes the database file, and re-initializes (fresh
    // migrations run inside the helper).
    await wipeDatabaseCompletely();

    // D19: one-time reset of the id-keyed AsyncStorage preferences.
    await ChatPreferencesService.sweepWipePreferences();

    // Clear the flag ONLY after the wipe + sweep succeeded — a failed wipe
    // leaves it set so the next boot retries.
    await clearWipeRebuildFlag();

    // 4-5 / D82 loop guard: record that the rebuild completed in this process
    // lifetime. A later `rebuild_required` signal in the SAME process is the
    // (defensive, D76-unreachable) restart-loop case — SyncService consults
    // `hasRebuildCompletedInProcess()` before restarting.
    rebuildCompletedInProcess = true;

    log.info('Wipe-rebuild completed — database re-initialized, prefs swept, flag cleared');
    return true;
  } finally {
    onStateChange?.(false);
  }
}