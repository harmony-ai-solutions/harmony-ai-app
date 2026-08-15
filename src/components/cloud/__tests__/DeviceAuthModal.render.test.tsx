/**
 * DeviceAuthModal — RNTL component tests for the Phase 4-2 auto-resolve
 * polling (D-DEV-01).
 *
 * Verifies the 5 s poll loop:
 *   - getStatus().authorized=true → interval cleared + onVerified() called
 *   - transient errors (5xx/429) are non-fatal — polling continues, no error UI
 *   - 404/400 surface the existing error UI without stopping the loop
 *   - polling does not run while the modal is hidden
 *
 * Uses @testing-library/react-native (RNTL) for render + fake timers, mocking
 * the themed primitives (as CloudProvisioningCard.render.test.tsx does) and the
 * DeviceAuthService facade so no network/theme tree is needed.
 *
 * NOTE: RNTL v14's render() is async (returns Promise<RenderResult>), so every
 * render call must be awaited.
 */

import React from 'react';
import { render } from '@testing-library/react-native';
import { DeviceAuthModal } from '../DeviceAuthModal';
import { DeviceAuthError } from '../../../services/cloud/DeviceAuthService';

// ── Module-level mocks for child component dependencies ──────────────────
// NOTE: jest.mock factories are hoisted before imports, so they CANNOT
// reference outer-scope variables. Use require() for any module needed inside
// the factory.

// Mock ThemedText to render children in a <Text> so getByText works.
jest.mock('../../themed/ThemedText', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    __esModule: true,
    ThemedText: ({ children, style, ...props }: any) =>
      React.createElement(Text, { style, ...props }, children),
  };
});

// Mock ThemedView to a plain View.
jest.mock('../../themed/ThemedView', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    ThemedView: ({ children, style, ...props }: any) =>
      React.createElement(View, { style, ...props }, children),
  };
});

// Mock ThemedButton to a TouchableOpacity wrapping the label (fireEvent.press).
jest.mock('../../themed/ThemedButton', () => {
  const React = require('react');
  const { TouchableOpacity, Text } = require('react-native');
  return {
    __esModule: true,
    ThemedButton: ({ label, onPress, disabled, style, ...props }: any) =>
      React.createElement(
        TouchableOpacity,
        { onPress, disabled, style, accessibilityRole: 'button', ...props },
        React.createElement(Text, null, label),
      ),
  };
});

// Mock useAppTheme — DeviceAuthModal reads theme colors for input styling.
jest.mock('../../../contexts/ThemeContext', () => ({
  useAppTheme: () => ({
    theme: {
      colors: {
        text: { primary: '#fff', muted: '#999' },
        border: { default: '#333' },
        background: { base: '#000' },
      },
    },
  }),
}));

// Mock useTranslation to resolve the few keys the modal renders; keys are
// resolved through the real en/auth.json copy so string regressions surface.
// NOTE: the `t` function must be STABLE across renders — react-i18next returns
// a memoized t, and the modal's polling effect depends on it. Returning a new
// function per render would re-register the 5 s interval on every cooldown
// tick (1 s) and it would never fire.
jest.mock('react-i18next', () => {
  const auth = require('../../../i18n/locales/en/auth.json');
  const t = (key: string, opts?: Record<string, any>) => {
    let msg = auth[key] ?? key;
    if (opts) {
      for (const [k, v] of Object.entries(opts)) {
        msg = msg.replace(`{{${k}}}`, String(v));
      }
    }
    return msg;
  };
  return {
    useTranslation: () => ({ t }),
  };
});

// Mock the service facade — poll tests drive getStatus directly.
jest.mock('../../../services/cloud/DeviceAuthService', () => {
  const getStatus = jest.fn();
  const requestCode = jest.fn(async () => {});
  const verifyCode = jest.fn(async () => {});
  const mockDeviceAuthError = class DeviceAuthError extends Error {
    action: string;
    status?: number;
    constructor(action: string, message: string, status?: number) {
      super(`Device auth ${action} failed: ${message}`);
      this.name = 'DeviceAuthError';
      this.action = action;
      this.status = status;
    }
  };
  return {
    __esModule: true,
    default: { getStatus, requestCode, verifyCode },
    DeviceAuthError: mockDeviceAuthError,
  };
});

