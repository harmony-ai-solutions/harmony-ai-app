/**
 * CloudSessionService — connect state machine tests.
 *
 * The service drives the session broker through the first-party Soulbits API
 * client's `session.connectPoll(version, options, deviceId)`. The client factory
 * (`buildSoulbitsClient`) is mocked so tests assert the service's status
 * transitions (requesting → ready/failed/deviceAuthRequired), concurrency, and
 * cancellation — without touching the network or the real client package.
 *
 * The mock returns the typed `SessionConnectResponse` directly (connectPoll
 * unwraps the HTTP envelope itself) and rejects with typed errors on failure.
 */

import { CloudSessionService, CloudSessionStatus, DeviceAuthRequiredError } from '../src/services/cloud/CloudSessionService';
import { DeviceAuthRequiredError as ClientDeviceAuthRequiredError, APIError } from '@harmony-ai-solutions/soulbits-api-client';

// ── Mocks ──────────────────────────────────────────────────────────────────

// Variables referenced inside jest.mock factories must start with `mock`.
const mockConnectPoll = jest.fn();
const mockDisconnect = jest.fn();

jest.mock('../src/services/cloud/soulbitsClient', () => ({
  buildSoulbitsClient: jest.fn(() => ({
    session: {
      connectPoll: mockConnectPoll,
      disconnect: mockDisconnect,
    },
  })),
}));

// AuthService is called by _runConnectLoop (getToken) and by
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

// DeviceIdProvider feeds the D-DEV-04 gate; pin a stable id for assertions.
jest.mock('../src/services/cloud/DeviceIdProvider', () => ({
  getDeviceId: jest.fn(() => Promise.resolve('device-test-0000')),
}));

