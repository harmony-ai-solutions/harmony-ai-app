package ai.soulbits.chat.engine

import android.content.Intent
import android.os.Build
import android.os.Handler
import android.os.Looper
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.WritableMap
import com.facebook.react.module.annotations.ReactModule
import com.facebook.react.modules.core.DeviceEventManagerModule

/**
 * EngineSidecarModule — JS ↔ native bridge for the engine sidecar (task 1-2).
 *
 * Exposes:
 *   - isAvailable(): true when a `libengine.so` exists for this device ABI
 *   - start(options): starts the foreground [EngineSidecarService] (which owns
 *     the process via [EngineSidecarController]) and resolves with the parsed
 *     readiness payload once the `ENGINE_READY` line is observed
 *   - stop(): stops the process (SIGTERM → WAL checkpoint)
 *   - getState(): current lifecycle status
 *
 * Events (RCTDeviceEventEmitter): `engine:ready`, `engine:restarting`,
 * `engine:crashed`, `engine:stopped`, `engine:state`, `engine:exit`.
 *
 * The DB key is passed through intent extras (same-uid only) and forwarded to
 * the sidecar as the `SE_DB_KEY` environment variable — never logged and never
 * a CLI arg.
 *
 * Registered via [EngineSidecarPackage] (a legacy `ReactContextBaseJavaModule`
 * — the repo has no codegen spec infrastructure and the sibling ChatBubble
 * module is legacy; legacy modules are interop-supported under the new
 * architecture. The JS API surface stays stable if a TurboModule spec is
 * layered on later).
 */
@ReactModule(name = EngineSidecarModule.NAME)
class EngineSidecarModule(private val reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext), EngineSidecarController.Listener {

  private val mainHandler = Handler(Looper.getMainLooper())
  private val startLock = Any()
  private var pendingStart: Promise? = null
  private val readyTimeout = Runnable { failPendingStart() }

  init {
    EngineSidecarController.addListener(this)
  }

  override fun getName(): String = NAME

  override fun invalidate() {
    EngineSidecarController.removeListener(this)
    mainHandler.removeCallbacks(readyTimeout)
    synchronized(startLock) { pendingStart = null }
    super.invalidate()
  }

  // ---------------------------------------------------------------------------
  // API
  // ---------------------------------------------------------------------------

  @ReactMethod
  fun isAvailable(promise: Promise) {
    promise.resolve(EngineSidecarController.isAvailable(reactContext))
  }

