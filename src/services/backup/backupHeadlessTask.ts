/**
 * backupHeadlessTask — registers the `SoulbitsBackupTask` headless JS task
 * (plan 2-6). WorkManager wakes BackupWorker while the app is backgrounded, the
 * worker starts BackupHeadlessTaskService, and this task runs an automatic
 * backup through the shared orchestrator.
 *
 * Imported from index.js so the task is registered in the app's JS runtime.
 */

import { AppRegistry } from 'react-native';
import { createLogger } from '../../utils/logger';
import { backupOrchestrator } from './BackupOrchestrator';

const log = createLogger('[BackupHeadlessTask]');

/** The headless task key (must match BackupHeadlessTaskService.TASK_KEY). */
export const BACKUP_HEADLESS_TASK = 'SoulbitsBackupTask';

/** The headless task body (exported for tests). */
export async function runBackupHeadlessTask(data: { trigger?: string } = {}): Promise<void> {
  try {
    const settings = await backupOrchestrator.getSettings();
    if (!settings.enabled || settings.cadence === 'off') {
      log.info('headless backup skipped: disabled');
      return;
    }
    const res = await backupOrchestrator.backUpNow();
    log.info(`headless backup ${res.skipped ? 'skipped' : 'done'} (${res.totalBytes} bytes)`);
  } catch (e) {
    log.warn('headless backup failed:', e);
    await backupOrchestrator.updateSettings({ lastError: (e as Error)?.message ?? String(e) });
  }
}

/** Register the headless task (idempotent). */
export function registerBackupHeadlessTask(): void {
  AppRegistry.registerHeadlessTask(BACKUP_HEADLESS_TASK, () => runBackupHeadlessTask);
}
