/**
 * UpdatePrompt — headless app-update dialog driver (plan 7-10 §4; owner ruling
 * 2026-10-20: the top banner is gone, the dialog appears automatically).
 *
 * Covers the fetch/emit wiring, the once-per-version-per-session dedupe, the
 * session-only Cancel contract (nothing persisted), store-variant suppression,
 * lock-screen gating, and the confirm routing (in-app APK self-update vs
 * Linking.openURL) including the install-permission path.
 */

jest.mock('../../../utils/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts ? `${key}:${JSON.stringify(opts)}` : key,
  }),
}));

const mockShowAlert = jest.fn();
jest.mock('../../../contexts/AppAlertContext', () => ({
  useAppAlert: () => ({ showAlert: mockShowAlert }),
}));

let mockIsLocked = false;
jest.mock('../../../contexts/BiometricLockContext', () => ({
  useBiometricLock: () => ({ isLocked: mockIsLocked }),
}));

let mockApkAvailable = false;
jest.mock('../../../config/appChannel', () => ({
  isApkSelfUpdateAvailable: () => mockApkAvailable,
}));

let mockStoreVariant = false;
jest.mock('../../../config/appVariant', () => ({
  isStoreVariant: () => mockStoreVariant,
  isFullVariant: () => !mockStoreVariant,
}));

const mockStartApk = jest.fn();
const mockOpenSettings = jest.fn();
jest.mock('../../../services/updates/apkSelfUpdate', () => ({
  __esModule: true,
  INSTALL_PERMISSION_REQUIRED: 'install_permission_required',
  startApkSelfUpdate: (...args: unknown[]) => mockStartApk(...args),
  openInstallPermissionSettings: (...args: unknown[]) => mockOpenSettings(...args),
}));

type UpdateStateListener = (state: UpdateState) => void;
const listeners: UpdateStateListener[] = [];
const mockGetState = jest.fn();
const mockOnUpdateStateChange = jest.fn((listener: UpdateStateListener) => {
  listeners.push(listener);
  return () => {
    const index = listeners.indexOf(listener);
    if (index >= 0) listeners.splice(index, 1);
  };
});
const mockDismissUpdate = jest.fn();
const mockIsUpdateDismissed = jest.fn();
jest.mock('../../../services/updates/UpdateAvailableService', () => ({
  getUpdateState: () => mockGetState(),
  onUpdateStateChange: (listener: UpdateStateListener) => mockOnUpdateStateChange(listener),
  dismissUpdate: (...args: unknown[]) => mockDismissUpdate(...args),
  isUpdateDismissed: (...args: unknown[]) => mockIsUpdateDismissed(...args),
}));

import React from 'react';
import { Linking } from 'react-native';
import { act, cleanup, render, waitFor } from '@testing-library/react-native';
import { UpdatePrompt } from '../UpdatePrompt';
import { INSTALL_PERMISSION_REQUIRED } from '../../../services/updates/apkSelfUpdate';
import type { UpdateState } from '../../../services/updates/UpdateAvailableService';

const EMPTY_STATE: UpdateState = { appUpdate: null, checkedAt: null, dismissed: [] };

const stateWithUpdate = (
  version: string,
  downloadUrl: string | null = 'https://dl/app.apk',
): UpdateState => ({
  appUpdate: { version, downloadUrl, notesUrl: 'https://notes/release' },
  checkedAt: 1,
  dismissed: [],
});

/** Push a state update through the component's subscription. */
const emitUpdate = async (state: UpdateState) => {
  await act(async () => {
    for (const listener of [...listeners]) listener(state);
  });
};

/** The buttons of the nth showAlert call. */
const alertButtons = (
  callIndex = 0,
): Array<{ text: string; style?: string; onPress?: () => void }> =>
  mockShowAlert.mock.calls[callIndex][2];

