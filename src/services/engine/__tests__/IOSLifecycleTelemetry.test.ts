/**
 * IOSLifecycleTelemetry — unit tests (task 4-3, step 1 telemetry).
 */

jest.mock('../../../utils/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

import { IOSLifecycleTelemetry } from '../IOSLifecycleTelemetry';
import type { IOSLifecycleWakeRecord } from '../IOSLifecycleTelemetry';

function rec(over: Partial<IOSLifecycleWakeRecord> = {}): IOSLifecycleWakeRecord {
  return {
    kind: 'keepalive',
    outcome: 'honored',
    startedAt: 0,
    finishedAt: 10,
    durationMs: 10,
    completed: 1,
    truncated: 0,
    degraded: 0,
    ...over,
  };
}

describe('IOSLifecycleTelemetry', () => {
  it('counts honored/missed per kind', () => {
    const t = new IOSLifecycleTelemetry();
    t.record(rec());
    t.record(rec({ outcome: 'missed' }));
    t.record(rec({ kind: 'maintenance' }));
    const snap = t.snapshot();
    expect(snap.keepaliveHonored).toBe(1);
    expect(snap.keepaliveMissed).toBe(1);
    expect(snap.maintenanceHonored).toBe(1);
    expect(snap.maintenanceMissed).toBe(0);
    expect(snap.recent).toHaveLength(3);
  });

  it('bounds the recent ring', () => {
    const t = new IOSLifecycleTelemetry();
    for (let i = 0; i < 60; i++) t.record(rec());
    expect(t.snapshot().recent).toHaveLength(50);
  });

  it('feeds the sink and swallows a sink failure', () => {
    const t = new IOSLifecycleTelemetry();
    const sink = jest.fn();
    t.setSink(sink);
    t.record(rec());
    expect(sink).toHaveBeenCalledTimes(1);

    t.setSink(() => {
      throw new Error('sink down');
    });
    expect(() => t.record(rec())).not.toThrow();
  });

  it('resets counters + records', () => {
    const t = new IOSLifecycleTelemetry();
    t.record(rec());
    t.reset();
    expect(t.snapshot()).toMatchObject({
      keepaliveHonored: 0,
      keepaliveMissed: 0,
      maintenanceHonored: 0,
      maintenanceMissed: 0,
      recent: [],
    });
  });
});
