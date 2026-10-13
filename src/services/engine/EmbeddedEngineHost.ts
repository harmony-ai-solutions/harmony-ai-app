/**
 * EmbeddedEngineHost — the iOS `EngineHost` (task 4-2).
 *
 * A thin adapter over `EngineEmbeddedModule`, which drives the in-process
 * gomobile facade (`SoulbitsEngine.xcframework`). iOS is a FOREGROUND TIER
 * (assessment §8): the engine lives and dies with the app process and is started
 * on foreground / stopped on background by `EngineLifecycle`.
 *
 * Beyond the shared `EngineHost` surface it exposes the `EngineCall` RPC, which
 * 4-3's silent-push and BGProcessingTask handlers ride for batch/maintenance.
 */

import type {
  EngineExitInfo,
  EngineReadyPayload,
  EngineSidecarEvent,
  EngineStartOptions,
  EngineStatus,
} from '../../types/engineSidecar';
import {
  callEngineEmbedded,
  getEngineEmbeddedState,
  isEngineEmbeddedAvailable,
  onEngineEmbeddedEvent,
  onEngineEmbeddedExit,
  startEngineEmbedded,
  stopEngineEmbedded,
} from './EngineEmbeddedModule';
import { getOrCreateEngineDbKey } from './EngineDbKey';
import type { EngineHost } from './EngineHost';

export class EmbeddedEngineHost implements EngineHost {
  readonly kind = 'embedded' as const;
  readonly foregroundTier = true;

  isAvailable(): Promise<boolean> {
    return isEngineEmbeddedAvailable();
  }

  /**
   * Start the in-process engine, resolving the app-owned DB key from the
   * Keychain when the caller did not supply one (task 4-2 DB key custody — the
   * engine never generates the key). A null key (Keychain unavailable) leaves
   * the engine on its unencrypted default so startup is never blocked.
   */
  async start(options: EngineStartOptions = {}): Promise<EngineReadyPayload> {
    let dbKey = options.dbKey;
    if (dbKey === undefined) {
      dbKey = (await getOrCreateEngineDbKey()) ?? undefined;
    }
    return startEngineEmbedded({ ...options, dbKey });
  }

  stop(): Promise<void> {
    return stopEngineEmbedded();
  }

  getState(): Promise<EngineStatus> {
    return getEngineEmbeddedState();
  }

  call(method: string, payloadJSON = ''): Promise<string> {
    return callEngineEmbedded(method, payloadJSON);
  }

  onEvent(listener: (event: EngineSidecarEvent) => void): () => void {
    return onEngineEmbeddedEvent(listener);
  }

  onExit(listener: (exit: EngineExitInfo) => void): () => void {
    return onEngineEmbeddedExit(listener);
  }
}
