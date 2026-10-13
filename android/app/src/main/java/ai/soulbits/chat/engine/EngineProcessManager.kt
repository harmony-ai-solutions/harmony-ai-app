package ai.soulbits.chat.engine

import android.content.Context
import android.os.Build
import android.util.Log
import java.io.BufferedReader
import java.io.File
import java.io.InputStream
import java.net.InetAddress
import java.net.ServerSocket
import java.util.concurrent.TimeUnit

/**
 * EngineProcessManager — owns the engine sidecar OS process (task 1-2).
 *
 * Responsibilities:
 *  - resolve the sidecar binary (`libengine.so`) from
 *    `ApplicationInfo.nativeLibraryDir` for the device ABI (with the
 *    API 24–28 `code_cache` extraction fallback the engine doc calls for)
 *  - exec it with the documented flags (`--data-dir`, `--bind`, `--ws-port`,
 *    `--wss-port`, `--admin-port`, `--log-level`) and the `SE_DB_KEY`
 *    environment variable for the SQLCipher-class key (never a CLI arg, so the
 *    secret is not visible in `ps` argv)
 *  - scan stdout line-by-line for the `ENGINE_READY {...}` readiness line
 *    (stdout is NOT pure JSON) and report the negotiated ports
 *  - pump stderr as logs
 *  - detect unexpected exits and restart with exponential backoff (max 3 by
 *    default), then surface an engine-error state
 *  - stop with SIGTERM (`Process.destroy()`), awaiting exit ≤10s, then SIGKILL
 *    (`destroyForcibly()`) on timeout
 *
 * Ports: the plan's original `--ws-port 0 --admin-port 0` (ephemeral) is NOT
 * supported by the landed engine — `validatePort` rejects anything outside
 * [1024, 65535] and the readiness payload reports the *configured* ports, not
 * the listener's. This manager therefore allocates concrete free loopback
 * ports up front and passes them explicitly; the readiness line confirms them.
 */
