/**
 * BackupSettingsScreen — 2-6 tests.
 *
 * The screen is driven by the mocked `backupOrchestrator` singleton. Covers the
 * status/size/recovery-code rendering, the estimate-confirm dialog before a
 * manual backup, the automatic-backup toggle, and the reset-key flow.
 */

import React from 'react';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react-native';

afterEach(cleanup);
beforeEach(() => {
  cleanup();
  jest.resetAllMocks();
});

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, opts?: any) => (opts ? `${key}:${JSON.stringify(opts)}` : key) }),
}));

jest.mock('../../utils/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

jest.mock('react-native-vector-icons/MaterialCommunityIcons', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return ({ name, ...props }: any) => React.createElement(Text, { ...props }, name);
});

jest.mock('../../utils/haptics', () => ({ hapticLightPress: jest.fn() }));

jest.mock('../../contexts/ThemeContext', () => ({
  useAppTheme: () => ({
    theme: {
      colors: {
        accent: { primary: '#7c3aed', secondary: '#a78bfa' },
        background: { base: '#0f0f1a', surface: '#151d30', elevated: '#1e1e2e' },
        border: { default: '#333333' },
        text: { primary: '#ffffff', secondary: '#cccccc', muted: '#aaaaaa', disabled: '#555555' },
        status: { success: '#22c55e', warning: '#f59e0b', error: '#ef4444' },
      },
    },
  }),
}));

const mockShowAlert = jest.fn();
jest.mock('../../contexts/AppAlertContext', () => ({
  useAppAlert: () => ({ showAlert: mockShowAlert }),
}));
const mockShowToast = jest.fn();
jest.mock('../../contexts/AppToastContext', () => ({
  useToast: () => ({ showToast: mockShowToast }),
}));

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn() }),
}));

jest.mock('../../components/themed/ThemedView', () => {
  const React = require('react');
  const { View } = require('react-native');
  return { __esModule: true, ThemedView: ({ children, style, ...props }: any) => React.createElement(View, { style, ...props }, children) };
});
jest.mock('../../components/themed/ThemedText', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return { __esModule: true, ThemedText: ({ children, style, ...props }: any) => React.createElement(Text, { style, ...props }, children) };
});
jest.mock('../../components/themed/ThemedCard', () => {
  const React = require('react');
  const { View } = require('react-native');
  return { __esModule: true, ThemedCard: ({ children, style, ...props }: any) => React.createElement(View, { style, ...props }, children) };
});
jest.mock('../../components/themed/ScreenHeader', () => {
  const React = require('react');
  const { View } = require('react-native');
  return { __esModule: true, ScreenHeader: ({ children, ...props }: any) => React.createElement(View, props, children) };
});
jest.mock('../../components/themed/ThemedButton', () => {
  const React = require('react');
  const { TouchableOpacity, Text } = require('react-native');
  return {
    __esModule: true,
    ThemedButton: ({ label, onPress, disabled, testID }: any) =>
      React.createElement(TouchableOpacity, { testID, onPress, disabled }, React.createElement(Text, null, label)),
  };
});

jest.mock('../../components/settings/SettingsRows', () => {
  const React = require('react');
  const { Switch, View } = require('react-native');
  return {
    __esModule: true,
    SettingsToggleRow: ({ value, onValueChange, label }: any) =>
      React.createElement(View, null, React.createElement(Switch, { testID: `toggle-${label}`, value, onValueChange })),
  };
});

jest.mock('../../components/config/SelectPicker', () => {
  const React = require('react');
  const { View } = require('react-native');
  return { __esModule: true, SelectPicker: ({ testID }: any) => React.createElement(View, { testID: testID ?? 'select-picker' }) };
});

jest.mock('../../services/backup/backupNative', () => ({
  pickBackupFolder: jest.fn(async () => null),
  isBackupNativeAvailable: jest.fn(() => true),
}));

