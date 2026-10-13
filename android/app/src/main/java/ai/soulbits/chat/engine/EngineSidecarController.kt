package ai.soulbits.chat.engine

import android.content.Context
import android.util.Log
import java.util.concurrent.CopyOnWriteArrayList

/**
 * EngineSidecarController — in-process singleton that owns the sidecar
 * [EngineProcessManager] and fans its lifecycle out to interested listeners
 * (the RN bridge module and, indirectly, JS).
 *
 * The controller exists so the foreground [EngineSidecarService] and the
 * [EngineSidecarModule] share one process manager: the service keeps the
 * process alive while the app session is active, while the module bridges
 * start/stop/state/events to JS. Status is the same `EngineStatus` vocabulary
 * the TS wrapper uses, so the 3-2 engine-service layer can consume it.
 */
object EngineSidecarController {

  const val STATUS_UNSUPPORTED = "unsupported"
  const val STATUS_STOPPED = "stopped"
  const val STATUS_STARTING = "starting"
  const val STATUS_READY = "ready"
  const val STATUS_RESTARTING = "restarting"
  const val STATUS_FAILED = "failed"

  /** Lifecycle callbacks delivered to the RN module. */
  interface Listener {
    fun onReady(info: ReadyInfo, rawLine: String)
    fun onRestarting(attempt: Int, delayMs: Long)
    fun onCrashed(attempt: Int, maxAttempts: Int, code: Int, signal: Int)
    fun onStopped(code: Int, signal: Int)
    fun onExit(code: Int, signal: Int, expected: Boolean, restartAttempt: Int, willRestart: Boolean)
    fun onState(status: String)
  }

  private const val TAG = "EngineSidecarController"

  private val listeners = CopyOnWriteArrayList<Listener>()

  @Volatile
  private var status: String = STATUS_STOPPED

  private var manager: EngineProcessManager? = null

  /** Whether a sidecar binary exists for this device (Android, matching ABI). */
  fun isAvailable(context: Context): Boolean =
    EngineProcessManager.resolveBinary(context) != null

  /** Current lifecycle status. */
  fun getStatus(): String = status

  /** Most recent readiness payload, or null. */
  fun getReady(): ReadyInfo? = manager?.lastReady()

  /** True while the sidecar process is alive. */
  fun isAlive(): Boolean = manager?.isAlive() == true

  fun addListener(listener: Listener) {
    listeners.addIfAbsent(listener)
  }

  fun removeListener(listener: Listener) {
    listeners.remove(listener)
  }

  /**
   * Start the sidecar. Returns true when a process was launched (or already
   * running); false when no binary exists for this device ABI.
   */
  @Synchronized
  fun start(context: Context, options: EngineProcessManager.StartOptions): Boolean {
    if (!isAvailable(context)) {
      setStatus(STATUS_UNSUPPORTED)
      return false
    }
    val existing = manager
    if (existing != null && existing.isAlive()) {
      // Already running — re-announce readiness if we have it.
      existing.lastReady()?.let { listeners.forEach { l -> l.onReady(it, "") } }
      setStatus(STATUS_READY)
      return true
    }
    val mgr = existing ?: EngineProcessManager(context.applicationContext, bridge).also {
      manager = it
    }
    setStatus(STATUS_STARTING)
    val started = mgr.start(options)
    if (!started) {
      setStatus(STATUS_UNSUPPORTED)
    }
    return started
  }

  /** Stop the sidecar (SIGTERM; SIGKILL on timeout). */
  fun stop() {
    manager?.stop()
  }

  // ── Manager → controller bridge ────────────────────────────────────────

  private val bridge = object : EngineProcessManager.Listener {
    override fun onReady(info: ReadyInfo, rawLine: String) {
      setStatus(STATUS_READY)
      listeners.forEach { it.onReady(info, rawLine) }
    }

    override fun onStdout(line: String) {
      Log.v(TAG, "stdout: $line")
    }

    override fun onStderr(line: String) {
      Log.v(TAG, "stderr: $line")
    }

    override fun onRestarting(attempt: Int, delayMs: Long) {
      setStatus(STATUS_RESTARTING)
      listeners.forEach { it.onRestarting(attempt, delayMs) }
    }

    override fun onExit(
      code: Int,
      signal: Int,
      expected: Boolean,
      restartAttempt: Int,
      willRestart: Boolean,
    ) {
      listeners.forEach { it.onExit(code, signal, expected, restartAttempt, willRestart) }
    }

    override fun onCrashed(attempt: Int, maxAttempts: Int, code: Int, signal: Int) {
      setStatus(STATUS_FAILED)
      listeners.forEach { it.onCrashed(attempt, maxAttempts, code, signal) }
    }

    override fun onStopped(code: Int, signal: Int) {
      setStatus(STATUS_STOPPED)
      listeners.forEach { it.onStopped(code, signal) }
    }
  }

  private fun setStatus(next: String) {
    if (status == next) return
    status = next
    listeners.forEach { it.onState(next) }
  }
}