import DeviceAuthService from '../../../services/cloud/DeviceAuthService';

const mockGetStatus = DeviceAuthService.getStatus as jest.Mock;

// Real Modal renders children when visible in the RN jest preset — good enough
// for the poll assertions. useAppTheme is mocked, so theme is never null.
const baseProps = {
  visible: true,
  onVerified: jest.fn(),
  onDismiss: jest.fn(),
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('DeviceAuthModal — Phase 4-2 auto-resolve polling', () => {
  it('polls every 5 s and closes via onVerified once the device is authorized', async () => {
    mockGetStatus
      .mockResolvedValueOnce({ authorized: false, authorizationPending: true })
      .mockResolvedValueOnce({ authorized: false, authorizationPending: true })
      .mockResolvedValueOnce({ authorized: true, authorizationPending: false });

    await render(<DeviceAuthModal {...baseProps} />);

    // First tick after mount fires immediately on the initial interval delay;
    // advance 5 s to trigger subsequent polls.
    await jest.advanceTimersByTimeAsync(5000);
    expect(mockGetStatus).toHaveBeenCalledTimes(1);
    expect(baseProps.onVerified).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(5000);
    expect(mockGetStatus).toHaveBeenCalledTimes(2);
    expect(baseProps.onVerified).not.toHaveBeenCalled();

    // Third poll: authorized → interval cleared + onVerified.
    await jest.advanceTimersByTimeAsync(5000);
    expect(mockGetStatus).toHaveBeenCalledTimes(3);
    expect(baseProps.onVerified).toHaveBeenCalledTimes(1);
  });

  it('does not poll while the modal is hidden', async () => {
    await render(<DeviceAuthModal {...baseProps} visible={false} />);

    await jest.advanceTimersByTimeAsync(20_000);
    expect(mockGetStatus).not.toHaveBeenCalled();
    expect(baseProps.onVerified).not.toHaveBeenCalled();
  });

  it('ignores transient 5xx errors — keeps polling, no error UI', async () => {
    const { queryByText } = await render(<DeviceAuthModal {...baseProps} />);

    mockGetStatus
      .mockRejectedValueOnce(new DeviceAuthError('getStatus', 'upstream down', 503))
      .mockResolvedValueOnce({ authorized: true, authorizationPending: false });

    await jest.advanceTimersByTimeAsync(5000);
    expect(mockGetStatus).toHaveBeenCalledTimes(1);
    // Transient error → no error text rendered.
    expect(queryByText('Could not send the code. Please try again.')).toBeNull();

    // Poll continues and resolves on the next tick.
    await jest.advanceTimersByTimeAsync(5000);
    expect(baseProps.onVerified).toHaveBeenCalledTimes(1);
  });

  it('surfaces 404 as the existing error UI but keeps polling', async () => {
    const { getByText } = await render(<DeviceAuthModal {...baseProps} />);

    mockGetStatus
      .mockRejectedValueOnce(new DeviceAuthError('getStatus', 'device not found', 404))
      .mockResolvedValueOnce({ authorized: true, authorizationPending: false });

    await jest.advanceTimersByTimeAsync(5000);
    expect(mockGetStatus).toHaveBeenCalledTimes(1);
    expect(
      getByText('Could not send the code. Please try again.'),
    ).toBeTruthy();

    // The loop is not stopped by the error — next tick resolves.
    await jest.advanceTimersByTimeAsync(5000);
    expect(baseProps.onVerified).toHaveBeenCalledTimes(1);
  });

  it('surfaces 400 as the existing error UI', async () => {
    const { getByText } = await render(<DeviceAuthModal {...baseProps} />);

    mockGetStatus.mockRejectedValue(
      new DeviceAuthError('getStatus', 'bad request', 400),
    );

    await jest.advanceTimersByTimeAsync(5000);
    expect(
      getByText('Could not send the code. Please try again.'),
    ).toBeTruthy();
  });
});
