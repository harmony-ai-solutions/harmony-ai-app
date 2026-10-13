/**
 * Engine sidecar — shared TypeScript types (task 1-2).
 *
 * The Android app ships the Soulbits Engine as `libengine.so` in
 * `jniLibs/<abi>/`, execs it from `ApplicationInfo.nativeLibraryDir`, and
 * speaks the documented sidecar contract (see the engine repo's
 * `docs/Sidecar-Deployment.md`):
 *
 *   - readiness: one `ENGINE_READY {json}` line on stdout (stdout is NOT pure
 *     JSON — Gin route dumps + the seeder write there too, so consumers scan
 *     line-by-line for the prefix)
 *   - shutdown: SIGTERM → exit 0 within 10s (WAL checkpointed)
 *   - single instance: lockfile `<data-dir>/engine-sidecar.lock`
 *
 * These types are the seam the native module (`NativeModules.EngineSidecar`)
 * and the JS wrapper (`src/services/engine/EngineSidecarModule.ts`) agree on,
 * and the surface the 3-2 engine-service layer consumes.
 */

/**
 * The negotiated ports + identity parsed from the sidecar's `ENGINE_READY`
 * line. Field names are camelCase here; the wire JSON uses the engine's keys
 * (`ws`, `wss`, `admin`, `bind`, `pid`, `dataDir`, `token`) and is mapped in
 * `parseReadyLine`.
 */
export interface EngineReadyPayload {
  /** Event server (WS/HTTP) port — the port the app's WS client dials. */
  wsPort: number;
  /** Event server WSS (TLS) port. 0 when the sidecar runs WS-only. */
  wssPort: number;
  /** Management API port — the 3-2 management-API client dials this. */
  adminPort: number;
  /** Bind address (loopback by default: 127.0.0.1). */
  bind: string;
  /** OS pid of the sidecar process. -1 when unknown. */
  pid: number;
  /** Absolute data dir the sidecar opened. Empty string when unknown. */
  dataDir: string;
  /**
   * Per-process loopback token (task 3-1): the app presents it as the
   * `X-Loopback-Token` header on the app-facing `/api/*` reads. Empty string when the
   * sidecar binds a non-loopback interface (the loopback path is disabled and
   * the app falls back to `X-Admin-API-Key`). See the engine repo's
   * `docs/Sidecar-Deployment.md`.
   */
  token: string;
}

/**
 * Lifecycle status of the sidecar, as tracked by the JS wrapper.
 *
 * - `unsupported` — no `libengine.so` for this device ABI (or not Android)
 * - `stopped`     — not running
 * - `starting`    — process spawned, awaiting the readiness line
 * - `ready`       — readiness line parsed; safe to connect
 * - `restarting`  — unexpected exit; native is applying restart backoff
 * - `failed`      — gave up after the max restart attempts (engine-error state)
 */
export type EngineStatus =
  | 'unsupported'
  | 'stopped'
  | 'starting'
  | 'ready'
  | 'restarting'
  | 'failed';

/** Options passed to `startEngineSidecar`. */
export interface EngineStartOptions {
  /**
   * SQLCipher-class database key from the app keychain. Forwarded to the
   * sidecar via the `SE_DB_KEY` environment variable (never a CLI arg, never
   * logged). The engine never generates a key — the app owns key custody.
   */
  dbKey?: string;
  /**
   * Override the data directory. Defaults (native side) to
   * `<context.filesDir>/engine`.
   */
  dataDir?: string;
  /** Log level forwarded to the sidecar (`--log-level`). Default `info`. */
  logLevel?: 'trace' | 'debug' | 'info' | 'warn' | 'error';
  /**
   * Max automatic restarts after unexpected exits before surfacing the
   * engine-error state. Native default is 3 (matches the plan).
   */
  maxRestarts?: number;
}

/** Info about a sidecar process exit (delivered on `engine:exit`). */
export interface EngineExitInfo {
  /** Exit code, or null when the process was terminated by a signal. */
  code: number | null;
  /** Signal number, or null when it exited normally. */
  signal: number | null;
  /** true when host-initiated (`stop()`); false for an unexpected crash. */
  expected: boolean;
  /** 1-based restart attempt this exit triggered (0 when no restart follows). */
  restartAttempt: number;
  /** Whether the native manager will restart after this exit. */
  willRestart: boolean;
}

/** Discrete lifecycle events emitted by the native module. */
export type EngineSidecarEvent =
  | { type: 'ready'; payload: EngineReadyPayload; rawLine: string }
  | { type: 'restarting'; attempt: number; delayMs: number }
  | {
      type: 'crashed';
      attempt: number;
      maxAttempts: number;
      code: number | null;
      signal: number | null;
    }
  | { type: 'stopped'; code: number | null; signal: number | null }
  | { type: 'state'; status: EngineStatus }
  | { type: 'exit'; exit: EngineExitInfo };

/** Result shape returned by the native `start()` bridge call. */
export interface NativeEngineStartResult {
  wsPort?: number;
  wssPort?: number;
  adminPort?: number;
  bind?: string;
  pid?: number;
  dataDir?: string;
  /** Per-process loopback token (task 3-1) when the native side forwards it. */
  token?: string;
  /** The raw `ENGINE_READY {...}` line — the canonical parse source. */
  rawLine?: string;
}
