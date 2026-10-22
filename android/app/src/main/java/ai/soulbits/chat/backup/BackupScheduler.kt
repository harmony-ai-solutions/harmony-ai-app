package ai.soulbits.chat.backup

import android.content.Context
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import com.facebook.react.bridge.ReadableMap
import java.util.concurrent.TimeUnit

/**
 * BackupScheduler — the WorkManager plumbing for the user-owned-storage backup
 * job (plan 2-6 step 2). The daily/weekly/monthly job runs [BackupWorker] under
 * the user's constraints (Wi-Fi-only + charging + idle by default); the manual
 * "back up now" path enqueues a one-off run.
 */
object BackupScheduler {
  const val PERIODIC_WORK_NAME = "soulbits-backup-periodic"
  const val ONE_OFF_WORK_NAME = "soulbits-backup-now"

  /** Map a cadence string to a repeat interval in hours (min WorkManager = 15m). */
  fun intervalHours(cadence: String?): Long = when (cadence) {
    "weekly" -> 24L * 7
    "monthly" -> 24L * 30
    else -> 24L // daily (and the safe default)
  }

  /** Build WorkManager constraints from the JS constraint map. */
  fun constraintsFrom(map: ReadableMap?): Constraints {
    val unmetered = map?.hasKey("requiresUnmeteredNetwork")?.let { map.getBoolean("requiresUnmeteredNetwork") } ?: true
    val charging = map?.hasKey("requiresCharging")?.let { map.getBoolean("requiresCharging") } ?: true
    val idle = map?.hasKey("requiresIdle")?.let { map.getBoolean("requiresIdle") } ?: true
    return Constraints.Builder()
      .setRequiredNetworkType(if (unmetered) NetworkType.UNMETERED else NetworkType.CONNECTED)
      .setRequiresCharging(charging)
      .setRequiresDeviceIdle(idle)
      .setRequiresBatteryNotLow(true)
      .build()
  }

  /** (Re)schedule the periodic job. REPLACE keeps exactly one job. */
  fun schedule(context: Context, cadence: String?, constraints: ReadableMap?) {
    val request = PeriodicWorkRequestBuilder<BackupWorker>(
      intervalHours(cadence), TimeUnit.HOURS,
    ).setConstraints(constraintsFrom(constraints)).build()

    WorkManager.getInstance(context).enqueueUniquePeriodicWork(
      PERIODIC_WORK_NAME,
      ExistingPeriodicWorkPolicy.UPDATE,
      request,
    )
  }

  /** Cancel the periodic job. */
  fun cancel(context: Context) {
    WorkManager.getInstance(context).cancelUniqueWork(PERIODIC_WORK_NAME)
  }

  /** Enqueue an immediate one-off backup (constraints relaxed to network-only). */
  fun runNow(context: Context) {
    val request = OneTimeWorkRequestBuilder<BackupWorker>().build()
    WorkManager.getInstance(context).enqueueUniqueWork(
      ONE_OFF_WORK_NAME,
      ExistingWorkPolicy.REPLACE,
      request,
    )
  }
}
