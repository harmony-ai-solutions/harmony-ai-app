/**
 * SyncSettingsScreen — 3-3/D57 `serverUpdateRequired` sticky-gate UI tests.
 *
 * Verifies the screen surfaces the sticky server-update-required gate:
 *  - the status line renders the HUMAN label for textKey
 *    `serverUpdateRequired` (resolved against the real en/syncSettings.json —
 *    not the raw key, i.e. the 1:1 textKey mapping has its key)
 *  - a warning card (testID `server-update-required-card`) explains what to
 *    do + that the app reconnects automatically once Harmony Link is updated
 *  - manual sync actions (Sync Now / Force Full Re-Sync) are visually
 *    disabled while the gate is sticky (initiateSync no-ops at the service
 *    choke point — the buttons must not pretend otherwise)
 *  - with the gate off, none of the above renders and the buttons behave as
 *    before
 */
import React from 'react';
import { act, cleanup, render } from '@testing-library/react-native';
import { SyncSettingsScreen } from '../settings/SyncSettingsScreen';

afterEach(cleanup);
beforeEach(cleanup);

// t resolves against the REAL en/syncSettings.json so the tests prove the
// textKey 1:1 mapping resolves to human copy (a missing key would fall back
// to the raw key and fail these assertions).
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const dict = require('../../i18n/locales/en/syncSettings.json');
      return dict[key] ?? key;
    },
  }),
}));

jest.mock('../../utils/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

jest.mock('react-native-linear-gradient', () => {
  const React = require('react');
  const { View } = require('react-native');
  return ({ children, style, ...props }: any) =>
    React.createElement(View, { style, ...props }, children);
});

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

jest.mock('@react-navigation/native', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn() }),
    __mock_components: { View },
  };
});

// Themed primitives.
jest.mock('../../components/themed/ThemedView', () => {
  const React = require('react');
  const { View } = require('react-native');
  return { __esModule: true, ThemedView: ({ children, style, ...props }: any) =>
    React.createElement(View, { style, ...props }, children) };
});
jest.mock('../../components/themed/ThemedText', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return { __esModule: true, ThemedText: ({ children, ...props }: any) =>
    React.createElement(Text, props, children) };
});
jest.mock('../../components/themed/ThemedCard', () => {
  const React = require('react');
  const { View } = require('react-native');
  return { __esModule: true, ThemedCard: ({ children, style, ...props }: any) =>
    React.createElement(View, { style, ...props }, children) };
});
jest.mock('../../components/themed/ScreenHeader', () => {
  const React = require('react');
  const { View } = require('react-native');
  return { __esModule: true, ScreenHeader: ({ children, ...props }: any) =>
    React.createElement(View, { testID: 'screen-header-mock', ...props }, children) };
});
// ThemedButton → View carrying accessibilityState.disabled (repo-standard
// mock; tests assert `props.accessibilityState.disabled` by testID).
jest.mock('../../components/themed/ThemedButton', () => {
  const React = require('react');
  const { View, Text } = require('react-native');
  return {
    __esModule: true,
    ThemedButton: ({ label, onPress, disabled, testID, ...props }: any) =>
      React.createElement(
        View,
        {
          onPress: () => onPress(),
          accessibilityState: { disabled: !!disabled },
          testID,
          accessibilityRole: 'button',
          ...props,
        },
        React.createElement(Text, { testID: testID ? `${testID}-label` : undefined }, label),
      ),
  };
});

jest.mock('../../components/sync/SyncProgressVisualizer', () => {
  const React = require('react');
  const { View } = require('react-native');
  return { __esModule: true, SyncProgressVisualizer: () =>
    React.createElement(View, { testID: 'sync-progress-visualizer' }) };
});

jest.mock('../../components/config/SelectPicker', () => {
  const React = require('react');
  const { View } = require('react-native');
  return { __esModule: true, SelectPicker: () => React.createElement(View, null) };
});

jest.mock('../../services/SyncService', () => ({
  __esModule: true,
  default: {
    on: jest.fn(),
    removeListener: jest.fn(),
    initiateSync: jest.fn(),
    forceFullSync: jest.fn(),
  },
  SyncSession: undefined,
}));

