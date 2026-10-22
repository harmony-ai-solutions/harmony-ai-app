/**
 * PushTokenStore — the single source of truth for the device push token
 * (plan 7-12 §5, step 6).
 *
 * ## Why
 *
 * The custom-FCM path (topology A: a desktop engine paired with a sideloaded
 * app over LAN) needs the device's push token in the engine's
 * `device_push_tokens` table, which the engine populates from the WS session
 * params (`INIT_ENTITY.payload.push_token`). Before this step the app never
 * sent one (verified state 8a), so the table stayed empty in direct/LAN mode.
 *
 * There are two token producers, and they must agree:
 *   - **Step 6 (this module):** the existing NATIVE seam — iOS
 *     `EngineEmbeddedModule.onPushToken` / `consumePendingPushToken` (raw APNs
 *     token).
 *   - **Step 7 (later, Firebase):** `@react-native-firebase/messaging`'s
 *     `getToken()` (an FCM registration token). Step 7 PREFERS the SDK token
 *     and writes it into THIS store via {@link PushTokenStore.setPushToken};
 *     the native raw-token seam stays as the fallback when Firebase is compiled
 *     out of a build (§3).
 *
 * Because both producers write here, and `EntitySessionService` reads here at
 * INIT_ENTITY time, there is exactly one value the engine can ever receive.
 * This is deliberately a SYNC read (`getPushToken()`): the INIT_ENTITY payload
 * is built synchronously in the hot session path. The token is re-delivered by
 * the native seam on every launch, so the store is in-memory only — there is
 * nothing to persist that the OS/native layer does not already re-supply.
 *
 * ## Rotation
 *
 * A rotated token simply overwrites the store; the NEXT session establishment
 * carries the fresh value (no new protocol messages — plan 7-12 §5/step 6).
 * {@link PushTokenStore.onPushTokenChange} lets a future consumer (step 7's
 * cloud re-registration) observe rotation.
 *
 * ## Source precedence (step 7 — D1=b)
 *
 * Two producers can hold the store at once, and they are NOT peers:
 *
 *   - `'sdk'` — the Firebase (`@react-native-firebase/messaging`) FCM
 *     registration token. **When present it wins** (the cloud is FCM-v1-only,
 *     §3).
 *   - `'native'` — the raw APNs token from the native seam. It is the
 *     **fallback** used only when Firebase is compiled out / unavailable.
 *
 * `getPushToken()` returns the SDK token if one has been delivered, otherwise
 * the native token. A native write while an SDK token is live is therefore a
 * silent no-op on the effective value (no spurious fan-out). Cleat the SDK
 * token (e.g. a build swap) and the native token resumes.
 *
 * ## Fence
 *
 * The token is only ever sent to an engine the app holds a DIRECT session with
 * (local/LAN). `EntitySessionService` fences cloud conduct-proxy sessions off
 * this store — see `isEngineTargetedSession`.
 */

import { createLogger } from '../../utils/logger';

const log = createLogger('[PushTokenStore]');

/** A token-change listener. Receives `null` when the token is cleared. */
export type PushTokenListener = (token: string | null) => void;

/**
 * Which producer wrote a token. `'sdk'` (FCM registration token) takes
 * precedence over `'native'` (raw APNs), which is the fallback (plan 7-12 §3).
 */
export type PushTokenSource = 'native' | 'sdk';

/** Trim a token; blank/undefined → null. */
function normalizeToken(token: string | null | undefined): string | null {
  const normalized = typeof token === 'string' ? token.trim() : '';
  return normalized ? normalized : null;
}

/**
 * The native push-token seam (the iOS `EngineEmbeddedModule` surface, injected
 * for tests). Mirrors `onPushToken` / `consumePendingPushToken`.
 */
export interface PushTokenNativeSource {
  /** Subscribe to the raw APNs token (`push:token`). Returns an unsubscribe. */
  onPushToken(listener: (event: { token: string }) => void): () => void;
  /** Drain a token queued before JS was ready. Resolves the token or null. */
  consumePendingPushToken(): Promise<string | null>;
}

