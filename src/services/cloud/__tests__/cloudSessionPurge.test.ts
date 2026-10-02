/**
 * CloudSessionService async cloud-data-purge tests (cloud-data-deletion.md §7).
 *
 * Contract: ONE initiating POST → poll GET status every ~3s → terminal.
 *
 * Covers:
 *   - happy path: 202 → poll in_progress phases → deleted → legacy
 *     purge:done + full purge:terminal payload, status idle
 *   - 200-adopt: a 200 in_progress initiation adopts the running purge —
 *     the POST is NEVER re-sent (old 40× re-POST loop is gone)
 *   - snapshot-busy (409) retries (server retry_after_ms) then success,
 *     and the ≤10-tries exhaustion → purge:failed, status idle
 *   - 503/network backoff exhaustion → purge:failed "could not start"
 *   - terminal `failed` status → purge:failed + purge:terminal, then a full
 *     retry from initiating is allowed
 *   - 401 → AuthService.refresh() → rebuild → continue; 3 consecutive
 *     refresh failures → purge:failed with an auth reason
 *   - 15-min deadline → purge:terminal deadline; isPurging() STAYS true
 *   - `none` handling: transient while holding a request_id (≤3) vs
 *     cold-attach `none` = idle, no UI state
 *   - poll failures (offline mid-purge) NEVER settle the purge — the
 *     progress events flag `reconnecting` instead, and polling continues
 *   - attachToRunningPurge: in_progress → adopt + poll; deleted/failed →
 *     terminal replay; none → idle
 *   - backward-compat: purge:done / purge:failed still fire (before
 *     purge:terminal), and connect() still rejects while purging
 *
 * Client module is mocked (pattern from deviceAuth.test.ts); fake timers
 * drive the 3s poll cadence and backoff waits deterministically.
 */

jest.mock('../../../utils/logger', () => ({
  createLogger: () => ({
    warn: jest.fn(),
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }),
}));

jest.mock('../../auth/AuthService', () => ({
  __esModule: true,
  default: {
    getToken: jest.fn(async () => 'paseto-test'),
    refresh: jest.fn(async () => true),
  },
}));

jest.mock('@harmony-ai-solutions/soulbits-api-client', () => {
  const disconnect = jest.fn(async () => ({}));
  const deleteDataOrThrow = jest.fn();
  const deleteStatusOrThrow = jest.fn();

  class MockSnapshotBusyError extends Error {
    retryAfterMs?: number;
    constructor(retryAfterMs?: number) {
      super('snapshot_busy');
      this.name = 'SnapshotBusyError';
      this.retryAfterMs = retryAfterMs;
    }
  }
  class MockPurgeInProgressError extends Error {
    retryAfterMs?: number;
    constructor(retryAfterMs?: number) {
      super('purge_in_progress');
      this.name = 'PurgeInProgressError';
      this.retryAfterMs = retryAfterMs;
    }
  }
  class MockAPIError extends Error {
    status: number;
    constructor(status: number, body: Record<string, unknown>) {
      super((body?.error as string | undefined) ?? `HTTP ${status}`);
      this.name = 'APIError';
      this.status = status;
    }
  }

  return {
    createClient: () => ({
      session: { disconnect, deleteDataOrThrow, deleteStatusOrThrow },
      devices: {},
    }),
    SnapshotBusyError: MockSnapshotBusyError,
    PurgeInProgressError: MockPurgeInProgressError,
    APIError: MockAPIError,
    __disconnect: disconnect,
    __deleteDataOrThrow: deleteDataOrThrow,
    __deleteStatusOrThrow: deleteStatusOrThrow,
    __SnapshotBusyError: MockSnapshotBusyError,
    __APIError: MockAPIError,
  };
});

import * as SoulbitsClient from '@harmony-ai-solutions/soulbits-api-client';
import AuthService from '../../auth/AuthService';
import { cloudSessionService } from '../CloudSessionService';

const mockDisconnect = (SoulbitsClient as any).__disconnect as jest.Mock;
const mockDeleteData = (SoulbitsClient as any).__deleteDataOrThrow as jest.Mock;
const mockDeleteStatus = (SoulbitsClient as any).__deleteStatusOrThrow as jest.Mock;
const SnapshotBusy = (SoulbitsClient as any).__SnapshotBusyError as new (
  retryAfterMs?: number,
) => Error;
const APIErrorCtor = (SoulbitsClient as any).__APIError as new (
  status: number,
  body: Record<string, unknown>,
) => Error;