class EngineProcessManager(
  private val context: Context,
  private val listener: Listener,
) {

  /** Lifecycle callbacks — implemented by [EngineSidecarController]. */
  interface Listener {
    fun onReady(info: ReadyInfo, rawLine: String)
    fun onStdout(line: String)
    fun onStderr(line: String)
    fun onRestarting(attempt: Int, delayMs: Long)
    fun onExit(
      code: Int,
      signal: Int,
      expected: Boolean,
      restartAttempt: Int,
      willRestart: Boolean,
    )
    fun onCrashed(attempt: Int, maxAttempts: Int, code: Int, signal: Int)
    fun onStopped(code: Int, signal: Int)
  }

  /** Options for a sidecar launch. */
  data class StartOptions(
    val dataDir: String,
    val dbKey: String?,
    val logLevel: String,
    val maxRestarts: Int,
  )

  private val lock = Any()
  private var process: Process? = null
  private var running = false
  private var expectedStop = false
  private var restartAttempt = 0
  private var maxRestarts = DEFAULT_MAX_RESTARTS
  private var currentOptions: StartOptions? = null
  private var lastReady: ReadyInfo? = null

  /** True while the sidecar process is alive. */
  fun isAlive(): Boolean = synchronized(lock) { process?.isAlive == true }

  /** The most recent readiness payload, or null before the first ready line. */
  fun lastReady(): ReadyInfo? = synchronized(lock) { lastReady }

  /**
   * Start the sidecar. Returns false when no binary exists for this device
   * ABI (the caller surfaces `unsupported`). Idempotent while running.
   */
  fun start(options: StartOptions): Boolean {
    synchronized(lock) {
      if (running) return true
      val binary = resolveBinary(context) ?: return false
      val dataDir = File(options.dataDir)
      if (!dataDir.exists()) dataDir.mkdirs()
      running = true
      expectedStop = false
      restartAttempt = 0
      maxRestarts = options.maxRestarts
      currentOptions = options
      lastReady = null
      spawnLocked(binary, options)
      return true
    }
  }

  /**
   * Stop the sidecar: SIGTERM, await exit within [timeoutMs], else SIGKILL.
   * The exit callback is delivered from the wait thread (see [handleExit]).
   */
  fun stop(timeoutMs: Long = SHUTDOWN_TIMEOUT_MS) {
    val proc: Process?
    synchronized(lock) {
      expectedStop = true
      running = false
      proc = process
    }
    if (proc == null) {
      listener.onStopped(-1, -1)
      return
    }
    try {
      proc.destroy() // SIGTERM — engine checkpoints WAL and exits 0 ≤10s
      if (!proc.waitFor(timeoutMs, TimeUnit.MILLISECONDS)) {
        proc.destroyForcibly() // SIGKILL only on timeout
        proc.waitFor(2, TimeUnit.SECONDS)
      }
    } catch (_: Exception) {
      // Best-effort teardown.
    }
  }

  // ── Internals ──────────────────────────────────────────────────────────

  private fun spawnLocked(binary: File, options: StartOptions) {
    val ports = allocateFreePorts(3)
    if (ports.size < 3) {
      running = false
      listener.onCrashed(0, maxRestarts, -1, -1)
      return
    }
    val (ws, wss, admin) = Triple(ports[0], ports[1], ports[2])
    val pb = ProcessBuilder(
      binary.absolutePath,
      "--data-dir", options.dataDir,
      "--bind", LOOPBACK,
      "--ws-port", ws.toString(),
      "--wss-port", wss.toString(),
      "--admin-port", admin.toString(),
      "--log-level", options.logLevel,
    )
    pb.directory(File(options.dataDir))
    pb.redirectErrorStream(false)
    val env = pb.environment()
    env["SE_DATA_DIR"] = options.dataDir
    // DB key via environment (never argv → not in `ps`). The engine never
    // generates a key; the app owns key custody.
    options.dbKey?.let { if (it.isNotEmpty()) env["SE_DB_KEY"] = it }

    val proc = try {
      pb.start()
    } catch (e: Exception) {
      Log.e(TAG, "failed to exec engine sidecar", e)
      running = false
      listener.onCrashed(0, maxRestarts, -1, -1)
      return
    }
    process = proc
    pump(proc.inputStream, isStdout = true)
    pump(proc.errorStream, isStdout = false)
    watch(proc)
    healthWatch(proc)
  }

  private fun pump(stream: InputStream, isStdout: Boolean) {
    val reader = stream.bufferedReader()
    Thread {
      try {
        reader.use { r: BufferedReader ->
          r.forEachLine { line ->
            if (isStdout) {
              val info = EngineReadiness.parse(line)
              if (info != null) {
                synchronized(lock) { lastReady = info }
                listener.onReady(info, line)
              } else {
                listener.onStdout(line)
              }
            } else {
              listener.onStderr(line)
            }
          }
        }
      } catch (_: Exception) {
        // Stream closed on shutdown — expected.
      }
    }.apply {
      isDaemon = true
      name = if (isStdout) "engine-stdout" else "engine-stderr"
    }.start()
  }

  private fun watch(proc: Process) {
    Thread {
      val code = try {
        proc.waitFor()
      } catch (_: InterruptedException) {
        -1
      }
      handleExit(proc, code)
    }.apply {
      isDaemon = true
      name = "engine-wait"
    }.start()
  }

  /**
   * Periodic process-alive health watch. The wait thread is the authoritative
   * death detector (event-driven); this poll is a defensive backstop so the
   * exit path still runs if that thread is interrupted. Exits when the process
   * is superseded or the manager stops.
   */
  private fun healthWatch(proc: Process) {
    Thread {
      var alive = true
      while (alive) {
        val slept = try {
          Thread.sleep(HEALTH_CHECK_INTERVAL_MS)
          true
        } catch (_: InterruptedException) {
          false
        }
        if (!slept) {
          alive = false
        } else {
          val current = synchronized(lock) { process === proc && running }
          if (!current) {
            alive = false
          } else if (!proc.isAlive) {
            handleExit(proc, -1)
            alive = false
          }
        }
      }
    }.apply {
      isDaemon = true
      name = "engine-health"
    }.start()
  }

  private fun handleExit(proc: Process, code: Int) {
    var restart = false
    var delay = 0L
    synchronized(lock) {
      if (process !== proc) return // superseded by a newer process
      process = null
      if (expectedStop || !running) {
        running = false
        listener.onExit(code, SIGNAL_UNKNOWN, true, 0, false)
        listener.onStopped(code, SIGNAL_UNKNOWN)
        return
      }
      restartAttempt += 1
      if (restartAttempt <= maxRestarts) {
        restart = true
        delay = EngineReadiness.backoffDelayMs(restartAttempt, BACKOFF_BASE_MS, BACKOFF_MAX_MS)
        listener.onExit(code, SIGNAL_UNKNOWN, false, restartAttempt, true)
        listener.onRestarting(restartAttempt, delay)
      } else {
        running = false
        listener.onExit(code, SIGNAL_UNKNOWN, false, restartAttempt, false)
        listener.onCrashed(restartAttempt, maxRestarts, code, SIGNAL_UNKNOWN)
      }
    }
    if (restart) scheduleRestart(delay)
  }

  private fun scheduleRestart(delayMs: Long) {
    Thread {
      var interrupted = false
      try {
        Thread.sleep(delayMs)
      } catch (_: InterruptedException) {
        interrupted = true
      }
      if (!interrupted) {
        synchronized(lock) {
          if (running && !expectedStop) {
            val options = currentOptions
            val binary = if (options != null) resolveBinary(context) else null
            if (options != null && binary != null) {
              spawnLocked(binary, options)
            } else {
              running = false
            }
          }
        }
      }
    }.apply {
      isDaemon = true
      name = "engine-restart"
    }.start()
  }

  companion object {
    private const val TAG = "EngineProcessManager"
    private const val BINARY_NAME = "libengine.so"
    private const val LOOPBACK = "127.0.0.1"
    private const val SIGNAL_UNKNOWN = -1
    private const val DEFAULT_MAX_RESTARTS = 3
    private const val SHUTDOWN_TIMEOUT_MS = 10_000L
    private const val BACKOFF_BASE_MS = 500L
    private const val BACKOFF_MAX_MS = 8_000L
    private const val HEALTH_CHECK_INTERVAL_MS = 15_000L

    /**
     * Resolve the executable sidecar binary for this device, or null when no
     * `libengine.so` is present for the device ABI.
     *
     * Primary path: `nativeLibraryDir/libengine.so` (extracted because the app
     * sets `extractNativeLibs=true`). API 24–28 fallback: copy it to
     * `applicationInfo.dataDir/code_cache` (executable pre-29) and exec there.
     */
    fun resolveBinary(context: Context): File? {
      val nativeDir = context.applicationInfo?.nativeLibraryDir ?: return null
      val candidate = File(nativeDir, BINARY_NAME)
      if (!candidate.exists()) return null
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
        return extractToCodeCache(context, candidate)
      }
      return candidate
    }

    private fun extractToCodeCache(context: Context, source: File): File? {
      return try {
        val targetDir = File(context.applicationInfo.dataDir, "code_cache/engine")
        if (!targetDir.exists()) targetDir.mkdirs()
        val target = File(targetDir, BINARY_NAME)
        if (!target.exists() || target.length() != source.length()) {
          source.inputStream().use { input ->
            target.outputStream().use { output -> input.copyTo(output) }
          }
        }
        target.setExecutable(true, false)
        target
      } catch (e: Exception) {
        Log.w(TAG, "failed to stage engine binary into code_cache", e)
        null
      }
    }

    /** Allocate [count] distinct free loopback ports (best-effort, TOCTOU-tolerant). */
    private fun allocateFreePorts(count: Int): List<Int> {
      val ports = ArrayList<Int>(count)
      val sockets = ArrayList<ServerSocket>(count)
      try {
        repeat(count) {
          val socket = ServerSocket(0, 1, InetAddress.getByName(LOOPBACK))
          sockets.add(socket)
          ports.add(socket.localPort)
        }
      } catch (e: Exception) {
        Log.w(TAG, "failed to allocate free ports", e)
      } finally {
        sockets.forEach { runCatching { it.close() } }
      }
      return ports
    }
  }
}
