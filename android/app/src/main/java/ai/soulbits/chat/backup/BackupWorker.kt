package ai.soulbits.chat.backup

import android.content.Context
import android.content.Intent
import androidx.work.WorkerParameters
import com.facebook.react.HeadlessJsTaskService

/**
 * BackupWorker — the WorkManager worker for the periodic/one-off backup job
 * (plan 2-6 step 2).
 *
 * The engine owns snapshotting + upload; the app owns orchestration. The worker
 * therefore hands off to the React Native headless task `SoulbitsBackupTask`
 * ([BackupHeadlessTaskService]), which runs `BackupOrchestrator.backUpNow()`
 * against the loopback management API with the engine connection the app
 * already holds. The worker itself stays tiny and JS-agnostic.
 */
class BackupWorker(
  appContext: Context,
  params: WorkerParameters,
) : androidx.work.CoroutineWorker(appContext, params) {

  override suspend fun doWork(): Result {
    return try {
      val intent = Intent(applicationContext, BackupHeadlessTaskService::class.java)
      intent.putExtra(BackupHeadlessTaskService.EXTRA_TRIGGER, "workmanager")
      applicationContext.startService(intent)
      Result.success()
    } catch (t: Throwable) {
      // A headless-start failure must not wedge the periodic job; the next
      // window retries. Surface as retry so WorkManager backs off.
      Result.retry()
    }
  }
}