const svc: any = cloudSessionService;

/** Max poll interval = 3000 + 500 jitter; step past it each tick. */
const POLL_TICK_MS = 3_600;

/**
 * Drive the purge promise through its pending timer waits until it resolves.
 * Each advance covers one poll interval / retry wait.
 */
async function flushPurge(p: Promise<void>, maxTicks = 200): Promise<void> {
  for (let i = 0; i < maxTicks; i++) {
    await jest.advanceTimersByTimeAsync(POLL_TICK_MS);
  }
  await p;
}

/**
 * Advance until the purge promise settles (deadline included), stopping as
 * soon as it does so nothing AFTER the settle (e.g. the ~60s deadline
 * re-probe timer) fires inside this helper — re-probes are driven explicitly.
 */
async function advanceUntilSettled(p: Promise<void>, maxTicks = 400): Promise<void> {
  let settled = false;
  const mark = () => { settled = true; };
  p.then(mark, mark);
  for (let i = 0; i < maxTicks && !settled; i++) {
    // eslint-disable-next-line no-await-in-loop
    await jest.advanceTimersByTimeAsync(POLL_TICK_MS);
  }
  await p;
  expect(settled).toBe(true);
}

/** Worst-case re-probe delay = 60s + 10s jitter. */
const REPROBE_TICK_MS = 75_000;

/** Reset the singleton's per-run purge state between tests. */
function resetPurgeState(): void {
  svc.sessionId = null;
  svc.status = 'idle';
  svc.purgeRunState = 'idle';
  svc.purgeStartedAt = null;
  svc.purgeRequestId = null;
  svc.purgeAttempts = 0;
  svc.purgePhase = undefined;
  svc.lastPurgeTerminal = null;
  svc._purgePromise = null;
  svc._attachPromise = null;
  if (svc.purgeWaitTimer) {
    clearTimeout(svc.purgeWaitTimer);
    svc.purgeWaitTimer = null;
  }
  svc.purgeWaitResolve = null;
  if (svc.purgeReprobeTimer) {
    clearTimeout(svc.purgeReprobeTimer);
    svc.purgeReprobeTimer = null;
  }
  svc.removeAllListeners();
}

/** Standard terminal-success status payload. */
function deletedStatus(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    status: 'deleted',
    request_id: 'req-1',
    attempts: 0,
    objects_deleted: 4,
    versions_deleted: 5,
    beats_removed: 2,
    dek_deleted: true,
    finished_at: 1_790_964_494,
    ...overrides,
  };
}

beforeEach(() => {
  jest.useFakeTimers();
  resetPurgeState();
  mockDisconnect.mockClear();
  mockDeleteData.mockReset();
  mockDeleteStatus.mockReset();
  (AuthService.refresh as jest.Mock).mockClear();
  (AuthService.refresh as jest.Mock).mockResolvedValue(true);
});

afterEach(() => {
  jest.useRealTimers();
});

