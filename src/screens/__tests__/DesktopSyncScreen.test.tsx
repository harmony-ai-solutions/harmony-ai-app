/**
 * DesktopSyncScreen — 3-5 + 7-3 tests.
 *
 * The screen is driven by the mocked EngineApiClient singleton (per the 3-2
 * convention) plus the mocked sync orchestrator / auth service (7-3). Covers:
 * status rendering (state + authority), the transport picker + cloud fields,
 * the relay status block, cloud pairing (manual code + QR camera scan),
 * the sync-group key card, the rotation banner, auth-needed recovery and the
 * quota banner.
 */

import React from 'react';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react-native';

afterEach(cleanup);
beforeEach(() => {
  cleanup();
  jest.resetAllMocks();
  // Re-establish the persistent module mocks wiped by resetAllMocks.
  (AuthService.getToken as jest.Mock).mockResolvedValue('PASETO');
  (AuthService.getProfile as jest.Mock).mockResolvedValue({
    id: 'uid-1',
    email: 'user@example.com',
    display_name: 'User',
  });
  (AuthService.refresh as jest.Mock).mockResolvedValue(true);
  (getDeviceId as jest.Mock).mockResolvedValue('device-abc');
  mockCheckAndRequestPermission.mockResolvedValue(true);
});

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, opts?: any) => (opts ? `${key}:${JSON.stringify(opts)}` : key) }),
}));

jest.mock('../../utils/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

jest.mock('react-native-linear-gradient', () => {
  const React = require('react');
  const { View } = require('react-native');
  return ({ children, style, ...props }: any) => React.createElement(View, { style, ...props }, children);
});

jest.mock('react-native-vector-icons/MaterialCommunityIcons', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return ({ name, ...props }: any) => React.createElement(Text, { ...props }, name);
});

jest.mock('../../utils/haptics', () => ({ hapticLightPress: jest.fn() }));

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

const mockShowAlert = jest.fn();
jest.mock('../../contexts/AppAlertContext', () => ({
  useAppAlert: () => ({ showAlert: mockShowAlert }),
}));
const mockShowToast = jest.fn();
jest.mock('../../contexts/AppToastContext', () => ({
  useToast: () => ({ showToast: mockShowToast }),
}));

jest.mock('@react-navigation/native', () => {
  const React = require('react');
  return {
    useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn() }),
    useFocusEffect: (cb: () => void) => React.useEffect(cb, [cb]),
  };
});

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
jest.mock('../../components/themed/ThemedButton', () => {
  const React = require('react');
  const { TouchableOpacity, Text } = require('react-native');
  return {
    __esModule: true,
    ThemedButton: ({ label, onPress, disabled, testID }: any) =>
      React.createElement(TouchableOpacity, { testID, onPress, disabled, accessibilityRole: 'button' }, React.createElement(Text, null, label)),
  };
});

jest.mock('../../components/settings/SettingsRows', () => {
  const React = require('react');
  const { Switch, View } = require('react-native');
  return {
    __esModule: true,
    SettingsToggleRow: ({ value, onValueChange, ...props }: any) =>
      React.createElement(View, null, React.createElement(Switch, { testID: props.icon === 'account-multiple-plus-outline' ? 'desktop-sync-join-switch' : 'desktop-sync-enabled-switch', value, onValueChange })),
    SettingsLinkRow: () => React.createElement(View, null),
    SettingsDetailRow: () => React.createElement(View, null),
  };
});

jest.mock('../../components/config/SelectPicker', () => {
  const React = require('react');
  const { View } = require('react-native');
  return { __esModule: true, SelectPicker: () => React.createElement(View, { testID: 'desktop-sync-security-picker' }) };
});

jest.mock('../../services/engine/EngineApiClient', () => ({
  engineApiClient: {
    getSyncClientStatus: jest.fn(),
    updateSyncClientConfig: jest.fn(),
    yieldSyncClient: jest.fn(),
    disconnectSyncClient: jest.fn(),
  },
}));

