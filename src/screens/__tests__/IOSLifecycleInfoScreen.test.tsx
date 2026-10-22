/**
 * IOSLifecycleInfoScreen — 4-3 tests.
 *
 * The honest-limits info entry renders the best-effort/overnight/correctness/
 * relay copy and, on iOS, the session's honored/missed wake counters.
 */

import React from 'react';
import { cleanup, render } from '@testing-library/react-native';

afterEach(cleanup);
beforeEach(() => {
  cleanup();
  jest.resetAllMocks();
});

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: any) => (opts ? `${key}:${JSON.stringify(opts)}` : key),
  }),
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
jest.mock('../../components/themed/ThemedCard', () => {
  const React = require('react');
  const { View } = require('react-native');
  return { __esModule: true, ThemedCard: ({ children, style, ...props }: any) => React.createElement(View, { style, ...props }, children) };
});
jest.mock('../../components/themed/ScreenHeader', () => {
  const React = require('react');
  const { View } = require('react-native');
  return { __esModule: true, ScreenHeader: ({ children, ...props }: any) => React.createElement(View, props, children) };
});

import { IOSLifecycleInfoScreen } from '../settings/IOSLifecycleInfoScreen';
import { iosLifecycleTelemetry } from '../../services/engine/IOSLifecycleTelemetry';

describe('IOSLifecycleInfoScreen', () => {
  it('renders the honest-limits blocks', async () => {
    const { getByTestId, getByText } = await render(<IOSLifecycleInfoScreen />);
    expect(getByTestId('lifecycle-intro')).toBeTruthy();
    expect(getByTestId('lifecycle-best-effort')).toBeTruthy();
    expect(getByTestId('lifecycle-overnight')).toBeTruthy();
    expect(getByTestId('lifecycle-correctness')).toBeTruthy();
    expect(getByTestId('lifecycle-relay')).toBeTruthy();
    expect(getByText('bestEffortTitle')).toBeTruthy();
    expect(getByText('correctnessBody')).toBeTruthy();
  });

  it('shows the session honored/missed counters on iOS', async () => {
    iosLifecycleTelemetry.reset();
    iosLifecycleTelemetry.record({
      kind: 'keepalive',
      outcome: 'honored',
      startedAt: 0,
      finishedAt: 1,
      durationMs: 1,
      completed: 1,
      truncated: 0,
      degraded: 0,
    });
    iosLifecycleTelemetry.record({
      kind: 'keepalive',
      outcome: 'missed',
      startedAt: 0,
      finishedAt: 1,
      durationMs: 1,
      completed: 0,
      truncated: 0,
      degraded: 0,
    });

    const { getByTestId, getByText } = await render(<IOSLifecycleInfoScreen />);
    expect(getByTestId('lifecycle-telemetry')).toBeTruthy();
    expect(getByText('telemetryHonoredMissed:{"honored":1,"missed":1}')).toBeTruthy();
    iosLifecycleTelemetry.reset();
  });
});
