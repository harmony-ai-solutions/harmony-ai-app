package ai.soulbits.chat.engine

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import ai.soulbits.chat.MainActivity
import java.io.File

/**
 * EngineSidecarService — a typed foreground service that keeps the engine
 * sidecar process alive while the app session is active.
 *
 * Foreground-service policy (per the plan): the service runs while any entity
 * session is open or a chat screen is focused, and stops when the app goes
 * idle — battery honesty, no 24/7 keep-alive attempt. The lifecycle state is
 * lazy (0-1) and converges on the next start.
 *
 * The service is the durable owner of the [EngineSidecarController]: the RN
 * module starts it (with the DB key + options as intent extras) and the
 * controller starts the process. Stopping the service stops the process
 * (SIGTERM → WAL checkpoint).
 */
class EngineSidecarService : Service() {

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    // Every startForegroundService() delivery obligates startForeground()
    // within the system timeout — call it first, unconditionally.
    startForegroundCompat()

    when (intent?.action) {
      ACTION_STOP -> {
        EngineSidecarController.stop()
        stopSelf()
        return START_NOT_STICKY
      }
      else -> {
        val options = optionsFromIntent(intent)
        val started = EngineSidecarController.start(applicationContext, options)
        if (!started) {
          // No sidecar binary for this device — nothing to keep alive.
          stopSelf()
        }
        return START_NOT_STICKY
      }
    }
  }

  override fun onDestroy() {
    EngineSidecarController.stop()
    super.onDestroy()
  }

  // ── Notification ───────────────────────────────────────────────────────

  private fun startForegroundCompat() {
    createChannel()
    val notification = buildNotification()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
      // API 34+: declare the foreground-service type explicitly (must match
      // the manifest's android:foregroundServiceType="dataSync").
      startForeground(
        NOTIFICATION_ID,
        notification,
        ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC,
      )
    } else {
      startForeground(NOTIFICATION_ID, notification)
    }
  }

  private fun createChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    val channel = NotificationChannel(
      CHANNEL_ID,
      "Soulbits engine",
      NotificationManager.IMPORTANCE_LOW,
    ).apply {
      description = "Keeps the local Soulbits engine running while you chat"
      setShowBadge(false)
    }
    manager.createNotificationChannel(channel)
  }

  private fun buildNotification(): Notification {
    val openIntent = Intent(this, MainActivity::class.java).apply {
      addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
      action = Intent.ACTION_MAIN
    }
    val pendingIntent = PendingIntent.getActivity(
      this,
      0,
      openIntent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
    // The (context, channelId) builder is API 26+; minSdk is 24, so fall back
    // to the deprecated constructor on 24–25 (channel creation is also guarded).
    val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      Notification.Builder(this, CHANNEL_ID)
    } else {
      @Suppress("DEPRECATION")
      Notification.Builder(this)
    }
    return builder
      .setContentTitle("Soulbits engine running")
      .setContentText("Your local engine is active")
      .setSmallIcon(android.R.drawable.stat_notify_sync)
      .setContentIntent(pendingIntent)
      .setOngoing(true)
      .build()
  }

  // ── Options ────────────────────────────────────────────────────────────

  private fun optionsFromIntent(intent: Intent?): EngineProcessManager.StartOptions {
    val defaultDataDir = File(filesDir, "engine").absolutePath
    return EngineProcessManager.StartOptions(
      dataDir = intent?.getStringExtra(EXTRA_DATA_DIR)?.takeIf { it.isNotEmpty() } ?: defaultDataDir,
      dbKey = intent?.getStringExtra(EXTRA_DB_KEY),
      logLevel = intent?.getStringExtra(EXTRA_LOG_LEVEL)?.takeIf { it.isNotEmpty() } ?: "info",
      maxRestarts = intent?.getIntExtra(EXTRA_MAX_RESTARTS, DEFAULT_MAX_RESTARTS)
        ?: DEFAULT_MAX_RESTARTS,
    )
  }

  companion object {
    const val ACTION_START = "ai.soulbits.chat.engine.START"
    const val ACTION_STOP = "ai.soulbits.chat.engine.STOP"

    const val EXTRA_DB_KEY = "dbKey"
    const val EXTRA_DATA_DIR = "dataDir"
    const val EXTRA_LOG_LEVEL = "logLevel"
    const val EXTRA_MAX_RESTARTS = "maxRestarts"

    private const val CHANNEL_ID = "soulbits_engine"
    private const val NOTIFICATION_ID = 4281
    private const val DEFAULT_MAX_RESTARTS = 3
  }
}
