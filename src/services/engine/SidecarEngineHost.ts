/**
 * SidecarEngineHost — the Android `EngineHost` (task 4-2 interface extraction
 * of the 1-2 sidecar module).
 *
 * A thin adapter over `EngineSidecarModule`: the sidecar process manager owns
 * the real work (exec from `nativeLibraryDir`, `ENGINE_READY` handshake, health
 * watch, restart backoff, SIGTERM shutdown). This host only re-shapes it to the
 * platform-agnostic {@link EngineHost} interface so the engine-service layer can
 * treat Android and iOS identically.
 *
 * Android is NOT a foreground tier: the sidecar runs under a `dataSync`
 * foreground service (task 1-2) and is not stopped on app background.
 */

import type {
  EngineExitInfo,
  EngineReadyPayload,
  EngineSidecarEvent,
  EngineStartOptions,
  EngineStatus,
} from '../../types/engineSidecar';
import {
  getEngineSidecarState,
  isEngineSidecarAvailable,
  onEngineExit,
  onEngineSidecarEvent,
  startEngineSidecar,
  stopEngineSidecar,
} from './EngineSidecarModule';
import { getOrCreateEngineDbKey } from './EngineDbKey';
import type { EngineHost } from './EngineHost';

export class SidecarEngineHost implements EngineHost {
  readonly kind = 'sidecar' as const;
  readonly foregroundTier = false;

  isAvailable(): Promise<boolean> {
    return isEngineSidecarAvailable();
  }

  /**
   * Start the sidecar process, resolving the app-owned DB key from the Keychain
   * when the caller did not supply one (mirrors `EmbeddedEngineHost`; task 4-2
   * DB key custody). The Kotlin side forwards it to the engine as the
   * `SE_DB_KEY` environment variable, enabling SQLCipher-class encryption. A
   * null key (Keychain unavailable) leaves the engine on its unencrypted
   * default so startup is never blocked.
   */
  async start(options: EngineStartOptions = {}): Promise<EngineReadyPayload> {
    let dbKey = options.dbKey;
    if (dbKey === undefined) {
      dbKey = (await getOrCreateEngineDbKey()) ?? undefined;
    }
    return startEngineSidecar({ ...options, dbKey });
  }

  stop(): Promise<void> {
    return stopEngineSidecar();
  }

  getState(): Promise<EngineStatus> {
    return getEngineSidecarState();
  }

  /**
   * The sidecar has no in-process `EngineCall` surface. Android self-ticks
   * (task 4-3: "Desktop and Android sidecars self-tick"), so lifecycle control
   * is never routed through this host.
   */
  call(method: string): Promise<string> {
    return Promise.reject(
      new Error(`EngineHost(sidecar): EngineCall "${method}" is not available on the Android sidecar host`),
    );
  }

  onEvent(listener: (event: EngineSidecarEvent) => void): () => void {
    return onEngineSidecarEvent(listener);
  }

  onExit(listener: (exit: EngineExitInfo) => void): () => void {
    return onEngineExit(listener);
  }
}
