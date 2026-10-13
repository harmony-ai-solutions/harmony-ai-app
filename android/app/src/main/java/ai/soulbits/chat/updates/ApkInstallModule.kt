package ai.soulbits.chat.updates

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.module.annotations.ReactModule
import java.io.File

/**
 * ApkInstallModule — JS ↔ native bridge for the optional Android in-app
 * self-update (plan 7-10 §8; sideload channel only).
 *
 * Exposes:
 *   - canInstall(): true when the app may request package installs (API 26+:
 *     `REQUEST_INSTALL_PACKAGES` granted via "install unknown apps").
 *   - installApk(path): launches the system installer for a downloaded APK via
 *     the shared `FileProvider` (`${applicationId}.backupfiles`, whose
 *     `cache-path` covers the download dir).
 *   - openInstallSettings(): opens the per-app "install unknown apps" page.
 *
 * Legacy `ReactContextBaseJavaModule` (same pattern as BackupModule /
 * EngineSidecarModule / ChatBubbleModule). JS wrapper:
 * `src/services/updates/apkSelfUpdate.ts`. Play-channel builds never show the
 * flow (the permission is Play-review-sensitive — an explicit owner gate).
 */
@ReactModule(name = ApkInstallModule.NAME)
class ApkInstallModule(private val reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = NAME

  /** True when this app is allowed to request package installs. */
  @ReactMethod
  fun canInstall(promise: Promise) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      promise.resolve(reactContext.packageManager.canRequestPackageInstalls())
    } else {
      // Pre-O: the permission is granted at install time.
      promise.resolve(true)
    }
  }

  /** Launch the system package installer for a downloaded APK. */
  @ReactMethod
  fun installApk(path: String?, promise: Promise) {
    if (path.isNullOrEmpty()) {
      promise.reject("bad_args", "path is required")
      return
    }
    val activity = reactContext.currentActivity
    if (activity == null) {
      promise.reject("no_activity", "No foreground activity")
      return
    }
    try {
      val file = File(path)
      if (!file.exists()) {
        promise.reject("missing_file", "APK not found: $path")
        return
      }
      val uri: Uri = FileProvider.getUriForFile(
        reactContext, "${reactContext.packageName}.backupfiles", file,
      )
      val intent = Intent(Intent.ACTION_VIEW).apply {
        setDataAndType(uri, "application/vnd.android.package-archive")
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
      }
      activity.startActivity(intent)
      promise.resolve(true)
    } catch (t: Throwable) {
      promise.reject("install_failed", t)
    }
  }

  /** Open the per-app "install unknown apps" settings page. */
  @ReactMethod
  fun openInstallSettings(promise: Promise) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
      promise.resolve(false)
      return
    }
    try {
      val intent = Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES).apply {
        data = Uri.parse("package:${reactContext.packageName}")
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      }
      reactContext.startActivity(intent)
      promise.resolve(true)
    } catch (t: Throwable) {
      promise.reject("settings_failed", t)
    }
  }

  companion object {
    const val NAME = "SoulbitsApkInstall"
  }
}
