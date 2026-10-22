/**
 * LoginScreen — the single portal sign-in screen (Option B).
 *
 * Both CTAs start the portal connect-session flow and replace this screen with
 * the PendingApproval waiting screen.
 */

import React from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react-native';

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));

jest.mock('../../../utils/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

jest.mock('../../../contexts/ThemeContext', () => ({
  useAppTheme: () => ({ theme: { colors: {} } }),
}));

jest.mock('../../../contexts/AuthContext', () => ({ useAuth: jest.fn() }));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

const mockReplace = jest.fn();
const mockGoBack = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ replace: mockReplace, goBack: mockGoBack }),
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
  const { View } = require('react-native');
  return { ScreenHeader: () => React.createElement(View, { testID: 'screen-header' }, null) };
});

import { LoginScreen } from '../LoginScreen';
import { useAuth } from '../../../contexts/AuthContext';

const mockUseAuth = useAuth as jest.Mock;
const mockSignInViaPortal = jest.fn(async () => {});

beforeEach(() => {
  cleanup();
  jest.clearAllMocks();
  mockUseAuth.mockReturnValue({
    status: 'unauthenticated',
    user: null,
    signInViaPortal: mockSignInViaPortal,
    pendingSignIn: null,
  });
});

describe('LoginScreen — portal sign-in CTAs', () => {
  it('renders the primary + create-account CTAs', async () => {
    const { getByTestId, getByText } = await render(<LoginScreen />);
    expect(getByTestId('login-sign-in-soulbits')).toBeTruthy();
    expect(getByTestId('login-create-account')).toBeTruthy();
    expect(getByText('signIn_withSoulbits')).toBeTruthy();
    expect(getByText('signIn_createAccount')).toBeTruthy();
  });

  it('starts the portal flow and replaces with PendingApproval (primary)', async () => {
    const { getByTestId } = await render(<LoginScreen />);
    await fireEvent.press(getByTestId('login-sign-in-soulbits'));

    expect(mockSignInViaPortal).toHaveBeenCalledTimes(1);
    expect(mockReplace).toHaveBeenCalledWith('PendingApproval');
  });

  it('the create-account CTA also starts the portal flow', async () => {
    const { getByTestId } = await render(<LoginScreen />);
    await fireEvent.press(getByTestId('login-create-account'));

    expect(mockSignInViaPortal).toHaveBeenCalledTimes(1);
    expect(mockReplace).toHaveBeenCalledWith('PendingApproval');
  });

  it('pops back when already authenticated', async () => {
    mockUseAuth.mockReturnValue({
      status: 'authenticated',
      user: null,
      signInViaPortal: mockSignInViaPortal,
      pendingSignIn: null,
    });
    await render(<LoginScreen />);
    expect(mockGoBack).toHaveBeenCalled();
  });
});
