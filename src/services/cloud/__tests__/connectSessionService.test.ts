/**
 * ConnectSessionService — poll lifecycle (Option B portal sign-in).
 *
 * Everything impure is injected (fetch, timers, clock, AppState, Linking,
 * device identity, redeem sink) so the poll loop is driven deterministically
 * without React or the RN runtime. The real `defaultCreate`/`defaultPoll` wire
 * mapping is exercised through a stubbed `fetch`.
 */

import {
  createConnectSessionService,
  ConnectSessionHttpError,
  type ConnectSessionState,
} from '../ConnectSessionService';
import { CLOUD_HOSTS } from '../../../config/cloud';

// ── Fakes ───────────────────────────────────────────────────────────────────

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

/** Controllable interval timer (no real time passes). */
function fakeTimers() {
  let id = 0;
  const callbacks = new Map<number, () => void>();
  return {
    timers: {
      setInterval: (handler: () => void, _ms: number) => {
        id += 1;
        callbacks.set(id, handler);
        return id;
      },
      clearInterval: (handle: any) => {
        callbacks.delete(handle);
      },
    },
    /** Fire every registered interval once. */
    tick: () => {
      for (const handler of [...callbacks.values()]) handler();
    },
    active: () => callbacks.size,
  };
}

function fakeAppState() {
  let handler: ((s: string) => void) | null = null;
  return {
    source: {
      currentState: 'active' as const,
      addEventListener: (_t: 'change', h: (s: string) => void) => {
        handler = h;
        return { remove: () => { handler = null; } };
      },
    },
    fire: (state: string) => handler?.(state),
  };
}

function fakeLinking() {
  let handler: ((e: { url: string }) => void) | null = null;
  return {
    source: {
      addEventListener: (_t: 'url', h: (e: { url: string }) => void) => {
        handler = h;
        return { remove: () => { handler = null; } };
      },
      getInitialURL: async () => null,
    },
    fire: (url: string) => handler?.({ url }),
  };
}

async function flush(times = 8) {
  for (let i = 0; i < times; i += 1) {
    await Promise.resolve();
  }
}

function buildHarness(fetchImpl: jest.Mock) {
  const clock = { now: 0 };
  const timer = fakeTimers();
  const appState = fakeAppState();
  const linking = fakeLinking();
  const redeem = jest.fn(async () => {});
  const states: ConnectSessionState[] = [];
  const service = createConnectSessionService({
    fetch: fetchImpl as unknown as typeof fetch,
    timers: timer.timers,
    now: () => clock.now,
    appState: appState.source as any,
    linking: linking.source as any,
    getDeviceId: async () => 'device-1',
    platform: () => 'ios',
    deviceName: async () => 'Studio Phone',
    redeem,
    onStateChange: (s) => states.push(s),
  });
  return { service, clock, timer, appState, linking, redeem, states };
}

const CREATE_BODY = {
  connect_id: 'conn-1',
  session_secret: 'secret-1',
  connect_url: 'https://cloud.soulbits.app/connect?request=conn-1',
  expires_in: 600,
};

// ── Tests ───────────────────────────────────────────────────────────────────

