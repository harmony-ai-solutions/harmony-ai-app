package ai.soulbits.chat

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import com.facebook.react.bridge.ActivityEventListener
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.BaseActivityEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap
import com.facebook.react.module.annotations.ReactModule

/**
 * ChatBubbleModule — JS ↔ native bridge for the floating chat bubble.
 *
 * Exposes:
 *   - isSupported(): true when the OS supports overlay windows
 *   - hasPermission(): true when SYSTEM_ALERT_WINDOW is granted
 *   - requestPermission(): opens the overlay-permission settings screen
 *     (promise resolves true if already granted, false if the user denies,
 *     and never resolves after the settings screen is opened — the app
 *     re-checks hasPermission() when it regains focus)
 *   - show(conversationJson): starts the foreground bubble service
 *   - hide(): stops the foreground bubble service
 */
@ReactModule(name = ChatBubbleModule.NAME)
class ChatBubbleModule(private val reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  private var permissionPromise: Promise? = null

  private val activityEventListener: ActivityEventListener =
    object : BaseActivityEventListener() {
      override fun onActivityResult(
        activity: Activity?,
        requestCode: Int,
        resultCode: Int,
        data: Intent?,
      ) {
        if (requestCode != OVERLAY_PERMISSION_REQUEST_CODE) return
        // The user may have toggled the overlay switch — re-check on resume.
        resolvePermission()
      }
    }

  init {
    reactContext.addActivityEventListener(activityEventListener)
  }

  override fun getName(): String = NAME

  // ---------------------------------------------------------------------------
  // API
  // ---------------------------------------------------------------------------

  @ReactMethod
  fun isSupported(promise: Promise) {
    promise.resolve(Build.VERSION.SDK_INT >= Build.VERSION_CODES.M)
  }

  @ReactMethod
  fun hasPermission(promise: Promise) {
    promise.resolve(canDrawOverlays())
  }

  @ReactMethod
  fun requestPermission(promise: Promise) {
    if (canDrawOverlays()) {
      promise.resolve(true)
      return
    }
    val activity = currentActivity
    if (activity == null) {
      promise.reject("no_activity", "No current activity to request overlay permission")
      return
    }
    permissionPromise = promise
    val intent = Intent(
      Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
      Uri.parse("package:${reactContext.packageName}"),
    )
    activity.startActivityForResult(intent, OVERLAY_PERMISSION_REQUEST_CODE)
  }

  @ReactMethod
  fun show(conversationJson: String?) {
    if (!canDrawOverlays()) return
    val intent = Intent(reactContext, ChatBubbleService::class.java).apply {
      action = ChatBubbleService.ACTION_SHOW
      putExtra(ChatBubbleService.EXTRA_CONVERSATION, conversationJson)
    }
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      reactContext.startForegroundService(intent)
    } else {
      reactContext.startService(intent)
    }
  }

  @ReactMethod
  fun hide() {
    val intent = Intent(reactContext, ChatBubbleService::class.java).apply {
      action = ChatBubbleService.ACTION_HIDE
    }
    reactContext.stopService(intent)
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private fun canDrawOverlays(): Boolean {
    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
      Settings.canDrawOverlays(reactContext)
    } else {
      reactContext.checkSelfPermission(Manifest.permission.SYSTEM_ALERT_WINDOW) ==
        PackageManager.PERMISSION_GRANTED
    }
  }

  private fun resolvePermission() {
    val promise = permissionPromise ?: return
    permissionPromise = null
    promise.resolve(canDrawOverlays())
  }

  companion object {
    const val NAME = "ChatBubbleModule"
    private const val OVERLAY_PERMISSION_REQUEST_CODE = 8731
  }
}
