/**
 * AuthGate — store launch-gate tests (plan 7-14 V2).
 *
 * Covers the gate's rendering logic per variant × auth state, the
 * silent-attempt-then-fallback state machine (silent service mocked), the
 * sign-out → wall regression, wall error handling, and the full-variant no-op.
 * The variant is driven through the V1 test seam (`setAppVariantForTests`).
 */

import React from 'react';
import { Platform, Text } from 'react-native';
import { act, cleanup, fireEvent, render } from '@testing-library/react-native';
import { AuthGate } from '../AuthGate';
import { setAppVariantForTests } from '../../../config/appVariant';

// ── Hoisted module mocks (factories cannot close over outer variables) ──

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('../../../utils/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

jest.mock('../../../contexts/ThemeContext', () => ({
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

jest.mock('../../../contexts/AuthContext', () => ({ useAuth: jest.fn() }));

jest.mock('../../../services/auth/silentSignIn', () => ({ attemptSilentSignIn: jest.fn() }));

jest.mock('../../../services/auth/googleSignIn', () => ({
  ...jest.requireActual('../../../services/auth/googleSignIn'),
  signInWithGoogle: jest.fn(),
}));

jest.mock('../../../services/auth/appleSignIn', () => ({
  ...jest.requireActual('../../../services/auth/appleSignIn'),
  signInWithApple: jest.fn(),
}));

jest.mock('@invertase/react-native-apple-authentication', () => {
  const React = require('react');
  const { View } = require('react-native');
  const AppleButton = ({ onPress, ...props }: any) =>
    React.createElement(View, { ...props, onPress, testID: 'auth-gate-apple-button' });
  AppleButton.Type = { SIGN_IN: 'SignIn', CONTINUE: 'Continue', SIGN_UP: 'SignUp' };
  AppleButton.Style = { BLACK: 'Black', WHITE: 'White', WHITE_OUTLINE: 'WhiteOutline' };
  return { AppleButton, appleAuth: { performRequest: jest.fn(), isSupported: true } };
});

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
import { attemptSilentSignIn } from '../../../services/auth/silentSignIn';
import {
  signInWithGoogle,
  GoogleSignInError,
  GoogleSignInErrorType,
} from '../../../services/auth/googleSignIn';
import {
  signInWithApple,
  AppleSignInError,
  AppleSignInErrorType,
} from '../../../services/auth/appleSignIn';

const mockUseAuth = useAuth as jest.Mock;
const mockSilent = attemptSilentSignIn as jest.Mock;
const mockGoogle = signInWithGoogle as jest.Mock;
const mockApple = signInWithApple as jest.Mock;

let authStatus: 'loading' | 'authenticated' | 'unauthenticated';
const mockLoginWithGoogle = jest.fn(async () => {
  authStatus = 'authenticated';
});
const mockLoginWithApple = jest.fn(async () => {
  authStatus = 'authenticated';
});

// ── Helpers ─────────────────────────────────────────────────────────────

const Child = () => <Text testID="child">CHILD</Text>;

async function flush() {
  for (let i = 0; i < 10; i++) {
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
  mockUseAuth.mockImplementation(() => ({
    status: authStatus,
    user: null,
    signInVersion: 0,
    loginWithGoogle: mockLoginWithGoogle,
    loginWithApple: mockLoginWithApple,
  }));
  mockSilent.mockResolvedValue(null);
});

afterEach(() => {
  cleanup();
  setAppVariantForTests(null);
});

// ── Tests ───────────────────────────────────────────────────────────────

describe('AuthGate — full variant is a no-op', () => {
  it('renders children unchanged when unauthenticated and never attempts silent', async () => {
    setAppVariantForTests('full');
    const utils = await renderGate();
    await flush();

    expect(utils.getByTestId('child')).toBeTruthy();
    expect(utils.queryByTestId('auth-gate-wall')).toBeNull();
    expect(utils.queryByTestId('auth-gate-splash')).toBeNull();
    expect(mockSilent).not.toHaveBeenCalled();
  });

  it('renders children when authenticated', async () => {
    setAppVariantForTests('full');
    authStatus = 'authenticated';
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
    const utils = await renderGate();
    await flush();

    expect(utils.getByTestId('child')).toBeTruthy();
    expect(utils.queryByTestId('auth-gate-wall')).toBeNull();
  });

  it('shows the branded splash while auth is loading', async () => {
    setAppVariantForTests('store');
    authStatus = 'loading';
    const utils = await renderGate();

    expect(utils.getByTestId('auth-gate-splash')).toBeTruthy();
    expect(utils.queryByTestId('auth-gate-wall')).toBeNull();
    expect(utils.queryByTestId('child')).toBeNull();
  });

  it('shows the splash until the silent attempt settles, then the wall', async () => {
    setAppVariantForTests('store');
    // A deferred silent attempt lets us observe the in-flight splash.
    let resolveSilent: (value: string | null) => void = () => {};
    mockSilent.mockImplementation(
      () =>
        new Promise<string | null>((resolve) => {
          resolveSilent = resolve;
        }),
    );
    const utils = await renderGate();

    // Silent attempt in flight → splash, never a flash of the wall.
    expect(utils.getByTestId('auth-gate-splash')).toBeTruthy();
    expect(utils.queryByTestId('auth-gate-wall')).toBeNull();

    await act(async () => {
      resolveSilent(null);
    });
    await flush();

    expect(utils.getByTestId('auth-gate-wall')).toBeTruthy();
    expect(utils.queryByTestId('auth-gate-splash')).toBeNull();
    expect(utils.queryByTestId('child')).toBeNull();
    expect(mockSilent).toHaveBeenCalledTimes(1);
  });

  it('hides the Apple button on Android and keeps Google', async () => {
    setAppVariantForTests('store');
    const original = Platform.OS;
    // The jest.setup Platform mock is a plain, mutable object.
    (Platform as { OS: string }).OS = 'android';
    try {
      const utils = await renderGate();
      await flush();

      expect(utils.getByTestId('auth-gate-google')).toBeTruthy();
      expect(utils.queryByTestId('auth-gate-apple')).toBeNull();
    } finally {
      (Platform as { OS: string }).OS = original;
    }
  });

  it('shows the Apple button on iOS', async () => {
    setAppVariantForTests('store');
    const utils = await renderGate();
    await flush();

    expect(utils.getByTestId('auth-gate-apple')).toBeTruthy();
  });
});

describe('AuthGate — silent attempt state machine', () => {
  it('signs in via the existing loginWithGoogle path on silent success', async () => {
    setAppVariantForTests('store');
    mockSilent.mockResolvedValue('silent-id-token');

    const utils = await renderGate();
    await flush();

    expect(mockSilent).toHaveBeenCalledTimes(1);
    expect(mockLoginWithGoogle).toHaveBeenCalledWith('silent-id-token');
    // loginWithGoogle flipped status → authenticated → children (post-auth reuse).
    expect(utils.getByTestId('child')).toBeTruthy();
    expect(utils.queryByTestId('auth-gate-wall')).toBeNull();
  });

  it('falls back to the wall when the silent attempt throws', async () => {
    setAppVariantForTests('store');
    mockSilent.mockRejectedValue(new Error('native boom'));

    const utils = await renderGate();
    await flush();

    expect(utils.getByTestId('auth-gate-wall')).toBeTruthy();
    expect(mockLoginWithGoogle).not.toHaveBeenCalled();
  });

  it('sign-out after a cold-start-authenticated session lands on the wall without a silent retry', async () => {
    setAppVariantForTests('store');
    authStatus = 'authenticated';

    const utils = await renderGate();
    await flush();
    expect(utils.getByTestId('child')).toBeTruthy();
    expect(mockSilent).not.toHaveBeenCalled();

    // Simulate a sign-out: status flips to unauthenticated.
    authStatus = 'unauthenticated';
    await utils.rerender(
      <AuthGate>
        <Child />
      </AuthGate>,
    );
    await flush();

    expect(utils.getByTestId('auth-gate-wall')).toBeTruthy();
    expect(utils.queryByTestId('child')).toBeNull();
    // The cold-start decision was consumed → no silent re-auth after sign-out.
    expect(mockSilent).not.toHaveBeenCalled();
  });
});

describe('AuthGate — wall action handlers', () => {
  it('signs in with Google from the wall', async () => {
    setAppVariantForTests('store');
    const utils = await renderGate();
    await flush();

    mockGoogle.mockResolvedValueOnce('wall-google-token');
    await act(async () => {
      await fireEvent.press(utils.getByTestId('auth-gate-google'));
    });
    await flush();

    expect(mockGoogle).toHaveBeenCalledTimes(1);
    expect(mockLoginWithGoogle).toHaveBeenCalledWith('wall-google-token');
  });

  it('surfaces a retryable Google error and keeps the wall', async () => {
    setAppVariantForTests('store');
    const utils = await renderGate();
    await flush();

    mockGoogle.mockRejectedValueOnce(
      new GoogleSignInError(GoogleSignInErrorType.DEVELOPER_ERROR, 'bad config'),
    );
    await act(async () => {
      await fireEvent.press(utils.getByTestId('auth-gate-google'));
    });

    expect(utils.getByTestId('auth-gate-wall')).toBeTruthy();
    expect(utils.getByTestId('auth-gate-error')).toBeTruthy();
    expect(utils.getByText('googleErrorDeveloperError')).toBeTruthy();
  });

  it('shows no error copy when the Google flow is cancelled', async () => {
    setAppVariantForTests('store');
    const utils = await renderGate();
    await flush();

    mockGoogle.mockRejectedValueOnce(
      new GoogleSignInError(GoogleSignInErrorType.CANCELLED, 'cancelled'),
    );
    await act(async () => {
      await fireEvent.press(utils.getByTestId('auth-gate-google'));
    });

    expect(utils.queryByTestId('auth-gate-error')).toBeNull();
  });

  it('signs in with Apple from the wall (iOS)', async () => {
    setAppVariantForTests('store');
    const utils = await renderGate();
    await flush();

    mockApple.mockResolvedValueOnce('wall-apple-token');
    await act(async () => {
      await fireEvent.press(utils.getByTestId('auth-gate-apple-button'));
    });
    await flush();

    expect(mockApple).toHaveBeenCalledTimes(1);
    expect(mockLoginWithApple).toHaveBeenCalledWith('wall-apple-token');
  });

  it('surfaces a retryable Apple error and keeps the wall', async () => {
    setAppVariantForTests('store');
    const utils = await renderGate();
    await flush();

    mockApple.mockRejectedValueOnce(
      new AppleSignInError(AppleSignInErrorType.NOT_CONFIGURED, 'nope'),
    );
    await act(async () => {
      await fireEvent.press(utils.getByTestId('auth-gate-apple-button'));
    });

    expect(utils.getByTestId('auth-gate-wall')).toBeTruthy();
    expect(utils.getByText('appleErrorNotConfigured')).toBeTruthy();
  });
});
