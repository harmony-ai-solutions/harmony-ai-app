/**
 * UpdatePrompt — headless app-update dialog driver + in-app download dialog
 * ("Auto-Update UX phases 1+2"; plan 7-10 §4).
 *
 * Covers:
 *   - the once-per-version-per-session auto-prompt, the session-only Cancel
 *     contract (nothing persisted), store-variant suppression and lock gating;
 *   - confirm routing (in-app APK self-update vs Linking.openURL) including the
 *     notesUrl fallback and the "delegate concurrency to the service" rule;
 *   - the progress dialog driven by the service's observable state
 *     (downloading → Cancel, ready → Install, failed+permission → Open settings
 *     and Retry, idle → dismissed);
 *   - cold-start pickup: resume alert for a partial download, install alert for
 *     a complete one (begin → install, in order), plus store / lock / session
 *     gating and the no-double-dialog rule shared with the auto-prompt.
 *
 * The whole `apkSelfUpdate` service is mocked — the real suite lives in
 * `src/services/updates/__tests__/apkSelfUpdate.test.ts`. Themed primitives are
 * mocked (as the other modal suites do) so the dialog renders as plain RN
 * components.
 */

jest.mock('../../../utils/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

// A STABLE `t` (react-i18next returns a memoized one in production): an
// unstable identity would re-register the effects on every render.
jest.mock('react-i18next', () => {
  const t = (key: string, opts?: Record<string, unknown>) =>
    opts ? `${key}:${JSON.stringify(opts)}` : key;
  return { useTranslation: () => ({ t }) };
});

jest.mock('react-native-linear-gradient', () => {
  const React = require('react');
  const { View } = require('react-native');
  return ({ children, style, ...props }: any) =>
    React.createElement(View, { style, ...props }, children);
});

jest.mock('../../../contexts/ThemeContext', () => ({
  useAppTheme: () => ({
    theme: {
      colors: {
        accent: { primary: '#7c3aed', secondary: '#a78bfa', primaryHover: '#8b5cf6' },
        background: { base: '#0f0f1a', surface: '#151d30', elevated: '#1e1e2e', hover: '#222' },
        border: { default: '#333333', focus: '#444', hover: '#555', accent: '#7c3aed' },
        text: { primary: '#ffffff', secondary: '#cccccc', muted: '#aaaaaa', disabled: '#555555' },
        status: {
          success: '#22c55e',
          successBg: '#22c55e22',
          warning: '#f59e0b',
          warningBg: '#f59e0b22',
          error: '#ef4444',
          errorBg: '#ef444422',
          info: '#38bdf8',
          infoBg: '#38bdf822',
        },
        glass: {
          cardOpacity: 0.5,
          borderGradientStart: 'rgba(255,255,255,0.4)',
          borderGradientEnd: 'rgba(124,58,237,0.4)',
        },
        typography: { headerOpacity: 1, subtextOpacity: 0.7, captionOpacity: 0.5 },
      },
    },
  }),
}));

jest.mock('../../themed/ThemedText', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    __esModule: true,
    ThemedText: ({ children, style, ...props }: any) =>
      React.createElement(Text, { style, ...props }, children),
  };
});

jest.mock('../../themed/ThemedButton', () => {
  const React = require('react');
  const { TouchableOpacity, Text } = require('react-native');
  return {
    __esModule: true,
    ThemedButton: ({ label, onPress, disabled, style, ...props }: any) =>
      React.createElement(
        TouchableOpacity,
        { onPress, disabled, style, accessibilityRole: 'button', ...props },
        React.createElement(Text, null, label),
      ),
  };
});

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

// ── apkSelfUpdate service (fully mocked) ────────────────────────────────

type ApkListener = (state: ApkDownloadState) => void;

