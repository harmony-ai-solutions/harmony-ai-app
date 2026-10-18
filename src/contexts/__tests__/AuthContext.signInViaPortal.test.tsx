/**
 * AuthContext — Option B portal sign-in (signInViaPortal / cancelSignIn) and
 * the redeem → storage → auth:changed path.
 *
 * The connect-session service is mocked with a controllable emitter; AuthService
 * is mocked so we can drive `auth:changed`. A tiny probe component renders the
 * context values so assertions read the live tree (no ref timing).
 */

import React from 'react';
import { Pressable, Text } from 'react-native';
import { Linking } from 'react-native';
import { act, cleanup, fireEvent, render } from '@testing-library/react-native';

// ── Hoisted mocks ───────────────────────────────────────────────────────────

jest.mock('../../utils/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

// `mock`-prefixed so the factories below may reference them (jest hoisting rule).
const mockAuthHandlers: Record<string, Array<(...args: any[]) => void>> = {};
jest.mock('../../services/auth/AuthService', () => ({
  __esModule: true,
  default: {
    getToken: jest.fn(async () => { throw new Error('no token'); }),
    getProfile: jest.fn(),
    invalidate: jest.fn(async () => {}),
    logout: jest.fn(async () => {}),
    applyConnectSessionTokens: jest.fn(async () => {}),
    on: jest.fn((ev: string, h: (...a: any[]) => void) => {
      (mockAuthHandlers[ev] ||= []).push(h);
    }),
    off: jest.fn((ev: string, h: (...a: any[]) => void) => {
      mockAuthHandlers[ev] = (mockAuthHandlers[ev] || []).filter(x => x !== h);
    }),
  },
  AuthExpiredError: class AuthExpiredError extends Error {},
}));

jest.mock('../../services/cloud/DeviceAuthService', () => ({
  __esModule: true,
  default: { registerDevice: jest.fn(async () => {}) },
}));

jest.mock('../../services/cloud/soulbitsTokenSync', () => ({
  startSoulbitsTokenSync: () => () => {},
}));

jest.mock('../../services/providers/seeding', () => ({
  startSeedingEnsure: () => () => {},
}));

jest.mock('../../services/notifications/PushTokenStore', () => ({
  pushTokenStore: { getPushToken: () => 'push-token-1' },
}));

// Controllable connect-session service.
const mockSessionListeners = new Set<(s: any) => void>();
let mockSessionState: any = { status: 'idle', connectUrl: null, remainingSeconds: 0, message: null };
function mockEmitSession() {
  for (const l of mockSessionListeners) l(mockSessionState);
}
const mockSessionStart = jest.fn(async () => {
  mockSessionState = {
    status: 'pending',
    connectUrl: 'https://cloud.soulbits.app/connect?request=conn-1',
    remainingSeconds: 600,
    message: null,
  };
  mockEmitSession();
  return { connectUrl: mockSessionState.connectUrl };
});
const mockSessionCancel = jest.fn(() => {
  mockSessionState = { status: 'idle', connectUrl: null, remainingSeconds: 0, message: null };
  mockEmitSession();
});
jest.mock('../../services/cloud/ConnectSessionService', () => ({
  getConnectSessionService: () => ({
    start: mockSessionStart,
    cancel: mockSessionCancel,
    getState: () => mockSessionState,
    subscribe: (l: (s: any) => void) => {
      mockSessionListeners.add(l);
      return () => mockSessionListeners.delete(l);
    },
  }),
}));

// ── Imports (after mocks) ───────────────────────────────────────────────────

import { AuthProvider, useAuth } from '../AuthContext';
import AuthService from '../../services/auth/AuthService';
import DeviceAuthService from '../../services/cloud/DeviceAuthService';

const mockGetProfile = AuthService.getProfile as jest.Mock;
const mockRegisterDevice = DeviceAuthService.registerDevice as jest.Mock;

function Probe() {
  const auth = useAuth();
  return (
    <>
      <Text testID="status">{auth.status}</Text>
      <Text testID="signInVersion">{String(auth.signInVersion)}</Text>
      <Text testID="pending">
        {auth.pendingSignIn
          ? `${auth.pendingSignIn.status}|${auth.pendingSignIn.connectUrl ?? ''}`
          : 'none'}
      </Text>
      <Text testID="user">{auth.user ? auth.user.id : 'none'}</Text>
      <Pressable testID="signin" onPress={() => { void auth.signInViaPortal(); }} />
      <Pressable testID="cancel" onPress={() => auth.cancelSignIn()} />
    </>
  );
}

async function renderAuth() {
  const utils = await render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  );
  return utils;
}

async function flush(times = 8) {
  for (let i = 0; i < times; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

const textOf = (el: any): string => String(el.props.children);

beforeEach(() => {
  cleanup();
  jest.clearAllMocks();
  mockSessionListeners.clear();
  mockSessionState = { status: 'idle', connectUrl: null, remainingSeconds: 0, message: null };
  for (const k of Object.keys(mockAuthHandlers)) delete mockAuthHandlers[k];
  mockGetProfile.mockResolvedValue({ id: 'u1', email: 'a@b.c', display_name: 'A' });
  jest.spyOn(Linking, 'openURL').mockResolvedValue(true as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('AuthContext — signInViaPortal', () => {
  it('starts a session, opens the portal URL, and exposes the pending state', async () => {
    const { getByTestId } = await renderAuth();
    await flush();

    await fireEvent.press(getByTestId('signin'));
    await flush();

    expect(mockSessionStart).toHaveBeenCalledTimes(1);
    expect(Linking.openURL).toHaveBeenCalledWith(
      'https://cloud.soulbits.app/connect?request=conn-1',
    );
    expect(textOf(getByTestId('pending'))).toBe(
      'pending|https://cloud.soulbits.app/connect?request=conn-1',
    );
  });

  it('cancels the pending sign-in', async () => {
    const { getByTestId } = await renderAuth();
    await flush();
    await fireEvent.press(getByTestId('signin'));
    await flush();

    await fireEvent.press(getByTestId('cancel'));

    expect(mockSessionCancel).toHaveBeenCalledTimes(1);
    expect(textOf(getByTestId('pending'))).toBe('none');
  });

  it('bumps signInVersion when the session is approved', async () => {
    const { getByTestId } = await renderAuth();
    await flush();
    expect(textOf(getByTestId('signInVersion'))).toBe('0');

    await act(async () => {
      mockSessionState = { status: 'approved', connectUrl: null, remainingSeconds: 0, message: null };
      mockEmitSession();
    });

    expect(textOf(getByTestId('signInVersion'))).toBe('1');
  });
});

describe('AuthContext — redeem path (auth:changed)', () => {
  it('sets the user, authenticates, clears the waiting state and registers the device', async () => {
    const { getByTestId } = await renderAuth();
    await flush();
    expect(textOf(getByTestId('status'))).toBe('unauthenticated');

    await act(async () => {
      mockAuthHandlers['auth:changed'].forEach(h => h('paseto-1'));
    });
    await flush();

    expect(textOf(getByTestId('status'))).toBe('authenticated');
    expect(textOf(getByTestId('user'))).toBe('u1');
    expect(textOf(getByTestId('pending'))).toBe('none');
    expect(mockRegisterDevice).toHaveBeenCalledWith({ pushToken: 'push-token-1' });
  });
});