describe('CloudSessionService.purgeCloudData — happy path', () => {
  it('202 → poll in_progress phases → deleted: one POST, legacy + terminal events, idle', async () => {
    svc.sessionId = 'sess-live';
    mockDeleteData.mockResolvedValueOnce({ status: 'in_progress', request_id: 'req-1' });
    mockDeleteStatus
      .mockResolvedValueOnce({ status: 'in_progress', phase: 'start', request_id: 'req-1', attempts: 0 })
      .mockResolvedValueOnce({ status: 'in_progress', phase: 's3', request_id: 'req-1', attempts: 1 })
      .mockResolvedValueOnce(deletedStatus());

    const done = jest.fn();
    const terminal = jest.fn();
    const progress = jest.fn();
    cloudSessionService.on('purge:done', done);
    cloudSessionService.on('purge:terminal', terminal);
    cloudSessionService.on('purge:progress', progress);

    await flushPurge(cloudSessionService.purgeCloudData());

    // Broker notified of the old session first; exactly ONE POST.
    expect(mockDisconnect).toHaveBeenCalledTimes(1);
    expect(mockDeleteData).toHaveBeenCalledTimes(1);
    expect(mockDeleteData).toHaveBeenCalledWith('DELETE');
    // Polled until terminal (3 status calls).
    expect(mockDeleteStatus).toHaveBeenCalledTimes(3);

    // Progress events carried the run state + phase transitions:
    // [0] initiating, [1] adopted→polling (no phase yet), [2..] per-poll.
    const phases = progress.mock.calls.map((c: any[]) => c[0]);
    expect(phases.length).toBeGreaterThanOrEqual(4);
    expect(phases[0]).toMatchObject({ runState: 'initiating', requestId: null });
    expect(phases[1]).toMatchObject({ runState: 'polling', requestId: 'req-1' });
    expect(phases[1].phase).toBeUndefined();
    expect(phases[2]).toMatchObject({ runState: 'polling', phase: 'start', requestId: 'req-1' });
    expect(phases[3]).toMatchObject({ runState: 'polling', phase: 's3', attempts: 1 });
    expect(phases[2].elapsedMs).toBeGreaterThanOrEqual(0);
    expect(phases[2].reconnecting).toBe(false);

    // Legacy event still fires; terminal carries the full counters AFTER it.
    expect(done).toHaveBeenCalledTimes(1);
    expect(terminal).toHaveBeenCalledTimes(1);
    expect(done.mock.invocationCallOrder[0]).toBeLessThan(terminal.mock.invocationCallOrder[0]);
    expect(terminal).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: 'deleted',
        requestId: 'req-1',
        attempts: 0,
        objectsDeleted: 4,
        versionsDeleted: 5,
        beatsRemoved: 2,
        dekDeleted: true,
        finishedAt: 1_790_964_494,
      }),
    );

    expect(cloudSessionService.getStatus()).toBe('idle');
    expect(cloudSessionService.isPurging()).toBe(false);
    expect(cloudSessionService.getPurgeRunState()).toBe('deleted');
    expect(cloudSessionService.getLastPurgeTerminal()?.outcome).toBe('deleted');
  });

  it('200 in_progress (concurrent/other device) → ADOPT: no re-POST, straight to polling', async () => {
    mockDeleteData.mockResolvedValueOnce({ status: 'in_progress', request_id: 'req-200' });
    mockDeleteStatus
      .mockResolvedValueOnce({ status: 'in_progress', phase: 'kill', request_id: 'req-200', attempts: 2 })
      .mockResolvedValueOnce(deletedStatus({ request_id: 'req-200' }));

    const done = jest.fn();
    cloudSessionService.on('purge:done', done);

    await flushPurge(cloudSessionService.purgeCloudData());

    // The POST was sent EXACTLY once — the old re-POST loop is gone.
    expect(mockDeleteData).toHaveBeenCalledTimes(1);
    expect(done).toHaveBeenCalledTimes(1);
    expect(cloudSessionService.getStatus()).toBe('idle');
  });
});

describe('CloudSessionService.purgeCloudData — initiating retries', () => {
  it('snapshot_busy ×2 (server retry_after_ms) then 202 → purge:done', async () => {
    mockDeleteData
      .mockRejectedValueOnce(new SnapshotBusy(3_000))
      .mockRejectedValueOnce(new SnapshotBusy(3_000))
      .mockResolvedValueOnce({ status: 'in_progress', request_id: 'req-1' });
    mockDeleteStatus.mockResolvedValue(deletedStatus());

    const done = jest.fn();
    cloudSessionService.on('purge:done', done);

    await flushPurge(cloudSessionService.purgeCloudData());

    expect(done).toHaveBeenCalledTimes(1);
    expect(mockDeleteData).toHaveBeenCalledTimes(3);
    expect(cloudSessionService.getStatus()).toBe('idle');
  });

  it('snapshot_busy exhausted (10 tries) → purge:failed, status idle (not failed)', async () => {
    mockDeleteData.mockRejectedValue(new SnapshotBusy(3_000));

    const failed = jest.fn();
    cloudSessionService.on('purge:failed', failed);

    await flushPurge(cloudSessionService.purgeCloudData());

    expect(failed).toHaveBeenCalledTimes(1);
    expect(failed.mock.calls[0][0]).toContain('snapshot busy');
    expect(mockDeleteData).toHaveBeenCalledTimes(10);
    expect(cloudSessionService.getStatus()).toBe('idle');
    expect(cloudSessionService.isPurging()).toBe(false);
  });

  it('503 ×5 → purge:failed "could not start" after the bounded backoff', async () => {
    mockDeleteData.mockRejectedValue(new APIErrorCtor(503, { error: 'service_unavailable' }));

    const failed = jest.fn();
    cloudSessionService.on('purge:failed', failed);

    await flushPurge(cloudSessionService.purgeCloudData());

    expect(failed).toHaveBeenCalledTimes(1);
    expect(failed.mock.calls[0][0]).toContain('could not start');
    expect(mockDeleteData).toHaveBeenCalledTimes(5);
    expect(cloudSessionService.getStatus()).toBe('idle');
  });
});

