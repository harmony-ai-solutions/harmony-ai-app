/**
 * IOSLifecycleWakeHandler — step 5 relay tests (plan 7-12 §2/§5).
 *
 * Covers the wake-window relay of sync-applied outreach: the collector is opened
 * before the batch and drained after it; both the batch-flag and sync-applied
 * paths are the CLOUD relay path, so both honor the `auto|cloud` vs
 * `direct|off` transport gate; the composed alert reuses the lock-screen-aware
 * composer; and the persisted watermark + in-process `message_id` dedupe keep it
 * from double-relaying.
 */

jest.mock('../../../utils/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

import {
  runIOSLifecycleWake,
  type IOSLifecycleWakeDeps,
  type SyncAppliedOutreachSource,
} from '../IOSLifecycleWakeHandler';
import type { OutreachNotificationEvent } from '../../notifications/OutreachNotificationService';
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
  truncated: [],
  degraded: [],
});

const BATCH_EMPTY = JSON.stringify({ completed: [], truncated: [], degraded: [] });

function syncEvent(overrides: Partial<OutreachNotificationEvent> = {}): OutreachNotificationEvent {
  return {
    type: 'outreach',
    entity_id: 'claire',
    entity_name: 'Claire',
    message_id: 'msg-1',
    title: 'Claire',
    body_preview: 'Thinking of you.',
    created_at: '2026-10-13T12:00:00Z',
    eligibility: 'eligible',
    ...overrides,
  };
}

function fakeCollector(events: OutreachNotificationEvent[]) {
  const source: SyncAppliedOutreachSource = {
    start: jest.fn(),
    take: jest.fn(() => events),
    stop: jest.fn(),
  };
  return source;
}

function makeDeps(overrides: Partial<IOSLifecycleWakeDeps> = {}) {
  const telemetry = new IOSLifecycleTelemetry();
  const relayNotify = jest.fn(async () => ({ delivered: 1 }));
  const watermark = {
    shouldRelay: jest.fn(async () => true),
    record: jest.fn(async () => undefined),
  };
  const dedupe = { recordIfNew: jest.fn(() => true) };
  const deps: IOSLifecycleWakeDeps = {
    ensureEngineStarted: jest.fn(async () => ({}) as any),
    stopEngine: jest.fn(async () => undefined),
    call: jest.fn(async () => BATCH_EMPTY),
    getToken: jest.fn(async () => 'v4.local.token'),
    refreshCredentials: jest.fn(async () => undefined),
    fetchBudget: jest.fn(async () => 48),
    composeOutreach: jest.fn(async () => null),
    relay: { notify: relayNotify } as any,
    now: jest.fn(() => NOW),
    telemetry,
    getTransport: jest.fn(async () => 'auto' as any),
    getHideContent: jest.fn(async () => false),
    dedupe: dedupe as any,
    watermark: watermark as any,
    ...overrides,
  };
  return { deps, telemetry, relayNotify, watermark, dedupe };
}

