/**
 * AuthGate — store launch-gate tests (plan 7-14 V2, Option B portal sign-in).
 *
 * Covers the gate's rendering logic per variant × auth state and the portal
 * wall: the "Sign in with Soulbits" CTA starts the portal flow, the inline
 * waiting state renders while pending, and a terminal state surfaces a retry.
 * The variant is driven through the V1 test seam (`setAppVariantForTests`).
 */

import React from 'react';
import { Text } from 'react-native';
import { act, cleanup, fireEvent, render } from '@testing-library/react-native';
import { AuthGate } from '../AuthGate';
import { setAppVariantForTests } from '../../../config/appVariant';

// ── Hoisted module mocks ────────────────────────────────────────────────

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { seconds?: number }) =>
      opts && opts.seconds != null ? `${key}:${opts.seconds}` : key,
  }),
}));

jest.mock('../../../contexts/ThemeContext', () => ({
  useAppTheme: () => ({
    theme: { colors: { accent: { primary: '#7c3aed' } } },
  }),
}));

jest.mock('../../../contexts/AuthContext', () => ({ useAuth: jest.fn() }));

jest.mock('../../themed/ThemedView', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    ThemedView: ({ children, style, ...props }: any) =>
      React.createElement(View, { style, ...props }, children),
  };
});
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
    ThemedButton: ({ label, onPress, disabled, testID, ...props }: any) =>
      React.createElement(
        TouchableOpacity,
        { onPress, disabled, testID, accessibilityRole: 'button', ...props },
        React.createElement(Text, null, label),
      ),
  };
});

// ── Imports (after mocks) ───────────────────────────────────────────────

import { useAuth } from '../../../contexts/AuthContext';

const mockUseAuth = useAuth as jest.Mock;
const mockSignInViaPortal = jest.fn(async () => {});
const mockCancelSignIn = jest.fn();

let authStatus: 'loading' | 'authenticated' | 'unauthenticated';
let pending: any;

function setAuth() {
  mockUseAuth.mockImplementation(() => ({
    status: authStatus,
    user: null,
    signInVersion: 0,
    signInViaPortal: mockSignInViaPortal,
    cancelSignIn: mockCancelSignIn,
    pendingSignIn: pending,
  }));
}

const Child = () => <Text testID="child">CHILD</Text>;

async function flush() {
  for (let i = 0; i < 6; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

function renderGate() {
  return render(
    <AuthGate>
      <Child />
    </AuthGate>,
  );
}

beforeEach(() => {
  cleanup();
  jest.clearAllMocks();
  authStatus = 'unauthenticated';
  pending = null;
  setAuth();
});

afterEach(() => {
  cleanup();
  setAppVariantForTests(null);
});

// ── Tests ───────────────────────────────────────────────────────────────

describe('AuthGate — full variant is a no-op', () => {
  it('renders children unchanged when unauthenticated', async () => {
    setAppVariantForTests('full');
    const utils = await renderGate();
    await flush();

    expect(utils.getByTestId('child')).toBeTruthy();
    expect(utils.queryByTestId('auth-gate-wall')).toBeNull();
    expect(utils.queryByTestId('auth-gate-splash')).toBeNull();
  });

  it('renders children when authenticated', async () => {
    setAppVariantForTests('full');
    authStatus = 'authenticated';
    setAuth();
    const utils = await renderGate();
    await flush();

    expect(utils.getByTestId('child')).toBeTruthy();
    expect(utils.queryByTestId('auth-gate-wall')).toBeNull();
  });
});

describe('AuthGate — store variant rendering', () => {
  it('renders children when authenticated', async () => {
    setAppVariantForTests('store');
    authStatus = 'authenticated';
    setAuth();
    const utils = await renderGate();
    await flush();

    expect(utils.getByTestId('child')).toBeTruthy();
    expect(utils.queryByTestId('auth-gate-wall')).toBeNull();
  });

  it('shows the branded splash while auth is loading', async () => {
    setAppVariantForTests('store');
    authStatus = 'loading';
    setAuth();
    const utils = await renderGate();

    expect(utils.getByTestId('auth-gate-splash')).toBeTruthy();
    expect(utils.queryByTestId('auth-gate-wall')).toBeNull();
    expect(utils.queryByTestId('child')).toBeNull();
  });

  it('shows the wall with the portal CTA when unauthenticated', async () => {
    setAppVariantForTests('store');
    const utils = await renderGate();
    await flush();

    expect(utils.getByTestId('auth-gate-wall')).toBeTruthy();
    expect(utils.getByTestId('auth-gate-sign-in')).toBeTruthy();
    expect(utils.queryByTestId('child')).toBeNull();
  });
});

describe('AuthGate — wall action handlers', () => {
  it('starts the portal sign-in from the wall', async () => {
    setAppVariantForTests('store');
    const utils = await renderGate();
    await flush();

    await act(async () => {
      await fireEvent.press(utils.getByTestId('auth-gate-sign-in'));
    });

    expect(mockSignInViaPortal).toHaveBeenCalledTimes(1);
  });

  it('renders the inline waiting state while the portal sign-in is pending', async () => {
    setAppVariantForTests('store');
    pending = {
      connectUrl: 'https://portal/connect?request=1',
      status: 'pending',
      remainingSeconds: 30,
      message: null,
    };
    setAuth();
    const utils = await renderGate();
    await flush();

    expect(utils.getByTestId('auth-gate-waiting-spinner')).toBeTruthy();
    expect(utils.getByTestId('auth-gate-cancel')).toBeTruthy();
    expect(utils.queryByTestId('auth-gate-sign-in')).toBeNull();
    expect(utils.getByText('pending_timeLeft:30')).toBeTruthy();
  });

  it('cancels a pending sign-in from the wall', async () => {
    setAppVariantForTests('store');
    pending = {
      connectUrl: 'https://portal/connect?request=1',
      status: 'pending',
      remainingSeconds: 30,
      message: null,
    };
    setAuth();
    const utils = await renderGate();
    await flush();

    await fireEvent.press(utils.getByTestId('auth-gate-cancel'));
    expect(mockCancelSignIn).toHaveBeenCalledTimes(1);
  });

  it('surfaces a retryable terminal error and keeps the wall', async () => {
    setAppVariantForTests('store');
    pending = { connectUrl: null, status: 'errored', remainingSeconds: 0, message: 'start_failed' };
    setAuth();
    const utils = await renderGate();
    await flush();

    expect(utils.getByTestId('auth-gate-wall')).toBeTruthy();
    expect(utils.getByTestId('auth-gate-error')).toBeTruthy();
    expect(utils.getByText('pending_error')).toBeTruthy();

    await act(async () => {
      await fireEvent.press(utils.getByTestId('auth-gate-sign-in'));
    });
    expect(mockSignInViaPortal).toHaveBeenCalledTimes(1);
  });

  it('lands back on the wall after a sign-out', async () => {
    setAppVariantForTests('store');
    authStatus = 'authenticated';
    setAuth();
    const utils = await renderGate();
    await flush();
    expect(utils.getByTestId('child')).toBeTruthy();

    authStatus = 'unauthenticated';
    setAuth();
    await utils.rerender(
      <AuthGate>
        <Child />
      </AuthGate>,
    );
    await flush();

    expect(utils.getByTestId('auth-gate-wall')).toBeTruthy();
    expect(utils.queryByTestId('child')).toBeNull();
  });
});

