/**
 * SyncSettingsScreen — async cloud-purge card state machine.
 *
 * Pins the deadline-latch escape UI (cloud-data-deletion.md §7):
 *   - a cold-start attach resolving `none` renders the IDLE confirm card
 *     (the server has no run — the card must not stay stuck);
 *   - a deadline-latched card resets to idle when the service reconciles the
 *     latch away (`purge:cleared` — server reports the run gone);
 *   - an attach finding a server-side `failed` renders the retry card.
 *
 * cloudSessionService is mocked as a real EventEmitter so the screen's
 * listeners receive emits (pattern from SyncConnectionContext.purgeBlocking).
 */
import React from 'react';
import { act, cleanup, render } from '@testing-library/react-native';
import { SyncSettingsScreen } from '../settings/SyncSettingsScreen';

afterEach(cleanup);
beforeEach(cleanup);

// t resolves against the REAL en/syncSettings.json (repo-standard for this
// screen's tests — proves keys resolve to human copy).
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
        typography: { headerOpacity: 1, subtextOpacity: 0.7, captionOpacity: 0.5 },
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
    getCurrentSource: jest.fn(() => Promise.resolve('cloud')),
    getLastSync: jest.fn(() => Promise.resolve(null)),
    getSecurityMode: jest.fn(() => Promise.resolve('secure')),
    getSyncEstimateLimitMB: jest.fn(() => Promise.resolve(5)),
  },
}));

// EventEmitter-backed service mock so the screen's listeners receive emits.
jest.mock('../../services/cloud/CloudSessionService', () => {
  const { EventEmitter } = require('eventemitter3');
  const svc: any = new EventEmitter();
  svc.getStatus = jest.fn(() => 'idle');
  svc.isPurging = jest.fn(() => false);
  svc.getPurgeRunState = jest.fn(() => 'idle');
  svc.getLastPurgeTerminal = jest.fn(() => null);
  svc.attachToRunningPurge = jest.fn(async () => ({ kind: 'none' }));
  svc.purgeCloudData = jest.fn(async () => undefined);
  return { __esModule: true, cloudSessionService: svc };
});

const mockShowAlert = jest.fn();
jest.mock('../../contexts/AppAlertContext', () => ({
  useAppAlert: () => ({ showAlert: mockShowAlert }),
}));

const mockUseSyncConnection = jest.fn();
jest.mock('../../contexts/SyncConnectionContext', () => ({
  useSyncConnection: () => mockUseSyncConnection(),
}));

import { cloudSessionService } from '../../services/cloud/CloudSessionService';
import SyncService from '../../services/SyncService';

const svc: any = cloudSessionService;

const cloudConnected = {
  isConnected: true,
  isPaired: false,
  isReconnecting: false,
  reconnectAttempt: 0,
  nextReconnectIn: 0,
  showToast: jest.fn(),
  canUseChat: true,
  connectionStatus: {
    textKey: 'connected',
    color: '#4CAF50',
    variant: 'success',
    mode: 'cloud',
  },
  serverUpdateRequired: false,
  purgeBlocking: false,
  purgeResultPending: false,
  dismissPurgeResult: (...args: any[]) => mockDismissPurgeResult(...args),
};

const mockDismissPurgeResult = jest.fn();