jest.mock('../../services/backup/BackupOrchestrator', () => ({
  backupOrchestrator: {
    getSettings: jest.fn(),
    updateSettings: jest.fn(),
    probeTarget: jest.fn(),
    getRecoveryCode: jest.fn(),
    estimateBackupSize: jest.fn(),
    backUpNow: jest.fn(),
    resetRecoveryCode: jest.fn(),
    scheduleIfEnabled: jest.fn(),
    setPassphrase: jest.fn(),
    clearPassphrase: jest.fn(),
    restore: jest.fn(),
    clearPendingConflict: jest.fn(),
    isSignedIn: jest.fn(async () => true),
    getCloudQuota: jest.fn(async () => ({ usedBytes: 2 * 1024 * 1024, quotaMb: 10240 })),
  },
  BACKUP_TARGET_OPTIONS: [
    { id: 'local-folder', labelKey: 'targetLocal', v1: true },
    { id: 'webdav', labelKey: 'targetWebDAV', v1: true },
    { id: 'soulbits-cloud', labelKey: 'targetSoulbitsCloud', v1: true, requiresSignIn: true },
  ],
}));

import { BackupSettingsScreen, formatBytes, groupRecoveryCode } from '../settings/BackupSettingsScreen';
import { backupOrchestrator } from '../../services/backup/BackupOrchestrator';

const mockOrch = backupOrchestrator as unknown as {
  getSettings: jest.Mock;
  updateSettings: jest.Mock;
  probeTarget: jest.Mock;
  getRecoveryCode: jest.Mock;
  estimateBackupSize: jest.Mock;
  backUpNow: jest.Mock;
  resetRecoveryCode: jest.Mock;
  scheduleIfEnabled: jest.Mock;
  restore: jest.Mock;
  clearPendingConflict: jest.Mock;
};

function settings(over: Record<string, unknown> = {}) {
  return {
    enabled: true,
    targetType: 'local-folder',
    cadence: 'daily',
    wifiOnly: true,
    chargingOnly: true,
    passphraseEnabled: false,
    localFolderUri: 'content://tree/x',
    localFolderLabel: 'My folder',
    lastBackupAt: '2026-10-12T00:00:00Z',
    lastTotalBytes: 5 * 1024 * 1024,
    ...over,
  };
}

async function renderScreen(s = settings()) {
  mockOrch.getSettings.mockResolvedValue(s);
  mockOrch.probeTarget.mockResolvedValue({ available: true, account: 'me' });
  mockOrch.getRecoveryCode.mockResolvedValue('a'.repeat(64));
  mockOrch.updateSettings.mockImplementation(async (p: any) => ({ ...s, ...p }));
  (backupOrchestrator as any).isSignedIn.mockResolvedValue(true);
  (backupOrchestrator as any).getCloudQuota.mockResolvedValue({ usedBytes: 2 * 1024 * 1024, quotaMb: 10240 });
  const utils = await render(<BackupSettingsScreen />);
  await waitFor(() => expect(utils.getByTestId('backup-recovery-code')).toBeTruthy());
  return utils;
}

