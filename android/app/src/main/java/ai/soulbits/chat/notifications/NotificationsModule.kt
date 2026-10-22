package ai.soulbits.chat.notifications

import android.Manifest
import android.annotation.SuppressLint
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.module.annotations.ReactModule
import com.facebook.react.modules.core.PermissionAwareActivity
import com.facebook.react.modules.core.PermissionListener

/**
 * NotificationsModule — Android local-notification surface for outreach events
 * (plan 7-12 §4b).
 *
 * The app's events-WS outreach client (`OutreachNotificationService`) posts a
 * local notification when an outreach/greeting event arrives while the app is
 * backgrounded and the process is alive. This module owns the "outreach/
 * messages" channel and the posting call. `messageId` is the notification
 * `tag`, so a re-post for the same message REPLACES the prior notification
 * (dedupe-by-replace); `entityId` is the notification group.
 *
 * NO Firebase anything (that is plan 7-12 step 7, a later change): this is a
 * plain `NotificationManagerCompat` post. JS wrapper:
 * `src/services/notifications/LocalNotifications.ts`.
 *
 * ## Permission surface
 *
 * On Android 13+ (API 33, `TIRAMISU`) notifications are a **runtime** grant:
 * without `POST_NOTIFICATIONS` nothing is visible — neither `postLocalNotification`
 * here, nor an FCM push the OS would auto-display (plan 7-12 §3). This module
 * therefore also mirrors the iOS module's permission API verbatim so the JS
 * wrapper (`src/services/notifications/NotificationPermission.ts`) is
 * platform-agnostic:
 *
 *      requestAuthorization()    -> Promise<string>   // authorized|denied|notDetermined
 *      getAuthorizationStatus()  -> Promise<string>
 *
 * Below API 33 the grant is implicit (no runtime permission exists), so both
 * resolve `authorized`. On API 33+ the request goes through the host Activity;
 * the status is the binary grant/deny mapped onto the JS union (Android has no
 * `provisional`/`ephemeral`/true `notDetermined` equivalent — a never-prompted
 * grant reads as `denied` unless notifications are globally enabled).
 * `POST_NOTIFICATIONS` is declared in `AndroidManifest.xml`.
 *
 * Legacy `ReactContextBaseJavaModule` (same pattern as BackupModule /
 * EngineSidebarModule). `getName()` returns the SAME module name the iOS
 * module uses (`SoulbitsNotifications`) so the JS wrapper is platform-agnostic.
 */
