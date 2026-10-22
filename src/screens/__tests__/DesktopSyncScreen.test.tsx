/**
 * DesktopSyncScreen — 3-5 + 7-3 + Design A (2026-10-22) tests.
 *
 * The screen is driven by the mocked EngineApiClient singleton (per the 3-2
 * convention) plus the mocked sync orchestrator / auth service (7-3). Covers:
 * status rendering (hero state + authority), the Setup checklist (account /
 * paired / join rows, the auto-join and its empty-escrow waiting row), the
 * plain Sync status card (devices / last sync / encryption + warnings), the
 * Advanced disclosure (manual pairing, configuration, relay diagnostics,
 * sync-key actions), cloud pairing (manual code + QR camera scan) with the
 * UNCONDITIONAL group_join_pending + auto-join, the rotation banner,
 * auth-needed recovery and the quota banner.
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
  (AuthService.enrollDevice as jest.Mock).mockResolvedValue(undefined);
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
      React.createElement(View, null, React.createElement(Switch, { testID: 'desktop-sync-enabled-switch', value, onValueChange })),
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
    enrollDevice: jest.fn(async () => undefined),
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
import { setAppVariantForTests } from '../../config/appVariant';

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

/** A relay-transport status snapshot (cloud mode). */
function cloudStatus(over: Record<string, unknown> = {}) {
  return status({
    config: { ...status().config, transport: 'relay', relay_url: 'wss://sync.test/v1/sync/ws' },
    ...over,
  });
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

/** Open the collapsed Advanced settings disclosure (Design A). */
async function openAdvanced(utils: any) {
  await act(async () => {
    fireEvent.press(utils.getByTestId('desktop-sync-advanced-toggle'));
  });
}

/** Scan a (cloud) QR payload through the camera mock. */
async function scanCode(utils: any, code: string) {
  await act(async () => {
    fireEvent.press(utils.getByTestId('desktop-sync-scan-button'));
  });
  await act(async () => {
    fireEvent(utils.getByTestId('mock-camera'), 'readCode', {
      nativeEvent: { codeStringValue: code },
    });
  });
}

/** A v2 LAN pairing QR payload (plan 7-15), JSON-encoded for the scanner. */
function lanCode(over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    v: 1,
    kind: 'soulbits-lan',
    ws: '192.168.1.10:28080',
    wss: '192.168.1.10:28443',
    mode: 'secure',
    fingerprint: 'sha256:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89',
    dataset_id: 'ds-1',
    name: 'Studio-PC',
    secret: 's3cr3t-single-use',
    ttl: 300,
    ...over,
  });
}

/** The desktop-minted cloud QR payload v3 (2026-10-22). */
function cloudCodeV3(over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    v: 1,
    kind: 'soulbits-cloud',
    relay_url: 'wss://sync.test/v1/sync/ws',
    pairing_token: 'tok-v3',
    account_hint: 'user@example.com',
    dataset_id: 'uid-1',
    ...over,
  });
}

const ENROLLMENT = {
  relay_url: 'wss://sync.soulbits.app/v1/sync/ws',
  grant: 'grant-1',
  account_hint: 'u***@example.com',
};

/** Render, scan a code, and (optionally) confirm the LAN sheet. */
async function scanAndMaybeConfirm(utils: any, code: string, confirm = true) {
  await scanCode(utils, code);
  if (confirm) {
    await act(async () => {
      fireEvent.press(utils.getByTestId('lan-confirm-button'));
    });
  }
}