describe('CloudSessionService.purgeCloudData — terminal failed + retry', () => {
  it('status failed → purge:failed(server error) + terminal failed; retry runs a full new flow', async () => {
    mockDeleteData
      .mockResolvedValueOnce({ status: 'in_progress', request_id: 'req-1' })
      // Second run (retry) gets a fresh 202.
      .mockResolvedValueOnce({ status: 'in_progress', request_id: 'req-2' });
    mockDeleteStatus
      .mockResolvedValueOnce({
        status: 'failed',
        request_id: 'req-1',
        attempts: 5,
        error: 'attempt cap reached',
        objects_deleted: 0,
        versions_deleted: 0,
        beats_removed: 0,
        dek_deleted: false,
        finished_at: 1_790_964_494,
      })
      .mockResolvedValueOnce(deletedStatus({ request_id: 'req-2' }));

    const failed = jest.fn();
    const done = jest.fn();
    const terminal = jest.fn();
    cloudSessionService.on('purge:failed', failed);
    cloudSessionService.on('purge:done', done);
    cloudSessionService.on('purge:terminal', terminal);

    await flushPurge(cloudSessionService.purgeCloudData());

    expect(failed).toHaveBeenCalledWith('attempt cap reached');
    expect(done).not.toHaveBeenCalled();
    expect(terminal).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'failed', error: 'attempt cap reached', attempts: 5 }),
    );
    expect(cloudSessionService.getStatus()).toBe('idle');
    expect(cloudSessionService.isPurging()).toBe(false);

    // User unblocked — a retry runs a full new flow from initiating.
    await flushPurge(cloudSessionService.purgeCloudData());
    expect(mockDeleteData).toHaveBeenCalledTimes(2);
    expect(done).toHaveBeenCalledTimes(1);
    expect(terminal).toHaveBeenCalledTimes(2);
    expect(cloudSessionService.getStatus()).toBe('idle');
  });
});

describe('CloudSessionService.purgeCloudData — auth refresh in-loop', () => {
  it('401 → AuthService.refresh() → rebuild → continue to success', async () => {
    mockDeleteData
      .mockRejectedValueOnce(new APIErrorCtor(401, { error: 'unauthorized' }))
      .mockResolvedValueOnce({ status: 'in_progress', request_id: 'req-1' });
    mockDeleteStatus.mockResolvedValue(deletedStatus());

    const done = jest.fn();
    cloudSessionService.on('purge:done', done);

    await flushPurge(cloudSessionService.purgeCloudData());

    expect(AuthService.refresh).toHaveBeenCalledTimes(1);
    expect(done).toHaveBeenCalledTimes(1);
    expect(cloudSessionService.getStatus()).toBe('idle');
  });

  it('3 consecutive refresh failures → purge:failed with an auth reason', async () => {
    (AuthService.refresh as jest.Mock).mockResolvedValue(false);
    mockDeleteData.mockRejectedValue(new APIErrorCtor(401, { error: 'unauthorized' }));

    const failed = jest.fn();
    cloudSessionService.on('purge:failed', failed);

    await flushPurge(cloudSessionService.purgeCloudData());

    expect(failed).toHaveBeenCalledTimes(1);
    expect(failed.mock.calls[0][0]).toContain('authentication expired');
    // 3 POSTs, one refresh per occurrence.
    expect(mockDeleteData).toHaveBeenCalledTimes(3);
    expect(AuthService.refresh).toHaveBeenCalledTimes(3);
    expect(cloudSessionService.getStatus()).toBe('idle');
  });
});

