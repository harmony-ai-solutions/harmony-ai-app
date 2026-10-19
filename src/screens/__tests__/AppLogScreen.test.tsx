/**
 * AppLogScreen — viewer tests.
 *
 * Covers rendering entries from the ring buffer, the level filter + text
 * search, the clear confirmation flow, and the share/copy invocations.
 */

import React from 'react';
import { Share } from 'react-native';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react-native';

afterEach(cleanup);
beforeEach(() => {
  cleanup();
  jest.clearAllMocks();
});

const mockShowAlert = jest.fn();
const mockShowToast = jest.fn();

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

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn() }),
}));

jest.mock('../../contexts/AppAlertContext', () => ({
  useAppAlert: () => ({ showAlert: mockShowAlert }),
}));

jest.mock('../../contexts/AppToastContext', () => ({
  useToast: () => ({ showToast: mockShowToast }),
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
jest.mock('../../components/themed/ScreenHeader', () => {
  const React = require('react');
  const { View } = require('react-native');
  return { __esModule: true, ScreenHeader: ({ right, children, ...props }: any) => React.createElement(View, props, right, children) };
});

const mockBuildReport = jest.fn(() => 'APP-REPORT');
const mockCopyEntries = jest.fn(() => Promise.resolve(true));
jest.mock('../../services/diagnostics/appDiagnostics', () => ({
  buildAppDiagnosticsReport: (...args: unknown[]) => (mockBuildReport as jest.Mock)(...args),
  copyAppLogEntries: (...args: unknown[]) => (mockCopyEntries as jest.Mock)(...args),
}));

import { AppLogScreen } from '../settings/AppLogScreen';
import { appLogBuffer } from '../../utils/appLogs';

function seed() {
  appLogBuffer.clear();
  appLogBuffer.push({
    timestamp: '2026-10-19T10:00:00.000Z',
    level: 'info',
    namespace: '[Svc]',
    message: 'hello world',
  });
  appLogBuffer.push({
    timestamp: '2026-10-19T10:00:01.000Z',
    level: 'error',
    namespace: null,
    message: 'boom failure',
  });
}

describe('AppLogScreen render', () => {
  it('renders the buffer entries chronologically', async () => {
    seed();
    const { getByText, getByTestId } = await render(<AppLogScreen />);
    expect(getByText('hello world')).toBeTruthy();
    expect(getByText('boom failure')).toBeTruthy();
    expect(getByTestId('app-log-count')).toBeTruthy();
  });

  it('shows the empty state when the buffer is empty', async () => {
    appLogBuffer.clear();
    const { getByTestId } = await render(<AppLogScreen />);
    expect(getByTestId('app-log-empty')).toBeTruthy();
  });
});

describe('AppLogScreen filter + search', () => {
  it('filters to the error level and above', async () => {
    seed();
    const { getByTestId, queryByText, getByText } = await render(<AppLogScreen />);
    await fireEvent.press(getByTestId('app-log-level-error'));
    expect(queryByText('hello world')).toBeNull();
    expect(getByText('boom failure')).toBeTruthy();
  });

  it('searches messages case-insensitively', async () => {
    seed();
    const { getByTestId, queryByText, getByText } = await render(<AppLogScreen />);
    await fireEvent.changeText(getByTestId('app-log-search'), 'BOOM');
    expect(getByText('boom failure')).toBeTruthy();
    expect(queryByText('hello world')).toBeNull();
  });
});

describe('AppLogScreen actions', () => {
  it('confirms before clearing the buffer', async () => {
    seed();
    const { getByTestId } = await render(<AppLogScreen />);
    fireEvent.press(getByTestId('app-log-clear'));

    expect(mockShowAlert).toHaveBeenCalledTimes(1);
    const buttons = mockShowAlert.mock.calls[0][2];
    const destructive = buttons.find((b: any) => b.style === 'destructive');
    expect(destructive).toBeTruthy();

    destructive.onPress();
    await waitFor(() => expect(appLogBuffer.size()).toBe(0));
    expect(mockShowToast).toHaveBeenCalledWith('clearedToast');
  });

  it('shares the filtered buffer through the OS share sheet', async () => {
    const shareSpy = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' } as any);
    seed();
    const { getByTestId } = await render(<AppLogScreen />);
    fireEvent.press(getByTestId('app-log-share'));
    await waitFor(() => expect(mockBuildReport).toHaveBeenCalled());
    await waitFor(() => expect(shareSpy).toHaveBeenCalledWith(expect.objectContaining({ message: 'APP-REPORT' })));
    shareSpy.mockRestore();
  });

  it('copies the filtered buffer and confirms with a toast', async () => {
    seed();
    const { getByTestId } = await render(<AppLogScreen />);
    fireEvent.press(getByTestId('app-log-copy'));
    await waitFor(() => expect(mockCopyEntries).toHaveBeenCalled());
    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith('copiedToast'));
  });
});