const mockKeyStatus = jest.fn();
const mockReadRotationRequired = jest.fn();
const mockRelayRotationRequired = jest.fn();
const mockStartCloudSync = jest.fn();
const mockJoinCloudSync = jest.fn();
const mockResetSyncKey = jest.fn();
jest.mock('../../services/sync/SyncGroupOrchestrator', () => ({
  syncGroupOrchestrator: {
    keyStatus: (...a: any[]) => mockKeyStatus(...a),
    readRotationRequired: (...a: any[]) => mockReadRotationRequired(...a),
    relayRotationRequired: (...a: any[]) => mockRelayRotationRequired(...a),
    startCloudSync: (...a: any[]) => mockStartCloudSync(...a),
    joinCloudSync: (...a: any[]) => mockJoinCloudSync(...a),
    resetSyncKey: (...a: any[]) => mockResetSyncKey(...a),
  },
  SyncGroupAuthError: class SyncGroupAuthError extends Error {},
}));

jest.mock('../../services/auth/AuthService', () => ({
  __esModule: true,
  default: {
    getToken: jest.fn(async () => 'PASETO'),
    getProfile: jest.fn(async () => ({ id: 'uid-1', email: 'user@example.com', display_name: 'User' })),
    refresh: jest.fn(async () => true),
  },
}));

jest.mock('../../services/cloud/DeviceIdProvider', () => ({
  getDeviceId: jest.fn(async () => 'device-abc'),
}));

const mockCheckAndRequestPermission = jest.fn();
jest.mock('../../utils/permissions', () => ({
  checkAndRequestPermission: (...a: any[]) => mockCheckAndRequestPermission(...a),
  openAppSettings: jest.fn(async () => undefined),
  PERMISSIONS: { CAMERA: 'android.permission.CAMERA' },
}));

import { DesktopSyncScreen } from '../settings/DesktopSyncScreen';
import { engineApiClient } from '../../services/engine/EngineApiClient';
import AuthService from '../../services/auth/AuthService';
import { getDeviceId } from '../../services/cloud/DeviceIdProvider';

const mockStatus = engineApiClient.getSyncClientStatus as jest.Mock;
const mockUpdate = engineApiClient.updateSyncClientConfig as jest.Mock;
const mockYield = engineApiClient.yieldSyncClient as jest.Mock;
const mockDisconnect = engineApiClient.disconnectSyncClient as jest.Mock;

function status(over: Record<string, unknown> = {}) {
  return {
    enabled: true,
    state: 'syncing',
    last_error: null,
    local_authoritative: false,
    baseline_path: null,
    dataset_id: 'ds-1',
    pending_writes: 0,
    sync_group: 'uninitialized',
    rotation_required: false,
    cognition_authority: null,
    narration_paused: false,
    relay: null,
    config: {
      enabled: true,
      transport: 'lan',
      peer_address: '192.168.1.10:28080',
      peer_wss_address: '',
      security_mode: 'secure',
      relay_url: '',
      relay_token: '',
      device_id: '',
      dataset_id: '',
      group_join_pending: false,
      device_name: 'Pixel',
      device_type: 'embedded_engine',
      device_platform: 'android',
    },
    ...over,
  };
}

async function renderScreen(initial = status()) {
  mockStatus.mockResolvedValue(initial);
  mockKeyStatus.mockResolvedValue({ state: 'uninitialized', has_key: false, rotation_required: false });
  mockReadRotationRequired.mockResolvedValue(false);
  mockRelayRotationRequired.mockResolvedValue({ state: 'member', has_key: true, rotation_required: true });
  const utils = await render(<DesktopSyncScreen />);
  await waitFor(() => expect(utils.getByTestId('desktop-sync-state')).toBeTruthy());
  return utils;
}