describe('CloudSessionService.purgeCloudData — deadline', () => {
  it('15-min wall clock → purge:terminal deadline; isPurging() STAYS true; re-probe armed', async () => {
    mockDeleteData.mockResolvedValueOnce({ status: 'in_progress', request_id: 'req-1' });
    mockDeleteStatus.mockResolvedValue({
      status: 'in_progress', phase: 's3', request_id: 'req-1', attempts: 3,
    });

    const done = jest.fn();
    const failed = jest.fn();
    const terminal = jest.fn();
    cloudSessionService.on('purge:done', done);
    cloudSessionService.on('purge:failed', failed);
    cloudSessionService.on('purge:terminal', terminal);

    // Advance only until the deadline settles (stop-before-re-probe).
    await advanceUntilSettled(cloudSessionService.purgeCloudData());

    expect(done).not.toHaveBeenCalled();
    expect(failed).not.toHaveBeenCalled();
    expect(terminal).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'deadline' }),
    );
    // Deadline keeps the connect gate up: still 'purging'.
    expect(cloudSessionService.getStatus()).toBe('purging');
    expect(cloudSessionService.isPurging()).toBe(true);
    expect(cloudSessionService.getPurgeRunState()).toBe('deadline');
    // The self-heal cadence is armed so a server-side completion AFTER our
    // budget resolves the latch without user action.
    expect((svc as any).purgeReprobeTimer).not.toBeNull();
  });
});

describe('CloudSessionService.purgeCloudData — `none` handling', () => {
  it('none while holding a request_id → transient, keeps polling, then deleted', async () => {
    mockDeleteData.mockResolvedValueOnce({ status: 'in_progress', request_id: 'req-1' });
    mockDeleteStatus
      .mockResolvedValueOnce({ status: 'none' })
      .mockResolvedValueOnce({ status: 'in_progress', phase: 'dek', request_id: 'req-1', attempts: 0 })
      .mockResolvedValueOnce(deletedStatus());

    const done = jest.fn();
    cloudSessionService.on('purge:done', done);

    await flushPurge(cloudSessionService.purgeCloudData());

    expect(done).toHaveBeenCalledTimes(1);
    expect(cloudSessionService.getStatus()).toBe('idle');
  });

  it('none ×4 with a held request_id → settles failed (status lost, retry safe)', async () => {
    mockDeleteData.mockResolvedValueOnce({ status: 'in_progress', request_id: 'req-1' });
    mockDeleteStatus.mockResolvedValue({ status: 'none' });

    const failed = jest.fn();
    cloudSessionService.on('purge:failed', failed);

    await flushPurge(cloudSessionService.purgeCloudData());

    expect(failed).toHaveBeenCalledTimes(1);
    expect(failed.mock.calls[0][0]).toContain('status lost');
    expect(cloudSessionService.getStatus()).toBe('idle');
  });
});

describe('CloudSessionService.purgeCloudData — offline mid-purge', () => {
  it('poll failures never settle the purge; progress flags reconnecting; recovers to deleted', async () => {
    mockDeleteData.mockResolvedValueOnce({ status: 'in_progress', request_id: 'req-1' });
    mockDeleteStatus
      .mockRejectedValueOnce(new TypeError('Network request failed'))
      .mockRejectedValueOnce(new TypeError('Network request failed'))
      .mockRejectedValueOnce(new TypeError('Network request failed'))
      .mockResolvedValueOnce({ status: 'in_progress', phase: 'beats', request_id: 'req-1', attempts: 0 })
      .mockResolvedValueOnce(deletedStatus());

    const failed = jest.fn();
    const done = jest.fn();
    const progress = jest.fn();
    cloudSessionService.on('purge:failed', failed);
    cloudSessionService.on('purge:done', done);
    cloudSessionService.on('purge:progress', progress);

    await flushPurge(cloudSessionService.purgeCloudData());

    // Connectivity loss NEVER emits purge:failed.
    expect(failed).not.toHaveBeenCalled();
    expect(done).toHaveBeenCalledTimes(1);
    // ...but the reconnecting affordance was flagged after 3 failures.
    const reconnecting = progress.mock.calls
      .map((c: any[]) => c[0])
      .filter((p: any) => p.reconnecting === true);
    expect(reconnecting.length).toBeGreaterThanOrEqual(1);
    expect(cloudSessionService.getStatus()).toBe('idle');
  });
});

