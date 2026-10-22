/**
 * AccountSettingsScreen — state-aware rendering + actions.
 *
 * The screen now branches on `useAuth().status` / `pendingSignIn`:
 *   - signed out → value prop + "Sign in with Soulbits" CTA, cloud rows hidden
 *   - signed in  → identity block (name/email/initial), device row, logout, cloud rows
 *   - pending    → inline spinner (no second entry point)
 *   - loading    → skeleton (no flash of the wrong state)
 * plus the device-authorization warning (driven by the mocked
 * DeviceAuthService.getStatus) with its re-authorize action.
 *
 * useAuth + DeviceAuthService are mocked; the device-name helper is exercised
 * for real against the global react-native-device-info mock ("Test Model").
 */

import React from 'react';
import { Alert } from 'react-native';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react-native';

afterEach(cleanup);

beforeEach(() => {
  cleanup();
  jest.clearAllMocks();
});

jest.mock('react-i18next', () => ({
  // Minimal interpolation so the "This device · <name>" row can be asserted.
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts && typeof opts.name === 'string' ? `${key}·${opts.name}` : key,
  }),
}));

jest.mock('../../utils/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

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

jest.mock('../../contexts/AuthContext', () => ({ useAuth: jest.fn() }));

// Mutable navigation spies the mocked useNavigation returns.
const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
const mockReplace = jest.fn();
jest.mock('@react-navigation/native', () => {
  const React = require('react');
  return {
    useNavigation: () => ({ navigate: mockNavigate, goBack: mockGoBack, replace: mockReplace }),
    // Run the focus effect like a plain effect (status-keyed, so it re-runs on
    // auth changes exactly as useFocusEffect would on refocus).
    useFocusEffect: (cb: () => void | (() => void)) => React.useEffect(cb, [cb]),
  };
});

jest.mock('../../services/cloud/DeviceAuthService', () => ({
  __esModule: true,
  default: { getStatus: jest.fn() },
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
jest.mock('../../components/themed/ThemedText', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return { __esModule: true, ThemedText: ({ children, ...p }: any) => React.createElement(Text, p, children) };
});
jest.mock('../../components/themed/ThemedButton', () => {
  const React = require('react');
  const { TouchableOpacity, Text } = require('react-native');
  return {
    __esModule: true,
    ThemedButton: ({ label, onPress, disabled, testID }: any) =>
      React.createElement(
        TouchableOpacity,
        { onPress, disabled, testID, accessibilityRole: 'button' },
        React.createElement(Text, null, label),
      ),
  };
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

// Render the link-row label as text so rows can be queried (and pressed).
jest.mock('../../components/settings/SettingsRows', () => {
  const React = require('react');
  const { TouchableOpacity, Text } = require('react-native');
  return {
    __esModule: true,
    SettingsLinkRow: ({ label, onPress, testID }: any) =>
      React.createElement(
        TouchableOpacity,
        { onPress, testID, accessibilityRole: 'button' },
        React.createElement(Text, null, label),
      ),
  };
});

import { AccountSettingsScreen } from '../settings/AccountSettingsScreen';
import { useAuth } from '../../contexts/AuthContext';
import DeviceAuthService from '../../services/cloud/DeviceAuthService';

const mockUseAuth = useAuth as jest.Mock;
const mockGetStatus = DeviceAuthService.getStatus as jest.Mock;
const mockSignInViaPortal = jest.fn(async () => {});
const mockLogout = jest.fn(async () => {});

const USER = {
  id: 'u1',
  email: 'ada@example.com',
  display_name: 'Ada Lovelace',
  email_verified: true,
  created_at: '2026-01-01T00:00:00Z',
};

function setAuth(overrides: Record<string, unknown> = {}) {
  mockUseAuth.mockReturnValue({
    user: null,
    status: 'unauthenticated',
    signInVersion: 0,
    signInViaPortal: mockSignInViaPortal,
    cancelSignIn: jest.fn(),
    logout: mockLogout,
    refreshUser: jest.fn(),
    pendingSignIn: null,
    ...overrides,
  });
}

beforeEach(() => {
  // Default: device is authorized (no warning). Tests override per case.
  mockGetStatus.mockResolvedValue({ authorized: true, authorizationPending: false });
  setAuth();
});

describe('AccountSettingsScreen — signed out', () => {
  it('shows the value prop + sign-in CTA, hides cloud rows, keeps local rows', async () => {
    const { getByTestId, getByText, queryByText, queryByTestId } = await render(
      <AccountSettingsScreen />,
    );

    expect(getByTestId('account-sign-in')).toBeTruthy();
    expect(getByText('identitySignInCta')).toBeTruthy();
    expect(getByText('identitySignedOutValueProp')).toBeTruthy();

    // Cloud-only rows hidden (not greyed out).
    expect(queryByText('resetPassword')).toBeNull();
    expect(queryByText('activeSessions')).toBeNull();
    expect(queryByText('deleteAccount')).toBeNull();
    expect(queryByText('manageSubscription')).toBeNull();

    // Local rows always visible.
    expect(getByText('biometricLock')).toBeTruthy();
    expect(getByText('disabledAIsTitle')).toBeTruthy();
    expect(getByText('blockedUsersTitle')).toBeTruthy();
    expect(getByText('marketLibraryTitle')).toBeTruthy();

    // No identity block / no logout when signed out.
    expect(queryByTestId('account-identity')).toBeNull();
    expect(queryByText('logout')).toBeNull();
  });

  it('starts the portal flow and replaces with PendingApproval when the CTA is pressed', async () => {
    const { getByTestId } = await render(<AccountSettingsScreen />);

    await fireEvent.press(getByTestId('account-sign-in'));

    expect(mockSignInViaPortal).toHaveBeenCalledTimes(1);
    expect(mockReplace).toHaveBeenCalledWith('PendingApproval');
  });
});

describe('AccountSettingsScreen — signed in', () => {
  it('renders the identity block, device row, logout and the cloud rows', async () => {
    setAuth({ status: 'authenticated', user: USER });
    const { getByTestId, getByText, queryByTestId } = await render(<AccountSettingsScreen />);

    expect(getByTestId('account-identity')).toBeTruthy();
    expect(getByText('Ada Lovelace')).toBeTruthy();
    expect(getByText('ada@example.com')).toBeTruthy();
    expect(getByText('identitySignedIn')).toBeTruthy();
    expect(getByText('A')).toBeTruthy(); // avatar initial

    // Device row uses the shared derivation (react-native-device-info mock).
    await waitFor(() => expect(getByText('identityDeviceRow·Test Model')).toBeTruthy());

    expect(getByText('logout')).toBeTruthy();
    expect(getByText('resetPassword')).toBeTruthy();
    expect(getByText('activeSessions')).toBeTruthy();
    expect(getByText('deleteAccount')).toBeTruthy();
    expect(getByText('manageSubscription')).toBeTruthy();

    // Authorized device → no warning.
    await waitFor(() => expect(mockGetStatus).toHaveBeenCalled());
    expect(queryByTestId('account-device-auth-warning')).toBeNull();
  });

  it('falls back to the email for the display name and initial', async () => {
    setAuth({ status: 'authenticated', user: { ...USER, display_name: '' } });
    const { getAllByText, getByText } = await render(<AccountSettingsScreen />);

    expect(getAllByText('ada@example.com').length).toBeGreaterThan(0);
    expect(getByText('A')).toBeTruthy();
  });

  it('confirms logout through the existing alert', async () => {
    setAuth({ status: 'authenticated', user: USER });
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const { getByText } = await render(<AccountSettingsScreen />);

    await fireEvent.press(getByText('logout'));

    expect(alertSpy).toHaveBeenCalledTimes(1);
    alertSpy.mockRestore();
  });
});

describe('AccountSettingsScreen — device authorization indicator', () => {
  it('shows the warning and re-runs the portal flow on re-authorize', async () => {
    setAuth({ status: 'authenticated', user: USER });
    mockGetStatus.mockResolvedValue({ authorized: false, authorizationPending: true });
    const { getByTestId, getByText } = await render(<AccountSettingsScreen />);

    await waitFor(() => expect(getByTestId('account-device-auth-warning')).toBeTruthy());
    expect(getByText('deviceAuthWarning')).toBeTruthy();

    await fireEvent.press(getByTestId('account-reauthorize'));

    expect(mockSignInViaPortal).toHaveBeenCalledTimes(1);
    expect(mockReplace).toHaveBeenCalledWith('PendingApproval');
  });

  it('silently hides the indicator when the status fetch fails', async () => {
    setAuth({ status: 'authenticated', user: USER });
    mockGetStatus.mockRejectedValue(new Error('boom'));
    const { queryByTestId } = await render(<AccountSettingsScreen />);

    await waitFor(() => expect(mockGetStatus).toHaveBeenCalled());
    expect(queryByTestId('account-device-auth-warning')).toBeNull();
  });
});

describe('AccountSettingsScreen — pending sign-in', () => {
  it('shows the inline spinner instead of a second entry point', async () => {
    setAuth({
      status: 'unauthenticated',
      pendingSignIn: {
        connectUrl: 'https://cloud.soulbits.app/connect?request=conn-1',
        status: 'pending',
        remainingSeconds: 300,
        message: null,
      },
    });
    const { getByTestId, getByText, queryByTestId } = await render(<AccountSettingsScreen />);

    expect(getByTestId('account-pending')).toBeTruthy();
    expect(getByText('identityPending')).toBeTruthy();
    expect(queryByTestId('account-sign-in')).toBeNull();
  });
});

describe('AccountSettingsScreen — auth bootstrap', () => {
  it('renders a skeleton placeholder and no wrong-state identity', async () => {
    setAuth({ status: 'loading' });
    const { getByTestId, getByText, queryByTestId } = await render(<AccountSettingsScreen />);

    expect(getByTestId('account-identity-skeleton')).toBeTruthy();
    expect(queryByTestId('account-identity')).toBeNull();
    expect(queryByTestId('account-sign-in')).toBeNull();
    expect(queryByTestId('account-signed-out')).toBeNull();

    // Local rows still render sanely during bootstrap.
    expect(getByText('biometricLock')).toBeTruthy();
  });
});
