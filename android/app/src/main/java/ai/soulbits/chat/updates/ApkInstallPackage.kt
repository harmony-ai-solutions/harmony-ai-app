package ai.soulbits.chat.updates

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

/**
 * Registers [ApkInstallModule] so `NativeModules.SoulbitsApkInstall` is
 * available from JS (plan 7-10 §8). Added to the package list in
 * `MainApplication`.
 */
class ApkInstallPackage : ReactPackage {
  override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> =
    listOf(ApkInstallModule(reactContext))

  override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> =
    emptyList()
}