describe('CloudSessionService — deadline latch escape (re-probe/attach)', () => {
  /** Run to the deadline latch (stops BEFORE the re-probe fires). */
  async function runToDeadline(): Promise<void> {
    mockDeleteData.mockResolvedValueOnce({ status: 'in_progress', request_id: 'req-1' });
    mockDeleteStatus.mockResolvedValue({
      status: 'in_progress', phase: 's3', request_id: 'req-1', attempts: 3,
    });
    await advanceUntilSettled(cloudSessionService.purgeCloudData());
    expect(cloudSessionService.getPurgeRunState()).toBe('deadline');
    expect(cloudSessionService.getStatus()).toBe('purging');
  }

  it('attach performs a REAL status GET in deadline (no latch) and adopts in_progress', async () => {
    await runToDeadline();
    const getsAfterRun = mockDeleteStatus.mock.calls.length;

    // Attach re-probes: server still running → ADOPT (fresh deadline).
    mockDeleteStatus
      .mockResolvedValueOnce({ status: 'in_progress', phase: 'dek', request_id: 'req-1', attempts: 4 })
      .mockResolvedValueOnce(deletedStatus({ request_id: 'req-1' }));

    const result = await cloudSessionService.attachToRunningPurge();

    expect(result).toMatchObject({ kind: 'adopted', progress: { runState: 'polling', phase: 'dek', attempts: 4 } });
    expect(mockDeleteStatus.mock.calls.length).toBe(getsAfterRun + 1); // real GET happened
    expect(cloudSessionService.isPurging()).toBe(true);
    expect(cloudSessionService.getPurgeRunState()).toBe('polling');
    // Adopt stops the self-heal cadence — an active run owns the loop again.
    expect((svc as any).purgeReprobeTimer).toBeNull();

    // The adopted poll loop runs to terminal — with NO re-POST anywhere.
    const done = jest.fn();
    cloudSessionService.on('purge:done', done);
    await flushPurge(new Promise<void>(r => cloudSessionService.once('purge:terminal', () => r())));
    expect(done).toHaveBeenCalledTimes(1);
    expect(cloudSessionService.getStatus()).toBe('idle');
    expect(mockDeleteData).toHaveBeenCalledTimes(1);
  });

  it('attach in deadline with server `deleted` settles properly: idle + purge:done + terminal', async () => {
    await runToDeadline();
    const done = jest.fn();
    const terminal = jest.fn();
    cloudSessionService.on('purge:done', done);
    cloudSessionService.on('purge:terminal', terminal);

    mockDeleteStatus.mockResolvedValueOnce(deletedStatus());
    const result = await cloudSessionService.attachToRunningPurge();

    expect(result).toEqual({
      kind: 'terminal',
      terminal: expect.objectContaining({ outcome: 'deleted', objectsDeleted: 4, dekDeleted: true }),
    });
    // Settled PROPERLY: status idle, gate down, legacy + terminal events.
    expect(cloudSessionService.getStatus()).toBe('idle');
    expect(cloudSessionService.isPurging()).toBe(false);
    expect(done).toHaveBeenCalledTimes(1);
    expect(terminal).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'deleted' }));
    expect((svc as any).purgeReprobeTimer).toBeNull(); // cadence stopped
    expect(mockDeleteData).toHaveBeenCalledTimes(1); // no re-POST
  });

  it('periodic re-probe resolves a post-deadline completion: deleted → idle + events', async () => {
    const done = jest.fn();
    const failed = jest.fn();
    const cleared = jest.fn();
    const terminal = jest.fn();
    cloudSessionService.on('purge:done', done);
    cloudSessionService.on('purge:failed', failed);
    cloudSessionService.on('purge:cleared', cleared);
    cloudSessionService.on('purge:terminal', terminal);

    await runToDeadline();

    // The server finished AFTER our deadline landed.
    mockDeleteStatus.mockResolvedValue(deletedStatus({ request_id: 'req-1' }));
    await jest.advanceTimersByTimeAsync(REPROBE_TICK_MS);

    expect(cloudSessionService.getStatus()).toBe('idle');
    expect(cloudSessionService.isPurging()).toBe(false);
    expect(cloudSessionService.getPurgeRunState()).toBe('deleted');
    expect(done).toHaveBeenCalledTimes(1);
    expect(terminal).toHaveBeenCalledTimes(2); // deadline, then deleted
    expect(terminal.mock.calls[1][0]).toMatchObject({ outcome: 'deleted' });
    expect(failed).not.toHaveBeenCalled();
    expect(cleared).not.toHaveBeenCalled();
    // Cadence stopped once resolved; never re-POSTed.
    expect((svc as any).purgeReprobeTimer).toBeNull();
    expect(mockDeleteData).toHaveBeenCalledTimes(1);
  });

  it('periodic re-probe resolves via `none`: clears to idle + purge:cleared', async () => {
    await runToDeadline();
    const done = jest.fn();
    const cleared = jest.fn();
    cloudSessionService.on('purge:done', done);
    cloudSessionService.on('purge:cleared', cleared);

    mockDeleteStatus.mockResolvedValue({ status: 'none' });
    await jest.advanceTimersByTimeAsync(REPROBE_TICK_MS);

    // The way out of the latch: status idle, gate down, cleared event fired,
    // and NO fake success (purge:done must NOT fire for a vanished run).
    expect(cloudSessionService.getStatus()).toBe('idle');
    expect(cloudSessionService.isPurging()).toBe(false);
    expect(cloudSessionService.getPurgeRunState()).toBe('idle');
    expect(cloudSessionService.getLastPurgeTerminal()).toBeNull();
    expect(cleared).toHaveBeenCalledTimes(1);
    expect(done).not.toHaveBeenCalled();
    expect((svc as any).purgeReprobeTimer).toBeNull();
    expect(mockDeleteData).toHaveBeenCalledTimes(1);
  });

  it('failed re-probe GET keeps the latch and re-arms the cadence (single in-flight GET per tick)', async () => {
    await runToDeadline();
    const cleared = jest.fn();
    cloudSessionService.on('purge:cleared', cleared);

    mockDeleteStatus.mockRejectedValue(new TypeError('Network request failed'));
    await jest.advanceTimersByTimeAsync(REPROBE_TICK_MS);

    // Transient failure → latch preserved, cadence re-armed, gate still up.
    expect(cloudSessionService.getStatus()).toBe('purging');
    expect(cloudSessionService.isPurging()).toBe(true);
    expect(cloudSessionService.getPurgeRunState()).toBe('deadline');
    expect(cleared).not.toHaveBeenCalled();
    expect((svc as any).purgeReprobeTimer).not.toBeNull();
    const getsAfterFirstProbe = mockDeleteStatus.mock.calls.length;

    // Next cadence tick performs exactly ONE more GET (no overlap/pile-up).
    await jest.advanceTimersByTimeAsync(REPROBE_TICK_MS);
    expect(mockDeleteStatus.mock.calls.length).toBe(getsAfterFirstProbe + 1);
    expect(cloudSessionService.getPurgeRunState()).toBe('deadline');
    expect(mockDeleteData).toHaveBeenCalledTimes(1);
  });
});

