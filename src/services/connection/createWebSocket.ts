/**
 * WebSocket constructor factory.
 *
 * Returns the appropriate WebSocket constructor for the current environment:
 *
 * - **Test (Jest + jest-websocket-mock):** Returns the standard global `WebSocket`,
 *   which is intercepted by jest-websocket-mock in the jsdom environment.
 * - **Production (React Native):** Returns the `react-native-websocket-self-signed`
 *   module's default export (lazy-required to keep the native module out of the
 *   test bundle).
 *
 * ## API Discrepancy
 *
 * The `react-native-websocket-self-signed` library does NOT follow the standard
 * `new WebSocket(url)` constructor pattern.  It uses a singleton factory:
 *
 * ```ts
 * const ws = require('react-native-websocket-self-signed').default.getInstance(url);
 * ws.onOpen(cb);
 * ws.onMessage(cb);
 * ws.connect({ Authorization: `Bearer ${jwt}` });
 * ```
 *
 * This factory therefore returns the **default export** of the native module,
 * which is the class (not an instance).  Callers that currently use
 * `getInstance(url)` must continue to do so, **or** switch to `new WebSocketCtor(url)`
 * if they can tolerate the standard WebSocket API.
 *
 * The primary consumer of this factory is `InsecureSSLWebSocketConnection.ts`,
 * which imports the native module directly.  After this refactor, that class
 * should check the environment:
 *
 * - **Jest:** import {getWebSocketCtor} and use the returned constructor with
 *   the standard WebSocket API.
 * - **Production:** keep using `getInstance(url)` and the native module's API.
 *
 * @see ConnectionManager.ts — already uses `WebSocketConnectionFactory`, which
 *      creates connection objects via `new UnencryptedWebSocketConnection()` etc.
 *      No changes are needed in `ConnectionManager` because it never imports
 *      the native module directly.
 */

export type WebSocketCtor = typeof WebSocket;

export function getWebSocketCtor(): WebSocketCtor {
  if (process.env.JEST_WORKER_ID !== undefined) {
    // Running under Jest — use standard WebSocket (intercepted by jest-websocket-mock).
    // The jsdom test environment provides a global WebSocket.
    return WebSocket;
  }
  // Production — lazy require to keep the native module out of test imports.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const SelfSignedWebSocket = require('react-native-websocket-self-signed').default;
  return SelfSignedWebSocket;
}
