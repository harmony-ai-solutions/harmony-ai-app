/**
 * RestoreOfferScreen — 5-3 tests.
 *
 * The skippable fresh-install restore offer. Covers the details render
 * (target/date/size) and both exits: Restore (→ RestoreOnboarding) and
 * Start fresh (→ MainTabs/MyProfile), each recording the offer as resolved.
 */

import React from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react-native';

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

const mockNavigate = jest.fn();
const mockReplace = jest.fn();
const mockGoBack = jest.fn();
let mockParams: any = {};
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate, replace: mockReplace, goBack: mockGoBack }),
  useRoute: () => ({ params: mockParams }),
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

// The screen reuses the pure byte formatter from the backup settings screen.
jest.mock('../settings/BackupSettingsScreen', () => ({
  __esModule: true,
  formatBytes: (b: number) => (b ? `${Math.round(b / (1024 * 1024))} MB` : '0 MB'),
}));

const mockMarkSeen = jest.fn((..._args: any[]) => Promise.resolve());
jest.mock('../../services/backup/restoreOnboarding', () => ({
  markRestoreOfferSeen: (...args: any[]) => mockMarkSeen(...args),
}));

import { RestoreOfferScreen } from '../setup/RestoreOfferScreen';

async function renderScreen(offer: any = { source: 'webdav', labelKey: 'targetWebDAV', createdAt: '2026-10-05T00:00:00Z', totalBytes: 5 * 1024 * 1024 }) {
  mockParams = { offer };
  return render(<RestoreOfferScreen />);
}

describe('RestoreOfferScreen', () => {
  it('renders the discovered backup details', async () => {
    const utils = await renderScreen();
    expect(utils.getByTestId('restore-offer-target').props.children).toBe('targetWebDAV');
    expect(utils.getByTestId('restore-offer-size').props.children).toBe('5 MB');
    expect(utils.getByTestId('restore-offer-date')).toBeTruthy();
    expect(utils.getByTestId('restore-offer-details')).toBeTruthy();
  });

  it('restores: records the offer and opens the restore flow', async () => {
    const utils = await renderScreen();
    await act(async () => {
      fireEvent.press(utils.getByTestId('restore-offer-restore'));
    });
    expect(mockMarkSeen).toHaveBeenCalled();
    expect(mockReplace).toHaveBeenCalledWith('RestoreOnboarding');
  });

  it('starts fresh: records the offer and returns to the profile', async () => {
    const utils = await renderScreen();
    await act(async () => {
      fireEvent.press(utils.getByTestId('restore-offer-start-fresh'));
    });
    expect(mockMarkSeen).toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith('MainTabs', { screen: 'MyProfile' });
  });
});
