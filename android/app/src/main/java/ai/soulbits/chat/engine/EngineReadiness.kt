package ai.soulbits.chat.engine

import org.json.JSONObject

/**
 * Parsed `ENGINE_READY {...}` payload (engine sidecar readiness protocol).
 *
 * Mirrors the engine's `ReadyPayload` JSON keys: `ws`, `wss`, `admin`, `bind`,
 * `pid`, `dataDir`. See the engine repo's `docs/Sidecar-Deployment.md`.
 */
data class ReadyInfo(
  val ws: Int,
  val wss: Int,
  val admin: Int,
  val bind: String,
  val pid: Int,
  val dataDir: String,
)

/**
 * Pure readiness-line parsing for the engine sidecar.
 *
 * The engine's stdout is **not** pure JSON — Gin route dumps and the default
 * data seeder also write there — so callers scan line-by-line for the
 * `ENGINE_READY ` prefix and parse the JSON that follows. Mirrors the
 * TypeScript `parseReadyLine` helper so the two sides agree on the contract.
 */
object EngineReadiness {

  /** The stdout prefix written exactly once when both servers are up. */
  const val PREFIX = "ENGINE_READY "

  /**
   * Parse a single stdout line into a [ReadyInfo], or null when the line is
   * not a well-formed readiness line.
   */
  fun parse(line: String?): ReadyInfo? {
    if (line.isNullOrEmpty()) return null
    val idx = line.indexOf(PREFIX)
    if (idx < 0) return null
    val json = line.substring(idx + PREFIX.length).trim()
    if (json.isEmpty()) return null
    val obj = try {
      JSONObject(json)
    } catch (_: Exception) {
      return null
    }
    val ws = obj.optInt("ws", 0)
    val admin = obj.optInt("admin", 0)
    if (ws <= 0 || admin <= 0) return null
    return ReadyInfo(
      ws = ws,
      wss = obj.optInt("wss", 0),
      admin = admin,
      bind = obj.optString("bind", "127.0.0.1"),
      pid = obj.optInt("pid", -1),
      dataDir = obj.optString("dataDir", ""),
    )
  }

  /**
   * Exponential restart backoff for a 1-based attempt number (mirrors the TS
   * `computeBackoffDelayMs`): `base * 2^(attempt-1)`, clamped to `max`.
   */
  fun backoffDelayMs(
    attempt: Int,
    baseMs: Long = 500L,
    maxMs: Long = 8_000L,
  ): Long {
    val a = attempt.coerceAtLeast(1)
    val shift = (a - 1).coerceAtMost(20)
    return minOf(baseMs * (1L shl shift), maxMs)
  }
}
