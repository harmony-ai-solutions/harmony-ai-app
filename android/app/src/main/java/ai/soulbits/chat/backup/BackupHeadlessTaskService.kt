package ai.soulbits.chat.backup

import android.content.Intent
import com.facebook.react.HeadlessJsTaskService
import com.facebook.react.bridge.Arguments
import com.facebook.react.jstasks.HeadlessJsTaskConfig

/**
 * BackupHeadlessTaskService — runs the JS headless task `SoulbitsBackupTask`
 * (registered in `src/services/backup/backupHeadlessTask.ts`). This is what
 * makes an automatic backup possible while the app is backgrounded: WorkManager
 * wakes the worker, the worker starts this service, and the JS task performs
 * the backup through the same orchestrator the UI uses.
 */
class BackupHeadlessTaskService : HeadlessJsTaskService() {
  override fun getTaskConfig(intent: Intent?): HeadlessJsTaskConfig {
    val data = Arguments.createMap()
    data.putString("trigger", intent?.getStringExtra(EXTRA_TRIGGER) ?: "unknown")
    return HeadlessJsTaskConfig(
      TASK_KEY,
      data,
      // Give the backup up to 5 minutes of background JS time.
      5 * 60 * 1000L,
      /* allowedInForeground = */ true,
    )
  }

  companion object {
    const val TASK_KEY = "SoulbitsBackupTask"
    const val EXTRA_TRIGGER = "trigger"
  }
}
