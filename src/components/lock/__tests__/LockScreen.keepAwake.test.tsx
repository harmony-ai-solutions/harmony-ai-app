/**
 * LockScreen — the lock overlay holds the display awake while mounted.
 *
 * The "phone goes into lockdown / instantly re-sleeps and locks" report came
 * from the lock overlay letting the display sleep: waking it fired the OS
 * biometric prompt, that prompt's own screen-off window let the display sleep
 * again, and the lock re-armed (owner device, Android 15, 2026-10-21). The
 * overlay now takes a keep-screen-on hold on mount and releases it on
 * unlock/unmount (the wrapper refcounts, so the TTS panel holding it at the same
 * time is safe).
 */

import React from 'react';
import { render } from '@testing-library/react-native';
import { LockScreen } from '../LockScreen';
import { activateKeepScreenOn, deactivateKeepScreenOn } from '../../../services/keepScreenOn';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('../../../services/keepScreenOn', () => ({
  activateKeepScreenOn: jest.fn(() => Promise.resolve()),
  deactivateKeepScreenOn: jest.fn(() => Promise.resolve()),
}));

jest.mock('../../../contexts/ThemeContext', () => ({
  useAppTheme: () => ({
    theme: {
      colors: {
        accent: { primary: '#7c3aed', secondary: '#a78bfa' },
        background: { base: '#0f0f1a', surface: '#151d30', elevated: '#1e1e2e' },
        border: { default: '#333333' },
        text: { primary: '#ffffff', secondary: '#cccccc', muted: '#aaaaaa' },
        status: { error: '#ef4444' },
      },
    },
  }),
}));

jest.mock('../../../contexts/BiometricLockContext', () => ({
  useBiometricLock: () => ({ lockMode: 'biometric', unlock: jest.fn() }),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('react-native-linear-gradient', () => {
  const React = require('react');
  const { View } = require('react-native');
  return ({ children, ...props }: any) => React.createElement(View, props, children);
});

jest.mock('react-native-vector-icons/MaterialCommunityIcons', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return ({ name, ...props }: any) => React.createElement(Text, props, name);
});

jest.mock('../../../utils/haptics', () => ({ hapticLightPress: jest.fn() }));
jest.mock('../../../utils/colorUtils', () => ({ hexToRgba: (hex: string) => hex }));

jest.mock('../../themed/ThemedView', () => {
  const React = require('react');
  const { View } = require('react-native');
  return { ThemedView: ({ children, ...props }: any) => React.createElement(View, props, children) };
});
jest.mock('../../themed/ThemedText', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return { ThemedText: ({ children, ...props }: any) => React.createElement(Text, props, children) };
});
jest.mock('../../themed/ThemedGradient', () => {
  const React = require('react');
  const { View } = require('react-native');
  return { ThemedGradient: ({ children, ...props }: any) => React.createElement(View, props, children) };
});
jest.mock('../../themed/ThemedButton', () => {
  const React = require('react');
  const { TouchableOpacity, Text } = require('react-native');
  return {
    ThemedButton: ({ label, ...props }: any) =>
      React.createElement(TouchableOpacity, props, React.createElement(Text, null, label)),
  };
});

const mockActivate = activateKeepScreenOn as jest.Mock;
const mockDeactivate = deactivateKeepScreenOn as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  // The auto-biometric effect arms a 350 ms timer; keep it from firing.
  jest.useFakeTimers({ doNotFake: ['queueMicrotask', 'nextTick', 'setImmediate'] });
});

afterEach(() => {
  jest.useRealTimers();
});

describe('LockScreen — keep-awake while locked', () => {
  it('holds the display awake on mount and releases it on unmount (unlock)', async () => {
    const utils = await render(<LockScreen />);

    expect(mockActivate).toHaveBeenCalledTimes(1);
    expect(mockDeactivate).not.toHaveBeenCalled();

    await utils.unmount();

    expect(mockDeactivate).toHaveBeenCalledTimes(1);
  });
});