jest.mock('../../services/ConnectionStateManager', () => ({
  __esModule: true,
  default: {
    getCurrentSource: jest.fn(() => Promise.resolve('selfhosted')),
    getLastSync: jest.fn(() => Promise.resolve(null)),
    getSecurityMode: jest.fn(() => Promise.resolve('secure')),
    getSyncEstimateLimitMB: jest.fn(() => Promise.resolve(5)),
  },
}));

jest.mock('../../services/cloud/CloudSessionService', () => ({
  __esModule: true,
  cloudSessionService: {
    on: jest.fn(),
    off: jest.fn(),
    isPurging: jest.fn(() => false),
    getStatus: jest.fn(() => 'idle'),
  },
}));

jest.mock('../../contexts/AppAlertContext', () => ({
  useAppAlert: () => ({ showAlert: jest.fn() }),
}));

const mockUseSyncConnection = jest.fn();
jest.mock('../../contexts/SyncConnectionContext', () => ({
  useSyncConnection: () => mockUseSyncConnection(),
}));

// Mirrors computeConnectionStatus outputs (connectionStatusHelper.ts).
const stickySelfhostedConnected = {
  isConnected: true,
  isPaired: true,
  isReconnecting: false,
  reconnectAttempt: 0,
  nextReconnectIn: 0,
  showToast: jest.fn(),
  canUseChat: true,
  connectionStatus: {
    textKey: 'serverUpdateRequired',
    color: '#f44336',
    variant: 'error',
    mode: 'selfhosted',
  },
  serverUpdateRequired: true,
};

const stickySelfhostedDisconnected = {
  ...stickySelfhostedConnected,
  isConnected: false,
  canUseChat: true,
};

const plainConnected = {
  ...stickySelfhostedConnected,
  connectionStatus: {
    textKey: 'connected',
    color: '#4CAF50',
    variant: 'success',
    mode: 'selfhosted',
  },
  serverUpdateRequired: false,
};

async function flush() {
  for (let i = 0; i < 8; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

describe('SyncSettingsScreen — serverUpdateRequired sticky gate', () => {
  it('shows the warning card + human status label while sticky (even with the WS up)', async () => {
    mockUseSyncConnection.mockReturnValue(stickySelfhostedConnected);

    const utils = await render(<SyncSettingsScreen />);
    await flush();

    // Warning card with actionable copy.
    expect(utils.getByTestId('server-update-required-card')).toBeTruthy();
    expect(
      utils.getByText(
        'Harmony Link must be updated before syncing can continue. Please update Harmony Link to the latest version — this device will reconnect and resume syncing automatically once the update is installed.',
      ),
    ).toBeTruthy();

    // textKey → human label (NOT the raw 'serverUpdateRequired' key). The
    // label renders in the hero AND the status detail row.
    expect(utils.getAllByText('Harmony Link update required').length).toBeGreaterThan(0);
    expect(utils.queryByText('serverUpdateRequired')).toBeNull();

    // Manual sync attempts are visually disabled while the service choke
    // point short-circuits initiateSync().
    expect(utils.getByTestId('sync-now-button').props.accessibilityState.disabled).toBe(true);
    expect(utils.getByTestId('force-resync-button').props.accessibilityState.disabled).toBe(true);
  });

  it('shows the card even when disconnected (gate is mode/state-independent)', async () => {
    mockUseSyncConnection.mockReturnValue(stickySelfhostedDisconnected);

    const utils = await render(<SyncSettingsScreen />);
    await flush();

    expect(utils.getByTestId('server-update-required-card')).toBeTruthy();
    expect(utils.getByTestId('sync-now-button').props.accessibilityState.disabled).toBe(true);
  });

  it('hides the card and keeps buttons enabled when the gate is off', async () => {
    mockUseSyncConnection.mockReturnValue(plainConnected);

    const utils = await render(<SyncSettingsScreen />);
    await flush();

    expect(utils.queryByTestId('server-update-required-card')).toBeNull();
    expect(utils.getByTestId('sync-now-button').props.accessibilityState.disabled).toBe(false);
    expect(utils.getByTestId('force-resync-button').props.accessibilityState.disabled).toBe(false);
    // Existing status rendering unchanged.
    expect(utils.getAllByText('Connected').length).toBeGreaterThan(0);
  });
});
