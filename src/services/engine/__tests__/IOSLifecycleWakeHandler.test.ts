/**
 * IOSLifecycleWakeHandler — unit tests (task 4-3, steps 1–2, 5).
 *
 * The pass is driven entirely through injected seams, so these lock the
 * orchestration: engine start → credential inject (best-effort) → tier budget →
 * bounded batch (deadline strictly before the OS window) → outreach relay →
 * clean stop → honored/missed telemetry, including the degraded non-LLM path.
 */

jest.mock('../../../utils/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

import {
  IOS_WAKE_WINDOW_MS,
  perWakeMaxBeats,
  runIOSLifecycleWake,
} from '../IOSLifecycleWakeHandler';
import type { IOSLifecycleWakeDeps } from '../IOSLifecycleWakeHandler';
import { IOSLifecycleTelemetry } from '../IOSLifecycleTelemetry';

const NOW = Date.UTC(2026, 0, 2, 3, 0, 0);

const BATCH_WITH_OUTREACH = JSON.stringify({
  completed: [
    {
      entityId: 'e1',
      plan: {
        elapsedSeconds: 3600,
        gapKind: 'short',
        beatsToFire: 1,
        missedBeats: 0,
        foldBeats: 0,
        dreamDue: false,
        compactDue: false,
        outreachDue: true,
        seed: 1,
      },
    },
  ],
  truncated: ['e2'],
  degraded: [],
});

function makeDeps(overrides: Partial<IOSLifecycleWakeDeps> = {}) {
  const telemetry = new IOSLifecycleTelemetry();
  const relayNotify = jest.fn(async () => ({ delivered: 1 }));
  const deps: IOSLifecycleWakeDeps = {
    ensureEngineStarted: jest.fn(async () => ({}) as any),
    stopEngine: jest.fn(async () => undefined),
    call: jest.fn(async () => BATCH_WITH_OUTREACH),
    getToken: jest.fn(async () => 'v4.local.token'),
    refreshCredentials: jest.fn(async () => undefined),
    fetchBudget: jest.fn(async () => 48),
    composeOutreach: jest.fn(async (entityId: string) => ({
      entityId,
      body: 'thinking of you',
      payload: JSON.stringify({ kind: 'outreach', entityId }),
    })),
    relay: { notify: relayNotify } as any,
    now: jest.fn(() => NOW),
    telemetry,
    ...overrides,
  };
  return { deps, telemetry, relayNotify };
}

describe('perWakeMaxBeats', () => {
  it('slices the daily budget across nominal hourly wakes', () => {
    expect(perWakeMaxBeats(48)).toBe(2);
    expect(perWakeMaxBeats(1)).toBe(1);
  });
  it('falls back to the conservative default when unknown', () => {
    expect(perWakeMaxBeats(null)).toBe(2);
    expect(perWakeMaxBeats(0)).toBe(2);
    expect(perWakeMaxBeats(-5)).toBe(2);
  });
});

describe('runIOSLifecycleWake', () => {
  it('runs a bounded batch, relays outreach, stops, and records an honored wake', async () => {
    const { deps, telemetry, relayNotify } = makeDeps();
    const result = await runIOSLifecycleWake(deps);

    expect(result).toMatchObject({ honored: true, completed: 1, truncated: 1, relayed: 1 });
    expect(deps.stopEngine).toHaveBeenCalledTimes(1);
    expect(relayNotify).toHaveBeenCalledWith(
      expect.objectContaining({ alert: { title: undefined, body: 'thinking of you' } }),
    );

    // Batch payload: RFC3339 now/deadline strictly inside the OS window + sliced budget.
    const [method, payloadJSON] = (deps.call as jest.Mock).mock.calls[0];
    expect(method).toBe('lifecycle.batch');
    const payload = JSON.parse(payloadJSON);
    expect(payload.now).toBe('2026-01-02T03:00:00Z');
    expect(payload.deadline).toBe(new Date(NOW + IOS_WAKE_WINDOW_MS).toISOString().replace(/\.\d{3}Z$/, 'Z'));
    expect(payload.maxBeats).toBe(2);
    expect(payload.priority).toBe('most_overdue');
    expect(payload.degraded).toBeUndefined();

    expect(telemetry.snapshot().keepaliveHonored).toBe(1);
    expect(telemetry.snapshot().keepaliveMissed).toBe(0);
  });

  it('degrades to non-LLM mode when credential injection fails', async () => {
    const { deps, telemetry } = makeDeps({
      refreshCredentials: jest.fn(async () => {
        throw new Error('token stale');
      }),
    });
    const result = await runIOSLifecycleWake(deps);

    expect(result).toMatchObject({ honored: true, degraded: true });
    const payload = JSON.parse((deps.call as jest.Mock).mock.calls[0][1]);
    expect(payload.degraded).toBe(true);
    expect(telemetry.snapshot().keepaliveHonored).toBe(1);
  });

  it('still runs the batch when signed out (no token) without degrading', async () => {
    const { deps } = makeDeps({ getToken: jest.fn(async () => null) });
    const result = await runIOSLifecycleWake(deps);

    expect(result).toMatchObject({ honored: true, degraded: false });
    expect(deps.refreshCredentials).not.toHaveBeenCalled();
    expect(deps.fetchBudget).not.toHaveBeenCalled();
    const payload = JSON.parse((deps.call as jest.Mock).mock.calls[0][1]);
    expect(payload.degraded).toBeUndefined();
    expect(payload.maxBeats).toBe(2);
  });

  it('records a missed wake + still stops when the batch call throws', async () => {
    const { deps, telemetry } = makeDeps({
      call: jest.fn(async () => {
        throw new Error('engine not started');
      }),
    });
    const result = await runIOSLifecycleWake(deps);

    expect(result.honored).toBe(false);
    expect(result.error).toMatch(/engine not started/);
    expect(deps.stopEngine).toHaveBeenCalledTimes(1);
    expect(telemetry.snapshot().keepaliveMissed).toBe(1);
    expect(telemetry.snapshot().keepaliveHonored).toBe(0);
  });

  it('treats a relay failure as non-fatal (outreach persists on-device)', async () => {
    const { deps } = makeDeps({
      relay: {
        notify: jest.fn(async () => {
          throw new Error('relay down');
        }),
      } as any,
    });
    const result = await runIOSLifecycleWake(deps);
    expect(result.honored).toBe(true);
    expect(result.relayed).toBe(0);
  });

  it('does not relay when no entity flagged outreach', async () => {
    const noOutreach = JSON.stringify({ completed: [], truncated: [], degraded: [] });
    const { deps, relayNotify } = makeDeps({ call: jest.fn(async () => noOutreach) });
    const result = await runIOSLifecycleWake(deps);
    expect(result.relayed).toBe(0);
    expect(relayNotify).not.toHaveBeenCalled();
  });

  it('surfaces a plan 7-8 not-authoritative skip as a well-formed honored pass (not an error)', async () => {
    const skipped = JSON.stringify({
      completed: [],
      truncated: [],
      degraded: [],
      skipped_reason: 'not_authoritative',
    });
    const { deps, telemetry, relayNotify } = makeDeps({ call: jest.fn(async () => skipped) });
    const result = await runIOSLifecycleWake(deps);

    expect(result.honored).toBe(true);
    expect(result.error).toBeUndefined();
    expect(result.skippedReason).toBe('not_authoritative');
    expect(result.completed).toBe(0);
    expect(relayNotify).not.toHaveBeenCalled();
    expect(telemetry.snapshot().keepaliveHonored).toBe(1);
  });
});
