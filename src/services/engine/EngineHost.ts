/**
 * EngineHost — the platform-agnostic engine host abstraction (task 4-2).
 *
 * The app runs the SAME engine two ways depending on where a separate process
 * is possible:
 *
 *   - **Android — `SidecarEngineHost`**: the engine is a child process
 *     (`libengine.so`, task 1-1/1-2). It exposes ports + a per-process loopback
 *     token via the `ENGINE_READY {...}` stdout line; lifecycle events
 *     (`ready`/`restarting`/`crashed`/`stopped`/`exit`) are emitted by the
 *     native manager.
 *   - **iOS — `EmbeddedEngineHost`**: the engine is linked IN-PROCESS as
 *     `SoulbitsEngine.xcframework` (task 4-1's gomobile facade) and driven by a
 *     native module (`NativeModules.SoulbitsEngine`). It returns the same
 *     readiness JSON shape and mirrors the engine→client event stream.
 *
 * Both hosts yield the same `EngineReadyPayload` ({wsPort, wssPort, adminPort,
 * bind, pid, dataDir, token}) so the whole downstream stack — the 3-2
 * management-API client, the engine-service connection state, the repository
 * seam — is shared with no platform branches.
 *
 * Host selection is by platform ({@link selectEngineHost}); tests inject a fake
 * via {@link setEngineHostOverride}.
 */

import { Platform } from 'react-native';
import type {
  EngineExitInfo,
  EngineReadyPayload,
  EngineSidecarEvent,
  EngineStartOptions,
  EngineStatus,
} from '../../types/engineSidecar';
import { SidecarEngineHost } from './SidecarEngineHost';
import { EmbeddedEngineHost } from './EmbeddedEngineHost';

/** Which placement the host uses. */
export type EngineHostKind = 'sidecar' | 'embedded';

/**
 * The contract the engine-service layer consumes. Implemented per platform;
 * consumers never branch on `Platform.OS`.
 */
export interface EngineHost {
  /** Process placement of this host. */
  readonly kind: EngineHostKind;

  /**
   * True when this host is a foreground tier — i.e. it must be stopped when the
   * app backgrounds (iOS embedded). False when the platform keeps the engine
   * alive across backgrounding (Android's foreground service, task 1-2).
   */
  readonly foregroundTier: boolean;

  /** True when an engine implementation exists for this build/device. */
  isAvailable(): Promise<boolean>;

  /**
   * Start (or connect) the engine and resolve once it is ready. The returned
   * payload carries the loopback ports + token the downstream stack dials.
   */
  start(options?: EngineStartOptions): Promise<EngineReadyPayload>;

  /** Stop the engine (graceful; WAL checkpoint). Idempotent. */
  stop(): Promise<void>;

  /** Current lifecycle status tracked by the host. */
  getState(): Promise<EngineStatus>;

  /**
   * The multiplexed in-process RPC (`EngineCall`) — lifecycle/control calls on
   * the embedded host (catch-up, batch, overnight maintenance, sync control,
   * generic management proxy). The sidecar host has no such surface (Android
   * self-ticks and reaches lifecycle via its own path) and rejects.
   */
  call(method: string, payloadJSON?: string): Promise<string>;

  /** Subscribe to every host lifecycle event. Returns an unsubscribe function. */
  onEvent(listener: (event: EngineSidecarEvent) => void): () => void;

  /** Subscribe to `exit` only (sidecar). Returns an unsubscribe function. */
  onExit(listener: (exit: EngineExitInfo) => void): () => void;
}

let override: EngineHost | null = null;
let cached: EngineHost | null = null;

/** Build the platform-default host (sidecar on Android, embedded on iOS). */
function defaultHost(): EngineHost {
  return Platform.OS === 'ios' ? new EmbeddedEngineHost() : new SidecarEngineHost();
}

/** The engine host for this platform (singleton). */
export function selectEngineHost(): EngineHost {
  if (override) return override;
  if (!cached) cached = defaultHost();
  return cached;
}

/**
 * Test seam: force a specific host (pass null to clear). Used by EngineService
 * tests to drive a fake host deterministically regardless of `Platform.OS`.
 */
export function setEngineHostOverride(host: EngineHost | null): void {
  override = host;
  cached = null;
}
