/**
 * SettingsScreen — push-notification authorization wiring (task 5-1 add-on).
 *
 * Enabling the push toggle must request iOS notification authorization at that
 * natural point; when the user denies it, the screen surfaces an i18n hint and
 * still persists the preference. The service is mocked; this test asserts the
 * screen-level wiring only.
 */

import React from 'react';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react-native';

afterEach(cleanup);
beforeEach(() => {
  cleanup();
  jest.clearAllMocks();
});

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('../../utils/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

jest.mock('react-native-vector-icons/MaterialCommunityIcons', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return ({ name, ...props }: any) => React.createElement(Text, { ...props }, name);
});

jest.mock('../../utils/haptics', () => ({ setHapticFeedbackEnabled: jest.fn() }));

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

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('../../components/navigation/GlassTabBar', () => ({ TAB_BAR_CONTENT_PAD: 0 }));

jest.mock('../../components/themed/ThemedView', () => {
  const React = require('react');
  const { View } = require('react-native');
  return { __esModule: true, ThemedView: ({ children, style, ...p }: any) => React.createElement(View, { style, ...p }, children) };
});
jest.mock('../../components/themed/ThemedCard', () => {
  const React = require('react');
  const { View } = require('react-native');
  return { __esModule: true, ThemedCard: ({ children, style, ...p }: any) => React.createElement(View, { style, ...p }, children) };
});
jest.mock('../../components/themed/SectionHeader', () => {
  const React = require('react');
  const { View } = require('react-native');
  return { __esModule: true, SectionHeader: (props: any) => React.createElement(View, props) };
});
jest.mock('../../components/themed/ScreenHeader', () => {
  const React = require('react');
  const { View } = require('react-native');
  return { __esModule: true, ScreenHeader: (props: any) => React.createElement(View, props) };
});

jest.mock('../../components/settings/SettingsRows', () => {
  const React = require('react');
  const { Switch, View } = require('react-native');
  return {
    __esModule: true,
    SettingsLinkRow: (props: any) => React.createElement(View, props),
    SettingsToggleRow: ({ label, value, onValueChange }: any) =>
      React.createElement(Switch, { testID: `toggle-${label}`, value, onValueChange }),
  };
});

const mockRequest = jest.fn();
jest.mock('../../services/notifications/NotificationPermission', () => ({
  requestNotificationPermission: (...args: unknown[]) => mockRequest(...args),
  isNotificationAuthorized: (status: string) =>
    status === 'authorized' || status === 'provisional' || status === 'ephemeral',
}));

import AsyncStorage from '@react-native-async-storage/async-storage';
import { SettingsScreen } from '../SettingsScreen';

const mockSetItem = AsyncStorage.setItem as jest.Mock;

async function renderScreen() {
  const utils = await render(<SettingsScreen />);
  await waitFor(() => expect(utils.getByTestId('toggle-pushNotifications')).toBeTruthy());
  return utils;
}

describe('SettingsScreen — push notification authorization', () => {
  it('requests authorization when the push toggle is enabled', async () => {
    mockRequest.mockResolvedValue('authorized');
    const utils = await renderScreen();

    await act(async () => {
      fireEvent(utils.getByTestId('toggle-pushNotifications'), 'valueChange', true);
    });

    expect(mockRequest).toHaveBeenCalledTimes(1);
    expect(mockShowToast).not.toHaveBeenCalled();
    expect(mockSetItem).toHaveBeenCalledWith('@soulbits_setting_push_notifications', 'true');
  });

  it('surfaces the i18n hint when authorization is denied', async () => {
    mockRequest.mockResolvedValue('denied');
    const utils = await renderScreen();

    await act(async () => {
      fireEvent(utils.getByTestId('toggle-pushNotifications'), 'valueChange', true);
    });

    expect(mockShowToast).toHaveBeenCalledWith('notificationsPermissionDenied');
  });

  it('does not request authorization when the toggle is disabled', async () => {
    const utils = await renderScreen();

    await act(async () => {
      fireEvent(utils.getByTestId('toggle-pushNotifications'), 'valueChange', false);
    });

    expect(mockRequest).not.toHaveBeenCalled();
    expect(mockSetItem).toHaveBeenCalledWith('@soulbits_setting_push_notifications', 'false');
  });
});