describe('CloudSessionService.attachToRunningPurge — cold start', () => {
  it('in_progress → adopt: fresh deadline, polling starts, terminal events still fire', async () => {
    mockDeleteStatus
      .mockResolvedValueOnce({ status: 'in_progress', phase: 'routing', request_id: 'req-remote', attempts: 4 })
      .mockResolvedValueOnce(deletedStatus({ request_id: 'req-remote' }));

    const done = jest.fn();
    const progress = jest.fn();
    cloudSessionService.on('purge:done', done);
    cloudSessionService.on('purge:progress', progress);

    const result = await cloudSessionService.attachToRunningPurge();

    expect(result).toMatchObject({
      kind: 'adopted',
      progress: { runState: 'polling', phase: 'routing', requestId: 'req-remote', attempts: 4 },
    });
    expect(cloudSessionService.isPurging()).toBe(true);
    expect(cloudSessionService.getPurgeRunState()).toBe('polling');
    // No POST was ever sent for an adopted purge.
    expect(mockDeleteData).not.toHaveBeenCalled();

    // The adopted poll loop runs to terminal.
    await flushPurge(new Promise<void>(resolve => cloudSessionService.once('purge:terminal', () => resolve())));
    expect(done).toHaveBeenCalledTimes(1);
    expect(cloudSessionService.getStatus()).toBe('idle');
  });

  it('deleted/failed status → terminal replay once, connect NOT gated', async () => {
    mockDeleteStatus.mockResolvedValueOnce({
      status: 'failed',
      request_id: 'req-old',
      attempts: 2,
      error: 'attempt cap reached',
      objects_deleted: 0,
      versions_deleted: 0,
      beats_removed: 0,
      dek_deleted: false,
      finished_at: 1_790_964_494,
    });

    const result = await cloudSessionService.attachToRunningPurge();

    expect(result).toEqual({
      kind: 'terminal',
      terminal: expect.objectContaining({ outcome: 'failed', error: 'attempt cap reached' }),
    });
    expect(cloudSessionService.getStatus()).toBe('idle');
    expect(cloudSessionService.isPurging()).toBe(false);
    // Remembered for re-renders.
    expect(cloudSessionService.getLastPurgeTerminal()?.outcome).toBe('failed');
    // No polling loop was started.
    expect(mockDeleteStatus).toHaveBeenCalledTimes(1);
  });

  it('none → nothing: idle, no events, no polling', async () => {
    mockDeleteStatus.mockResolvedValueOnce({ status: 'none' });

    const result = await cloudSessionService.attachToRunningPurge();

    expect(result).toEqual({ kind: 'none' });
    expect(cloudSessionService.getStatus()).toBe('idle');
    expect(cloudSessionService.getPurgeRunState()).toBe('idle');
    expect(cloudSessionService.isPurging()).toBe(false);
  });

  it('status fetch failure (offline cold start) → none; broker 409 remains the backstop', async () => {
    mockDeleteStatus.mockRejectedValueOnce(new TypeError('Network request failed'));

    const result = await cloudSessionService.attachToRunningPurge();

    expect(result).toEqual({ kind: 'none' });
    expect(cloudSessionService.isPurging()).toBe(false);
  });
});

