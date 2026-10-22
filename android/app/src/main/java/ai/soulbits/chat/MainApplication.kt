package ai.soulbits.chat

import android.app.Application
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost
import ai.soulbits.chat.engine.EngineSidecarPackage
import ai.soulbits.chat.backup.BackupPackage
import ai.soulbits.chat.updates.ApkInstallPackage
import ai.soulbits.chat.notifications.NotificationsPackage
import ai.soulbits.chat.keepawake.KeepScreenOnPackage

class MainApplication : Application(), ReactApplication {

  override val reactHost: ReactHost by lazy {
    getDefaultReactHost(
      context = applicationContext,
      packageList =
        PackageList(this).packages.apply {
          // Packages that cannot be autolinked yet can be added manually here, for example:
          // add(MyReactNativePackage())
          // Floating chat bubble (display over other apps)
          add(ChatBubblePackage())
          // Engine sidecar process manager (task 1-2)
          add(EngineSidecarPackage())
          // Backup & restore (plan 2-6): SAF picker, WorkManager, share, OAuth.
          add(BackupPackage())
          // Android in-app APK self-update (plan 7-10 §8; sideload channel).
          add(ApkInstallPackage())
          // Local outreach notifications (plan 7-12 §4b): channel + posting.
          add(NotificationsPackage())
          // Screen keep-awake while TTS test playback runs.
          add(KeepScreenOnPackage())
        },
      // Explicitly gate dev support on OUR variant's BuildConfig. The RN 0.86
      // overload defaults this to ReactBuildConfig.DEBUG (the react-android
      // library's own flag, false in published Maven artifacts), which silently
      // disables Metro in debug builds -> "Unable to load script" from the
      // asset loader.
      useDevSupport = BuildConfig.DEBUG,
    )
  }

  override fun onCreate() {
    super.onCreate()
    loadReactNative(this)
  }
}
