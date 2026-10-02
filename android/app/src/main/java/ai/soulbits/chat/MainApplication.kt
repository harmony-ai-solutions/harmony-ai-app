package ai.soulbits.chat

import android.app.Application
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost

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