describe('runIOSLifecycleWake — sync-applied outreach relay', () => {
  it('starts the collector before the batch and drains it after, relaying with messageId + preview body', async () => {
    const collector = fakeCollector([syncEvent()]);
    const { deps, relayNotify, watermark } = makeDeps({ collectorFactory: () => collector });

    const result = await runIOSLifecycleWake(deps);

    expect(collector.start).toHaveBeenCalledTimes(1);
    expect(collector.stop).toHaveBeenCalledTimes(1);
    expect(result.relayed).toBe(1);
    expect(relayNotify).toHaveBeenCalledWith({
      payload: JSON.stringify({ kind: 'outreach', entityId: 'claire', messageId: 'msg-1' }),
      alert: { title: 'Claire', body: 'Thinking of you.' },
    });
    // The watermark advanced to the relayed message.
    expect(watermark.record).toHaveBeenCalledWith(
      expect.objectContaining({ message_id: 'msg-1' }),
    );
  });

  it('composes a generic alert body when lock-screen content is hidden', async () => {
    const collector = fakeCollector([syncEvent()]);
    const { deps, relayNotify } = makeDeps({
      collectorFactory: () => collector,
      getHideContent: jest.fn(async () => true),
    });

    await runIOSLifecycleWake(deps);

    expect(relayNotify).toHaveBeenCalledWith(
      expect.objectContaining({ alert: { title: 'Claire', body: 'Claire sent you a message' } }),
    );
  });

  it('skips non-eligible events (defensive second layer)', async () => {
    const collector = fakeCollector([
      syncEvent({ eligibility: 'muted' }),
      syncEvent({ message_id: 'msg-2', eligibility: 'decay_suppressed' }),
    ]);
    const { deps, relayNotify } = makeDeps({ collectorFactory: () => collector });

    await runIOSLifecycleWake(deps);
    expect(relayNotify).not.toHaveBeenCalled();
  });

  it('suppresses an already-relayed message via the persisted watermark', async () => {
    const collector = fakeCollector([syncEvent()]);
    const { deps, relayNotify, watermark } = makeDeps({
      collectorFactory: () => collector,
      watermark: {
        shouldRelay: jest.fn(async () => false),
        record: jest.fn(async () => undefined),
      } as any,
    });

    await runIOSLifecycleWake(deps);
    expect(relayNotify).not.toHaveBeenCalled();
    expect((watermark as any).record).not.toHaveBeenCalled();
  });

  it('suppresses a duplicate message_id via the in-process dedupe', async () => {
    const collector = fakeCollector([syncEvent()]);
    const { deps, relayNotify } = makeDeps({
      collectorFactory: () => collector,
      dedupe: { recordIfNew: jest.fn(() => false) } as any,
    });

    await runIOSLifecycleWake(deps);
    expect(relayNotify).not.toHaveBeenCalled();
  });

  it('relays sync-applied events oldest-first', async () => {
    const collector = fakeCollector([
      syncEvent({ message_id: 'later', created_at: '2026-10-13T12:05:00Z' }),
      syncEvent({ message_id: 'earlier', created_at: '2026-10-13T12:00:00Z' }),
    ]);
    const { deps, relayNotify } = makeDeps({ collectorFactory: () => collector });

    await runIOSLifecycleWake(deps);
    const order = (relayNotify.mock.calls as any[]).map(c =>
      JSON.parse(c[0].payload).messageId,
    );
    expect(order).toEqual(['earlier', 'later']);
  });

  it('stops the collector even when the batch throws', async () => {
    const collector = fakeCollector([]);
    const { deps } = makeDeps({
      collectorFactory: () => collector,
      call: jest.fn(async () => {
        throw new Error('engine not started');
      }),
    });

    const result = await runIOSLifecycleWake(deps);
    expect(result.honored).toBe(false);
    expect(collector.stop).toHaveBeenCalledTimes(1);
  });
});

describe('runIOSLifecycleWake — transport gate', () => {
  const cases: Array<{ transport: string; relays: boolean }> = [
    { transport: 'auto', relays: true },
    { transport: 'cloud', relays: true },
    { transport: 'direct', relays: false },
    { transport: 'off', relays: false },
  ];

  for (const { transport, relays } of cases) {
    it(`transport=${transport} → ${relays ? 'relays' : 'skips'} the wake relay (batch + sync paths)`, async () => {
      const collector = fakeCollector([syncEvent()]);
      const { deps, relayNotify } = makeDeps({
        collectorFactory: () => collector,
        call: jest.fn(async () => BATCH_WITH_OUTREACH),
        composeOutreach: jest.fn(async (entityId: string) => ({
          entityId,
          body: 'batch body',
          payload: JSON.stringify({ kind: 'outreach', entityId }),
        })),
        getTransport: jest.fn(async () => transport as any),
      });

      const result = await runIOSLifecycleWake(deps);
      if (relays) {
        expect(relayNotify).toHaveBeenCalledTimes(2); // batch-flag + sync-applied
        expect(result.relayed).toBe(2);
      } else {
        expect(relayNotify).not.toHaveBeenCalled();
        expect(result.relayed).toBe(0);
      }
    });
  }
});