const mockBegin = jest.fn();
const mockCancel = jest.fn();
const mockInstall = jest.fn();
const mockFindPending = jest.fn();
const mockOpenSettings = jest.fn();
const mockGetApkState = jest.fn();
const apkListeners: ApkListener[] = [];
const mockOnApkStateChange = jest.fn((listener: ApkListener) => {
  apkListeners.push(listener);
  return () => {
    const index = apkListeners.indexOf(listener);
    if (index >= 0) apkListeners.splice(index, 1);
  };
});

jest.mock('../../../services/updates/apkSelfUpdate', () => ({
  __esModule: true,
  INSTALL_PERMISSION_REQUIRED: 'install_permission_required',
  getApkDownloadState: () => mockGetApkState(),
  onApkDownloadStateChange: (listener: ApkListener) => mockOnApkStateChange(listener),
  beginApkSelfUpdate: (...args: unknown[]) => mockBegin(...args),
  cancelApkSelfUpdate: (...args: unknown[]) => mockCancel(...args),
  installDownloadedApk: (...args: unknown[]) => mockInstall(...args),
  findPendingApkDownload: (...args: unknown[]) => mockFindPending(...args),
  openInstallPermissionSettings: (...args: unknown[]) => mockOpenSettings(...args),
  isApkSelfUpdateSupported: () => true,
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
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react-native';
import { UpdatePrompt } from '../UpdatePrompt';
import { INSTALL_PERMISSION_REQUIRED } from '../../../services/updates/apkSelfUpdate';
import type {
  ApkDownloadState,
  PendingApkDownload,
} from '../../../services/updates/apkSelfUpdate';
import type { UpdateState } from '../../../services/updates/UpdateAvailableService';

const EMPTY_STATE: UpdateState = { appUpdate: null, checkedAt: null, dismissed: [] };

const IDLE_DOWNLOAD: ApkDownloadState = { phase: 'idle', progress: null, error: null };

const stateWithUpdate = (
  version: string,
  downloadUrl: string | null = 'https://dl/app.apk',
): UpdateState => ({
  appUpdate: { version, downloadUrl, notesUrl: 'https://notes/release' },
  checkedAt: 1,
  dismissed: [],
});

/** ~23.5 MB of a ~50.1 MB artifact → 47 %. */
const BYTES_FETCHED = 24641536;
const CONTENT_LENGTH = 52533658;

const downloadingState = (percent: number | null = 47): ApkDownloadState => ({
  phase: 'downloading',
  progress: {
    version: 'v0.4.16',
    url: 'https://dl/app-v0.4.16.apk',
    bytesFetched: BYTES_FETCHED,
    contentLength: percent == null ? null : CONTENT_LENGTH,
    percent,
  },
  error: null,
});

const readyState = (): ApkDownloadState => ({
  phase: 'ready',
  progress: {
    version: 'v0.4.16',
    url: 'https://dl/app-v0.4.16.apk',
    bytesFetched: CONTENT_LENGTH,
    contentLength: CONTENT_LENGTH,
    percent: 100,
  },
  error: null,
});

const pendingDownload = (
  complete: boolean,
  percent: number | null = 42,
): PendingApkDownload => ({
  version: 'v0.4.16',
  url: 'https://dl/app-v0.4.16.apk',
  bytesFetched: 22_000_000,
  contentLength: complete ? 22_000_000 : CONTENT_LENGTH,
  percent: complete ? 100 : percent,
  complete,
});

/** Push an update state through the component's subscription. */
const emitUpdate = async (state: UpdateState) => {
  await act(async () => {
    for (const listener of [...listeners]) listener(state);
  });
};

/** Push a download state through the component's subscription. */
const emitDownload = async (state: ApkDownloadState) => {
  await act(async () => {
    for (const listener of [...apkListeners]) listener(state);
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
  apkListeners.length = 0;
  mockIsLocked = false;
  mockApkAvailable = false;
  mockStoreVariant = false;
  mockGetState.mockReturnValue(EMPTY_STATE);
  mockGetApkState.mockReturnValue(IDLE_DOWNLOAD);
  mockFindPending.mockResolvedValue(null);
  mockBegin.mockResolvedValue(undefined);
  mockCancel.mockResolvedValue(undefined);
  mockInstall.mockResolvedValue(undefined);
  mockOpenSettings.mockResolvedValue(undefined);
  jest.spyOn(Linking, 'openURL').mockResolvedValue(true as never);
});

afterEach(cleanup);

describe('UpdatePrompt — automatic prompt', () => {
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

  it('does not prompt without an app update', async () => {
    mockGetState.mockReturnValue(EMPTY_STATE);

    await render(<UpdatePrompt />);

    expect(mockShowAlert).not.toHaveBeenCalled();
  });
});

describe('UpdatePrompt — confirm routing', () => {
  it('starts the in-app APK self-update with the version and URL (sideload channel)', async () => {
    mockApkAvailable = true;
    mockGetState.mockReturnValue(stateWithUpdate('v0.4.15', 'https://dl/app-v0.4.15.apk'));
    await render(<UpdatePrompt />);

    await act(async () => {
      alertButtons()[1].onPress?.();
    });

    await waitFor(() =>
      expect(mockBegin).toHaveBeenCalledWith('v0.4.15', 'https://dl/app-v0.4.15.apk'),
    );
    expect(Linking.openURL).not.toHaveBeenCalled();
  });

  it('leaves concurrency guarding to the service (no client-side in-flight ref)', async () => {
    mockApkAvailable = true;
    mockGetState.mockReturnValue(stateWithUpdate('v0.4.15', 'https://dl/app.apk'));
    await render(<UpdatePrompt />);

    const confirm = alertButtons()[1];
    await act(async () => {
      confirm.onPress?.();
      confirm.onPress?.();
    });

    // beginApkSelfUpdate is a no-op while a run is active; the component does
    // not need its own guard (the old installInFlightRef is gone).
    expect(mockBegin).toHaveBeenCalledTimes(2);
  });

  it('opens the download URL when the self-update is unavailable', async () => {
    mockApkAvailable = false;
    mockGetState.mockReturnValue(stateWithUpdate('v0.4.15', 'https://dl/app.apk'));
    await render(<UpdatePrompt />);

    await act(async () => {
      alertButtons()[1].onPress?.();
    });

    await waitFor(() => expect(Linking.openURL).toHaveBeenCalledWith('https://dl/app.apk'));
    expect(mockBegin).not.toHaveBeenCalled();
  });

  it('falls back to notesUrl when the manifest has no download URL', async () => {
    mockApkAvailable = false;
    mockGetState.mockReturnValue(stateWithUpdate('v0.4.15', null));
    await render(<UpdatePrompt />);

    await act(async () => {
      alertButtons()[1].onPress?.();
    });

    await waitFor(() => expect(Linking.openURL).toHaveBeenCalledWith('https://notes/release'));
    expect(mockBegin).not.toHaveBeenCalled();
  });
});

describe('UpdatePrompt — progress dialog', () => {
  it('renders nothing while the service is idle', async () => {
    const screen = await render(<UpdatePrompt />);

    expect(screen.queryByTestId('update-download-modal')).toBeNull();
    expect(mockOnApkStateChange).toHaveBeenCalledTimes(1);
  });

  it('shows the download progress as the service emits downloading', async () => {
    const screen = await render(<UpdatePrompt />);
    expect(screen.queryByTestId('update-download-modal')).toBeNull();

    await emitDownload(downloadingState());

    expect(screen.getByTestId('update-download-modal')).toBeTruthy();
    expect(screen.getByText('selfUpdate.downloadingTitle')).toBeTruthy();
    expect(
      screen.getByText(
        'selfUpdate.progressMeta:{"downloaded":"23.5 MB","total":"50.1 MB","percent":47}',
      ),
    ).toBeTruthy();
  });

  it('cancels the download from the dialog', async () => {
    const screen = await render(<UpdatePrompt />);
    await emitDownload(downloadingState());

    await act(async () => {
      fireEvent.press(screen.getByText('selfUpdate.cancel'));
    });

    expect(mockCancel).toHaveBeenCalledTimes(1);
  });

  it('launches the installer from the ready dialog', async () => {
    const screen = await render(<UpdatePrompt />);
    await emitDownload(readyState());

    expect(screen.getByText('selfUpdate.readyTitle')).toBeTruthy();
    await act(async () => {
      fireEvent.press(screen.getByText('selfUpdate.installNow'));
    });

    expect(mockInstall).toHaveBeenCalledTimes(1);
  });

  it('offers settings + retry when the install permission is missing', async () => {
    const screen = await render(<UpdatePrompt />);
    await emitDownload({
      ...downloadingState(0),
      phase: 'failed',
      error: INSTALL_PERMISSION_REQUIRED,
    });

    expect(screen.getByText('selfUpdate.permissionNeeded')).toBeTruthy();

    await act(async () => {
      fireEvent.press(screen.getByText('selfUpdate.openSettings'));
    });
    expect(mockOpenSettings).toHaveBeenCalledTimes(1);

    await act(async () => {
      fireEvent.press(screen.getByText('selfUpdate.retry'));
    });
    await waitFor(() =>
      expect(mockBegin).toHaveBeenCalledWith('v0.4.16', 'https://dl/app-v0.4.16.apk'),
    );
  });

  it('retries a generic download failure with the last known URL', async () => {
    const screen = await render(<UpdatePrompt />);
    await emitDownload({
      ...downloadingState(),
      phase: 'failed',
      error: 'download failed (HTTP 500)',
    });

    expect(
      screen.getByText(
        'selfUpdate.installFailed:{"message":"download failed (HTTP 500)"}',
      ),
    ).toBeTruthy();

    await act(async () => {
      fireEvent.press(screen.getByText('selfUpdate.retry'));
    });
    await waitFor(() =>
      expect(mockBegin).toHaveBeenCalledWith('v0.4.16', 'https://dl/app-v0.4.16.apk'),
    );

    await act(async () => {
      fireEvent.press(screen.getByText('selfUpdate.cancel'));
    });
    expect(mockCancel).toHaveBeenCalledTimes(1);
  });

  it('closes the dialog when the service returns to idle', async () => {
    const screen = await render(<UpdatePrompt />);
    await emitDownload(downloadingState());
    expect(screen.getByTestId('update-download-modal')).toBeTruthy();

    await emitDownload(IDLE_DOWNLOAD);
    expect(screen.queryByTestId('update-download-modal')).toBeNull();
  });

  it('hides the progress dialog while the app is locked', async () => {
    mockIsLocked = true;
    mockGetApkState.mockReturnValue(downloadingState());

    const screen = await render(<UpdatePrompt />);

    expect(screen.queryByTestId('update-download-modal')).toBeNull();
  });
});

describe('UpdatePrompt — cold-start pickup', () => {
  it('offers to resume a partial download, then resumes it', async () => {
    mockApkAvailable = true;
    mockFindPending.mockResolvedValue(pendingDownload(false));

    await render(<UpdatePrompt />);

    await waitFor(() => expect(mockShowAlert).toHaveBeenCalledTimes(1));
    const [title, body, buttons] = mockShowAlert.mock.calls[0];
    expect(title).toBe('selfUpdate.resumeTitle');
    expect(body).toBe('selfUpdate.resumeBody:{"version":"v0.4.16","percent":42}');
    expect(buttons[0]).toMatchObject({ text: 'selfUpdate.notNow', style: 'cancel' });
    expect(buttons[1].text).toBe('selfUpdate.resume');

    await act(async () => {
      buttons[1].onPress?.();
    });
    await waitFor(() =>
      expect(mockBegin).toHaveBeenCalledWith('v0.4.16', 'https://dl/app-v0.4.16.apk'),
    );
    expect(mockInstall).not.toHaveBeenCalled();
  });

  it('uses the percent-free resume copy when the total is unknown', async () => {
    mockApkAvailable = true;
    mockFindPending.mockResolvedValue(pendingDownload(false, null));

    await render(<UpdatePrompt />);

    await waitFor(() => expect(mockShowAlert).toHaveBeenCalledTimes(1));
    expect(mockShowAlert.mock.calls[0][1]).toBe(
      'selfUpdate.resumeBodyUnknown:{"version":"v0.4.16"}',
    );
  });

  it('offers to install a complete download, then begins and installs in order', async () => {
    mockApkAvailable = true;
    mockFindPending.mockResolvedValue(pendingDownload(true));

    await render(<UpdatePrompt />);

    await waitFor(() => expect(mockShowAlert).toHaveBeenCalledTimes(1));
    const [title, body, buttons] = mockShowAlert.mock.calls[0];
    expect(title).toBe('selfUpdate.pickupReadyTitle');
    expect(body).toBe('selfUpdate.pickupReadyBody:{"version":"v0.4.16"}');
    expect(buttons[1].text).toBe('selfUpdate.installNow');

    await act(async () => {
      buttons[1].onPress?.();
    });

    await waitFor(() => expect(mockInstall).toHaveBeenCalledTimes(1));
    expect(mockBegin).toHaveBeenCalledWith('v0.4.16', 'https://dl/app-v0.4.16.apk');
    expect(mockBegin.mock.invocationCallOrder[0]).toBeLessThan(
      mockInstall.mock.invocationCallOrder[0],
    );
  });

  it('does nothing when there is no pending download', async () => {
    mockApkAvailable = true;
    mockFindPending.mockResolvedValue(null);

    await render(<UpdatePrompt />);

    await waitFor(() => expect(mockFindPending).toHaveBeenCalledTimes(1));
    expect(mockShowAlert).not.toHaveBeenCalled();
  });

  it('never picks up on the store variant', async () => {
    mockApkAvailable = true;
    mockStoreVariant = true;
    mockFindPending.mockResolvedValue(pendingDownload(true));

    await render(<UpdatePrompt />);

    expect(mockFindPending).not.toHaveBeenCalled();
    expect(mockShowAlert).not.toHaveBeenCalled();
  });

  it('skips the scan when the self-update is unavailable', async () => {
    mockApkAvailable = false;
    mockFindPending.mockResolvedValue(pendingDownload(true));

    await render(<UpdatePrompt />);

    expect(mockFindPending).not.toHaveBeenCalled();
  });

  it('waits for the unlock, then offers the pending download once', async () => {
    mockApkAvailable = true;
    mockIsLocked = true;
    mockFindPending.mockResolvedValue(pendingDownload(false));

    const { rerender } = await render(<UpdatePrompt />);
    expect(mockFindPending).not.toHaveBeenCalled();
    expect(mockShowAlert).not.toHaveBeenCalled();

    mockIsLocked = false;
    await rerender(<UpdatePrompt />);

    await waitFor(() => expect(mockShowAlert).toHaveBeenCalledTimes(1));
    expect(mockShowAlert.mock.calls[0][0]).toBe('selfUpdate.resumeTitle');

    await rerender(<UpdatePrompt />);
    await emitUpdate(EMPTY_STATE);
    expect(mockFindPending).toHaveBeenCalledTimes(1);
    expect(mockShowAlert).toHaveBeenCalledTimes(1);
  });

  it('never double-dialogs a version the auto-prompt already covered', async () => {
    mockApkAvailable = true;
    // The pending download is for the very version the prompt announces.
    mockFindPending.mockResolvedValue(pendingDownload(true));
    mockGetState.mockReturnValue(stateWithUpdate('v0.4.16', 'https://dl/app-v0.4.16.apk'));

    await render(<UpdatePrompt />);

    await waitFor(() => expect(mockFindPending).toHaveBeenCalledTimes(1));
    expect(mockShowAlert).toHaveBeenCalledTimes(1);
    expect(mockShowAlert.mock.calls[0][0]).toBe('selfUpdate.title');
  });
});
