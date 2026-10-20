package ai.soulbits.chat.keepawake

import android.view.WindowManager
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.UiThreadUtil
import com.facebook.react.module.annotations.ReactModule

/**
 * KeepScreenOnModule — first-party screen keep-awake helper.
 *
 * The TTS test studio can play a longer sample; without a wake lock the OS dims
 * and sleeps the display mid-listen, the app backgrounds and the biometric lock
 * re-arms. This module toggles `FLAG_KEEP_SCREEN_ON` on the current Activity's
 * window while audio is actually playing (see `src/services/keepScreenOn.ts`
 * for the JS wrapper).
 *
 * Window flags are owned by the UI thread, so both methods hop onto it via
 * [UiThreadUtil]. No current Activity (app backgrounded during teardown, bare
 * context) is a silent no-op rather than an error — the JS side treats this as
 * best-effort. Legacy `ReactContextBaseJavaModule`, the same pattern as
 * `NotificationsModule`; the module name matches the iOS module so the wrapper
 * is platform-agnostic.
 */
@ReactModule(name = KeepScreenOnModule.NAME)
class KeepScreenOnModule(reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = NAME

  /** Add the wake flag, keeping the screen lit until [deactivate]. */
  @ReactMethod
  fun activate() = setKeepScreenOn(true)

  /** Clear the wake flag, restoring normal display sleep. */
  @ReactMethod
  fun deactivate() = setKeepScreenOn(false)

  private fun setKeepScreenOn(enabled: Boolean) {
    UiThreadUtil.runOnUiThread {
      val window = reactApplicationContext.currentActivity?.window ?: return@runOnUiThread
      if (enabled) {
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
      } else {
        window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
      }
    }
  }

  companion object {
    const val NAME = "KeepScreenOn"
  }
}
