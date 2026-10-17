/**
 * PendingApprovalScreen — Option B portal sign-in waiting screen.
 *
 * Covers the pending / terminal / success states, the cancel + re-open-browser
 * actions, and the brief-success → pop behaviour on redeem.
 */

import React from 'react';
import { Linking } from 'react-native';
import { act, cleanup, fireEvent, render } from '@testing-library/react-native';

// ── Hoisted mocks ───────────────────────────────────────────────────────────

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { seconds?: number }) =>
      opts && opts.seconds != null ? `${key}:${opts.seconds}` : key,
  }),
}));

jest.mock('../../../contexts/ThemeContext', () => ({
  useAppTheme: () => ({
    theme: {
      colors: {
        accent: { primary: '#7c3aed' },
        background: { base: '#0f0f1a' },
        border: { default: '#333333' },
        text: { primary: '#fff', secondary: '#ccc', muted: '#aaa' },
      },
    },
  }),
}));

jest.mock('../../../contexts/AuthContext', () => ({ useAuth: jest.fn() }));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

const mockGoBack = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ goBack: mockGoBack, replace: jest.fn() }),
}));

jest.mock('../../../components/themed/ThemedView', () => {
  const React = require('react');
  const { View } = require('react-native');
  return { ThemedView: ({ children, ...p }: any) => React.createElement(View, p, children) };
});
jest.mock('../../../components/themed/ThemedText', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return { ThemedText: ({ children, ...p }: any) => React.createElement(Text, p, children) };
});
jest.mock('../../../components/themed/ThemedButton', () => {
  const React = require('react');
  const { TouchableOpacity, Text } = require('react-native');
  return {
    ThemedButton: ({ label, onPress, disabled, testID }: any) =>
      React.createElement(
        TouchableOpacity,
        { onPress, disabled, testID, accessibilityRole: 'button' },
        React.createElement(Text, null, label),
      ),
  };
});
jest.mock('../../../components/themed/ScreenHeader', () => {
  const React = require('react');
  const { View, Text } = require('react-native');
  return {
    ScreenHeader: ({ title }: any) =>
      React.createElement(View, { testID: 'screen-header' }, React.createElement(Text, null, title)),
  };
});

// ── Imports (after mocks) ───────────────────────────────────────────────────

import { PendingApprovalScreen } from '../PendingApprovalScreen';
import { useAuth } from '../../../contexts/AuthContext';

const mockUseAuth = useAuth as jest.Mock;

beforeEach(() => {
  cleanup();
  jest.clearAllMocks();
  jest.spyOn(Linking, 'openURL').mockResolvedValue(true as never);
});
afterEach(() => {
  jest.restoreAllMocks();
});

describe('PendingApprovalScreen', () => {
  it('renders the waiting state with a countdown and actions', async () => {
    mockUseAuth.mockReturnValue({
      status: 'unauthenticated',
      pendingSignIn: {
        connectUrl: 'https://portal/connect?request=1',
        status: 'pending',
        remainingSeconds: 42,
        message: null,
      },
      signInViaPortal: jest.fn(),
      cancelSignIn: jest.fn(),
    });

    const { getByTestId, getByText } = await render(<PendingApprovalScreen />);

    expect(getByTestId('pending-approval-pending')).toBeTruthy();
    expect(getByTestId('pending-approval-spinner')).toBeTruthy();
    expect(getByText('pending_title')).toBeTruthy();
    expect(getByText('pending_subtitle')).toBeTruthy();
    expect(getByText('pending_timeLeft:42')).toBeTruthy();
    expect(getByTestId('pending-approval-open-browser')).toBeTruthy();
  });

  it('re-opens the connect URL in the browser', async () => {
    mockUseAuth.mockReturnValue({
      status: 'unauthenticated',
      pendingSignIn: {
        connectUrl: 'https://portal/connect?request=1',
        status: 'pending',
        remainingSeconds: 10,
        message: null,
      },
      signInViaPortal: jest.fn(),
      cancelSignIn: jest.fn(),
    });

    const { getByTestId } = await render(<PendingApprovalScreen />);
    await fireEvent.press(getByTestId('pending-approval-open-browser'));

    expect(Linking.openURL).toHaveBeenCalledWith('https://portal/connect?request=1');
  });

  it('cancel clears the pending sign-in and pops back', async () => {
    const cancelSignIn = jest.fn();
    mockUseAuth.mockReturnValue({
      status: 'unauthenticated',
      pendingSignIn: {
        connectUrl: 'https://portal/connect?request=1',
        status: 'pending',
        remainingSeconds: 10,
        message: null,
      },
      signInViaPortal: jest.fn(),
      cancelSignIn,
    });

    const { getByTestId } = await render(<PendingApprovalScreen />);
    await fireEvent.press(getByTestId('pending-approval-cancel'));

    expect(cancelSignIn).toHaveBeenCalledTimes(1);
    expect(mockGoBack).toHaveBeenCalledTimes(1);
  });

  it('renders the terminal (expired) state with a retry', async () => {
    const signInViaPortal = jest.fn();
    mockUseAuth.mockReturnValue({
      status: 'unauthenticated',
      pendingSignIn: {
        connectUrl: 'https://portal/connect?request=1',
        status: 'expired',
        remainingSeconds: 0,
        message: null,
      },
      signInViaPortal,
      cancelSignIn: jest.fn(),
    });

    const { getByTestId, getByText } = await render(<PendingApprovalScreen />);
    expect(getByTestId('pending-approval-terminal')).toBeTruthy();
    expect(getByText('pending_expired')).toBeTruthy();

    await fireEvent.press(getByTestId('pending-approval-retry'));
    expect(signInViaPortal).toHaveBeenCalledTimes(1);
  });

  it('shows a brief success then pops back once authenticated', async () => {
    jest.useFakeTimers();
    try {
      mockUseAuth.mockReturnValue({
        status: 'authenticated',
        pendingSignIn: null,
        signInViaPortal: jest.fn(),
        cancelSignIn: jest.fn(),
      });

      const { getByTestId } = await render(<PendingApprovalScreen />);
      expect(getByTestId('pending-approval-success')).toBeTruthy();

      act(() => {
        jest.advanceTimersByTime(900);
      });
      expect(mockGoBack).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });
});

