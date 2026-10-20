/**
 * keepScreenOn — JS wrapper around the first-party KeepScreenOn native helper.
 *
 * Locks the guards the TTS panel relies on: calls are idempotent per direction
 * (so a `useEffect` that re-runs on every phase change does not spam the
 * native side), a missing module (jest/web/off-device) is a silent no-op, and
 * a native rejection never throws into the render path.
 */

import { NativeModules } from 'react-native';
import {
  activateKeepScreenOn,
  deactivateKeepScreenOn,
} from '../keepScreenOn';

jest.mock('../../utils/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

type Bridge = { activate: jest.Mock; deactivate: jest.Mock };

function bridge(): Bridge | undefined {
  return (NativeModules as unknown as Record<string, Bridge | undefined>).KeepScreenOn;
}

describe('keepScreenOn', () => {
  let activate: jest.Mock;
  let deactivate: jest.Mock;

  beforeEach(() => {
    activate = jest.fn(() => Promise.resolve());
    deactivate = jest.fn(() => Promise.resolve());
    (NativeModules as unknown as Record<string, Bridge>).KeepScreenOn = { activate, deactivate };
  });

  afterEach(async () => {
    // Balance the module-level `active` flag before dropping the bridge.
    await deactivateKeepScreenOn();
    delete (NativeModules as unknown as Record<string, unknown>).KeepScreenOn;
  });

  it('activates and deactivates the native module', async () => {
    await activateKeepScreenOn();
    expect(activate).toHaveBeenCalledTimes(1);
    expect(deactivate).not.toHaveBeenCalled();

    await deactivateKeepScreenOn();
    expect(deactivate).toHaveBeenCalledTimes(1);
  });

  it('is idempotent per direction', async () => {
    await activateKeepScreenOn();
    await activateKeepScreenOn();
    await activateKeepScreenOn();
    expect(activate).toHaveBeenCalledTimes(1);

    await deactivateKeepScreenOn();
    await deactivateKeepScreenOn();
    expect(deactivate).toHaveBeenCalledTimes(1);
  });

  it('no-ops when the native module is missing', async () => {
    delete (NativeModules as unknown as Record<string, unknown>).KeepScreenOn;

    await expect(activateKeepScreenOn()).resolves.toBeUndefined();
    await expect(deactivateKeepScreenOn()).resolves.toBeUndefined();
    expect(bridge()).toBeUndefined();
  });

  it('swallows a native activate rejection and allows a retry', async () => {
    activate.mockRejectedValueOnce(new Error('no activity'));

    await expect(activateKeepScreenOn()).resolves.toBeUndefined();
    expect(activate).toHaveBeenCalledTimes(1);

    await activateKeepScreenOn();
    expect(activate).toHaveBeenCalledTimes(2);
  });
});