// ── Helpers ────────────────────────────────────────────────────────────────

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

  // ── Successful provisioning (connectPoll resolves ready) ────────────────

  it('transitions requesting → ready when connectPoll resolves ready', async () => {
    mockConnectPoll.mockResolvedValue({
      status: 'ready',
      session_id: 'sess-abc',
      proxy_endpoint: 'wss://proxy.example.com/ws/sync',
    });

    await expect(service.connect()).resolves.toBeUndefined();

    // Status transitions: requesting (from connect) → ready (terminal)
    expect(statusEvents.map(e => e.status)).toEqual(['requesting', 'ready']);

    // Session info captured
    expect(service.getSessionId()).toBe('sess-abc');
    expect(service.getStatus()).toBe('ready');
    expect(service.getReadyAt()).not.toBeNull();

    // device_id forwarded to the client's connectPoll (version undefined)
    expect(mockConnectPoll).toHaveBeenCalledTimes(1);
    expect(mockConnectPoll).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({ timeoutMs: expect.any(Number) }),
      'device-test-0000',
    );
  });

  // ── Terminal failure (connectPoll rejects) ──────────────────────────────

  it('transitions to failed with failureReason when connectPoll rejects', async () => {
    mockConnectPoll.mockRejectedValue(new Error('Session provisioning failed: circuit open'));

    await expect(service.connect()).rejects.toThrow('circuit open');

    expect(service.getStatus()).toBe('failed');
    expect(service.getReadyAt()).toBeNull();

    // Failed event has reason
    const failedEvent = statusEvents.find(e => e.status === 'failed');
    expect(failedEvent).toBeDefined();
    expect(failedEvent!.info?.failureReason).toContain('circuit open');
  });

  // ── Timeout (client-owned budget exhausted) → failed ────────────────────

  it('fails when connectPoll rejects with a timeout', async () => {
    mockConnectPoll.mockRejectedValue(new Error('Session provisioning timed out after 120 retries'));

    await expect(service.connect()).rejects.toThrow('timed out');

    expect(service.getStatus()).toBe('failed');
    const failedEvent = statusEvents.find(e => e.status === 'failed');
    expect(failedEvent).toBeDefined();
    expect(failedEvent!.info?.failureReason).toContain('timed out');
  });

  // ── 403 device_authorization_required → deviceAuthRequired status ───────

  it('transitions to deviceAuthRequired and rethrows app-local DeviceAuthRequiredError on 403', async () => {
    mockConnectPoll.mockRejectedValue(new ClientDeviceAuthRequiredError());

    await expect(service.connect()).rejects.toBeInstanceOf(DeviceAuthRequiredError);

    expect(service.getStatus()).toBe('deviceAuthRequired');
    const gateEvent = statusEvents.find(e => e.status === 'deviceAuthRequired');
    expect(gateEvent).toBeDefined();
  });

  // ── 401 → surfaces as failed (client has no refresh; AuthService owns it) ─

  it('transitions to failed when connectPoll rejects with 401 APIError', async () => {
    mockConnectPoll.mockRejectedValue(new APIError(401, { error: 'token expired' }));

    await expect(service.connect()).rejects.toThrow('token expired');

    expect(service.getStatus()).toBe('failed');
    const failedEvent = statusEvents.find(e => e.status === 'failed');
    expect(failedEvent).toBeDefined();
    expect(failedEvent!.info?.failureReason).toContain('token expired');
  });

  // ── Concurrent connect() calls share one promise ────────────────────────

  it('shares connect promise across concurrent calls (no double poll)', async () => {
    mockConnectPoll.mockResolvedValue({
      status: 'ready',
      session_id: 'sess-concurrent',
      proxy_endpoint: 'wss://proxy.example.com/ws/sync',
    });

    // Call connect() twice without awaiting the first
    const p1 = service.connect();
    const p2 = service.connect();

    // Both must resolve to the same promise
    await expect(p1).resolves.toBeUndefined();
    await expect(p2).resolves.toBeUndefined();

    // Only 1 client call (first connect drives the loop; second returns same promise)
    expect(mockConnectPoll).toHaveBeenCalledTimes(1);
    expect(service.getStatus()).toBe('ready');
  });

  // ── Idempotent: calling connect() when ready is a no-op ─────────────────

  it('returns immediately when status is already ready', async () => {
    // First: success
    mockConnectPoll.mockResolvedValueOnce({
      status: 'ready',
      session_id: 'sess-ready',
      proxy_endpoint: 'wss://proxy.example.com/ws/sync',
    });

    await service.connect();
    expect(mockConnectPoll).toHaveBeenCalledTimes(1);

    // Second call should be a no-op
    mockConnectPoll.mockClear();
    await service.connect();
    expect(mockConnectPoll).not.toHaveBeenCalled();
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
    mockConnectPoll
      .mockResolvedValueOnce({
        status: 'ready',
        session_id: 'sess-original',
        proxy_endpoint: 'wss://proxy.example.com/ws/sync',
      });
    await service.connect();
    expect(service.getStatus()).toBe('ready');
    expect(service.getSessionId()).toBe('sess-original');

    // Second call WITHOUT force → no-op (cached)
    mockConnectPoll.mockClear();
    await service.connect();
    expect(mockConnectPoll).not.toHaveBeenCalled();

    // Third call WITH force → must hit the broker again even though status is 'ready'
    mockConnectPoll
      .mockResolvedValueOnce({
        status: 'ready',
        session_id: 'sess-fresh', // broker reconciled state and returned a new session
        proxy_endpoint: 'wss://proxy.example.com/ws/sync',
      });
    await service.connect({ force: true });

    expect(mockConnectPoll).toHaveBeenCalledTimes(1);
    expect(service.getSessionId()).toBe('sess-fresh');
    expect(service.getStatus()).toBe('ready');
  });

  it('force: true does NOT disrupt an in-flight provisioning poll', async () => {
    // connectPoll is a single (client-owned) call that resolves ready
    mockConnectPoll.mockResolvedValue({
      status: 'ready',
      session_id: 'sess-inflight',
      proxy_endpoint: 'wss://proxy.example.com/ws/sync',
    });

    const p1 = service.connect();

    // While provisioning, call connect({ force: true }). The re-entrancy guard
    // for in-flight polls must still fire — force only bypasses the cached
    // 'ready' state, not an active poll.
    const p2 = service.connect({ force: true });

    await Promise.all([p1, p2]);

    // Only 1 client call — second call returned the shared promise
    expect(mockConnectPoll).toHaveBeenCalledTimes(1);
    expect(service.getStatus()).toBe('ready');
  });

  // ── Disconnect mid-poll cancels and resets to idle ──────────────────────

  it('disconnect() cancels in-flight connect and resets to idle', async () => {
    // Hang the connectPoll until we resolve it after disconnect()
    let resolvePoll: (v: any) => void = () => {};
    mockConnectPoll.mockImplementation(
      () => new Promise(resolve => { resolvePoll = resolve; }),
    );

    // Start connect (it will await the pending connectPoll)
    const connectPromise = service.connect();

    // Flush microtasks so the loop reaches the pending connectPoll call
    for (let i = 0; i < 20; i++) {
      await Promise.resolve();
    }

    // Now disconnect — should cancel the poll
    await service.disconnect();

    // State should be idle
    expect(service.getStatus()).toBe('idle');

    // Resolve the poll — the loop must observe _cancelled and bail
    resolvePoll({
      status: 'ready',
      session_id: 'sess-cancel',
      proxy_endpoint: 'wss://proxy.example.com/ws/sync',
    });

    // The connect promise should reject with 'connect cancelled'
    await expect(connectPromise).rejects.toThrow('connect cancelled');

    // Verify the idle event was emitted
    const idleEvent = statusEvents.find(e => e.status === 'idle');
    expect(idleEvent).toBeDefined();
  });

  // ── Connect after failure starts fresh (no stale promise) ─────────────

  it('can connect again after a failure', async () => {
    // First: failure
    mockConnectPoll
      .mockRejectedValueOnce(new Error('Session provisioning failed: circuit open'));

    await expect(service.connect()).rejects.toThrow('circuit open');
    expect(service.getStatus()).toBe('failed');

    // Second: success
    mockConnectPoll
      .mockResolvedValueOnce({
        status: 'ready',
        session_id: 'sess-retry',
        proxy_endpoint: 'wss://proxy.example.com/ws/sync',
      });

    await expect(service.connect()).resolves.toBeUndefined();
    expect(service.getStatus()).toBe('ready');
    expect(service.getSessionId()).toBe('sess-retry');
  });

  // ── connectPoll returns status === 'active' (grace recovery) → ready ──

  it('treats active status as ready (grace session recovery)', async () => {
    mockConnectPoll.mockResolvedValue({
      status: 'active',
      session_id: 'sess-grace',
      proxy_endpoint: 'wss://proxy.example.com/ws/sync',
    });

    await expect(service.connect()).resolves.toBeUndefined();
    expect(service.getStatus()).toBe('ready');
    expect(service.getSessionId()).toBe('sess-grace');
  });

  // ── Network error (client throws) → failed ───────────────────────────

  it('transitions to failed when the client throws', async () => {
    mockConnectPoll.mockRejectedValue(new Error('Network request failed'));

    await expect(service.connect()).rejects.toThrow('Network request failed');
    expect(service.getStatus()).toBe('failed');

    const failedEvent = statusEvents.find(e => e.status === 'failed');
    expect(failedEvent).toBeDefined();
    expect(failedEvent!.info?.failureReason).toContain('Network request failed');
  });

  // ── disconnect() best-effort notifies the broker via the client ───────

  it('disconnect() calls session.disconnect() with the cached session id', async () => {
    // Provision a ready session first
    mockConnectPoll.mockResolvedValue({
      status: 'ready',
      session_id: 'sess-disconnect',
      proxy_endpoint: 'wss://proxy.example.com/ws/sync',
    });
    await service.connect();
    expect(service.getSessionId()).toBe('sess-disconnect');

    await service.disconnect();

    expect(service.getStatus()).toBe('idle');
    expect(mockDisconnect).toHaveBeenCalledTimes(1);
    expect(mockDisconnect).toHaveBeenCalledWith('sess-disconnect');
  });
});
