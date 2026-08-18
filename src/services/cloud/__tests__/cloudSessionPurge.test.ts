/**
 * CloudSessionService.purgeCloudData tests (cloud-data-purge Phase 6).
 *
 * Covers:
 *   - happy path: disconnect first, delete resolves 'deleted' → purge:done,
 *     final status idle
 *   - SnapshotBusyError ×2 then success → three client calls, purge:done
 *   - 200 in_progress ×3 (another device) then 'deleted' → polls through
 *   - SnapshotBusyError exhausted (10 tries) → purge:failed, status idle
 *   - terminal client error (APIError) → purge:failed immediately
 *   - connect() while purging → rejects (suppression contract)
 *   - isPurging() stays true across the internal disconnect() (status bug
 *     regression: disconnect must not clobber 'purging' mid-purge)
 *
 * Client module is mocked (pattern from deviceAuth.test.ts); fake timers
 * drive the bounded 3s retry waits deterministically.
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
  },
}));

jest.mock('@harmony-ai-solutions/soulbits-api-client', () => {
  const disconnect = jest.fn(async () => ({}));
  const deleteDataOrThrow = jest.fn();

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
      session: { disconnect, deleteDataOrThrow },
      devices: {},
    }),
    SnapshotBusyError: MockSnapshotBusyError,
    PurgeInProgressError: MockPurgeInProgressError,
    APIError: MockAPIError,
    __disconnect: disconnect,
    __deleteDataOrThrow: deleteDataOrThrow,
    __SnapshotBusyError: MockSnapshotBusyError,
    __PurgeInProgressError: MockPurgeInProgressError,
    __APIError: MockAPIError,
  };
});

import * as SoulbitsClient from '@harmony-ai-solutions/soulbits-api-client';
import { cloudSessionService } from '../CloudSessionService';

const mockDisconnect = (SoulbitsClient as any).__disconnect as jest.Mock;
const mockDeleteData = (SoulbitsClient as any).__deleteDataOrThrow as jest.Mock;
const SnapshotBusy = (SoulbitsClient as any).__SnapshotBusyError as new (
  retryAfterMs?: number,
) => Error;

/** Drive the purge promise through all pending 3s retry waits. */
async function flushPurge(p: Promise<void>): Promise<void> {
  for (let i = 0; i < 130; i++) {
    await jest.advanceTimersByTimeAsync(3_100);
  }
  await p;
}

beforeEach(() => {
  jest.useFakeTimers();
  mockDisconnect.mockClear();
  mockDeleteData.mockReset();
  // No live session by default (disconnect RPC skipped unless sessionId set).
  (cloudSessionService as any).sessionId = null;
});

afterEach(() => {
  jest.useRealTimers();
});

describe('CloudSessionService.purgeCloudData', () => {
  it('happy path: disconnects first, resolves deleted → purge:done + idle', async () => {
    (cloudSessionService as any).sessionId = 'sess-live';
    mockDeleteData.mockResolvedValueOnce({ status: 'deleted', objects_deleted: 4 });

    const events: string[] = [];
    cloudSessionService.once('purge:done', () => events.push('done'));

    await flushPurge(cloudSessionService.purgeCloudData());

    expect(events).toEqual(['done']);
    expect(mockDisconnect).toHaveBeenCalledTimes(1); // broker notified of the old session first
    expect(mockDeleteData).toHaveBeenCalledTimes(1);
    expect(mockDeleteData).toHaveBeenCalledWith('DELETE');
    expect(cloudSessionService.getStatus()).toBe('idle');
    expect(cloudSessionService.isPurging()).toBe(false);
  });

  it('snapshot_busy ×2 then success → three calls, purge:done', async () => {
    mockDeleteData
      .mockRejectedValueOnce(new SnapshotBusy(3000))
      .mockRejectedValueOnce(new SnapshotBusy(3000))
      .mockResolvedValueOnce({ status: 'deleted' });

    let done = false;
    cloudSessionService.once('purge:done', () => { done = true; });

    await flushPurge(cloudSessionService.purgeCloudData());

    expect(done).toBe(true);
    expect(mockDeleteData).toHaveBeenCalledTimes(3);
    expect(cloudSessionService.getStatus()).toBe('idle');
  });

  it('in_progress ×3 (another device) then deleted → polls through', async () => {
    mockDeleteData
      .mockResolvedValueOnce({ status: 'in_progress', request_id: 'req-other' })
      .mockResolvedValueOnce({ status: 'in_progress', request_id: 'req-other' })
      .mockResolvedValueOnce({ status: 'in_progress', request_id: 'req-other' })
      .mockResolvedValueOnce({ status: 'deleted' });

    let done = false;
    cloudSessionService.once('purge:done', () => { done = true; });

    await flushPurge(cloudSessionService.purgeCloudData());

    expect(done).toBe(true);
    expect(mockDeleteData).toHaveBeenCalledTimes(4);
    expect(cloudSessionService.getStatus()).toBe('idle');
  });

  it('snapshot_busy exhausted → purge:failed, status idle (not failed)', async () => {
    mockDeleteData.mockRejectedValue(new SnapshotBusy(3000));

    let failedReason = '';
    cloudSessionService.once('purge:failed', (r: string) => { failedReason = r; });

    await flushPurge(cloudSessionService.purgeCloudData());

    expect(failedReason).toContain('snapshot busy');
    expect(mockDeleteData).toHaveBeenCalledTimes(10);
    expect(cloudSessionService.getStatus()).toBe('idle');
  });

  it('terminal client error → purge:failed immediately, no retries', async () => {
    const APIErrorCtor = (SoulbitsClient as any).__APIError as new (
      status: number,
      body: Record<string, unknown>,
    ) => Error;
    mockDeleteData.mockRejectedValue(new APIErrorCtor(500, { error: 'internal_error' }));

    let failedReason = '';
    cloudSessionService.once('purge:failed', (r: string) => { failedReason = r; });

    const p = cloudSessionService.purgeCloudData();
    await jest.advanceTimersByTimeAsync(0);
    await p;

    expect(failedReason).toBeTruthy();
    expect(mockDeleteData).toHaveBeenCalledTimes(1);
    expect(cloudSessionService.getStatus()).toBe('idle');
  });

  it('isPurging stays true across the internal disconnect (status regression)', async () => {
    let resolveFirst!: (v: { status: string }) => void;
    mockDeleteData.mockImplementationOnce(
      () => new Promise<{ status: string }>((res) => { resolveFirst = res; }),
    );

    const p = cloudSessionService.purgeCloudData();
    // Let the disconnect + first delete call start.
    await jest.advanceTimersByTimeAsync(0);

    expect(cloudSessionService.isPurging()).toBe(true); // not clobbered by disconnect()

    resolveFirst({ status: 'deleted' });
    await flushPurge(p);
    expect(cloudSessionService.isPurging()).toBe(false);
  });

  it('connect() rejects while a purge is in flight', async () => {
    let resolveFirst!: (v: { status: string }) => void;
    mockDeleteData.mockImplementationOnce(
      () => new Promise<{ status: string }>((res) => { resolveFirst = res; }),
    );

    const p = cloudSessionService.purgeCloudData();
    await jest.advanceTimersByTimeAsync(0);

    await expect(cloudSessionService.connect()).rejects.toThrow('purge in progress');

    resolveFirst({ status: 'deleted' });
    await flushPurge(p);
  });
});
