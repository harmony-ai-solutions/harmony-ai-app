/**
 * Browser-style `WebSocket` mock for the sibling connection unit tests
 * (Unencrypted / Secure / Cloud). Those implementations use the standard RN /
 * browser `new WebSocket(url[, protocols])` constructor — NOT the
 * `react-native-websocket-self-signed` native singleton used by
 * `InsecureSSLWebSocketConnection` (which has its own fake in
 * InsecureSSLWebSocketConnection.test.ts).
 *
 * The Jest `unit` project runs with `testEnvironment: 'node'`, which has no
 * global `WebSocket`. Each test installs this mock via `installMockWebSocket()`
 * and drives the socket lifecycle through the `fire*` helpers. The most recently
 * constructed instance is captured on `MockWebSocket.last`.
 */
export const CONNECTING = 0;
export const OPEN = 1;
export const CLOSING = 2;
export const CLOSED = 3;

export type MockWSListener = (ev: any) => void;

export class MockWebSocket {
  // Standard readyState constants — production code reads `WebSocket.OPEN`.
  static CONNECTING = CONNECTING;
  static OPEN = OPEN;
  static CLOSING = CLOSING;
  static CLOSED = CLOSED;

  /** Most recently constructed instance — tests read this to drive events. */
  static last: MockWebSocket | null = null;
  static instances: MockWebSocket[] = [];

  url: string;
  protocols: string | string[] | undefined;
  readyState: number = CONNECTING;

  // Standard browser WebSocket handler properties.
  onopen: MockWSListener | null = null;
  onmessage: MockWSListener | null = null;
  onerror: MockWSListener | null = null;
  onclose: MockWSListener | null = null;

  // Standard methods as spies.
  close = jest.fn((code?: number, reason?: string) => {
    this.readyState = CLOSED;
  });
  send = jest.fn();

  constructor(url: string, protocols?: string | string[]) {
    this.url = url;
    this.protocols = protocols;
    MockWebSocket.last = this;
    MockWebSocket.instances.push(this);
  }

  /** Clear the captured-instance registry between tests. */
  static reset(): void {
    MockWebSocket.last = null;
    MockWebSocket.instances = [];
  }

  // --- test driver helpers -------------------------------------------------

  fireOpen(): void {
    this.readyState = OPEN;
    if (this.onopen) this.onopen({});
  }

  /** `payload` is JSON.stringified to match how `handleMessage` parses `event.data`. */
  fireMessage(payload: any): void {
    const data = typeof payload === 'string' ? payload : JSON.stringify(payload);
    if (this.onmessage) this.onmessage({ data });
  }

  fireError(err: any): void {
    if (this.onerror) this.onerror(err);
  }

  fireClose(code = 1000, reason = ''): void {
    this.readyState = CLOSED;
    if (this.onclose) this.onclose({ code, reason, wasClean: true });
  }
}

/** Install the mock on the global so production `new WebSocket(url)` picks it up. */
export function installMockWebSocket(): void {
  (global as any).WebSocket = MockWebSocket;
}

/**
 * Flush pending promise microtasks without being affected by fake timers.
 * The async connect() bodies await AsyncStorage/AuthService (resolved promises)
 * before registering their setTimeout; draining microtasks guarantees the timer
 * is scheduled before a test advances fake time.
 */
export function flushMicrotasks(): Promise<void> {
  return new Promise<void>((resolve) => jest.requireActual('timers').setImmediate(resolve));
}