beforeEach(() => {
  cleanup();
  jest.clearAllMocks();
  listeners.length = 0;
  mockIsLocked = false;
  mockApkAvailable = false;
  mockStoreVariant = false;
  mockGetState.mockReturnValue(EMPTY_STATE);
  mockStartApk.mockResolvedValue(undefined);
  mockOpenSettings.mockResolvedValue(undefined);
  jest.spyOn(Linking, 'openURL').mockResolvedValue(true as never);
});

afterEach(cleanup);

describe('UpdatePrompt', () => {
  it('prompts automatically when an app update is available', async () => {
    mockGetState.mockReturnValue(stateWithUpdate('v0.4.15'));

    const { toJSON } = await render(<UpdatePrompt />);

    expect(toJSON()).toBeNull();
    expect(mockShowAlert).toHaveBeenCalledTimes(1);
    const [title, body, buttons] = mockShowAlert.mock.calls[0];
    expect(title).toBe('selfUpdate.title');
    expect(body).toBe('selfUpdate.body:{"version":"v0.4.15"}');
    expect(buttons).toHaveLength(2);
    expect(buttons[0]).toMatchObject({ text: 'selfUpdate.cancel', style: 'cancel' });
    expect(buttons[1].text).toBe('selfUpdate.confirm');
  });

  it('does not re-prompt when the same update state is re-emitted', async () => {
    mockGetState.mockReturnValue(stateWithUpdate('v0.4.15'));
    await render(<UpdatePrompt />);
    expect(mockShowAlert).toHaveBeenCalledTimes(1);

    // Repeated emissions: cache refresh, foreground re-check, same version.
    await emitUpdate(stateWithUpdate('v0.4.15'));
    await emitUpdate(stateWithUpdate('v0.4.15'));
    await emitUpdate(stateWithUpdate('v0.4.15'));

    expect(mockShowAlert).toHaveBeenCalledTimes(1);
  });

  it('prompts again for a newer version', async () => {
    mockGetState.mockReturnValue(stateWithUpdate('v0.4.15'));
    await render(<UpdatePrompt />);
    expect(mockShowAlert).toHaveBeenCalledTimes(1);

    await emitUpdate(stateWithUpdate('v0.4.16'));

    expect(mockShowAlert).toHaveBeenCalledTimes(2);
    expect(mockShowAlert.mock.calls[1][1]).toBe('selfUpdate.body:{"version":"v0.4.16"}');
  });

  it('Cancel is session-only: nothing persisted and no re-prompt this session', async () => {
    mockGetState.mockReturnValue(stateWithUpdate('v0.4.15'));
    await render(<UpdatePrompt />);

    const cancel = alertButtons()[0];
    expect(cancel.style).toBe('cancel');
    await act(async () => {
      cancel.onPress?.();
    });

    expect(mockDismissUpdate).not.toHaveBeenCalled();
    expect(mockIsUpdateDismissed).not.toHaveBeenCalled();

    await emitUpdate(stateWithUpdate('v0.4.15'));
    expect(mockShowAlert).toHaveBeenCalledTimes(1);
  });

  it('never prompts on the store variant', async () => {
    mockStoreVariant = true;
    mockGetState.mockReturnValue(stateWithUpdate('v0.4.15'));

    await render(<UpdatePrompt />);
    await emitUpdate(stateWithUpdate('v0.4.15'));

    expect(mockShowAlert).not.toHaveBeenCalled();
  });

  it('does not prompt while locked, then prompts once after unlock', async () => {
    mockIsLocked = true;
    mockGetState.mockReturnValue(stateWithUpdate('v0.4.15'));

    const { rerender } = await render(<UpdatePrompt />);
    expect(mockShowAlert).not.toHaveBeenCalled();

    // Still locked (state refresh) → stays silent.
    await emitUpdate(stateWithUpdate('v0.4.15'));
    expect(mockShowAlert).not.toHaveBeenCalled();

    // Unlock → the lock-state dependency re-runs the effect.
    mockIsLocked = false;
    await rerender(<UpdatePrompt />);
    expect(mockShowAlert).toHaveBeenCalledTimes(1);

    // A later re-render must not re-prompt for the same version.
    await rerender(<UpdatePrompt />);
    expect(mockShowAlert).toHaveBeenCalledTimes(1);
  });

  it('runs the in-app APK self-update on confirm (sideload channel)', async () => {
    mockApkAvailable = true;
    mockGetState.mockReturnValue(stateWithUpdate('v0.4.15', 'https://dl/app-v0.4.15.apk'));
    await render(<UpdatePrompt />);

    const confirm = alertButtons()[1];
    await act(async () => {
      confirm.onPress?.();
    });

    await waitFor(() =>
      expect(mockStartApk).toHaveBeenCalledWith('https://dl/app-v0.4.15.apk'),
    );
    expect(Linking.openURL).not.toHaveBeenCalled();
  });

  it('cannot double-start the install while one is in flight', async () => {
    mockApkAvailable = true;
    let finishInstall: () => void = () => {};
    mockStartApk.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishInstall = () => resolve();
        }),
    );
    mockGetState.mockReturnValue(stateWithUpdate('v0.4.15', 'https://dl/app.apk'));
    await render(<UpdatePrompt />);

    const confirm = alertButtons()[1];
    await act(async () => {
      confirm.onPress?.();
      confirm.onPress?.();
    });

    expect(mockStartApk).toHaveBeenCalledTimes(1);
    await act(async () => {
      finishInstall();
    });
  });

  it('opens the download URL when the self-update is unavailable', async () => {
    mockApkAvailable = false;
    mockGetState.mockReturnValue(stateWithUpdate('v0.4.15', 'https://dl/app.apk'));
    await render(<UpdatePrompt />);

    await act(async () => {
      alertButtons()[1].onPress?.();
    });

    await waitFor(() => expect(Linking.openURL).toHaveBeenCalledWith('https://dl/app.apk'));
    expect(mockStartApk).not.toHaveBeenCalled();
  });

  it('falls back to notesUrl when the manifest has no download URL', async () => {
    mockApkAvailable = false;
    mockGetState.mockReturnValue(stateWithUpdate('v0.4.15', null));
    await render(<UpdatePrompt />);

    await act(async () => {
      alertButtons()[1].onPress?.();
    });

    await waitFor(() => expect(Linking.openURL).toHaveBeenCalledWith('https://notes/release'));
  });

  it('shows the install-permission alert when the installer needs permission', async () => {
    mockApkAvailable = true;
    mockStartApk.mockRejectedValue(new Error(INSTALL_PERMISSION_REQUIRED));
    mockGetState.mockReturnValue(stateWithUpdate('v0.4.15', 'https://dl/app.apk'));
    await render(<UpdatePrompt />);

    await act(async () => {
      alertButtons()[1].onPress?.();
    });

    await waitFor(() => expect(mockShowAlert).toHaveBeenCalledTimes(2));
    const [, message, buttons] = mockShowAlert.mock.calls[1];
    expect(message).toBe('selfUpdate.permissionNeeded');
    expect(buttons[1].text).toBe('selfUpdate.openSettings');

    await act(async () => {
      buttons[1].onPress?.();
    });
    expect(mockOpenSettings).toHaveBeenCalledTimes(1);
  });

  it('shows the generic install failure alert', async () => {
    mockApkAvailable = true;
    mockStartApk.mockRejectedValue(new Error('download failed (HTTP 500)'));
    mockGetState.mockReturnValue(stateWithUpdate('v0.4.15', 'https://dl/app.apk'));
    await render(<UpdatePrompt />);

    await act(async () => {
      alertButtons()[1].onPress?.();
    });

    await waitFor(() => expect(mockShowAlert).toHaveBeenCalledTimes(2));
    const [, message, buttons] = mockShowAlert.mock.calls[1];
    expect(message).toBe('selfUpdate.installFailed:{"message":"download failed (HTTP 500)"}');
    expect(buttons).toBeUndefined();
  });
});