/**
 * The process-wide push-token store. Safe to read synchronously; writes fan out
 * to subscribers.
 */
export class PushTokenStore {
  /** The raw APNs (native seam) token — the fallback token. */
  private nativeToken: string | null = null;
  /** The Firebase FCM (SDK) registration token — wins when present. */
  private sdkToken: string | null = null;
  private readonly listeners = new Set<PushTokenListener>();

  /**
   * The effective push token: the SDK (FCM) token when one is present,
   * otherwise the native (raw APNs) token, otherwise null.
   */
  getPushToken(): string | null {
    return this.sdkToken ?? this.nativeToken;
  }

  /**
   * Record a push token. Defaults to the `'native'` (fallback) source so every
   * existing caller (`attachNativePushTokenSource`) is unchanged; step 7's
   * Firebase integration passes `'sdk'` to take precedence (plan 7-12 §3).
   * Blank/undefined clears the given source. A no-op when the EFFECTIVE token
   * is unchanged (no spurious fan-out — e.g. a native write while an SDK token
   * is live).
   */
  setPushToken(token: string | null | undefined, source: PushTokenSource = 'native'): void {
    const before = this.getPushToken();
    const next = normalizeToken(token);
    if (source === 'sdk') {
      this.sdkToken = next;
    } else {
      this.nativeToken = next;
    }
    const after = this.getPushToken();
    if (after === before) return;
    this.emit(after);
  }

  /** Convenience for the Firebase SDK producer (`setPushToken(token, 'sdk')`). */
  setSdkPushToken(token: string | null | undefined): void {
    this.setPushToken(token, 'sdk');
  }

  /** Subscribe to token changes. Returns an unsubscribe fn. */
  onPushTokenChange(listener: PushTokenListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Test-only: clear the token and subscribers. */
  reset(): void {
    this.nativeToken = null;
    this.sdkToken = null;
    this.listeners.clear();
  }

  private emit(token: string | null): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(token);
      } catch (e) {
        log.warn('push-token listener threw:', e);
      }
    }
  }
}

/** The process-wide store. `EntitySessionService` reads it at INIT_ENTITY time. */
export const pushTokenStore = new PushTokenStore();

/** Test-only: reset the singleton between suites. */
export function __resetPushTokenStoreForTests(): void {
  pushTokenStore.reset();
}

/**
 * The production native seam (lazy require to avoid an import cycle risk and to
 * keep this module importable without the native engine linked).
 */
function defaultNativeSource(): PushTokenNativeSource {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mod = require('../engine/EngineEmbeddedModule');
  return {
    onPushToken: mod.onPushToken,
    consumePendingPushToken: mod.consumePendingPushToken,
  };
}

/**
 * Wire the native push-token seam into the store (idempotent per call site).
 * Subscribes to `push:token` and drains any token queued before JS booted.
 * Returns an unsubscribe fn. Off iOS (or without the native module) this is a
 * no-op subscription — the store simply stays empty until step 7 supplies a
 * token.
 */
export function attachNativePushTokenSource(
  source?: PushTokenNativeSource,
): () => void {
  const seam = source ?? defaultNativeSource();
  if (!seam || typeof seam.onPushToken !== 'function') return () => undefined;

  const unsubscribe = seam.onPushToken(event => {
    if (event && typeof event.token === 'string' && event.token) {
      pushTokenStore.setPushToken(event.token);
    }
  });

  try {
    void Promise.resolve(seam.consumePendingPushToken())
      .then(token => {
        if (token) pushTokenStore.setPushToken(token);
      })
      .catch(e => log.warn('consumePendingPushToken failed:', e));
  } catch (e) {
    log.warn('consumePendingPushToken threw:', e);
  }

  return unsubscribe;
}

export default pushTokenStore;