describe('CloudSessionService.purge — connect gate + re-entrancy (regressions)', () => {
  it('connect() rejects while a purge is in flight', async () => {
    let resolveFirst!: (v: { status: string; request_id: string }) => void;
    mockDeleteData.mockImplementationOnce(
      () => new Promise<{ status: string; request_id: string }>((res) => { resolveFirst = res; }),
    );

    const p = cloudSessionService.purgeCloudData();
    await jest.advanceTimersByTimeAsync(0);

    await expect(cloudSessionService.connect()).rejects.toThrow('purge in progress');

    resolveFirst({ status: 'in_progress', request_id: 'req-1' });
    mockDeleteStatus.mockResolvedValue(deletedStatus());
    await flushPurge(p);
  });

  it('re-entrant purgeCloudData() while active shares the in-flight run (no second POST)', async () => {
    let resolveFirst!: (v: { status: string; request_id: string }) => void;
    mockDeleteData.mockImplementationOnce(
      () => new Promise<{ status: string; request_id: string }>((res) => { resolveFirst = res; }),
    );

    const p1 = cloudSessionService.purgeCloudData();
    await jest.advanceTimersByTimeAsync(0);
    const p2 = cloudSessionService.purgeCloudData();

    // Both share the in-flight run: no second POST was made for the
    // re-entrant call (the machine is busy initiating).
    expect(mockDeleteData).toHaveBeenCalledTimes(1);

    resolveFirst({ status: 'in_progress', request_id: 'req-1' });
    mockDeleteStatus.mockResolvedValue(deletedStatus());
    await Promise.all([flushPurge(p1), p2]);

    expect(mockDeleteData).toHaveBeenCalledTimes(1);
    expect(cloudSessionService.getStatus()).toBe('idle');
  });

  it('re-entrant purgeCloudData() during an ADOPTED purge shares the run (no second POST)', async () => {
    mockDeleteStatus
      .mockResolvedValueOnce({ status: 'in_progress', phase: 's3', request_id: 'req-remote', attempts: 1 })
      .mockResolvedValueOnce(deletedStatus({ request_id: 'req-remote' }));

    const attach = await cloudSessionService.attachToRunningPurge();
    expect(attach.kind).toBe('adopted');
    // The adopted loop is published — a re-entrant purgeCloudData() must
    // share it, never start a second machine (which would re-POST).
    expect((svc as any)._purgePromise).not.toBeNull();

    await flushPurge(cloudSessionService.purgeCloudData());

    expect(mockDeleteData).not.toHaveBeenCalled(); // adopt, never re-POST
    expect(cloudSessionService.getStatus()).toBe('idle');
    expect((svc as any)._purgePromise).toBeNull();
  });
});