  @ReactMethod
  fun start(options: ReadableMap?, promise: Promise) {
    if (!EngineSidecarController.isAvailable(reactContext)) {
      // No libengine.so for this device ABI — fail fast instead of waiting
      // out the readiness timeout.
      promise.reject(
        "engine_unavailable",
        "No engine sidecar binary for this device ABI",
      )
      return
    }
    synchronized(startLock) {
      pendingStart?.reject("engine_superseded", "A newer start() superseded this request")
      pendingStart = promise
    }
    mainHandler.removeCallbacks(readyTimeout)
    mainHandler.postDelayed(readyTimeout, READY_TIMEOUT_MS)

    // Already running — resolve immediately from the cached readiness.
    val ready = EngineSidecarController.getReady()
    if (ready != null && EngineSidecarController.isAlive()) {
      resolvePendingStart(ready, "")
      return
    }

    val intent = Intent(reactContext, EngineSidecarService::class.java).apply {
      action = EngineSidecarService.ACTION_START
      putExtra(EngineSidecarService.EXTRA_DB_KEY, options?.getString("dbKey"))
      putExtra(EngineSidecarService.EXTRA_DATA_DIR, options?.getString("dataDir"))
      putExtra(EngineSidecarService.EXTRA_LOG_LEVEL, options?.getString("logLevel"))
      if (options?.hasKey("maxRestarts") == true) {
        putExtra(EngineSidecarService.EXTRA_MAX_RESTARTS, options.getInt("maxRestarts"))
      }
    }
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        reactContext.startForegroundService(intent)
      } else {
        reactContext.startService(intent)
      }
    } catch (e: Exception) {
      // e.g. ForegroundServiceStartNotAllowedException (Android 12+ background
      // start policy) — surface honestly; the caller may retry when foreground.
      failPendingStart("engine_start_failed", e.message ?: "failed to start engine service")
    }
  }

  @ReactMethod
  fun stop(promise: Promise) {
    try {
      val intent = Intent(reactContext, EngineSidecarService::class.java).apply {
        action = EngineSidecarService.ACTION_STOP
      }
      reactContext.stopService(intent)
      EngineSidecarController.stop()
      promise.resolve(null)
    } catch (e: Exception) {
      promise.reject("engine_stop_failed", e.message, e)
    }
  }

  @ReactMethod
  fun getState(promise: Promise) {
    promise.resolve(EngineSidecarController.getStatus())
  }

  // ---------------------------------------------------------------------------
  // Controller listener → JS events (marshalled to the UI thread)
  // ---------------------------------------------------------------------------

  override fun onReady(info: ReadyInfo, rawLine: String) {
    emitReady(info, rawLine)
    resolvePendingStart(info, rawLine)
  }

  override fun onRestarting(attempt: Int, delayMs: Long) {
    emit(
      "engine:restarting",
      Arguments.createMap().apply {
        putInt("attempt", attempt)
        putDouble("delayMs", delayMs.toDouble())
      },
    )
  }

  override fun onCrashed(attempt: Int, maxAttempts: Int, code: Int, signal: Int) {
    emit(
      "engine:crashed",
      Arguments.createMap().apply {
        putInt("attempt", attempt)
        putInt("maxAttempts", maxAttempts)
        putInt("code", code)
        putInt("signal", signal)
      },
    )
    failPendingStart("engine_crashed", "engine sidecar exited repeatedly")
  }

  override fun onStopped(code: Int, signal: Int) {
    emit(
      "engine:stopped",
      Arguments.createMap().apply {
        putInt("code", code)
        putInt("signal", signal)
      },
    )
  }

  override fun onExit(
    code: Int,
    signal: Int,
    expected: Boolean,
    restartAttempt: Int,
    willRestart: Boolean,
  ) {
    emit(
      "engine:exit",
      Arguments.createMap().apply {
        putInt("code", code)
        putInt("signal", signal)
        putBoolean("expected", expected)
        putInt("restartAttempt", restartAttempt)
        putBoolean("willRestart", willRestart)
      },
    )
  }

  override fun onState(status: String) {
    emit("engine:state", Arguments.createMap().apply { putString("status", status) })
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private fun emitReady(info: ReadyInfo, rawLine: String) {
    emit("engine:ready", readyMap(info, rawLine))
  }

  private fun readyMap(info: ReadyInfo, rawLine: String): WritableMap =
    Arguments.createMap().apply {
      putString("rawLine", rawLine)
      putInt("wsPort", info.ws)
      putInt("wssPort", info.wss)
      putInt("adminPort", info.admin)
      putString("bind", info.bind)
      putInt("pid", info.pid)
      putString("dataDir", info.dataDir)
    }

  /** Marshal event emission onto the UI thread (callbacks arrive off-thread). */
  private fun emit(event: String, payload: WritableMap) {
    onMain {
      try {
        reactContext
          .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
          .emit(event, payload)
      } catch (_: Exception) {
        // No JS listener / context torn down — events are best-effort.
      }
    }
  }

  private fun resolvePendingStart(info: ReadyInfo, rawLine: String) {
    val promise = synchronized(startLock) {
      val p = pendingStart ?: return
      pendingStart = null
      p
    }
    mainHandler.removeCallbacks(readyTimeout)
    promise.resolve(readyMap(info, rawLine))
  }

  private fun failPendingStart(
    code: String = "engine_ready_timeout",
    message: String = "engine sidecar did not report readiness in time",
  ) {
    val promise = synchronized(startLock) {
      val p = pendingStart ?: return
      pendingStart = null
      p
    }
    mainHandler.removeCallbacks(readyTimeout)
    promise.reject(code, message)
  }

  private inline fun onMain(crossinline block: () -> Unit) {
    if (Looper.myLooper() == Looper.getMainLooper()) {
      block()
    } else {
      mainHandler.post { block() }
    }
  }

  companion object {
    const val NAME = "EngineSidecar"
    private const val READY_TIMEOUT_MS = 30_000L
  }
}
