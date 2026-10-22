/**
 * IOSMaintenanceScheduler — unit tests (task 4-3, step 3; 0-4 overnight entry
 * point + the 2-6 backup ride-along).
 */

jest.mock('../../../utils/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

import { runIOSMaintenanceSweep } from '../IOSMaintenanceScheduler';
import type { IOSMaintenanceDeps } from '../IOSMaintenanceScheduler';
import { IOSLifecycleTelemetry } from '../IOSLifecycleTelemetry';

const NOW = Date.UTC(2026, 0, 3, 2, 0, 0);

const MAINT_RESULT = JSON.stringify({
  compacted: [{ entityId: 'e1', ops: 2, tokens: 900 }],
  skipped: ['e2'],
  degraded: [],
  truncated: [],
  failed: [],
});
const BATCH_RESULT = JSON.stringify({
  completed: [
    {
      entityId: 'e1',
      plan: {
        elapsedSeconds: 7200,
        gapKind: 'short',
        beatsToFire: 2,
        missedBeats: 1,
        foldBeats: 0,
        dreamDue: true,
        compactDue: true,
        outreachDue: true,
        seed: 9,
      },
    },
  ],
  truncated: [],
  degraded: [],
});

function makeDeps(overrides: Partial<IOSMaintenanceDeps> = {}) {
  const telemetry = new IOSLifecycleTelemetry();
  const call = jest.fn(async (method: string, _payload: string) =>
    method === 'lifecycle.maintenance' ? MAINT_RESULT : BATCH_RESULT,
  );
  const deps: IOSMaintenanceDeps = {
    ensureEngineStarted: jest.fn(async () => ({}) as any),
    stopEngine: jest.fn(async () => undefined),
    call,
    getToken: jest.fn(async () => 'v4.local.token'),
    refreshCredentials: jest.fn(async () => undefined),
    fetchBudget: jest.fn(async () => 48),
    composeOutreach: jest.fn(async (entityId: string) => ({
      entityId,
      body: 'hello',
      payload: 'p',
    })),
    relay: { notify: jest.fn(async () => ({ delivered: 1 })) } as any,
    runBackup: jest.fn(async () => undefined),
    now: jest.fn(() => NOW),
    telemetry,
    ...overrides,
  };
  return { deps, telemetry, call };
}

describe('runIOSMaintenanceSweep', () => {
  it('runs maintenance then the batch, relays outreach, backs up, and records an honored wake', async () => {
    const { deps, telemetry, call } = makeDeps();
    const result = await runIOSMaintenanceSweep(deps);

    expect(result).toMatchObject({
      honored: true,
      compacted: 1,
      completed: 1,
      relayed: 1,
      backedUp: true,
    });

    expect(call.mock.calls[0][0]).toBe('lifecycle.maintenance');
    expect(call.mock.calls[1][0]).toBe('lifecycle.batch');
    // The batch spends the full daily budget overnight (not the per-wake slice).
    const batchPayload = JSON.parse(call.mock.calls[1][1]);
    expect(batchPayload.maxBeats).toBe(48);
    expect(batchPayload.deadline).toBeDefined();

    expect(deps.runBackup).toHaveBeenCalledTimes(1);
    expect(deps.stopEngine).toHaveBeenCalledTimes(1);
    expect(telemetry.snapshot().maintenanceHonored).toBe(1);
  });

  it('degrades both calls when credential injection fails', async () => {
    const { deps, call } = makeDeps({
      refreshCredentials: jest.fn(async () => {
        throw new Error('nope');
      }),
    });
    const result = await runIOSMaintenanceSweep(deps);
    expect(result).toMatchObject({ honored: true, degraded: true });
    expect(JSON.parse(call.mock.calls[0][1]).degraded).toBe(true);
    expect(JSON.parse(call.mock.calls[1][1]).degraded).toBe(true);
  });

  it('a backup failure never fails the sweep', async () => {
    const { deps } = makeDeps({
      runBackup: jest.fn(async () => {
        throw new Error('iCloud offline');
      }),
    });
    const result = await runIOSMaintenanceSweep(deps);
    expect(result.honored).toBe(true);
    expect(result.backedUp).toBe(false);
  });

  it('records a missed wake + still stops when maintenance throws', async () => {
    const { deps, telemetry } = makeDeps({
      call: jest.fn(async () => {
        throw new Error('engine not started');
      }),
    });
    const result = await runIOSMaintenanceSweep(deps);
    expect(result.honored).toBe(false);
    expect(result.error).toMatch(/engine not started/);
    expect(deps.stopEngine).toHaveBeenCalledTimes(1);
    expect(telemetry.snapshot().maintenanceMissed).toBe(1);
  });
});