describe('BackupSettingsScreen', () => {
  it('renders size and recovery code', async () => {
    const utils = await renderScreen();
    expect(utils.getByTestId('backup-size').props.children).toBe('5 MB');
    expect(utils.getByTestId('backup-recovery-code').props.children).toContain('aaaaaaaa');
  });

  it('confirms the estimate before backing up, then runs', async () => {
    mockOrch.estimateBackupSize.mockResolvedValue(3 * 1024 * 1024);
    mockOrch.backUpNow.mockResolvedValue({ skipped: false, recoveryCode: '', recoveryCodeIsNew: false, dataVersion: 'dv', totalBytes: 3 * 1024 * 1024, uploadedObjects: 1, dedupedObjects: 0 });
    mockShowAlert.mockImplementation((_t: string, _m: string, buttons: any[]) => {
      const confirm = buttons?.find((b) => b.text === 'backUpNowConfirm');
      confirm?.onPress?.();
    });
    const utils = await renderScreen();
    await act(async () => {
      fireEvent.press(utils.getByTestId('backup-now'));
    });
    expect(mockShowAlert).toHaveBeenCalled();
    expect(mockShowAlert.mock.calls[0][1]).toContain('3 MB');
    expect(mockOrch.backUpNow).toHaveBeenCalled();
  });

  it('persists the automatic-backup toggle', async () => {
    const utils = await renderScreen();
    const sw = utils.getByTestId('toggle-enabledLabel');
    await act(async () => {
      fireEvent(sw, 'valueChange', false);
    });
    expect(mockOrch.updateSettings).toHaveBeenCalledWith(expect.objectContaining({ enabled: false }));
  });

  it('resets the key after confirmation', async () => {
    mockOrch.resetRecoveryCode.mockResolvedValue('c'.repeat(64));
    mockShowAlert.mockImplementation((_t: string, _m: string, buttons: any[]) => {
      const confirm = buttons?.find((b) => b.text === 'regenerateConfirm');
      confirm?.onPress?.();
    });
    const utils = await renderScreen();
    await act(async () => {
      fireEvent.press(utils.getByTestId('backup-regenerate'));
    });
    expect(mockOrch.resetRecoveryCode).toHaveBeenCalled();
  });

  it('shows the hosted-cloud quota when the hosted target is selected', async () => {
    const utils = await renderScreen(settings({ targetType: 'soulbits-cloud' }));
    const quota = utils.getByTestId('backup-cloud-quota');
    expect(String(quota.props.children)).toContain('2 MB');
    expect(String(quota.props.children)).toContain('10240 MB');
  });

  it('surfaces the conflict modal from pendingConflict settings', async () => {
    const utils = await renderScreen(
      settings({
        pendingConflict: {
          remoteGeneration: 7,
          remoteDataVersion: 'rdv',
          remoteDeviceLabel: 'Other Phone',
          detectedAt: 'now',
        },
      }),
    );
    await waitFor(() => expect(utils.getByTestId('backup-conflict-body')).toBeTruthy());
    expect(String(utils.getByTestId('backup-conflict-body').props.children)).toContain('Other Phone');
  });

  it('pushes mine with the overwrite policy from the conflict modal', async () => {
    mockOrch.backUpNow.mockResolvedValue({
      skipped: false,
      recoveryCode: '',
      recoveryCodeIsNew: false,
      dataVersion: 'dv',
      totalBytes: 100,
      uploadedObjects: 1,
      dedupedObjects: 0,
    });
    const utils = await renderScreen(
      settings({ pendingConflict: { remoteGeneration: 7, remoteDataVersion: 'rdv', detectedAt: 'now' } }),
    );
    await waitFor(() => expect(utils.getByTestId('backup-conflict-push')).toBeTruthy());
    await act(async () => {
      fireEvent.press(utils.getByTestId('backup-conflict-push'));
    });
    expect(mockOrch.backUpNow).toHaveBeenCalledWith({ onConflict: 'overwrite' });
  });

  it('runs the restore flow from the pull-theirs action', async () => {
    mockOrch.restore.mockResolvedValue({
      unwrapKind: 'w1',
      dataVersion: 'dv',
      schemaVersion: 1,
      sideObjects: 0,
      dbRows: 0,
      dataDir: '/restored',
    });
    mockOrch.clearPendingConflict.mockResolvedValue(undefined);
    mockShowAlert.mockImplementation((_t: string, _m: string, buttons: any[]) => {
      const confirm = buttons?.find((b) => b.text === 'conflictPullConfirm');
      confirm?.onPress?.();
    });
    const utils = await renderScreen(
      settings({ pendingConflict: { remoteGeneration: 7, remoteDataVersion: 'rdv', detectedAt: 'now' } }),
    );
    await waitFor(() => expect(utils.getByTestId('backup-conflict-pull')).toBeTruthy());
    await act(async () => {
      fireEvent.press(utils.getByTestId('backup-conflict-pull'));
    });
    expect(mockShowAlert).toHaveBeenCalled();
    await waitFor(() => expect(mockOrch.restore).toHaveBeenCalled());
    expect(mockOrch.clearPendingConflict).toHaveBeenCalled();
  });
});

describe('backup helpers', () => {
  it('formats bytes', () => {
    expect(formatBytes(0)).toBe('0 MB');
    expect(formatBytes(2048)).toBe('2 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5 MB');
    expect(formatBytes(15 * 1024 * 1024)).toBe('15 MB');
  });
  it('groups the recovery code', () => {
    expect(groupRecoveryCode('a'.repeat(64))).toBe('aaaaaaaa '.repeat(8).trim());
  });
});