describe('DesktopSyncScreen', () => {
  it('renders the state and authority from the status', async () => {
    const utils = await renderScreen(status({ state: 'pending_approval', local_authoritative: false }));
    expect(utils.getByTestId('desktop-sync-state').props.children).toBe('state_pending_approval');
    expect(utils.getByTestId('desktop-sync-authority').props.children).toBe('authorityPeer');
    // The pairing hint is shown while awaiting approval (LAN).
    expect(utils.getByTestId('desktop-sync-pending-hint')).toBeTruthy();
  });

  it('shows where cognition runs and the narration-paused banner (plan 7-8)', async () => {
    const local = await renderScreen(status({ cognition_authority: 'local' }));
    expect(local.getByTestId('desktop-sync-cognition-authority').props.children).toBe('cognitionLocal');

    const remote = await renderScreen(status({ cognition_authority: 'phone-9' }));
    expect(remote.getByTestId('desktop-sync-cognition-authority').props.children).toBe(
      'cognitionDevice:{"device":"phone-9"}',
    );

    const paused = await renderScreen(status({ cognition_authority: 'local', narration_paused: true }));
    expect(paused.getByTestId('desktop-sync-narration-paused')).toBeTruthy();
  });

  it('renders the connection-status hero (3-5b design-language parity)', async () => {
    const utils = await renderScreen();
    expect(utils.getByTestId('desktop-sync-hero')).toBeTruthy();
    expect(utils.getByTestId('desktop-sync-state')).toBeTruthy();
  });

  it('shows actionable recovery copy when the desktop rejects the pairing', async () => {
    const utils = await renderScreen(status({ state: 'rejected', last_error: 'syncclient: no common sync protocol (SYNC_REJECT)' }));
    expect(utils.getByTestId('desktop-sync-state').props.children).toBe('state_rejected');
    expect(utils.getByTestId('desktop-sync-rejected-hint')).toBeTruthy();
  });

  it('warns about buffered pending writes', async () => {
    const utils = await renderScreen(status({ pending_writes: 4 }));
    expect(utils.getByTestId('desktop-sync-pending-writes')).toBeTruthy();
  });

  it('connects with the form config when the button is pressed', async () => {
    mockUpdate.mockResolvedValue(status());
    const utils = await renderScreen();
    await act(async () => {
      fireEvent.press(utils.getByTestId('desktop-sync-connect'));
    });
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        enabled: true,
        transport: 'lan',
        peer_address: '192.168.1.10:28080',
        security_mode: 'secure',
      }),
    );
  });

  it('disconnects via the disconnect button', async () => {
    mockDisconnect.mockResolvedValue(status({ state: 'stopped' }));
    const utils = await renderScreen();
    await act(async () => {
      fireEvent.press(utils.getByTestId('desktop-sync-disconnect'));
    });
    expect(mockDisconnect).toHaveBeenCalled();
  });

  it('confirms before handing over authority and calls yield', async () => {
    mockYield.mockResolvedValue({ status: 'ok', state: 'syncing' });
    mockShowAlert.mockImplementation((_t: string, _m: string, buttons: any[]) => {
      const confirm = buttons?.find(b => b.text === 'yieldConfirm');
      confirm?.onPress?.();
    });
    const utils = await renderScreen(status({ state: 'syncing' }));
    await act(async () => {
      fireEvent.press(utils.getByTestId('desktop-sync-yield'));
    });
    expect(mockShowAlert).toHaveBeenCalled();
    expect(mockYield).toHaveBeenCalled();
  });

  it('warns about pending writes before disabling', async () => {
    const utils = await renderScreen(status({ pending_writes: 2 }));
    await act(async () => {
      fireEvent.press(utils.getByTestId('desktop-sync-disable'));
    });
    expect(mockShowAlert).toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  // ── 7-3: transport picker + cloud surface ──────────────────────────────

  it('switches to the cloud transport and surfaces the relay + pairing UI', async () => {
    const utils = await renderScreen();
    expect(utils.queryByTestId('desktop-sync-relay-url')).toBeNull();
    await act(async () => {
      fireEvent.press(utils.getByTestId('desktop-sync-transport-relay'));
    });
    expect(utils.getByTestId('desktop-sync-relay-url')).toBeTruthy();
    expect(utils.getByTestId('desktop-sync-device-id')).toBeTruthy();
    expect(utils.getByTestId('desktop-sync-dataset-id')).toBeTruthy();
    expect(utils.getByTestId('desktop-sync-pair-button')).toBeTruthy();
    expect(utils.getByTestId('desktop-sync-scan-button')).toBeTruthy();
    expect(utils.getByTestId('desktop-sync-start-cloud-sync')).toBeTruthy();
  });

  it('renders the relay status block (quota rows + seq) in cloud mode', async () => {
    const utils = await renderScreen(
      status({
        config: { ...status().config, transport: 'relay', relay_url: 'wss://sync.test/v1/sync/ws' },
        relay: {
          connected: true,
          auth_needed: false,
          last_seq: 12,
          last_seq_age_ms: 500,
          acked_seq: 10,
          buffered_frames: 2,
          buffered_bytes: 2048,
          cap: 4096,
          overflow: false,
          rejected_frames: 0,
          decrypt_failures: 0,
          sync_buffer_mb: 64,
          sync_devices: 3,
          backup_storage_mb: 1024,
        },
      }),
    );
    expect(utils.getByTestId('desktop-sync-relay-status')).toBeTruthy();
    expect(utils.getByTestId('desktop-sync-relay-seq').props.children.join('')).toBe('12 / 10');
    // Plan 7-6: the tier device cap + buffer usage render proactively.
    expect(utils.getByTestId('desktop-sync-relay-devices').props.children).toBe(
      'relayDevicesUpTo:{"count":3}',
    );
    expect(utils.getByTestId('desktop-sync-relay-buffered').props.children.join('')).toBe('2 KB / 4 KB');
    expect(utils.getByTestId('desktop-sync-relay-buffered').props.style).toBeUndefined();
  });

  it('shows "unlimited" for the device cap and buffer when the tier quotas are 0', async () => {
    const utils = await renderScreen(
      status({
        config: { ...status().config, transport: 'relay', relay_url: 'wss://sync.test/v1/sync/ws' },
        relay: {
          connected: true,
          auth_needed: false,
          last_seq: 0,
          last_seq_age_ms: 0,
          acked_seq: 0,
          buffered_frames: 0,
          buffered_bytes: 0,
          cap: 0,
          overflow: false,
          rejected_frames: 0,
          decrypt_failures: 0,
          sync_buffer_mb: 0,
          sync_devices: 0,
          backup_storage_mb: 0,
        },
      }),
    );
    expect(utils.getByTestId('desktop-sync-relay-devices').props.children).toBe('relayUnlimited');
    expect(utils.getByTestId('desktop-sync-relay-buffered').props.children.join('')).toBe('0 MB / relayUnlimited');
  });

  it('escalates the buffer row when the relay buffer has overflowed', async () => {
    const utils = await renderScreen(
      status({
        config: { ...status().config, transport: 'relay', relay_url: 'wss://sync.test/v1/sync/ws' },
        relay: {
          connected: true,
          auth_needed: false,
          last_seq: 0,
          last_seq_age_ms: 0,
          acked_seq: 0,
          buffered_frames: 5,
          buffered_bytes: 8192,
          cap: 4096,
          overflow: true,
          rejected_frames: 0,
          decrypt_failures: 0,
          sync_buffer_mb: 64,
          sync_devices: 3,
          backup_storage_mb: 1024,
        },
      }),
    );
    const buffered = utils.getByTestId('desktop-sync-relay-buffered');
    expect(buffered.props.children.join('')).toBe('8 KB / 4 KB');
    // The row ties into the existing warning styling when overflowed.
    expect(buffered.props.style).toBeTruthy();
  });

  it('hides the quota rows when there is no relay snapshot (LAN mode)', async () => {
    const utils = await renderScreen();
    expect(utils.queryByTestId('desktop-sync-relay-status')).toBeNull();
    expect(utils.queryByTestId('desktop-sync-relay-devices')).toBeNull();
    expect(utils.queryByTestId('desktop-sync-relay-buffered')).toBeNull();
  });

  it('pairs from a pasted code: PUTs the relay config with the transient pairing token', async () => {
    mockUpdate.mockResolvedValue(status());
    const utils = await renderScreen();
    await act(async () => {
      fireEvent.press(utils.getByTestId('desktop-sync-transport-relay'));
    });
    const code = JSON.stringify({
      relay_url: 'wss://sync.test/v1/sync/ws',
      pairing_token: 'tok-1',
      account_hint: 'user@example.com',
    });
    await act(async () => {
      fireEvent.changeText(utils.getByTestId('desktop-sync-pairing-code'), code);
    });
    await act(async () => {
      fireEvent.press(utils.getByTestId('desktop-sync-pair-button'));
    });
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        transport: 'relay',
        relay_url: 'wss://sync.test/v1/sync/ws',
        pairing_token: 'tok-1',
        relay_token: 'PASETO',
        enabled: true,
      }),
    );
  });

  it('rejects a pairing code minted for another account', async () => {
    (AuthService.getProfile as jest.Mock).mockResolvedValueOnce({
      id: 'uid-1',
      email: 'other@example.com',
      display_name: 'Other',
    });
    const utils = await renderScreen();
    await act(async () => {
      fireEvent.press(utils.getByTestId('desktop-sync-transport-relay'));
    });
    await act(async () => {
      fireEvent.changeText(
        utils.getByTestId('desktop-sync-pairing-code'),
        JSON.stringify({ relay_url: 'wss://x/v1/sync/ws', pairing_token: 't', account_hint: 'someone@else.com' }),
      );
    });
    await act(async () => {
      fireEvent.press(utils.getByTestId('desktop-sync-pair-button'));
    });
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockShowToast).toHaveBeenCalledWith('pairingAccountMismatch');
  });

  // ── 7-3 follow-up: QR camera scanning (react-native-camera-kit) ────────

  it('opens the QR scanner modal when camera permission is granted', async () => {
    const utils = await renderScreen();
    await act(async () => {
      fireEvent.press(utils.getByTestId('desktop-sync-transport-relay'));
    });
    await act(async () => {
      fireEvent.press(utils.getByTestId('desktop-sync-scan-button'));
    });
    expect(mockCheckAndRequestPermission).toHaveBeenCalledWith('android.permission.CAMERA');
    expect(utils.getByTestId('mock-camera')).toBeTruthy();
    expect(utils.getByTestId('qr-scanner-hint')).toBeTruthy();
  });

  it('pairs from a scanned code via the shared parse → verify → configure path', async () => {
    mockUpdate.mockResolvedValue(status());
    const utils = await renderScreen();
    await act(async () => {
      fireEvent.press(utils.getByTestId('desktop-sync-transport-relay'));
    });
    await act(async () => {
      fireEvent.press(utils.getByTestId('desktop-sync-scan-button'));
    });
    const code = JSON.stringify({
      relay_url: 'wss://sync.test/v1/sync/ws',
      pairing_token: 'scan-tok',
      account_hint: 'user@example.com',
    });
    await act(async () => {
      fireEvent(utils.getByTestId('mock-camera'), 'readCode', {
        nativeEvent: { codeStringValue: code },
      });
    });
    await waitFor(() =>
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          transport: 'relay',
          relay_url: 'wss://sync.test/v1/sync/ws',
          pairing_token: 'scan-tok',
          relay_token: 'PASETO',
          enabled: true,
        }),
      ),
    );
    // The scanner closed itself once a code was read.
    expect(utils.queryByTestId('mock-camera')).toBeNull();
  });

  it('shows the parse-error copy when the scanned QR is not a pairing code', async () => {
    const utils = await renderScreen();
    await act(async () => {
      fireEvent.press(utils.getByTestId('desktop-sync-transport-relay'));
    });
    await act(async () => {
      fireEvent.press(utils.getByTestId('desktop-sync-scan-button'));
    });
    await act(async () => {
      fireEvent(utils.getByTestId('mock-camera'), 'readCode', {
        nativeEvent: { codeStringValue: 'totally not a pairing code' },
      });
    });
    expect(mockShowToast).toHaveBeenCalledWith(expect.stringContaining('pairingFailed'));
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('falls back to manual paste when camera permission is denied', async () => {
    mockCheckAndRequestPermission.mockResolvedValueOnce(false);
    const utils = await renderScreen();
    await act(async () => {
      fireEvent.press(utils.getByTestId('desktop-sync-transport-relay'));
    });
    await act(async () => {
      fireEvent.press(utils.getByTestId('desktop-sync-scan-button'));
    });
    expect(mockShowAlert).toHaveBeenCalledWith(
      'scanPermissionTitle',
      'scanPermissionMessage',
      expect.any(Array),
      expect.objectContaining({ icon: 'camera-off' }),
    );
    // The scanner never opened.
    expect(utils.queryByTestId('mock-camera')).toBeNull();
  });

  it('starts cloud sync from the group card when uninitialized', async () => {
    mockStartCloudSync.mockResolvedValue({ action: 'created' });
    const utils = await renderScreen();
    await act(async () => {
      fireEvent.press(utils.getByTestId('desktop-sync-transport-relay'));
    });
    await act(async () => {
      fireEvent.press(utils.getByTestId('desktop-sync-start-cloud-sync'));
    });
    expect(mockStartCloudSync).toHaveBeenCalled();
  });

  it('offers "finish joining" when the engine is key_pending', async () => {
    mockJoinCloudSync.mockResolvedValue({ action: 'joined' });
    const utils = await renderScreen(status({ sync_group: 'key_pending' }));
    await act(async () => {
      fireEvent.press(utils.getByTestId('desktop-sync-transport-relay'));
    });
    await act(async () => {
      fireEvent.press(utils.getByTestId('desktop-sync-join-cloud-sync'));
    });
    expect(mockJoinCloudSync).toHaveBeenCalled();
  });

  it('shows the rotation banner and resets the key on confirm', async () => {
    mockResetSyncKey.mockResolvedValue({ state: 'member', has_key: true, rotation_required: false });
    mockShowAlert.mockImplementation((_t: string, _m: string, buttons: any[]) => {
      buttons?.find(b => b.text === 'resetKeyConfirm')?.onPress?.();
    });
    const utils = await renderScreen(status({ rotation_required: true }));
    await act(async () => {
      fireEvent.press(utils.getByTestId('desktop-sync-transport-relay'));
    });
    expect(utils.getByTestId('desktop-sync-rotation-banner')).toBeTruthy();
    await act(async () => {
      fireEvent.press(utils.getAllByTestId('desktop-sync-reset-key')[0]);
    });
    expect(mockResetSyncKey).toHaveBeenCalled();
  });

  it('auto-recovers auth_needed by re-injecting a fresh relay token', async () => {
    mockUpdate.mockResolvedValue(status());
    await renderScreen(
      status({
        state: 'auth_needed',
        config: { ...status().config, transport: 'relay', relay_url: 'wss://sync.test/v1/sync/ws' },
        relay: {
          connected: false,
          auth_needed: true,
          last_seq: 0,
          last_seq_age_ms: 0,
          acked_seq: 0,
          buffered_frames: 0,
          buffered_bytes: 0,
          cap: 0,
          overflow: false,
          rejected_frames: 0,
          decrypt_failures: 0,
          sync_buffer_mb: 0,
          sync_devices: 0,
          backup_storage_mb: 0,
        },
      }),
    );
    await waitFor(() =>
      expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ relay_token: 'PASETO' })),
    );
    expect(AuthService.refresh).toHaveBeenCalled();
  });

  it('shows the quota-exceeded banner', async () => {
    const utils = await renderScreen(status({ state: 'quota_exceeded' }));
    expect(utils.getByTestId('desktop-sync-quota')).toBeTruthy();
  });
});
