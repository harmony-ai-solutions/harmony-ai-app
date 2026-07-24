import {SyncService} from '../../../src/services/SyncService';

/**
 * Drive a full sync to completion and wait for the result.
 *
 * Returns a Promise that resolves when the `sync:completed` event fires,
 * or rejects on `sync:error` or `initiateSync` failure.
 *
 * @param syncService  The SyncService instance to drive.
 * @param timeoutMs    Max wall-clock time to wait (default 10s).
 */
export async function runFullSync(
  syncService: SyncService,
  timeoutMs: number = 10_000,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Sync did not complete within ${timeoutMs}ms`));
    }, timeoutMs);

    const onCompleted = () => {
      clearTimeout(timeout);
      syncService.removeListener('sync:completed', onCompleted);
      syncService.removeListener('sync:error', onError);
      resolve();
    };

    const onError = (err: string) => {
      clearTimeout(timeout);
      syncService.removeListener('sync:completed', onCompleted);
      syncService.removeListener('sync:error', onError);
      reject(new Error(err));
    };

    syncService.on('sync:completed', onCompleted);
    syncService.on('sync:error', onError);

    syncService.initiateSync().catch((sendErr: unknown) => {
      clearTimeout(timeout);
      syncService.removeListener('sync:completed', onCompleted);
      syncService.removeListener('sync:error', onError);
      reject(sendErr);
    });
  });
}
