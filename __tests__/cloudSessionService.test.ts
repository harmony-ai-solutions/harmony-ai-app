/**
 * CloudSessionService — polling state machine tests.
 *
 * The service now drives the session broker through the first-party Soulbits API
 * client (`session.connect()` / `session.disconnect()`). The client factory
 * (`buildSoulbitsClient`) is mocked so tests assert the polling state machine
 * (requesting → provisioning → ready/failed), concurrency, and cancellation —
 * without touching the network or the real client package.
 *
 * The mock must return openapi-fetch-style results: `{ data?, error?, response }`,
 * where 2xx bodies (200 ready / 202 provisioning) land in `data` and the 503
 * `failed` body lands in `error`.
 */

import { CloudSessionService, CloudSessionStatus } from '../src/services/cloud/CloudSessionService';
import { MAX_PROVISIONING_ATTEMPTS } from '../src/config/cloud';

// ── Mocks ──────────────────────────────────────────────────────────────────

// Variables referenced inside jest.mock factories must start with `mock`.
const mockConnect = jest.fn();
const mockDisconnect = jest.fn();

jest.mock('../src/services/cloud/soulbitsClient', () => ({
  buildSoulbitsClient: jest.fn(() => ({
    session: {
      connect: mockConnect,
      disconnect: mockDisconnect,
    },
  })),
}));

// AuthService is called by _doConnect (getToken/refresh/invalidate) and by
// scheduleProactiveRefresh (getTokenExpiresAt). Provide a real-ish
// AuthExpiredError class so CloudSessionService's named import resolves.
jest.mock('../src/services/auth/AuthService', () => {
  class AuthExpiredError extends Error {
    constructor() {
      super('Cloud auth expired — re-authentication required');
      this.name = 'AuthExpiredError';
    }
  }
  return {
    __esModule: true,
    AuthExpiredError,
    default: {
      getToken: jest.fn(() => Promise.resolve('paseto-test')),
      getTokenExpiresAt: jest.fn(() => 0), // 0 → no token, schedule is a no-op
      refresh: jest.fn(() => Promise.resolve(true)),
      invalidate: jest.fn(() => Promise.resolve()),
      isTokenExpired: jest.fn(() => false),
    },
  };
});

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Build an openapi-fetch-style result for session.connect().
 * 2xx → body in `data`; non-2xx → body in `error`. The service only reads
 * `response.status` / `response.ok`, so a plain object stands in for Response.
 */
function mockConnectResult(status: number, body: Record<string, unknown>) {
  return {
    data: status >= 200 && status < 300 ? body : undefined,
    error: status >= 300 ? body : undefined,
    response: { status, ok: status >= 200 && status < 300 },
  };
}

/**
 * Flush the microtask queue enough times to advance the async connect loop
 * (getToken → client connect → awaits) into `_sleep`. Promises are not affected
 * by fake timers, so this works under `jest.useFakeTimers()`.
 */
const flush = async () => {
  for (let i = 0; i < 20; i++) {
    await Promise.resolve();
  }
};

/**
 * Create a fresh CloudSessionService instance for each test.
 * We bypass the singleton by creating a new instance directly.
 */