@ReactModule(name = NotificationsModule.NAME)
class NotificationsModule(private val reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = NAME

  // ── availability ──────────────────────────────────────────────────────

  @ReactMethod
  fun isAvailable(promise: Promise) = promise.resolve(true)

  // ── permission (Android notification parity — plan 7-12 step 4 addendum) ─

  /**
   * Request the `POST_NOTIFICATIONS` runtime grant (API 33+). Mirrors the iOS
   * `requestAuthorization` so the JS wrapper can call the same method on both
   * platforms.
   *
   * Below API 33 the permission is implicit — resolves `authorized`. On API 33+
   * the prompt is shown via the host Activity (the RN `PermissionAwareActivity`
   * path, the same mechanism RN's own `PermissionsAndroid` uses — it requests
   * against the current Activity and wires the result callback). When there is
   * no foreground Activity to prompt from (backgrounded/bare context), we
   * degrade to `notDetermined` rather than hanging on a promise the OS will
   * never settle. Never rejects.
   */
  @ReactMethod
  fun requestAuthorization(promise: Promise) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
      promise.resolve(STATUS_AUTHORIZED)
      return
    }
    if (hasNotificationPermission()) {
      promise.resolve(STATUS_AUTHORIZED)
      return
    }

    val activity = reactContext.currentActivity
    // No Activity (or a non-RN host that cannot route the result): cannot
    // prompt. Resolve the pre-prompt status so JS degrades cleanly.
    if (activity == null || activity !is PermissionAwareActivity) {
      promise.resolve(STATUS_NOT_DETERMINED)
      return
    }

    try {
      activity.requestPermissions(
        arrayOf(Manifest.permission.POST_NOTIFICATIONS),
        PERMISSION_REQUEST_CODE,
        PermissionListener { requestCode, _, grantResults ->
          if (requestCode != PERMISSION_REQUEST_CODE) return@PermissionListener false
          val granted =
            grantResults.isNotEmpty() &&
              grantResults[0] == PackageManager.PERMISSION_GRANTED
          promise.resolve(if (granted) STATUS_AUTHORIZED else STATUS_DENIED)
          true // result consumed — remove this listener
        },
      )
    } catch (t: Throwable) {
      // Defensive: the Activity may have detached between the null-check and
      // the call. Degrade rather than reject.
      promise.resolve(STATUS_NOT_DETERMINED)
    }
  }

  /**
   * Read the current notification-authorization status without prompting.
   * Mirrors iOS `getAuthorizationStatus`. `areNotificationsEnabled()` covers
   * both the API 33+ runtime grant and the user's global per-app toggle, so it
   * is the honest "can a banner show?" check on every supported API level.
   * Never rejects.
   */
  @ReactMethod
  fun getAuthorizationStatus(promise: Promise) {
    val enabled = NotificationManagerCompat.from(reactContext).areNotificationsEnabled()
    promise.resolve(if (enabled) STATUS_AUTHORIZED else STATUS_DENIED)
  }

  /** True when the API 33+ `POST_NOTIFICATIONS` grant is already held. */
  private fun hasNotificationPermission(): Boolean =
    Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
      ContextCompat.checkSelfPermission(reactContext, Manifest.permission.POST_NOTIFICATIONS) ==
        PackageManager.PERMISSION_GRANTED

  // ── channel ───────────────────────────────────────────────────────────

  /** Ensure the outreach/messages channel exists (idempotent). */
  @ReactMethod
  fun createChannel(promise: Promise) {
    ensureChannel()
    promise.resolve(true)
  }

  // ── posting ───────────────────────────────────────────────────────────

  /**
   * Post a local notification. Resolves `true` when the notification was
   * posted. A blank `messageId` resolves `false` (it is the replace-key).
   */
  @SuppressLint("MissingPermission")
  @ReactMethod
  fun postLocalNotification(options: ReadableMap?, promise: Promise) {
    val title = options?.getString("title").orEmpty()
    val body = options?.getString("body").orEmpty()
    val entityId = options?.getString("entityId").orEmpty()
    val messageId = options?.getString("messageId").orEmpty()

    if (messageId.isEmpty()) {
      promise.resolve(false)
      return
    }

    val manager = NotificationManagerCompat.from(reactContext)
    // POST_NOTIFICATIONS (API 33+) is a runtime grant; if it is off, posting is
    // a silent no-op — report false so the JS caller can stop retrying.
    if (!manager.areNotificationsEnabled()) {
      promise.resolve(false)
      return
    }

    try {
      ensureChannel()
      val notification = NotificationCompat.Builder(reactContext, CHANNEL_ID)
        .setContentTitle(title)
        .setContentText(body)
        .setStyle(NotificationCompat.BigTextStyle().bigText(body))
        .setSmallIcon(android.R.drawable.ic_dialog_email)
        .setAutoCancel(true)
        .setPriority(NotificationCompat.PRIORITY_DEFAULT)
        .setGroup(if (entityId.isNotEmpty()) entityId else GROUP_FALLBACK)
        .build()

      // tag = messageId → a re-post for the same message replaces the prior one.
      manager.notify(messageId, NOTIFICATION_ID, notification)
      promise.resolve(true)
    } catch (t: Throwable) {
      promise.resolve(false)
    }
  }

  // ── internals ─────────────────────────────────────────────────────────

  private fun ensureChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val manager =
      reactContext.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager ?: return
    if (manager.getNotificationChannel(CHANNEL_ID) != null) return
    val channel = NotificationChannel(
      CHANNEL_ID,
      CHANNEL_NAME,
      NotificationManager.IMPORTANCE_DEFAULT,
    ).apply { description = CHANNEL_DESCRIPTION }
    manager.createNotificationChannel(channel)
  }

  companion object {
    const val NAME = "SoulbitsNotifications"

    /** One standard-importance channel for entity messages/outreach. */
    const val CHANNEL_ID = "outreach_messages"
    const val CHANNEL_NAME = "Messages"
    const val CHANNEL_DESCRIPTION = "Messages from your AI companions"

    /** Fixed id — the `messageId` tag is what makes re-posts replace. */
    private const val NOTIFICATION_ID = 0x0A11
    private const val GROUP_FALLBACK = "outreach"

    // ── permission (mirrors the iOS module's lowercase status strings) ──
    /** Request code for the API 33+ `POST_NOTIFICATIONS` prompt. */
    private const val PERMISSION_REQUEST_CODE = 0x0A12
    /** Lowercase status strings matching the JS union in NotificationPermission.ts. */
    private const val STATUS_AUTHORIZED = "authorized"
    private const val STATUS_DENIED = "denied"
    private const val STATUS_NOT_DETERMINED = "notDetermined"
  }
}
