/**
 * engineReadiness — one-shot "retry when the engine becomes ready" slot.
 *
 * Verifies:
 *  - the not-connected test matches `requireEngineConnection()`'s stable prefix
 *    and only defers while the engine is actually DOWN;
 *  - a deferral arms exactly ONE subscription, runs on the next truthy
 *    connection, and ignores null (disconnect) events;
 *  - re-arming replaces the pending task (latest caller wins) without stacking
 *    subscriptions — no duplicate writes on a burst of boot-race failures;
 *  - a throwing task lands in `onError` (never escapes the callback);
 *  - `cancel()` disarms and releases the subscription without running.
 */

jest.mock('../../../utils/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

jest.mock('../EngineService', () => ({
  getEngineConnection: jest.fn(),
  onEngineConnectionChange: jest.fn(() => jest.fn()),
}));

import { getEngineConnection, onEngineConnectionChange } from '../EngineService';
import {
  createEngineReadinessDeferral,
  isEngineNotConnectedError,
  shouldDeferForEngineReadiness,
} from '../engineReadiness';

const mockedGetConnection = getEngineConnection as jest.Mock;
const mockedOnChange = onEngineConnectionChange as jest.Mock;

const CONN = { adminBaseUrl: 'http://127.0.0.1:28081' };
const NOT_CONNECTED =
  'Engine is not connected — start the engine sidecar before using the management-API data layer';

/** Capture every connection listener registered during a test. */
function captureListeners() {
  const listeners: Array<(connection: unknown) => void> = [];
  const unsubscribes: jest.Mock[] = [];
  mockedOnChange.mockImplementation((cb: (connection: unknown) => void) => {
    listeners.push(cb);
    const off = jest.fn();
    unsubscribes.push(off);
    return off;
  });
  return { listeners, unsubscribes };
}

const flush = async () => {
  for (let i = 0; i < 8; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await Promise.resolve();
  }
};

beforeEach(() => {
  jest.clearAllMocks();
  mockedGetConnection.mockReturnValue(null);
  mockedOnChange.mockImplementation(() => jest.fn());
});

describe('isEngineNotConnectedError', () => {
  it('matches the requireEngineConnection() message (Error or string)', () => {
    expect(isEngineNotConnectedError(new Error(NOT_CONNECTED))).toBe(true);
    expect(isEngineNotConnectedError(NOT_CONNECTED)).toBe(true);
  });

  it('ignores unrelated errors and non-error values', () => {
    expect(isEngineNotConnectedError(new Error('engine offline'))).toBe(false);
    expect(isEngineNotConnectedError(new Error('401 token expired'))).toBe(false);
    expect(isEngineNotConnectedError(undefined)).toBe(false);
    expect(isEngineNotConnectedError(null)).toBe(false);
    expect(isEngineNotConnectedError({ message: NOT_CONNECTED })).toBe(false);
  });
});

describe('shouldDeferForEngineReadiness', () => {
  it('defers only while the engine is still down', () => {
    mockedGetConnection.mockReturnValue(null);
    expect(shouldDeferForEngineReadiness(new Error(NOT_CONNECTED))).toBe(true);

    mockedGetConnection.mockReturnValue(CONN);
    expect(shouldDeferForEngineReadiness(new Error(NOT_CONNECTED))).toBe(false);
  });

  it('never defers a genuine failure against a live engine', () => {
    mockedGetConnection.mockReturnValue(CONN);
    expect(shouldDeferForEngineReadiness(new Error('POST /api/providers failed'))).toBe(false);
    mockedGetConnection.mockReturnValue(null);
    expect(shouldDeferForEngineReadiness(new Error('POST /api/providers failed'))).toBe(false);
  });
});

describe('createEngineReadinessDeferral', () => {
  it('runs the task on the next truthy connection and ignores disconnect events', async () => {
    const { listeners, unsubscribes } = captureListeners();
    const onError = jest.fn();
    const deferral = createEngineReadinessDeferral(onError);
    const task = jest.fn(async () => undefined);

    deferral.arm(task);
    expect(deferral.isArmed()).toBe(true);
    expect(mockedOnChange).toHaveBeenCalledTimes(1);

    listeners[0](null);
    await flush();
    expect(task).not.toHaveBeenCalled();
    expect(deferral.isArmed()).toBe(true);

    listeners[0](CONN);
    await flush();
    expect(task).toHaveBeenCalledTimes(1);
    expect(deferral.isArmed()).toBe(false);
    // Fired once → the subscription is released.
    expect(unsubscribes[0]).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
  });

  it('keeps ONE subscription and lets the latest armed task win', async () => {
    const { listeners } = captureListeners();
    const deferral = createEngineReadinessDeferral(jest.fn());
    const first = jest.fn();
    const second = jest.fn();

    deferral.arm(first);
    deferral.arm(second); // newer caller replaces the pending task
    expect(mockedOnChange).toHaveBeenCalledTimes(1);

    listeners[0](CONN);
    await flush();
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('routes a rejected task to onError instead of escaping', async () => {
    const { listeners } = captureListeners();
    const onError = jest.fn();
    const deferral = createEngineReadinessDeferral(onError);

    deferral.arm(async () => {
      throw new Error('boom');
    });
    listeners[0](CONN);
    await flush();

    expect(onError).toHaveBeenCalledWith(expect.any(Error));
    expect(deferral.isArmed()).toBe(false);
  });

  it('routes a synchronous throw to onError', async () => {
    const { listeners } = captureListeners();
    const onError = jest.fn();
    const deferral = createEngineReadinessDeferral(onError);

    deferral.arm(() => {
      throw new Error('sync boom');
    });
    expect(() => listeners[0](CONN)).not.toThrow();
    expect(onError).toHaveBeenCalledWith(expect.any(Error));
  });

  it('cancel() disarms without running and releases the subscription', async () => {
    const { listeners, unsubscribes } = captureListeners();
    const deferral = createEngineReadinessDeferral(jest.fn());
    const task = jest.fn();

    deferral.arm(task);
    deferral.cancel();
    expect(deferral.isArmed()).toBe(false);
    expect(unsubscribes[0]).toHaveBeenCalledTimes(1);

    listeners[0](CONN);
    await flush();
    expect(task).not.toHaveBeenCalled();
  });
});
