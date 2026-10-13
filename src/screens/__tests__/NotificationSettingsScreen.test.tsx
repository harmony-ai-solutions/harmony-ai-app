/**
 * NotificationSettingsScreen — transport picker wiring (plan 7-12 §4d).
 *
 * The screen reads the transport through the NotificationSettings service and
 * persists a choice through the same seam. The service is mocked; this test
 * asserts the screen-level wiring only.
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

const mockGetTransport = jest.fn(() => Promise.resolve('auto'));
const mockSetTransport = jest.fn((_value: string) => Promise.resolve());
jest.mock('../../services/notifications/NotificationSettings', () => ({
  getNotificationTransport: () => mockGetTransport(),
  setNotificationTransport: (value: string) => mockSetTransport(value),
}));

import { NotificationSettingsScreen } from '../settings/NotificationSettingsScreen';

const navigation = { goBack: jest.fn() } as any;

async function renderScreen() {
  const utils = await render(<NotificationSettingsScreen navigation={navigation} route={{} as any} />);
  await waitFor(() => expect(utils.getByTestId('transport-auto')).toBeTruthy());
  return utils;
}

describe('NotificationSettingsScreen', () => {
  it('renders all four transport options', async () => {
    const utils = await renderScreen();
    for (const value of ['auto', 'direct', 'cloud', 'off']) {
      expect(utils.getByTestId(`transport-${value}`)).toBeTruthy();
    }
  });

  it('reads the current transport on mount', async () => {
    await renderScreen();
    expect(mockGetTransport).toHaveBeenCalledTimes(1);
  });

  it('persists the selected transport', async () => {
    const utils = await renderScreen();
    await act(async () => {
      fireEvent.press(utils.getByTestId('transport-cloud'));
    });
    expect(mockSetTransport).toHaveBeenCalledWith('cloud');
  });
});