async function flush() {
  for (let i = 0; i < 8; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

beforeEach(() => {
  jest.clearAllMocks();
  svc.getStatus.mockReturnValue('idle');
  svc.isPurging.mockReturnValue(false);
  svc.getPurgeRunState.mockReturnValue('idle');
  svc.getLastPurgeTerminal.mockReturnValue(null);
  svc.attachToRunningPurge.mockResolvedValue({ kind: 'none' });
  mockUseSyncConnection.mockReturnValue(cloudConnected);
});

describe('SyncSettingsScreen — purge card deadline-latch escape', () => {
  it('attach resolving none renders the IDLE confirm card', async () => {
    const utils = await render(<SyncSettingsScreen />);
    await flush();

    expect(svc.attachToRunningPurge).toHaveBeenCalledTimes(1);
    expect(utils.getByTestId('reset-cloud-data-button')).toBeTruthy();
    expect(utils.queryByTestId('purge-deadline-text')).toBeNull();
    expect(utils.queryByTestId('purge-progress-block')).toBeNull();
  });

  it('deadline card resets to IDLE when the service fires purge:cleared', async () => {
    // Latched deadline from a previous app session (initial snapshot).
    svc.getPurgeRunState.mockReturnValue('deadline');
    svc.getLastPurgeTerminal.mockReturnValue({ outcome: 'deadline' });
    svc.isPurging.mockReturnValue(true);

    const utils = await render(<SyncSettingsScreen />);
    await flush();

    // Attach re-probes (never replays deadline); while it reports none the
    // card shows the deadline info state from the initial snapshot.
    expect(utils.getByTestId('purge-deadline-text')).toBeTruthy();

    // The service reconciled the latch away → the card must reset to idle.
    await act(async () => {
      svc.emit('purge:cleared');
    });

    expect(utils.queryByTestId('purge-deadline-text')).toBeNull();
    expect(utils.getByTestId('reset-cloud-data-button')).toBeTruthy();
  });

  it('attach finding a server-side failed renders the RETRY card', async () => {
    svc.attachToRunningPurge.mockResolvedValue({
      kind: 'terminal',
      terminal: { outcome: 'failed', error: 'attempt cap reached', attempts: 5 },
    });

    const utils = await render(<SyncSettingsScreen />);
    await flush();

    expect(utils.getByTestId('purge-failed-text')).toBeTruthy();
    expect(utils.getByTestId('retry-purge-button')).toBeTruthy();
    expect(utils.queryByTestId('reset-cloud-data-button')).toBeNull();
  });

  it('purge success (terminal deleted) offers an action that runs forceFullSync', async () => {
    const utils = await render(<SyncSettingsScreen />);
    await flush();
    mockShowAlert.mockClear();
    const syncServiceMock = SyncService as any;
    syncServiceMock.forceFullSync.mockClear().mockResolvedValue(undefined);

    await act(async () => {
      svc.emit('purge:terminal', { outcome: 'deleted' });
    });
    await flush();

    // The success alert is shown (was previously message-only)...
    expect(mockShowAlert).toHaveBeenCalledTimes(1);
    const [title, message, buttons] = mockShowAlert.mock.calls[0];
    expect(title).toBe('Cloud data deleted'); // resolves through the real i18n dict
    expect(Array.isArray(message) || typeof message === 'string').toBe(true);
    expect(String(message)).toContain('full re-sync');

    // ...with a non-cancel action labelled "Full re-sync now" that starts the
    // forced full re-sync.
    const action = (buttons ?? []).find((b: any) => b.style !== 'cancel');
    expect(action).toBeDefined();
    expect(action.text).toBe('Full re-sync now');
    await act(async () => {
      await action.onPress();
    });
    expect(syncServiceMock.forceFullSync).toHaveBeenCalledTimes(1);
    // The dialog action ACKNOWLEDGES the result (releases any deferred
    // estimate prompt after the user has seen the success message).
    expect(mockDismissPurgeResult).toHaveBeenCalled();

    // ...AND a PERSISTENT success card renders (A1) — it must exist right
    // away, independent of the single-slot alert.
    expect(utils.getByTestId('purge-success-block')).toBeTruthy();
    expect(utils.getByTestId('purge-success-resync-button')).toBeTruthy();
    expect(utils.getByTestId('purge-success-dismiss-button')).toBeTruthy();
    expect(utils.queryByText('Cloud data deleted — re-syncing your data now.')).toBeTruthy();
  });

  it('the persistent success card SURVIVES a later estimate prompt (no clobber)', async () => {
    const utils = await render(<SyncSettingsScreen />);
    await flush();

    await act(async () => {
      svc.emit('purge:terminal', { outcome: 'deleted' });
    });
    await flush();
    expect(utils.getByTestId('purge-success-block')).toBeTruthy();

    // Simulate exactly the bug: another alert takes over the single-slot
    // AppAlertContext (the post-purge re-sync's size-estimate prompt) — with
    // the old one-shot-only surface the purge success was GONE. The
    // persistent card must not care.
    await act(async () => {
      mockShowAlert('Sync', '24 records ready to download', [], {});
    });

    expect(utils.getByTestId('purge-success-block')).toBeTruthy();
    expect(utils.getByTestId('purge-success-resync-button')).toBeTruthy();
    expect(utils.getByTestId('purge-success-dismiss-button')).toBeTruthy();
  });

  it('the card dismiss ("Got it") acknowledges the result and returns to the idle confirm card', async () => {
    const utils = await render(<SyncSettingsScreen />);
    await flush();
    mockShowAlert.mockClear();

    await act(async () => {
      svc.emit('purge:terminal', { outcome: 'deleted' });
    });
    await flush();
    expect(utils.getByTestId('purge-success-block')).toBeTruthy();

    await act(async () => {
      utils.getByTestId('purge-success-dismiss-button').props.onPress();
    });

    expect(mockDismissPurgeResult).toHaveBeenCalledTimes(1);
    expect(utils.queryByTestId('purge-success-block')).toBeNull();
    expect(utils.getByTestId('reset-cloud-data-button')).toBeTruthy();
  });

  it('a completed FORCED sync auto-clears the success card (an incremental one does not)', async () => {
    const utils = await render(<SyncSettingsScreen />);
    await flush();

    await act(async () => {
      svc.emit('purge:terminal', { outcome: 'deleted' });
    });
    await flush();
    expect(utils.getByTestId('purge-success-block')).toBeTruthy();

    const completedListener = (SyncService.on as jest.Mock).mock.calls
      .filter(([evt]: any[]) => evt === 'sync:completed')
      .pop()?.[1];
    expect(completedListener).toBeDefined();

    // An incremental session completing must NOT clear the success card...
    await act(async () => {
      completedListener({ forceFullSync: false });
    });
    expect(utils.getByTestId('purge-success-block')).toBeTruthy();

    // ...the forced full re-sync completing does.
    await act(async () => {
      completedListener({ forceFullSync: true });
    });
    expect(utils.queryByTestId('purge-success-block')).toBeNull();
    expect(utils.getByTestId('reset-cloud-data-button')).toBeTruthy();
  });

  it('re-mounts with the success card while the provider-level purge result is still pending', async () => {
    // The user purged, left the screen, and came back: the ack surface must
    // re-appear so a deferred estimate prompt can always be released.
    mockUseSyncConnection.mockReturnValue({
      ...cloudConnected,
      purgeResultPending: true,
    });

    const utils = await render(<SyncSettingsScreen />);
    await flush();

    expect(utils.getByTestId('purge-success-block')).toBeTruthy();
    expect(utils.getByTestId('purge-success-dismiss-button')).toBeTruthy();
    expect(utils.queryByTestId('reset-cloud-data-button')).toBeNull();
  });
});