function createService(): CloudSessionService {
  // Access the private constructor via any-cast for testing
  const Service = CloudSessionService as unknown as {
    new (): CloudSessionService;
  };
  return new Service();
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('CloudSessionService', () => {
  let service: CloudSessionService;
  let statusEvents: Array<{ status: CloudSessionStatus; info?: any }>;

  beforeEach(() => {
    jest.restoreAllMocks(); // clear any per-test spy overrides
    jest.clearAllMocks();
    jest.useFakeTimers();

    service = createService();

    // Spy on _sleep to resolve immediately so tests don't wait real time
    jest.spyOn(service as unknown as { _sleep(ms: number): Promise<void> }, '_sleep')
      .mockResolvedValue(undefined);

    statusEvents = [];
    service.on('status', (s: CloudSessionStatus, info?: any) => {
      statusEvents.push({ status: s, info });
    });
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    service.removeAllListeners();
  });

  // ── Successful provisioning (202 → 202 → 200 ready) ──────────────────

  it('transitions requesting → provisioning → ready on successful poll', async () => {
    mockConnect
      .mockResolvedValueOnce(mockConnectResult(202, {
        status: 'provisioning',
        session_id: 'sess-abc',
        retry_after_ms: 500,
      }))
      .mockResolvedValueOnce(mockConnectResult(202, {
        status: 'provisioning',
        session_id: 'sess-abc',
        retry_after_ms: 500,
      }))
      .mockResolvedValueOnce(mockConnectResult(200, {
        status: 'ready',
        session_id: 'sess-abc',
        proxy_endpoint: 'wss://proxy.example.com/ws/sync',
      }));

    await expect(service.connect()).resolves.toBeUndefined();

    // Check status transitions
    expect(statusEvents.map(e => e.status)).toEqual([
      'requesting',
      'provisioning',
      'provisioning',
      'ready',
    ]);

    // Session info captured
    expect(service.getSessionId()).toBe('sess-abc');
    expect(service.getStatus()).toBe('ready');
    expect(service.getReadyAt()).not.toBeNull();

    // 3 connect() calls via the client (initial + 2 polls)
    expect(mockConnect).toHaveBeenCalledTimes(3);
  });

  // ── 503 failed → status failed, reason propagated ─────────────────────

  it('transitions to failed with failureReason on 503', async () => {
    mockConnect
      .mockResolvedValueOnce(mockConnectResult(503, {
        status: 'failed',
        failure_reason: 'circuit open',
      }));

    await expect(service.connect()).rejects.toThrow('cloud session failed: circuit open');

    expect(service.getStatus()).toBe('failed');
    expect(service.getReadyAt()).toBeNull();

    // Failed event has reason
    const failedEvent = statusEvents.find(e => e.status === 'failed');
    expect(failedEvent).toBeDefined();
    expect(failedEvent!.info?.failureReason).toBe('circuit open');
  });

  // ── body.status === 'failed' (non-503) → treated as failed ────────────

  it('transitions to failed when body.status is failed even on 200', async () => {
    mockConnect
      .mockResolvedValueOnce(mockConnectResult(200, {
        status: 'failed',
        failure_reason: 'session terminated',
      }));

    await expect(service.connect()).rejects.toThrow('cloud session failed: session terminated');

    expect(service.getStatus()).toBe('failed');
    const failedEvent = statusEvents.find(e => e.status === 'failed');
    expect(failedEvent).toBeDefined();
    expect(failedEvent!.info?.failureReason).toBe('session terminated');
  });

  // ── Max attempts exceeded → failed with timeout message ───────────────

  it('fails with timeout when MAX_PROVISIONING_ATTEMPTS exceeded', async () => {
    // Return 202 provisioning for every call
    const provisioningResponse = mockConnectResult(202, {
      status: 'provisioning',
      session_id: 'sess-timeout',
      retry_after_ms: 500,
    });
    // Need MAX_PROVISIONING_ATTEMPTS + 1 returns -- the initial call + all polls
    for (let i = 0; i <= MAX_PROVISIONING_ATTEMPTS; i++) {
      mockConnect.mockResolvedValueOnce(provisioningResponse);
    }

    await expect(service.connect()).rejects.toThrow('cloud session provisioning timed out');

    expect(service.getStatus()).toBe('failed');
    const failedEvent = statusEvents.find(e => e.status === 'failed');
    expect(failedEvent).toBeDefined();
    expect(failedEvent!.info?.failureReason).toContain('provisioning timed out');
  });

  // ── Concurrent connect() calls share one promise ──────────────────────

  it('shares connect promise across concurrent calls (no double poll)', async () => {
    mockConnect
      .mockResolvedValueOnce(mockConnectResult(202, {
        status: 'provisioning',
        session_id: 'sess-concurrent',
        retry_after_ms: 500,
      }))
      .mockResolvedValueOnce(mockConnectResult(200, {
        status: 'ready',
        session_id: 'sess-concurrent',
        proxy_endpoint: 'wss://proxy.example.com/ws/sync',
      }));

    // Call connect() twice without awaiting the first
    const p1 = service.connect();
    const p2 = service.connect();

    // Both must resolve to the same promise
    await expect(p1).resolves.toBeUndefined();
    await expect(p2).resolves.toBeUndefined();

    // Only 2 client calls (first connect drives the loop; second returns same promise)
    expect(mockConnect).toHaveBeenCalledTimes(2);
    expect(service.getStatus()).toBe('ready');
  });

  // ── Idempotent: calling connect() when ready is a no-op ───────────────

  it('returns immediately when status is already ready', async () => {
    // First: success
    mockConnect
      .mockResolvedValueOnce(mockConnectResult(200, {
        status: 'ready',
        session_id: 'sess-ready',
        proxy_endpoint: 'wss://proxy.example.com/ws/sync',
      }));

    await service.connect();
    expect(mockConnect).toHaveBeenCalledTimes(1);

    // Second call should be a no-op
    mockConnect.mockClear();
    await service.connect();
    expect(mockConnect).not.toHaveBeenCalled();
  });

  // ── force: true bypasses cached ready state ───────────────────────────
  //
  // Regression test for the production bug where WS failures triggered
  // "Max cloud WS failures reached — re-provisioning broker session" but
  // cloudSessionService.connect() short-circuited on cached status==='ready'
  // and never actually called the broker. The app looped forever dialing
  // WS against the same broken session.

  it('force: true bypasses cached ready and makes a fresh broker call', async () => {
    // First call: success → status cached as 'ready'
    mockConnect
      .mockResolvedValueOnce(mockConnectResult(200, {
        status: 'ready',
        session_id: 'sess-original',
        proxy_endpoint: 'wss://proxy.example.com/ws/sync',
      }));
    await service.connect();
    expect(service.getStatus()).toBe('ready');
    expect(service.getSessionId()).toBe('sess-original');

    // Second call WITHOUT force → no-op (cached)
    mockConnect.mockClear();
    await service.connect();
    expect(mockConnect).not.toHaveBeenCalled();

    // Third call WITH force → must hit the broker again even though status is 'ready'
    mockConnect
      .mockResolvedValueOnce(mockConnectResult(200, {
        status: 'ready',
        session_id: 'sess-fresh', // broker reconciled state and returned a new session
        proxy_endpoint: 'wss://proxy.example.com/ws/sync',
      }));
    await service.connect({ force: true });

    expect(mockConnect).toHaveBeenCalledTimes(1);
    expect(service.getSessionId()).toBe('sess-fresh');
    expect(service.getStatus()).toBe('ready');
  });

  it('force: true does NOT disrupt an in-flight provisioning poll', async () => {
    // Start a provisioning poll that will take 2 round-trips
    mockConnect
      .mockResolvedValueOnce(mockConnectResult(202, {
        status: 'provisioning',
        session_id: 'sess-inflight',
        retry_after_ms: 500,
      }))
      .mockResolvedValueOnce(mockConnectResult(200, {
        status: 'ready',
        session_id: 'sess-inflight',
        proxy_endpoint: 'wss://proxy.example.com/ws/sync',
      }));

    const p1 = service.connect();

    // While provisioning, call connect({ force: true }). The re-entrancy guard
    // for in-flight polls must still fire — force only bypasses the cached
    // 'ready' state, not an active poll.
    const p2 = service.connect({ force: true });

    await Promise.all([p1, p2]);

    // Only 2 client calls — second call returned the shared promise
    expect(mockConnect).toHaveBeenCalledTimes(2);
    expect(service.getStatus()).toBe('ready');
  });

  // ── Disconnect mid-poll cancels and resets to idle ────────────────────

  it('disconnect() cancels in-flight poll and resets to idle', async () => {
    // Return provisioning on first call, then hang on the sleep
    mockConnect
      .mockResolvedValueOnce(mockConnectResult(202, {
        status: 'provisioning',
        session_id: 'sess-cancel',
        retry_after_ms: 2000,
      }));

    // Make _sleep controllable so we can assert mid-poll state.
    let sleepResolve: () => void = () => {};
    const sleepPromise = new Promise<void>(resolve => { sleepResolve = resolve; });
    jest.spyOn(
      service as unknown as { _sleep(ms: number): Promise<void> },
      '_sleep',
    ).mockImplementation(() => sleepPromise);

    // Start connect (it will enter the sleep after the first poll)
    const connectPromise = service.connect();

    // Flush microtasks so the client call resolves and the loop enters _sleep
    await flush();

    // Should be in provisioning state
    expect(service.getStatus()).toBe('provisioning');

    // Now disconnect — should cancel the poll
    await service.disconnect();

    // State should be idle
    expect(service.getStatus()).toBe('idle');

    // Resolve the sleep so the loop can check _cancelled and throw
    sleepResolve();

    // The connect promise should reject with 'connect cancelled' or similar
    await expect(connectPromise).rejects.toThrow('connect cancelled');

    // Verify the idle event was emitted
    const idleEvent = statusEvents.find(e => e.status === 'idle');
    expect(idleEvent).toBeDefined();
  });

  // ── Connect after failure starts fresh (no stale promise) ─────────────

  it('can connect again after a failure', async () => {
    // First: 503 failure
    mockConnect
      .mockResolvedValueOnce(mockConnectResult(503, {
        status: 'failed',
        failure_reason: 'circuit open',
      }));

    await expect(service.connect()).rejects.toThrow('cloud session failed');
    expect(service.getStatus()).toBe('failed');

    // Second: success
    mockConnect
      .mockClear()
      .mockResolvedValueOnce(mockConnectResult(200, {
        status: 'ready',
        session_id: 'sess-retry',
        proxy_endpoint: 'wss://proxy.example.com/ws/sync',
      }));

    await expect(service.connect()).resolves.toBeUndefined();
    expect(service.getStatus()).toBe('ready');
    expect(service.getSessionId()).toBe('sess-retry');
  });

  // ── 200 with body.status === 'active' (grace recovery) → treated as ready ──

  it('treats active status as ready (grace session recovery)', async () => {
    mockConnect
      .mockResolvedValueOnce(mockConnectResult(200, {
        status: 'active',
        session_id: 'sess-grace',
        proxy_endpoint: 'wss://proxy.example.com/ws/sync',
      }));

    await expect(service.connect()).resolves.toBeUndefined();
    expect(service.getStatus()).toBe('ready');
    expect(service.getSessionId()).toBe('sess-grace');
  });

  // ── Network error (client throws) → failed ───────────────────────────

  it('transitions to failed when the client throws', async () => {
    mockConnect
      .mockRejectedValueOnce(new Error('Network request failed'));

    await expect(service.connect()).rejects.toThrow('Network request failed');
    expect(service.getStatus()).toBe('failed');

    const failedEvent = statusEvents.find(e => e.status === 'failed');
    expect(failedEvent).toBeDefined();
    expect(failedEvent!.info?.failureReason).toContain('Network request failed');
  });

  // ── disconnect() best-effort notifies the broker via the client ───────

  it('disconnect() calls session.disconnect() with the cached session id', async () => {
    // Provision a ready session first
    mockConnect
      .mockResolvedValueOnce(mockConnectResult(200, {
        status: 'ready',
        session_id: 'sess-disconnect',
        proxy_endpoint: 'wss://proxy.example.com/ws/sync',
      }));
    await service.connect();
    expect(service.getSessionId()).toBe('sess-disconnect');

    await service.disconnect();

    expect(service.getStatus()).toBe('idle');
    expect(mockDisconnect).toHaveBeenCalledTimes(1);
    expect(mockDisconnect).toHaveBeenCalledWith('sess-disconnect');
  });

  // ── 401 during connect → refresh once via AuthService, then succeed ───
  //
  // Guards the auth policy: the client is built PASETO-only (no refreshToken),
  // so a 401 surfaces as an error result and _doConnect must refresh through
  // AuthService and retry once. The second client call is made with the same
  // (cached) token — AuthService.refresh() is the mocked source of freshness.

  it('refreshes the PASETO once on 401 and retries the connect', async () => {
    const AuthService = jest.requireMock('../src/services/auth/AuthService').default;

    mockConnect
      .mockResolvedValueOnce(mockConnectResult(401, { error: 'token expired' }))
      .mockResolvedValueOnce(mockConnectResult(200, {
        status: 'ready',
        session_id: 'sess-after-refresh',
        proxy_endpoint: 'wss://proxy.example.com/ws/sync',
      }));

    await expect(service.connect()).resolves.toBeUndefined();

    expect(service.getStatus()).toBe('ready');
    expect(service.getSessionId()).toBe('sess-after-refresh');
    // Two client round-trips: the 401 + the post-refresh success.
    expect(mockConnect).toHaveBeenCalledTimes(2);
    expect(AuthService.refresh).toHaveBeenCalledTimes(1);
  });
});
