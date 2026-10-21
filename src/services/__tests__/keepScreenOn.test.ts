/**
 * keepScreenOn — JS wrapper around the first-party KeepScreenOn native helper.
 *
 * Locks the guards the TTS panel and the lock screen rely on:
 *  - refcounted holds (the panel and the lock overlay overlap), so the native
 *    flag is toggled only on the 0→1 / 1→0 edges and an extra release is inert
 *  - a return to foreground (`active`) RE-ASSERTS the flag while held, so an
 *    Activity/window recreation cannot silently leave keep-awake dead
 *  - a missing module (jest/web/off-device) is a no-op logged ONCE at INFO
 *  - a native rejection never throws into the render path (and allows a retry)
 */

import { NativeModules } from 'react-native';
import {
  activateKeepScreenOn,
  deactivateKeepScreenOn,
} from '../keepScreenOn';

jest.mock('../../utils/logger', () => {
  const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  return { createLogger: () => logger, __logger: logger };
});

// Controllable AppLifecycle: the wrapper subscribes only while it is held and
// re-applies the flag on 'active'.
jest.mock('react-native-applifecycle', () => {
  const handlers: Array<(state: string) => void> = [];
  const remove = jest.fn();
  return {
    AppLifecycle: {
      addEventListener: jest.fn((_event: string, handler: (state: string) => void) => {
        handlers.push(handler);
        return { remove };
      }),
      currentState: 'active',
      __handlers: handlers,
      __remove: remove,
    },
  };
});

import { AppLifecycle } from 'react-native-applifecycle';

type Bridge = { activate: jest.Mock; deactivate: jest.Mock };

const lifecycle = AppLifecycle as unknown as {
  __handlers: Array<(state: string) => void>;
  __remove: jest.Mock;
};
const logger = (jest.requireMock('../../utils/logger') as {
  __logger: { info: jest.Mock; warn: jest.Mock; error: jest.Mock; debug: jest.Mock };
}).__logger;

function bridge(): Bridge | undefined {
  return (NativeModules as unknown as Record<string, Bridge | undefined>).KeepScreenOn;
}

/** Fire a lifecycle change at every listener the wrapper registered. */
function emit(state: string) {
  lifecycle.__handlers.forEach((handler) => handler(state));
}

describe('keepScreenOn', () => {
  let activate: jest.Mock;
  let deactivate: jest.Mock;
  /** Holds taken in the current test, drained in afterEach. */
  let holds = 0;

  async function hold(times = 1) {
    for (let i = 0; i < times; i += 1) {
      holds += 1;
      await activateKeepScreenOn();
    }
  }

  async function release(times = 1) {
    for (let i = 0; i < times; i += 1) {
      holds = Math.max(0, holds - 1);
      await deactivateKeepScreenOn();
    }
  }

  beforeEach(() => {
    jest.clearAllMocks();
    holds = 0;
    lifecycle.__handlers.length = 0;
    activate = jest.fn(() => Promise.resolve());
    deactivate = jest.fn(() => Promise.resolve());
    (NativeModules as unknown as Record<string, Bridge>).KeepScreenOn = { activate, deactivate };
  });

  afterEach(async () => {
    // Balance the module-level refcount before dropping the bridge.
    await release(holds);
    delete (NativeModules as unknown as Record<string, unknown>).KeepScreenOn;
  });

  it('activates and deactivates the native module', async () => {
    await hold();
    expect(activate).toHaveBeenCalledTimes(1);
    expect(deactivate).not.toHaveBeenCalled();

    await release();
    expect(deactivate).toHaveBeenCalledTimes(1);
  });

  it('is refcounted: overlapping consumers toggle the native flag only on the edges', async () => {
    // TtsTestPanel holds it across synthesis, then LockScreen mounts on top.
    await hold();
    await hold();
    await hold();
    expect(activate).toHaveBeenCalledTimes(1);

    // The panel releases while the lock overlay still holds → flag stays on.
    await release();
    await release();
    expect(deactivate).not.toHaveBeenCalled();

    // Last consumer releases → flag clears exactly once.
    await release();
    expect(deactivate).toHaveBeenCalledTimes(1);
  });

  it('ignores a release below zero', async () => {
    await deactivateKeepScreenOn();
    await deactivateKeepScreenOn();
    expect(deactivate).not.toHaveBeenCalled();

    // Still usable afterwards.
    await hold();
    expect(activate).toHaveBeenCalledTimes(1);
  });

  it('re-asserts the flag on every foreground return while held', async () => {
    await hold();
    expect(activate).toHaveBeenCalledTimes(1);
    expect(AppLifecycle.addEventListener).toHaveBeenCalledTimes(1);

    // Already foregrounded: a re-assert must land on the CURRENT window.
    emit('active');
    await Promise.resolve();
    expect(activate).toHaveBeenCalledTimes(2);

    // Backgrounding does not toggle anything by itself.
    emit('background');
    await Promise.resolve();
    expect(activate).toHaveBeenCalledTimes(2);
    expect(deactivate).not.toHaveBeenCalled();
  });

  it('stops re-asserting (and unsubscribes) after the last release', async () => {
    await hold();
    emit('active');
    await Promise.resolve();
    expect(activate).toHaveBeenCalledTimes(2);

    await release();
    expect(lifecycle.__remove).toHaveBeenCalledTimes(1);

    emit('active');
    await Promise.resolve();
    expect(activate).toHaveBeenCalledTimes(2);
  });

  it('no-ops when the native module is missing, logging it once at INFO', async () => {
    delete (NativeModules as unknown as Record<string, unknown>).KeepScreenOn;

    await expect(activateKeepScreenOn()).resolves.toBeUndefined();
    await expect(activateKeepScreenOn()).resolves.toBeUndefined();
    await expect(deactivateKeepScreenOn()).resolves.toBeUndefined();
    await expect(deactivateKeepScreenOn()).resolves.toBeUndefined();

    expect(bridge()).toBeUndefined();
    expect(logger.info).toHaveBeenCalledTimes(1);
    expect(logger.info.mock.calls[0][0]).toContain('KeepScreenOn native module unavailable');
    expect(logger.error).not.toHaveBeenCalled();
    holds = 0;
  });

  it('swallows a native activate rejection and allows a retry', async () => {
    activate.mockRejectedValueOnce(new Error('no activity'));

    await expect(activateKeepScreenOn()).resolves.toBeUndefined();
    expect(activate).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalled();
    await release();

    // A failed hold is not sticky: the next consumer retries the native call.
    await hold();
    expect(activate).toHaveBeenCalledTimes(2);
  });
});
