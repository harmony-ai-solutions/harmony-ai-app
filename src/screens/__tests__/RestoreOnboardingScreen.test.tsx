/**
 * RestoreOnboardingScreen — 2-6 tests (+ post-restore engine restart, owner
 * ruling 2026-10-18).
 *
 * The screen stages the restore via the mocked `backupOrchestrator` singleton,
 * then cycles the engine (`restartEngine`) so the staged backup activates
 * immediately. Covers the happy path (applied) and the honest restart-failure
 * path (staged, still shown as success — never undone).
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

jest.mock('../../components/config/SelectPicker', () => {
  const React = require('react');
  const { View } = require('react-native');
  return { __esModule: true, SelectPicker: ({ testID }: any) => React.createElement(View, { testID: testID ?? 'select-picker' }) };
});

jest.mock('../../services/backup/backupNative', () => ({
  pickBackupFolder: jest.fn(async () => ({ uri: 'content://tree/x', label: 'My folder' })),
}));

jest.mock('../../services/backup/BackupOrchestrator', () => ({
  backupOrchestrator: {
    getSettings: jest.fn(async () => ({ targetType: 'local-folder', localFolderUri: '' })),
    restore: jest.fn(async () => ({
      unwrapKind: 'w1',
      dataVersion: 'dv',
      schemaVersion: 1,
      sideObjects: 0,
      dbRows: 0,
      dataDir: '/restored',
    })),
  },
  BACKUP_TARGET_OPTIONS: [
    { id: 'local-folder', labelKey: 'targetLocal', v1: true },
    { id: 'webdav', labelKey: 'targetWebDAV', v1: true },
  ],
}));

jest.mock('../../services/engine/EngineService', () => ({
  restartEngine: jest.fn(async () => ({})),
}));

import { RestoreOnboardingScreen } from '../setup/RestoreOnboardingScreen';
import { backupOrchestrator } from '../../services/backup/BackupOrchestrator';
import { pickBackupFolder } from '../../services/backup/backupNative';
import { restartEngine } from '../../services/engine/EngineService';

const mockOrch = backupOrchestrator as unknown as { getSettings: jest.Mock; restore: jest.Mock };
const mockRestart = restartEngine as jest.Mock;
const mockPickFolder = pickBackupFolder as jest.Mock;

/** Render + make the form restorable (pick a folder, enter a recovery code). */
async function readyToRestore() {
  // `jest.resetAllMocks()` (beforeEach) wipes the module-factory impls — restore
  // the ones this flow depends on.
  mockPickFolder.mockResolvedValue({ uri: 'content://tree/x', label: 'My folder' });
  mockOrch.getSettings.mockResolvedValue({ targetType: 'local-folder', localFolderUri: '' });
  mockOrch.restore.mockResolvedValue({
    unwrapKind: 'w1',
    dataVersion: 'dv',
    schemaVersion: 1,
    sideObjects: 0,
    dbRows: 0,
    dataDir: '/restored',
  });
  mockRestart.mockResolvedValue({});

  const utils = await render(<RestoreOnboardingScreen />);
  await act(async () => {
    fireEvent.press(utils.getByTestId('restore-pick-folder'));
  });
  await act(async () => {
    fireEvent.changeText(utils.getByPlaceholderText('recoveryPlaceholder'), 'CODE');
  });
  return utils;
}

describe('RestoreOnboardingScreen — post-restore engine restart', () => {
  it('restarts the engine after staging and shows the applied state', async () => {
    const utils = await readyToRestore();
    await act(async () => {
      fireEvent.press(utils.getByTestId('restore-run'));
    });

    await waitFor(() => expect(mockRestart).toHaveBeenCalledTimes(1));
    expect(mockOrch.restore).toHaveBeenCalled();
    expect(utils.getByTestId('restore-success')).toBeTruthy();
    expect(utils.getByText('restoreDoneHelp')).toBeTruthy();
    expect(mockShowToast).toHaveBeenCalledWith('restoreApplied');
  });

  it('on restart failure: keeps the staged success state and reports honestly', async () => {
    const utils = await readyToRestore();
    mockRestart.mockRejectedValueOnce(new Error('boot failed'));
    await act(async () => {
      fireEvent.press(utils.getByTestId('restore-run'));
    });

    await waitFor(() => expect(mockRestart).toHaveBeenCalledTimes(1));
    // The staged restore is NOT undone — the success card still renders, but
    // with the honest "staged" help text.
    expect(utils.getByTestId('restore-success')).toBeTruthy();
    expect(utils.getByText('restoreDoneHelpStaged')).toBeTruthy();
    expect(mockShowToast).toHaveBeenCalledWith('restoreRestartFailed:{"message":"boot failed"}');
  });
});