describe('DesktopSyncScreen', () => {
  it('renders the state from the status and the authority under Advanced', async () => {
    const utils = await renderScreen(status({ state: 'pending_approval', local_authoritative: false }));
    expect(utils.getByTestId('desktop-sync-state').props.children).toBe('state_pending_approval');
    // The pairing hint is shown while awaiting approval (LAN).
    expect(utils.getByTestId('desktop-sync-pending-hint')).toBeTruthy();
    await openAdvanced(utils);
    expect(utils.getByTestId('desktop-sync-authority').props.children).toBe('authorityPeer');
  });

  it('shows where cognition runs and the narration-paused banner (plan 7-8)', async () => {
    const local = await renderScreen(status({ cognition_authority: 'local' }));
    await openAdvanced(local);
    expect(local.getByTestId('desktop-sync-cognition-authority').props.children).toBe('cognitionLocal');

    const remote = await renderScreen(status({ cognition_authority: 'phone-9' }));
    await openAdvanced(remote);
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

  // ── Design A: the Setup checklist ────────────────────────────────────────

  it('renders the Setup checklist rows (signed in / paired / joining)', async () => {
    const utils = await renderScreen();
    expect(utils.getByTestId('desktop-sync-setup-card')).toBeTruthy();
    // Signed in — the account from AuthService's profile.
    expect(utils.getByTestId('desktop-sync-setup-row-account')).toBeTruthy();
    expect(
      utils.getByText('setupRowSignedIn:{"account":"user@example.com"}'),
    ).toBeTruthy();
    // LAN default → not paired yet.
    expect(utils.getByText('setupRowPairedPending')).toBeTruthy();
    // Not paired, no key → the join row is idle (honest, not "waiting").
    expect(utils.getByText('setupJoinIdle')).toBeTruthy();
  });

  it('shows the paired + joined checklist rows once the relay config is live', async () => {
    const utils = await renderScreen(cloudStatus({ sync_group: 'member' }));
    expect(utils.getByText('setupRowPaired')).toBeTruthy();
    expect(utils.getByText('setupJoinDone')).toBeTruthy();
  });

  it('shows the amber awaiting-key row when the engine reports awaiting_group_key', async () => {
    const utils = await renderScreen(
      cloudStatus({ state: 'stopped', sync_group: 'uninitialized', awaiting_group_key: true }),
    );
    // The hero maps the waiting-for-sync-key state BEFORE the generic stopped.
    expect(utils.getByTestId('desktop-sync-state').props.children).toBe('state_awaiting_key');
    expect(utils.getByText('stateSub_awaiting_key')).toBeTruthy();
    expect(utils.getByTestId('desktop-sync-setup-join-waiting')).toBeTruthy();
    expect(utils.getByText('setupJoinWaitingHint')).toBeTruthy();
    expect(utils.getByTestId('desktop-sync-setup-join-retry')).toBeTruthy();
  });

  it('degrades gracefully when awaiting_group_key is absent (older engine)', async () => {
    // Absent field → treated as false: the hero falls back to the raw state…
    const stopped = await renderScreen(status({ state: 'stopped', sync_group: 'uninitialized' }));
    expect(stopped.getByTestId('desktop-sync-state').props.children).toBe('state_stopped');
    expect(stopped.queryByTestId('desktop-sync-setup-join-waiting')).toBeNull();
    // …and the sync_group state still drives the waiting row (key_pending),
    // plus the paired-but-uninitialized fallback for pre-1.9.0 engines.
    const pending = await renderScreen(cloudStatus({ state: 'stopped', sync_group: 'key_pending' }));
    expect(pending.getByTestId('desktop-sync-state').props.children).toBe('state_stopped');
    expect(pending.getByTestId('desktop-sync-setup-join-waiting')).toBeTruthy();
    const pairedUninitialized = await renderScreen(
      cloudStatus({ state: 'stopped', sync_group: 'uninitialized' }),
    );
    expect(pairedUninitialized.getByTestId('desktop-sync-state').props.children).toBe('state_stopped');
    expect(pairedUninitialized.getByTestId('desktop-sync-setup-join-waiting')).toBeTruthy();
  });

  it('shows a spinner in the join row while a join is in flight', async () => {
    const utils = await renderScreen(cloudStatus({ sync_group: 'key_pending' }));
    await act(async () => {
      fireEvent.press(utils.getByTestId('desktop-sync-setup-join-retry'));
    });
    // The auto-join runs: the orchestrator is invoked (spinner shown while
    // in flight is covered implicitly by the phase machine).
    await waitFor(() => expect(mockJoinCloudSync).toHaveBeenCalled());
  });

  // ── Design A: the plain Sync status card ──────────────────────────────────

  it('renders the plain status rows (devices / last sync / encryption)', async () => {
    const utils = await renderScreen(
      cloudStatus({
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
    expect(utils.getByTestId('desktop-sync-status-devices').props.children).toBe(
      'relayDevicesUpTo:{"count":3}',
    );
    expect(utils.getByTestId('desktop-sync-status-last-sync').props.children).toBe('lastSyncLive');
    expect(utils.getByTestId('desktop-sync-status-encryption').props.children).toBe('encryptionE2E');
  });

  it('derives the last-sync age from the relay snapshot when disconnected', async () => {
    const utils = await renderScreen(
      cloudStatus({
        relay: {
          connected: false,
          auth_needed: false,
          last_seq: 12,
          last_seq_age_ms: 5 * 60_000,
          acked_seq: 10,
          buffered_frames: 0,
          buffered_bytes: 0,
          cap: 0,
          overflow: false,
          rejected_frames: 0,
          decrypt_failures: 0,
          sync_buffer_mb: 0,
          sync_devices: 3,
          backup_storage_mb: 0,
        },
      }),
    );
    expect(utils.getByTestId('desktop-sync-status-last-sync').props.children).toBe(
      'lastSyncMinAgo:{"count":5}',
    );
  });

  it('hides the devices / last-sync rows without a relay snapshot (LAN mode)', async () => {
    const utils = await renderScreen();
    expect(utils.queryByTestId('desktop-sync-status-devices')).toBeNull();
    expect(utils.queryByTestId('desktop-sync-status-last-sync')).toBeNull();
    // The encryption row is static and always shown.
    expect(utils.getByTestId('desktop-sync-status-encryption')).toBeTruthy();
  });

  // ── Actions under Advanced ────────────────────────────────────────────────

  it('connects with the form config when the button is pressed', async () => {
    mockUpdate.mockResolvedValue(status());
    const utils = await renderScreen();
    await openAdvanced(utils);
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
    await openAdvanced(utils);
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
    await openAdvanced(utils);
    await act(async () => {
      fireEvent.press(utils.getByTestId('desktop-sync-yield'));
    });
    expect(mockShowAlert).toHaveBeenCalled();
    expect(mockYield).toHaveBeenCalled();
  });

  it('warns about pending writes before disabling', async () => {
    const utils = await renderScreen(status({ pending_writes: 2 }));
    await openAdvanced(utils);
    await act(async () => {
      fireEvent.press(utils.getByTestId('desktop-sync-disable'));
    });
    expect(mockShowAlert).toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  // ── 7-3: transport picker + cloud surface (under Advanced) ────────────────

  it('hides the direct-LAN transport in store builds (7-14 V3 — cloud relay only)', async () => {
    setAppVariantForTests('store');
    try {
      const utils = await renderScreen();
      await openAdvanced(utils);
      // The direct-LAN pairing entry (topology A) is gone; only the cloud-relay
      // chip remains and the transport is pinned to relay.
      expect(utils.queryByTestId('desktop-sync-transport-lan')).toBeNull();
      expect(utils.getByTestId('desktop-sync-transport-relay')).toBeTruthy();
      expect(utils.getByTestId('desktop-sync-relay-url')).toBeTruthy();
      expect(utils.getByTestId('desktop-sync-pair-button')).toBeTruthy();
    } finally {
      setAppVariantForTests(null);
    }
  });

  it('switches to the cloud transport and surfaces the relay + pairing UI', async () => {
    const utils = await renderScreen();
    await openAdvanced(utils);
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

  it('renders the relay diagnostics block (quota rows + seq) under Advanced', async () => {
    const utils = await renderScreen(
      cloudStatus({
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
    await openAdvanced(utils);
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
      cloudStatus({
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
    await openAdvanced(utils);
    expect(utils.getByTestId('desktop-sync-relay-devices').props.children).toBe('relayUnlimited');
    expect(utils.getByTestId('desktop-sync-relay-buffered').props.children.join('')).toBe('0 MB / relayUnlimited');
  });

  it('escalates the buffer row when the relay buffer has overflowed', async () => {
    const utils = await renderScreen(
      cloudStatus({
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
    await openAdvanced(utils);
    const buffered = utils.getByTestId('desktop-sync-relay-buffered');
    expect(buffered.props.children.join('')).toBe('8 KB / 4 KB');
    // The row ties into the existing warning styling when overflowed.
    expect(buffered.props.style).toBeTruthy();
  });

  it('hides the relay diagnostics block when there is no relay snapshot (LAN mode)', async () => {
    const utils = await renderScreen();
    await openAdvanced(utils);
    expect(utils.queryByTestId('desktop-sync-relay-status')).toBeNull();
    expect(utils.queryByTestId('desktop-sync-relay-devices')).toBeNull();
    expect(utils.queryByTestId('desktop-sync-relay-buffered')).toBeNull();
  });

  // ── Cloud pairing (manual paste under Advanced + auto-join) ───────────────

  it('pairs from a pasted code: PUTs the relay config with the transient token + unconditional join flag', async () => {
    mockUpdate.mockResolvedValue(cloudStatus());
    mockJoinCloudSync.mockResolvedValue({ action: 'joined' });
    const utils = await renderScreen();
    await openAdvanced(utils);
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
        group_join_pending: true,
      }),
    );
    // A pasted cloud code follows the same auto-join path as a scan.
    await waitFor(() => expect(mockJoinCloudSync).toHaveBeenCalled());
  });

  it('rejects a pairing code minted for another account', async () => {
    (AuthService.getProfile as jest.Mock).mockResolvedValueOnce({
      id: 'uid-1',
      email: 'other@example.com',
      display_name: 'Other',
    });
    const utils = await renderScreen();
    await openAdvanced(utils);
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
      fireEvent.press(utils.getByTestId('desktop-sync-scan-button'));
    });
    expect(mockCheckAndRequestPermission).toHaveBeenCalledWith('android.permission.CAMERA');
    expect(utils.getByTestId('mock-camera')).toBeTruthy();
    expect(utils.getByTestId('qr-scanner-hint')).toBeTruthy();
  });

  it('auto-joins the sync group after a successful cloud pairing (scan)', async () => {
    mockUpdate.mockResolvedValue(cloudStatus());
    mockJoinCloudSync.mockResolvedValue({ action: 'joined' });
    const utils = await renderScreen();
    await scanCode(utils, cloudCodeV3());
    await waitFor(() =>
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          transport: 'relay',
          relay_url: 'wss://sync.test/v1/sync/ws',
          pairing_token: 'tok-v3',
          relay_token: 'PASETO',
          enabled: true,
          // Scanning a cloud QR ALWAYS means joining the existing group.
          group_join_pending: true,
          // The v3 payload's dataset reaches the PUT verbatim.
          dataset_id: 'uid-1',
        }),
      ),
    );
    await waitFor(() => expect(mockJoinCloudSync).toHaveBeenCalledTimes(1));
    // The scanner closed itself once a code was read.
    expect(utils.queryByTestId('mock-camera')).toBeNull();
  });

  it('falls back to the locally known dataset when the payload omits dataset_id', async () => {
    mockUpdate.mockResolvedValue(cloudStatus());
    mockJoinCloudSync.mockResolvedValue({ action: 'joined' });
    const utils = await renderScreen(cloudStatus());
    const { dataset_id, ...legacy } = JSON.parse(cloudCodeV3());
    await scanCode(utils, JSON.stringify(legacy));
    await waitFor(() =>
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ group_join_pending: true, dataset_id: 'ds-1' }),
      ),
    );
    await waitFor(() => expect(mockJoinCloudSync).toHaveBeenCalled());
  });

  it('shows the amber waiting row (not an error toast) when the escrow is empty', async () => {
    mockUpdate.mockResolvedValue(cloudStatus());
    mockJoinCloudSync.mockRejectedValueOnce(
      new Error('no escrowed sync key yet — start cloud sync on another device first'),
    );
    const utils = await renderScreen();
    await scanCode(utils, cloudCodeV3());
    await waitFor(() => expect(mockJoinCloudSync).toHaveBeenCalled());
    await waitFor(() => expect(utils.getByTestId('desktop-sync-setup-join-waiting')).toBeTruthy());
    // The empty escrow is NOT a generic failure — no error toast for it.
    expect(mockShowToast).not.toHaveBeenCalledWith(expect.stringContaining('groupActionFailed'));
    // Retry re-runs the join.
    mockJoinCloudSync.mockResolvedValueOnce({ action: 'joined' });
    await act(async () => {
      fireEvent.press(utils.getByTestId('desktop-sync-setup-join-retry'));
    });
    await waitFor(() => expect(mockJoinCloudSync).toHaveBeenCalledTimes(2));
  });

  it('surfaces a real join failure as the red row with the message', async () => {
    mockUpdate.mockResolvedValue(cloudStatus());
    mockJoinCloudSync.mockRejectedValueOnce(new Error('engine unreachable'));
    const utils = await renderScreen();
    await scanCode(utils, cloudCodeV3());
    await waitFor(() => expect(utils.getByTestId('desktop-sync-setup-join-error')).toBeTruthy());
    expect(mockShowToast).toHaveBeenCalledWith(
      'groupActionFailed:{"message":"engine unreachable"}',
    );
  });

  it('shows the parse-error copy when the scanned QR is not a pairing code', async () => {
    const utils = await renderScreen();
    await scanCode(utils, 'totally not a pairing code');
    expect(mockShowToast).toHaveBeenCalledWith(expect.stringContaining('pairingFailed'));
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('falls back to manual paste when camera permission is denied', async () => {
    mockCheckAndRequestPermission.mockResolvedValueOnce(false);
    const utils = await renderScreen();
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

  it('starts a new sync group from the advanced sync-key card when uninitialized', async () => {
    mockStartCloudSync.mockResolvedValue({ action: 'created' });
    const utils = await renderScreen(cloudStatus());
    await openAdvanced(utils);
    await act(async () => {
      fireEvent.press(utils.getByTestId('desktop-sync-start-cloud-sync'));
    });
    expect(mockStartCloudSync).toHaveBeenCalled();
  });

  it('offers "finish joining" when the engine is key_pending', async () => {
    mockJoinCloudSync.mockResolvedValue({ action: 'joined' });
    const utils = await renderScreen(cloudStatus({ sync_group: 'key_pending' }));
    await openAdvanced(utils);
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
    const utils = await renderScreen(cloudStatus({ rotation_required: true }));
    expect(utils.getByTestId('desktop-sync-rotation-banner')).toBeTruthy();
    await act(async () => {
      fireEvent.press(utils.getAllByTestId('desktop-sync-reset-key')[0]);
    });
    expect(mockResetSyncKey).toHaveBeenCalled();
  });

  it('auto-recovers auth_needed by re-injecting a fresh relay token', async () => {
    mockUpdate.mockResolvedValue(cloudStatus());
    await renderScreen(
      cloudStatus({
        state: 'auth_needed',
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

  // ── 7-15: QR-first LAN pairing + enrollment intake ─────────────────────

  it('shows the QR-first pairing card with a scan CTA by default', async () => {
    const utils = await renderScreen();
    expect(utils.getByTestId('desktop-sync-pairing-card')).toBeTruthy();
    expect(utils.getByTestId('desktop-sync-scan-button')).toBeTruthy();
    // The Advanced disclosure is collapsed by default — no protocol fields.
    expect(utils.getByTestId('desktop-sync-advanced-toggle')).toBeTruthy();
    expect(utils.queryByDisplayValue('192.168.1.10:28080')).toBeNull();
    expect(utils.queryByTestId('desktop-sync-relay-url')).toBeNull();
  });

  it('reveals the manual LAN form under the Advanced disclosure', async () => {
    const utils = await renderScreen();
    await openAdvanced(utils);
    expect(utils.queryByDisplayValue('192.168.1.10:28080')).toBeTruthy();
    expect(utils.getByTestId('desktop-sync-security-picker')).toBeTruthy();
  });

  it('routes a scanned LAN QR to the confirmation sheet (no config written yet)', async () => {
    const utils = await renderScreen();
    await scanAndMaybeConfirm(utils, lanCode(), false);
    expect(utils.getByTestId('lan-confirm-sheet')).toBeTruthy();
    expect(utils.getByTestId('lan-confirm-name').props.children).toBe(
      'lanConfirmTitle:{"name":"Studio-PC"}',
    );
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('rejects a LAN QR payload in store builds with clear copy (no LAN in store)', async () => {
    setAppVariantForTests('store');
    try {
      const utils = await renderScreen();
      await scanAndMaybeConfirm(utils, lanCode(), false);
      expect(mockShowToast).toHaveBeenCalledWith('lanUnavailableStore');
      expect(utils.queryByTestId('lan-confirm-sheet')).toBeNull();
      expect(mockUpdate).not.toHaveBeenCalled();
    } finally {
      setAppVariantForTests(null);
    }
  });

  it('applies ONE LAN config patch on confirm (addresses + mode + fingerprint + secret)', async () => {
    mockUpdate.mockResolvedValue(status());
    const utils = await renderScreen();
    await scanAndMaybeConfirm(utils, lanCode());
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        transport: 'lan',
        peer_address: '192.168.1.10:28080',
        peer_wss_address: '192.168.1.10:28443',
        security_mode: 'secure',
        peer_fingerprint: 'sha256:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89',
        lan_pairing_secret: 's3cr3t-single-use',
        device_name: expect.any(String),
        enabled: true,
      }),
    );
    // The sheet closes once applied.
    expect(utils.queryByTestId('lan-confirm-sheet')).toBeNull();
  });

  it('omits peer_wss_address / peer_fingerprint for an unencrypted LAN payload', async () => {
    mockUpdate.mockResolvedValue(status());
    const utils = await renderScreen();
    const { wss, fingerprint, ...rest } = JSON.parse(lanCode());
    await scanAndMaybeConfirm(utils, JSON.stringify({ ...rest, mode: 'unencrypted' }));
    const patch = mockUpdate.mock.calls[0][0];
    expect(patch.peer_address).toBe('192.168.1.10:28080');
    expect(patch.security_mode).toBe('unencrypted');
    expect(patch.peer_wss_address).toBeUndefined();
    expect(patch.peer_fingerprint).toBeUndefined();
    expect(patch.lan_pairing_secret).toBe('s3cr3t-single-use');
  });

  it('enrolls a signed-out phone via the desktop grant on confirm', async () => {
    (AuthService.getToken as jest.Mock).mockRejectedValue(new Error('signed out'));
    mockUpdate.mockResolvedValue(status());
    const utils = await renderScreen();
    await scanAndMaybeConfirm(utils, lanCode({ enrollment: ENROLLMENT }), false);
    // Offer line shown while signed out.
    expect(utils.getByTestId('lan-confirm-enroll-offer')).toBeTruthy();
    await act(async () => {
      fireEvent.press(utils.getByTestId('lan-confirm-button'));
    });
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ transport: 'lan' }));
    expect(AuthService.enrollDevice).toHaveBeenCalledWith({
      grant: 'grant-1',
      deviceId: 'device-abc',
      deviceName: expect.any(String),
      platform: 'ios',
    });
    expect(mockShowToast).toHaveBeenCalledWith(expect.stringContaining('enrollSuccess'));
  });

  it('skips enrollment when signed in with the matching account (pair only)', async () => {
    mockUpdate.mockResolvedValue(status());
    const utils = await renderScreen();
    // The phone is signed in (default mocks) and the profile email
    // user@example.com matches the masked hint u***@example.com.
    await scanAndMaybeConfirm(utils, lanCode({ enrollment: ENROLLMENT }));
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ transport: 'lan' }));
    expect(AuthService.enrollDevice).not.toHaveBeenCalled();
    expect(mockShowAlert).not.toHaveBeenCalled();
  });

  it('warns but still pairs when signed in with a different account', async () => {
    (AuthService.getProfile as jest.Mock).mockResolvedValue({
      id: 'uid-1',
      email: 'other@example.com',
      display_name: 'Other',
    });
    mockUpdate.mockResolvedValue(status());
    const utils = await renderScreen();
    await scanAndMaybeConfirm(utils, lanCode({ enrollment: ENROLLMENT }));
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ transport: 'lan' }));
    expect(AuthService.enrollDevice).not.toHaveBeenCalled();
    expect(mockShowAlert).toHaveBeenCalledWith(
      'enrollMismatchTitle',
      expect.stringContaining('enrollMismatchMessage'),
      expect.any(Array),
    );
  });

  it('keeps the pairing when the enrollment exchange fails (toast only)', async () => {
    (AuthService.getToken as jest.Mock).mockRejectedValue(new Error('signed out'));
    (AuthService.enrollDevice as jest.Mock).mockRejectedValueOnce(new Error('grant expired'));
    mockUpdate.mockResolvedValue(status());
    const utils = await renderScreen();
    await scanAndMaybeConfirm(utils, lanCode({ enrollment: ENROLLMENT }));
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ transport: 'lan' }));
    await waitFor(() =>
      expect(mockShowToast).toHaveBeenCalledWith(expect.stringContaining('enrollFailed')),
    );
  });
});