describe('ConnectSessionService — start + poll lifecycle', () => {
  it('creates a session, opens the URL, polls immediately and redeems once on approval', async () => {
    const fetchImpl = jest
      .fn()
      // create
      .mockResolvedValueOnce(jsonResponse(CREATE_BODY, 201))
      // immediate poll → approved (token pair returned exactly once)
      .mockResolvedValueOnce(
        jsonResponse({
          status: 'approved',
          token: 'paseto-x',
          refresh_token: 'refresh-x',
          expires_at: '2026-10-17T12:00:00Z',
        }),
      );

    const { service, redeem, timer } = buildHarness(fetchImpl);

    const { connectUrl } = await service.start();
    expect(connectUrl).toBe(CREATE_BODY.connect_url);
    await flush();

    // create + one poll
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const [createUrl, createInit] = fetchImpl.mock.calls[0];
    expect(createUrl).toBe(`${CLOUD_HOSTS.session}/v1/devices/connect-session`);
    expect(createInit.method).toBe('POST');
    expect(JSON.parse(createInit.body)).toEqual({
      device_id: 'device-1',
      platform: 'ios',
      device_name: 'Studio Phone',
    });

    // the poll carries the secret as a Bearer credential
    const [pollUrl, pollInit] = fetchImpl.mock.calls[1];
    expect(pollUrl).toBe(
      `${CLOUD_HOSTS.session}/v1/devices/connect-session/conn-1`,
    );
    expect(pollInit.headers.Authorization).toBe('Bearer secret-1');

    expect(redeem).toHaveBeenCalledTimes(1);
    expect(redeem).toHaveBeenCalledWith({
      token: 'paseto-x',
      refreshToken: 'refresh-x',
      expiresAt: '2026-10-17T12:00:00Z',
    });
    expect(service.getState().status).toBe('approved');
    // polling stopped → the interval was cleared
    expect(timer.active()).toBe(0);
  });

  it('stays pending while the portal has not approved, then approves on a later poll', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse(CREATE_BODY, 201))
      .mockResolvedValueOnce(jsonResponse({ status: 'pending' }))
      .mockResolvedValueOnce(jsonResponse({ status: 'pending' }))
      .mockResolvedValueOnce(
        jsonResponse({
          status: 'approved',
          token: 't',
          refresh_token: 'r',
          expires_at: '2026-10-17T12:00:00Z',
        }),
      );

    const { service, clock, timer, redeem } = buildHarness(fetchImpl);

    await service.start();
    await flush();
    expect(service.getState().status).toBe('pending');

    // advance past the poll cadence (2.5s) and tick
    clock.now += 3000;
    timer.tick();
    await flush();
    expect(service.getState().status).toBe('pending');
    expect(redeem).not.toHaveBeenCalled();

    clock.now += 3000;
    timer.tick();
    await flush();
    expect(redeem).toHaveBeenCalledTimes(1);
    expect(service.getState().status).toBe('approved');
  });

  it('expires at the TTL without redeeming', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse({ ...CREATE_BODY, expires_in: 10 }, 201))
      .mockResolvedValue(jsonResponse({ status: 'pending' }));

    const { service, clock, timer, redeem } = buildHarness(fetchImpl);
    await service.start();
    await flush();

    clock.now += 10_000; // reach the TTL
    timer.tick();
    await flush();

    expect(service.getState().status).toBe('expired');
    expect(redeem).not.toHaveBeenCalled();
    expect(timer.active()).toBe(0);
  });

  it('reports consumed when the session was already redeemed', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse(CREATE_BODY, 201))
      .mockResolvedValueOnce(jsonResponse({ status: 'consumed' }));

    const { service, redeem } = buildHarness(fetchImpl);
    await service.start();
    await flush();

    expect(service.getState().status).toBe('consumed');
    expect(redeem).not.toHaveBeenCalled();
  });

  it('keeps polling on a transient error and errors terminally on 401', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse(CREATE_BODY, 201))
      .mockRejectedValueOnce(new Error('network down')) // transient
      .mockResolvedValueOnce(jsonResponse({ status: 'pending' }))
      .mockResolvedValueOnce(
        (() => {
          const e = new ConnectSessionHttpError(401, 'invalid secret');
          return Promise.reject(e);
        })(),
      );

    const { service, clock, timer } = buildHarness(fetchImpl);
    await service.start();
    await flush();
    // transient error → still pending
    expect(service.getState().status).toBe('pending');

    clock.now += 3000;
    timer.tick();
    await flush();
    expect(service.getState().status).toBe('pending');

    clock.now += 3000;
    timer.tick();
    await flush();
    expect(service.getState().status).toBe('errored');
    expect(timer.active()).toBe(0);
  });

  it('surfaces a create failure as a terminal errored state', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: 'nope' }, 500));

    const { service } = buildHarness(fetchImpl);
    await expect(service.start()).rejects.toThrow();
    expect(service.getState().status).toBe('errored');
  });
});

describe('ConnectSessionService — immediate-poll triggers', () => {
  it('polls immediately when AppState returns to active', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse(CREATE_BODY, 201))
      .mockResolvedValueOnce(jsonResponse({ status: 'pending' }))
      .mockResolvedValueOnce(
        jsonResponse({
          status: 'approved',
          token: 't',
          refresh_token: 'r',
          expires_at: '2026-10-17T12:00:00Z',
        }),
      );

    const { service, appState, redeem } = buildHarness(fetchImpl);
    await service.start();
    await flush();
    expect(redeem).not.toHaveBeenCalled();

    appState.fire('background');
    appState.fire('active'); // → immediate poll
    await flush();

    expect(redeem).toHaveBeenCalledTimes(1);
  });

  it('polls immediately on the soulbits://connect-return deep link', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse(CREATE_BODY, 201))
      .mockResolvedValueOnce(jsonResponse({ status: 'pending' }))
      .mockResolvedValueOnce(
        jsonResponse({
          status: 'approved',
          token: 't',
          refresh_token: 'r',
          expires_at: '2026-10-17T12:00:00Z',
        }),
      );

    const { service, linking, redeem } = buildHarness(fetchImpl);
    await service.start();
    await flush();
    expect(redeem).not.toHaveBeenCalled();

    linking.fire('soulbits://connect-return');
    await flush();

    expect(redeem).toHaveBeenCalledTimes(1);
  });

  it('ignores unrelated deep links (no extra poll)', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse(CREATE_BODY, 201))
      .mockResolvedValueOnce(jsonResponse({ status: 'pending' }));

    const { service, linking } = buildHarness(fetchImpl);
    await service.start();
    await flush();
    const callsAfterStart = fetchImpl.mock.calls.length;

    linking.fire('soulbits://device-auth?code=123456');
    linking.fire('https://example.com');
    await flush();

    expect(fetchImpl.mock.calls.length).toBe(callsAfterStart);
  });
});

describe('ConnectSessionService — cancel + subscribe', () => {
  it('cancel stops polling and returns to idle', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse(CREATE_BODY, 201))
      .mockResolvedValue(jsonResponse({ status: 'pending' }));

    const { service, timer } = buildHarness(fetchImpl);
    await service.start();
    await flush();
    expect(timer.active()).toBe(1);

    service.cancel();
    expect(service.getState().status).toBe('idle');
    expect(timer.active()).toBe(0);
  });

  it('notifies subscribers of state transitions', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse(CREATE_BODY, 201))
      .mockResolvedValueOnce(jsonResponse({ status: 'pending' }));

    const { service } = buildHarness(fetchImpl);
    const seen: string[] = [];
    const unsub = service.subscribe((s) => seen.push(s.status));

    await service.start();
    await flush();
    unsub();
    service.cancel();

    expect(seen).toContain('starting');
    expect(seen).toContain('pending');
    // after unsubscribe, cancel is not observed
    expect(seen).not.toContain('idle');
  });
});
