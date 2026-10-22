package ai.soulbits.chat.keepawake

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

/**
 * Registers [KeepScreenOnModule] so `NativeModules.KeepScreenOn` is available
 * from JS on Android. Added to the package list in `MainApplication`.
 */
class KeepScreenOnPackage : ReactPackage {
  override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> =
    listOf(KeepScreenOnModule(reactContext))

  override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> =
    emptyList()
}
