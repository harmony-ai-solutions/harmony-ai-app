import {SyncService} from '../../../src/services/SyncService';

/**
 * Reset the SyncService singleton so the next call to `getInstance()` creates
 * a fresh instance. This is necessary between tests to ensure clean state.
 *
 * Uses `(SyncService as any).instance = null` because SyncService has a
 * private static `instance` property with no public reset method.
 */
export function resetSyncServiceSingleton(): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (SyncService as any).instance = null;
}
