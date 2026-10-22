import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  TextInput,
  RefreshControl,
  TouchableOpacity,
  Linking,
  Platform,
} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import DeviceInfo from 'react-native-device-info';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';
import { useAppTheme } from '../../contexts/ThemeContext';
import { useAppAlert } from '../../contexts/AppAlertContext';
import { useToast } from '../../contexts/AppToastContext';
import { ThemedText } from '../../components/themed/ThemedText';
import { ThemedView } from '../../components/themed/ThemedView';
import { ScreenHeader } from '../../components/themed/ScreenHeader';
import { ThemedButton } from '../../components/themed/ThemedButton';
import { ThemedCard } from '../../components/themed/ThemedCard';
import { SettingsToggleRow } from '../../components/settings/SettingsRows';
import { SelectPicker } from '../../components/config/SelectPicker';
import { QrScannerModal } from '../../components/modals/QrScannerModal';
import { LanPairingConfirmSheet } from '../../components/modals/LanPairingConfirmSheet';
import { engineApiClient } from '../../services/engine/EngineApiClient';
import { getEngineManifest, refreshUpdates } from '../../services/updates/UpdateAvailableService';
import type {
  SyncClientConfigPatchDto,
  SyncClientState,
  SyncClientStatusDto,
  SyncClientTransport,
  SyncGroupKeyStatusDto,
} from '../../services/engine/EngineApiClient';
import { syncGroupOrchestrator } from '../../services/sync/SyncGroupOrchestrator';
import {
  parseSyncPairingPayload,
  parseSyncPairingPayloadV2,
  accountHintMatches,
  maskedAccountHintMatches,
} from '../../services/sync/syncCloudTypes';
import type {
  LanEnrollment,
  LanSyncPairingPayload,
  SyncPairingPayload,
} from '../../services/sync/syncCloudTypes';
import AuthService from '../../services/auth/AuthService';
import { getDeviceId } from '../../services/cloud/DeviceIdProvider';
import { SYNC_RELAY } from '../../config/cloud';
import { isStoreVariant } from '../../config/appVariant';
import { createLogger } from '../../utils/logger';
import { formatBytes } from '../../utils/formatBytes';
import { hexToRgba } from '../../utils/colorUtils';
import { hapticLightPress } from '../../utils/haptics';
import { checkAndRequestPermission, openAppSettings, PERMISSIONS } from '../../utils/permissions';
import type { RootStackParamList } from '../../navigation/AppNavigator';

const log = createLogger('[DesktopSyncScreen]');

// Poll cadence while the screen is focused (design: ~2–5s).
const POLL_INTERVAL_MS = 3000;

// The three transport security modes (mirrors the engine's enum).
const SECURITY_MODES = [
  { id: 'secure', name: 'Secure (verified TLS)' },
  { id: 'insecure-ssl', name: 'Trusted certificate (self-signed)' },
  { id: 'unencrypted', name: 'Unencrypted (LAN only)' },
];

/** Short mode label + shield icon/colour for the security badge (recycled from
 *  the deleted ConnectionSetupScreen's read-only security row). */
function securityBadge(mode: string): { icon: string; color: string; label: string } {
  switch (mode) {
    case 'secure':
      return { icon: 'shield-check', color: '#4CAF50', label: 'Secure' };
    case 'insecure-ssl':
      return { icon: 'shield-alert', color: '#F0A23B', label: 'Trusted certificate' };
    case 'unencrypted':
      return { icon: 'shield-off', color: '#F44336', label: 'Unencrypted' };
    default:
      return { icon: 'shield-outline', color: '#8f8fa3', label: 'Unknown' };
  }
}

/** One-line safety copy per mode (translated). */
function securityModeHint(mode: string, t: (k: string) => string): string {
  switch (mode) {
    case 'secure':
      return t('securityHintSecure');
    case 'insecure-ssl':
      return t('securityHintInsecureSsl');
    case 'unencrypted':
      return t('securityHintUnencrypted');
    default:
      return '';
  }
}

/** State → badge colour + icon. */
function stateVisual(state: SyncClientState): { color: string; icon: string } {
  switch (state) {
    case 'syncing':
      return { color: '#4caf82', icon: 'cloud-check-outline' };
    case 'promoted':
      return { color: '#4caf82', icon: 'crown-outline' };
    case 'pending_approval':
      return { color: '#f0a23b', icon: 'account-clock-outline' };
    case 'pairing':
    case 'connecting':
      return { color: '#f0a23b', icon: 'cloud-refresh' };
    case 'backoff':
      return { color: '#f0a23b', icon: 'cloud-alert' };
    case 'auth_needed':
      return { color: '#f0a23b', icon: 'shield-refresh-outline' };
    case 'quota_exceeded':
      return { color: '#f44336', icon: 'cloud-lock-outline' };
    case 'rejected':
      return { color: '#f44336', icon: 'cloud-off-outline' };
    case 'idle':
      return { color: '#8f8fa3', icon: 'cloud-outline' };
    case 'stopped':
    default:
      return { color: '#8f8fa3', icon: 'cloud-off-outline' };
  }
}

/** The 11 states → i18n key. */
function stateLabelKey(state: SyncClientState): string {
  return `state_${state}`;
}

/** The 11 states → hero subtext i18n key. */
function stateSubtextKey(state: SyncClientState): string {
  return `stateSub_${state}`;
}

/** A labelled text field (recycled from the deleted ConnectionSetupScreen). */
const Field: React.FC<{
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  hint?: string;
  multiline?: boolean;
  editable?: boolean;
  backgroundColor: string;
  inputTextColor: string;
  inputPlaceholderColor: string;
  testID?: string;
}> = ({
  label,
  value,
  onChangeText,
  placeholder,
  hint,
  multiline,
  editable = true,
  backgroundColor,
  inputTextColor,
  inputPlaceholderColor,
  testID,
}) => (
  <View style={styles.fieldWrapper}>
    <ThemedText weight="medium" size={13} style={styles.fieldLabel}>
      {label}
    </ThemedText>
    <View style={[styles.fieldBody, { backgroundColor }]}>
      <TextInput
        style={[styles.fieldInput, { color: inputTextColor }, multiline && styles.fieldInputMultiline]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={inputPlaceholderColor}
        autoCapitalize="none"
        autoCorrect={false}
        multiline={multiline}
        editable={editable}
        testID={testID}
      />
    </View>
    {hint ? (
      <ThemedText variant="muted" size={11} style={styles.fieldHint}>
        {hint}
      </ThemedText>
    ) : null}
  </View>
);

/**
 * Transport chip row (LAN ↔ Cloud relay). In the store variant the direct-LAN
 * option is HIDDEN (plan 7-14 V3 / 7-12 topology map: Play is restricted to
 * B/C — cloud relay only) so the row collapses to the cloud-relay chip alone.
 */
const TransportPicker: React.FC<{
  value: SyncClientTransport;
  onChange: (v: SyncClientTransport) => void;
  theme: any;
  t: (k: string) => string;
  cloudOnly?: boolean;
}> = ({ value, onChange, theme, t, cloudOnly = false }) => {
  const options: { id: SyncClientTransport; label: string; icon: string }[] = [
    ...(cloudOnly
      ? []
      : [{ id: 'lan' as SyncClientTransport, label: t('transportLan'), icon: 'lan' }]),
    { id: 'relay', label: t('transportCloud'), icon: 'cloud-outline' },
  ];
  return (
    <View style={styles.transportRow}>
      {options.map(opt => {
        const active = value === opt.id;
        return (
          <TouchableOpacity
            key={opt.id}
            testID={`desktop-sync-transport-${opt.id}`}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            style={[
              styles.transportChip,
              {
                backgroundColor: active
                  ? hexToRgba(theme.colors.accent.primary, 0.18)
                  : theme.colors.background.base,
                borderColor: active ? theme.colors.accent.primary : theme.colors.border.default,
              },
            ]}
            onPress={() => {
              hapticLightPress();
              onChange(opt.id);
            }}
          >
            <Icon
              name={opt.icon}
              size={16}
              color={active ? theme.colors.accent.primary : theme.colors.text.muted}
            />
            <ThemedText
              size={13}
              weight={active ? 'medium' : 'normal'}
              style={{ color: active ? theme.colors.accent.primary : theme.colors.text.secondary }}
            >
              {opt.label}
            </ThemedText>
          </TouchableOpacity>
        );
      })}
    </View>
  );
};

/**
 * DesktopSyncScreen — the configuration + live status surface for the
 * changeset-v1 desktop↔phone sync (task 3-5), extended for the Soulbits Cloud
 * relay transport, QR/manual cloud pairing and sync-group key management
 * (task 7-3).
 *
 * 3-5b: the visual language is reconciled with the deleted rows-v1 screens —
 * the hero connection-status orb, the icon-labelled detail rows with dividers,
 * and the security shield badge are recycled from SyncSettingsScreen /
 * ConnectionSetupScreen. 7-3 keeps that language and adds the transport picker,
 * the relay status block and the sync-group / pairing cards.
 */
export const DesktopSyncScreen: React.FC = () => {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { t } = useTranslation('desktopSync');
  const { theme } = useAppTheme();
  const { showAlert } = useAppAlert();
  const { showToast } = useToast();

  const [status, setStatus] = useState<SyncClientStatusDto | null>(null);
  const [groupStatus, setGroupStatus] = useState<SyncGroupKeyStatusDto | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [rotationFlag, setRotationFlag] = useState(false);

  // Store variant: direct-LAN pairing (7-12 topology A) is hidden — the
  // transport is pinned to the cloud relay (B/C). Full variant unchanged.
  const storeVariant = isStoreVariant();

  // Form state (populated once from the first status read; polling never
  // clobbers in-progress edits).
  const [enabled, setEnabled] = useState(false);
  const [transport, setTransport] = useState<SyncClientTransport>(
    () => (isStoreVariant() ? 'relay' : 'lan'),
  );
  const [peerAddress, setPeerAddress] = useState('');
  const [peerWssAddress, setPeerWssAddress] = useState('');
  const [securityMode, setSecurityMode] = useState('secure');
  const [deviceName, setDeviceName] = useState('');
  const [relayUrl, setRelayUrl] = useState('');
  const [deviceId, setDeviceId] = useState('');
  const [datasetId, setDatasetId] = useState('');
  const [pairingCode, setPairingCode] = useState('');
  const [joinExisting, setJoinExisting] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [scannerVisible, setScannerVisible] = useState(false);
  // LAN QR flow (plan 7-15): the scanned payload awaiting confirmation, and the
  // manual-LAN form disclosure (QR-first UX — the form collapses under Advanced).
  const [pendingLan, setPendingLan] = useState<LanSyncPairingPayload | null>(null);
  const [lanSheetVisible, setLanSheetVisible] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [desktopArtifacts, setDesktopArtifacts] = useState<{
    windows_amd64: string;
    linux_amd64: string;
  } | null>(null);

  const formLoadedRef = useRef(false);
  const inFlightRef = useRef(false);
  const recoveringRef = useRef(false);
  const rotationRelayedRef = useRef(false);
  const scanProcessingRef = useRef(false);

  // Default the device name to the model name (best-effort; a test/mock
  // without getModel falls back).
  useEffect(() => {
    try {
      const model = (DeviceInfo as { getModel?: () => string }).getModel?.();
      if (model) setDeviceName(model);
    } catch {
      // ignore — the engine defaults the name
    }
    getDeviceId()
      .then(id => setDeviceId(prev => prev || id))
      .catch(() => {
        /* non-fatal */
      });
  }, []);

  /**
   * auth_needed auto-recovery (7-2/7-3): the engine hit relay close 4001
   * (bearer rejected) — refresh the account PASETO and re-PUT `relay_token`.
   * Guarded so a still-auth_needed status does not loop.
   */
  const recoverRelayAuth = useCallback(async () => {
    try {
      await AuthService.refresh().catch(() => false);
      const token = await AuthService.getToken();
      await engineApiClient.updateSyncClientConfig({ relay_token: token });
      log.info('relay auth refreshed');
    } catch (e) {
      log.warn('relay auth recovery failed:', e);
    }
  }, []);

  const applyStatus = useCallback(
    (next: SyncClientStatusDto) => {
      setStatus(next);
      setLoadError(null);
      if (!formLoadedRef.current) {
        formLoadedRef.current = true;
        setEnabled(next.config.enabled);
        // Store: never surface the (hidden) LAN transport even if the engine's
        // stored config says 'lan' — pin to relay.
        setTransport(storeVariant ? 'relay' : (next.config.transport || 'lan'));
        setPeerAddress(next.config.peer_address ?? '');
        setPeerWssAddress(next.config.peer_wss_address ?? '');
        setSecurityMode(next.config.security_mode || 'secure');
        setDeviceName(next.config.device_name || '');
        setRelayUrl(next.config.relay_url || SYNC_RELAY.defaultRelayUrl);
        setDeviceId(prev => prev || next.config.device_id || '');
        setDatasetId(next.config.dataset_id || next.dataset_id || '');
      }
      const needsAuth = next.state === 'auth_needed' || next.relay?.auth_needed === true;
      if (needsAuth && !recoveringRef.current) {
        recoveringRef.current = true;
        void recoverRelayAuth();
      } else if (!needsAuth) {
        recoveringRef.current = false;
      }
    },
    [recoverRelayAuth, storeVariant],
  );

  const refreshStatus = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      const next = await engineApiClient.getSyncClientStatus();
      applyStatus(next);
    } catch (e: any) {
      const message = e?.message ?? String(e);
      log.warn('status read failed:', message);
      setLoadError(message);
    } finally {
      inFlightRef.current = false;
    }
  }, [applyStatus]);

  const refreshGroupStatus = useCallback(async () => {
    try {
      const next = await syncGroupOrchestrator.keyStatus();
      setGroupStatus(next);
    } catch (e: any) {
      log.warn('group key-status read failed:', e?.message ?? String(e));
    }
  }, []);

  const refreshRotationFlag = useCallback(async () => {
    try {
      const required = await syncGroupOrchestrator.readRotationRequired();
      setRotationFlag(required);
      // Relay the portal flag to the engine once per episode (the engine is
      // authoritative for the actual rotation).
      if (required && !rotationRelayedRef.current) {
        rotationRelayedRef.current = true;
        await syncGroupOrchestrator.relayRotationRequired(true).catch(e => {
          log.warn('rotation-required relay failed:', e?.message ?? String(e));
          rotationRelayedRef.current = false;
        });
      } else if (!required) {
        rotationRelayedRef.current = false;
      }
    } catch (e: any) {
      log.warn('rotation-required read failed:', e?.message ?? String(e));
    }
  }, []);

  /**
   * Desktop-engine deep-link (plan 7-10 §4): the rejected state offers a
   * "download the latest desktop engine" link — the one place an engine
   * download is directly actionable for the user. Reads the release manifest.
   */
  const refreshDesktopArtifacts = useCallback(async () => {
    try {
      await refreshUpdates();
      setDesktopArtifacts(getEngineManifest()?.artifacts.desktop ?? null);
    } catch {
      // non-fatal — the link simply stays hidden
    }
  }, []);

  // Poll while the screen is focused.
  useFocusEffect(
    useCallback(() => {
      refreshStatus();
      refreshGroupStatus();
      refreshRotationFlag();
      void refreshDesktopArtifacts();
      AuthService.getToken()
        .then(() => setSignedIn(true))
        .catch(() => setSignedIn(false));
      const id = setInterval(refreshStatus, POLL_INTERVAL_MS);
      return () => clearInterval(id);
    }, [refreshStatus, refreshGroupStatus, refreshRotationFlag, refreshDesktopArtifacts]),
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([
      refreshStatus(),
      refreshGroupStatus(),
      refreshRotationFlag(),
      refreshDesktopArtifacts(),
    ]);
    setRefreshing(false);
  }, [refreshStatus, refreshGroupStatus, refreshRotationFlag, refreshDesktopArtifacts]);

  // Apply a config patch live; surface errors as a toast.
  const apply = useCallback(
    async (patch: Parameters<typeof engineApiClient.updateSyncClientConfig>[0]) => {
      setBusy(true);
      try {
        const next = await engineApiClient.updateSyncClientConfig(patch);
        setStatus(next);
        setEnabled(next.config.enabled);
        setTransport(storeVariant ? 'relay' : (next.config.transport || transport));
        formLoadedRef.current = true;
        return next;
      } catch (e: any) {
        const message = e?.message ?? String(e);
        log.error('update failed:', message);
        showToast(t('applyFailed', { message }));
        return null;
      } finally {
        setBusy(false);
      }
    },
    [showToast, t, transport, storeVariant],
  );

  const formPatch = useCallback(() => {
    // Store: the LAN transport is hidden, so always build the cloud-relay patch.
    if (transport === 'relay' || storeVariant) {
      return {
        transport: 'relay' as const,
        relay_url: relayUrl.trim(),
        device_id: deviceId.trim(),
        dataset_id: datasetId.trim(),
        device_name: deviceName.trim(),
      };
    }
    return {
      transport: 'lan' as const,
      peer_address: peerAddress.trim(),
      peer_wss_address: peerWssAddress.trim(),
      security_mode: securityMode,
      device_name: deviceName.trim(),
    };
  }, [transport, relayUrl, deviceId, datasetId, deviceName, peerAddress, peerWssAddress, securityMode, storeVariant]);

  const handleConnect = useCallback(async () => {
    hapticLightPress();
    await apply({ enabled: true, ...formPatch() });
  }, [apply, formPatch]);

  const handleToggleEnabled = useCallback(
    async (next: boolean) => {
      if (next) {
        setEnabled(true);
        await apply({ enabled: true, ...formPatch() });
        return;
      }
      // Disabling: warn about buffered writes when any are unforwarded.
      const pending = status?.pending_writes ?? 0;
      if (pending > 0) {
        showAlert(t('disableTitle'), t('disablePendingWrites', { count: pending }), [
          { text: t('common:cancel'), style: 'cancel', onPress: () => setEnabled(true) },
          {
            text: t('disableConfirm'),
            style: 'destructive',
            onPress: async () => {
              setEnabled(false);
              await apply({ enabled: false });
            },
          },
        ]);
        return;
      }
      setEnabled(false);
      await apply({ enabled: false });
    },
    [apply, formPatch, showAlert, status, t],
  );

  const handleDisconnect = useCallback(async () => {
    hapticLightPress();
    setBusy(true);
    try {
      const next = await engineApiClient.disconnectSyncClient();
      setStatus(next);
    } catch (e: any) {
      showToast(t('applyFailed', { message: e?.message ?? String(e) }));
    } finally {
      setBusy(false);
    }
  }, [showToast, t]);

  const handleYield = useCallback(() => {
    showAlert(t('yieldTitle'), t('yieldMessage'), [
      { text: t('common:cancel'), style: 'cancel' },
      {
        text: t('yieldConfirm'),
        onPress: async () => {
          setBusy(true);
          try {
            await engineApiClient.yieldSyncClient();
            showToast(t('yieldDone'));
            await refreshStatus();
          } catch (e: any) {
            showToast(t('yieldFailed', { message: e?.message ?? String(e) }));
          } finally {
            setBusy(false);
          }
        },
      },
    ]);
  }, [refreshStatus, showAlert, showToast, t]);

  /** Verify the cloud code's account hint, then PUT the relay config. */
  const applyCloudPairing = useCallback(
    async (payload: SyncPairingPayload) => {
      let token: string;
      try {
        token = await AuthService.getToken();
      } catch {
        showToast(t('pairingSignedOut'));
        return;
      }

      const profile = await AuthService.getProfile().catch(() => null);
      const identifiers = profile
        ? [profile.email, profile.username, profile.id].filter((v): v is string => !!v)
        : [];
      if (!accountHintMatches(payload.account_hint, identifiers)) {
        showToast(t('pairingAccountMismatch'));
        return;
      }

      setRelayUrl(payload.relay_url);
      const next = await apply({
        transport: 'relay',
        relay_url: payload.relay_url,
        pairing_token: payload.pairing_token,
        relay_token: token,
        device_id: deviceId.trim(),
        dataset_id: datasetId.trim(),
        group_join_pending: joinExisting,
        device_name: deviceName.trim(),
        enabled: true,
      });
      if (next) {
        showToast(t('pairingSuccess'));
        await Promise.all([refreshGroupStatus(), refreshRotationFlag()]);
      }
    },
    [
      apply,
      datasetId,
      deviceId,
      deviceName,
      joinExisting,
      refreshGroupStatus,
      refreshRotationFlag,
      showToast,
      t,
    ],
  );

  /**
   * Delegated enrollment intake (plan 7-15 §A4). Runs AFTER the LAN pairing
   * succeeded, so a failure never blocks pairing (surfaced as a toast):
   *   - signed out  → exchange the grant for this device's OWN session;
   *   - signed in, matching account (masked hint) → skip (just pair);
   *   - signed in, different account → warn (pairing proceeds, enrollment skipped).
   */
  const handleEnrollment = useCallback(
    async (enrollment: LanEnrollment) => {
      if (signedIn) {
        const profile = await AuthService.getProfile().catch(() => null);
        const identifiers = profile
          ? [profile.email, profile.username, profile.id].filter((v): v is string => !!v)
          : [];
        if (maskedAccountHintMatches(enrollment.account_hint, identifiers)) return;
        showAlert(
          t('enrollMismatchTitle'),
          t('enrollMismatchMessage', { account: enrollment.account_hint }),
          [{ text: t('common:ok') }],
        );
        return;
      }

      try {
        const id = await getDeviceId();
        await AuthService.enrollDevice({
          grant: enrollment.grant,
          deviceId: id,
          deviceName: deviceName.trim(),
          platform: Platform.OS,
        });
        setSignedIn(true);
        showToast(t('enrollSuccess', { account: enrollment.account_hint }));
      } catch (e: any) {
        showToast(t('enrollFailed', { message: e?.message ?? String(e) }));
      }
    },
    [deviceName, showAlert, showToast, signedIn, t],
  );

  /**
   * Confirm the scanned LAN payload: apply ONE `PUT /api/sync/client` patch
   * (addresses + security mode + TOFU fingerprint + the single-use pairing
   * secret) that makes the engine dial and auto-approve, then run the optional
   * enrollment intake. The secret never leaves this write.
   */
  const confirmLanPairing = useCallback(async () => {
    const payload = pendingLan;
    if (!payload) return;
    hapticLightPress();

    const patch: SyncClientConfigPatchDto = {
      transport: 'lan',
      peer_address: payload.ws,
      security_mode: payload.mode,
      lan_pairing_secret: payload.secret,
      device_name: deviceName.trim(),
      enabled: true,
    };
    if (payload.wss) patch.peer_wss_address = payload.wss;
    if (payload.fingerprint) patch.peer_fingerprint = payload.fingerprint;

    const next = await apply(patch);
    if (!next) return;

    // Reflect the scanned config in the (collapsed) manual form.
    formLoadedRef.current = true;
    setTransport('lan');
    setEnabled(true);
    setPeerAddress(payload.ws);
    setPeerWssAddress(payload.wss ?? '');
    setSecurityMode(payload.mode);
    setLanSheetVisible(false);
    setPendingLan(null);
    showToast(t('lanPairingSuccess', { name: payload.name }));

    if (payload.enrollment) {
      await handleEnrollment(payload.enrollment);
    }
  }, [apply, deviceName, handleEnrollment, pendingLan, showToast, t]);

  /** Pair from a manually pasted **cloud** code: verify the account, then PUT. */
  const handlePairFromCode = useCallback(
    async (rawCode: string) => {
      hapticLightPress();
      let payload: SyncPairingPayload;
      try {
        payload = parseSyncPairingPayload(rawCode);
      } catch (e: any) {
        showToast(t('pairingFailed', { message: e?.message ?? String(e) }));
        return;
      }
      await applyCloudPairing(payload);
    },
    [applyCloudPairing, showToast, t],
  );

  /**
   * QR-scan entry (owner ruling 2026-10-12: `react-native-camera-kit`). Request
   * camera permission first so the preview is never blank, then open the scanner
   * modal; a denied request falls back to the manual paste path. The scanned
   * string flows through the SAME parse → verify-account-hint → configure path
   * as the manual entry (`handlePairFromCode`).
   */
  const handleScanQr = useCallback(async () => {
    hapticLightPress();
    const granted = await checkAndRequestPermission(PERMISSIONS.CAMERA);
    if (!granted) {
      showAlert(
        t('scanPermissionTitle'),
        t('scanPermissionMessage'),
        [
          { text: t('common:cancel'), style: 'cancel' },
          { text: t('scanOpenSettings'), onPress: () => void openAppSettings() },
        ],
        { icon: 'camera-off' },
      );
      return;
    }
    setScannerVisible(true);
  }, [showAlert, t]);

  /**
   * A QR code was read: close the scanner and route by payload kind (plan 7-15
   * §A2). Cloud → the existing account-verified relay pairing; `soulbits-lan` →
   * the confirmation sheet. The store variant REJECTS LAN payloads with clear
   * copy (defense in depth — no LAN in store, ruling 7-14).
   */
  const handleScanned = useCallback(
    (code: string) => {
      if (scanProcessingRef.current) return;
      scanProcessingRef.current = true;
      setScannerVisible(false);
      void (async () => {
        let parsed;
        try {
          parsed = parseSyncPairingPayloadV2(code);
        } catch (e: any) {
          showToast(t('pairingFailed', { message: e?.message ?? String(e) }));
          return;
        }
        if (parsed.kind === 'lan') {
          if (storeVariant) {
            showToast(t('lanUnavailableStore'));
            return;
          }
          setPendingLan(parsed.payload);
          setLanSheetVisible(true);
          return;
        }
        await applyCloudPairing(parsed.payload);
      })().finally(() => {
        scanProcessingRef.current = false;
      });
    },
    [applyCloudPairing, showToast, storeVariant, t],
  );

  const runGroupAction = useCallback(
    async (action: () => Promise<unknown>, successKey: string) => {
      setBusy(true);
      try {
        await action();
        showToast(t(successKey));
        await Promise.all([refreshStatus(), refreshGroupStatus()]);
      } catch (e: any) {
        showToast(t('groupActionFailed', { message: e?.message ?? String(e) }));
      } finally {
        setBusy(false);
      }
    },
    [refreshGroupStatus, refreshStatus, showToast, t],
  );

  const handleStartCloudSync = useCallback(() => {
    hapticLightPress();
    void runGroupAction(() => syncGroupOrchestrator.startCloudSync(), 'startCloudSyncDone');
  }, [runGroupAction]);

  const handleJoinCloudSync = useCallback(() => {
    hapticLightPress();
    void runGroupAction(() => syncGroupOrchestrator.joinCloudSync(), 'joinCloudSyncDone');
  }, [runGroupAction]);

  const handleResetKey = useCallback(() => {
    showAlert(t('resetKeyTitle'), t('resetKeyMessage'), [
      { text: t('common:cancel'), style: 'cancel' },
      {
        text: t('resetKeyConfirm'),
        style: 'destructive',
        onPress: () => {
          void runGroupAction(() => syncGroupOrchestrator.resetSyncKey(), 'resetKeyDone');
        },
      },
    ]);
  }, [runGroupAction, showAlert, t]);

  if (!theme) return null;

  const accentPrimary = theme.colors.accent.primary;
  const textPrimary = theme.colors.text.primary;
  const textMuted = theme.colors.text.muted;
  const inputBg = theme.colors.background.surface;

  const state = status?.state ?? 'stopped';
  const visual = stateVisual(state);
  const pendingWrites = status?.pending_writes ?? 0;
  const authorityLabel = status?.local_authoritative ? t('authorityThisDevice') : t('authorityPeer');
  // Plan 7-8: where cognition (the "one brain") runs for this dataset.
  const cognitionAuthority = status?.cognition_authority ?? null;
  const cognitionLabel =
    cognitionAuthority === 'local'
      ? t('cognitionLocal')
      : cognitionAuthority
        ? t('cognitionDevice', { device: cognitionAuthority })
        : t('cognitionNone');
  const secBadge = securityBadge(securityMode);
  const relay = status?.relay ?? null;
  const syncGroup = status?.sync_group ?? 'uninitialized';
  const rotationPending = (status?.rotation_required ?? false) || rotationFlag;
  const isCloud = transport === 'relay';

  return (
    <ThemedView style={styles.container}>
      <ScreenHeader title={t('title')} onBack={() => navigation.goBack()} />

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            colors={[accentPrimary]}
            tintColor={accentPrimary}
            progressBackgroundColor={theme.colors.background.surface}
          />
        }
      >
        {/* ── Hero connection-status orb (recycled from the deleted
            SyncSettingsScreen) ──────────────────────────────────────────── */}
        <View style={styles.heroOrbContainer} testID="desktop-sync-hero">
          <View style={[styles.heroGlowRing, { borderColor: hexToRgba(visual.color, 0.25) }]}>
            <View style={[styles.heroGlowMid, { borderColor: hexToRgba(visual.color, 0.4) }]}>
              <LinearGradient
                colors={[visual.color, hexToRgba(visual.color, 0.5)]}
                start={{ x: 0.3, y: 0.1 }}
                end={{ x: 0.7, y: 0.9 }}
                style={styles.heroOrb}
              >
                <View style={styles.heroOrbHighlight} />
                <Icon name={visual.icon} size={36} color="#fff" />
              </LinearGradient>
            </View>
          </View>
          <ThemedText weight="bold" size={20} style={styles.heroStatusText} testID="desktop-sync-state">
            {t(stateLabelKey(state))}
          </ThemedText>
          <ThemedText variant="secondary" size={13} style={styles.heroSubtext}>
            {t(stateSubtextKey(state))}
          </ThemedText>
        </View>

        {/* ── Pairing card (QR-first, plan 7-15 §A5) ──────────────────────
            Promoted to the top card with a big "Scan desktop QR" CTA that
            accepts BOTH payload kinds. The cloud manual-paste surface stays
            inline (unchanged) when the relay transport is selected. */}
        <ThemedCard accentStripe style={styles.card} testID="desktop-sync-pairing-card">
          <View style={styles.cardHeader}>
            <Icon name="qrcode-scan" size={18} color={accentPrimary} />
            <ThemedText weight="medium" size={15} style={styles.cardTitle}>
              {t('pairingSection')}
            </ThemedText>
          </View>

          <ThemedText variant="muted" size={12} style={styles.fieldHint}>
            {t('scanCtaHint')}
          </ThemedText>

          <ThemedButton
            label={t('scanCta')}
            icon="qrcode-scan"
            onPress={() => void handleScanQr()}
            style={styles.actionButton}
            testID="desktop-sync-scan-button"
          />

          {isCloud ? (
            <>
              <ThemedText variant="muted" size={12} style={styles.fieldHint}>
                {t('pairingHint')}
              </ThemedText>

              <Field
                label={t('pairingCodeLabel')}
                value={pairingCode}
                onChangeText={setPairingCode}
                placeholder={t('pairingCodePlaceholder')}
                hint={t('pairingCodeHint')}
                multiline
                backgroundColor={inputBg}
                inputTextColor={textPrimary}
                inputPlaceholderColor={textMuted}
                testID="desktop-sync-pairing-code"
              />

              <SettingsToggleRow
                icon="account-multiple-plus-outline"
                label={t('joinExistingLabel')}
                value={joinExisting}
                onValueChange={setJoinExisting}
                theme={theme}
              />

              <ThemedButton
                label={busy ? t('pairing') : t('pairButton')}
                icon="link-variant"
                variant="outline"
                onPress={() => void handlePairFromCode(pairingCode)}
                disabled={busy || !pairingCode.trim()}
                style={styles.actionButton}
                testID="desktop-sync-pair-button"
              />
            </>
          ) : null}
        </ThemedCard>

        {/* ── Status card ─────────────────────────────────────────────── */}
        <ThemedCard accentStripe style={styles.card}>
          <View style={styles.cardHeader}>
            <Icon name="information-outline" size={18} color={accentPrimary} />
            <ThemedText weight="medium" size={15} style={styles.cardTitle}>
              {t('statusSection')}
            </ThemedText>
          </View>

          <View style={styles.detailRow}>
            <View style={styles.detailLabel}>
              <View style={[styles.dot, { backgroundColor: visual.color }]} />
              <ThemedText variant="muted" size={13}>{t('stateLabel')}</ThemedText>
            </View>
            <ThemedText size={13} style={{ color: visual.color }}>
              {t(stateLabelKey(state))}
            </ThemedText>
          </View>

          <View style={styles.detailDivider} />

          <View style={styles.detailRow}>
            <View style={styles.detailLabel}>
              <Icon name={isCloud ? 'cloud-outline' : 'lan'} size={14} color={textMuted} />
              <ThemedText variant="muted" size={13}>{t('transportLabel')}</ThemedText>
            </View>
            <ThemedText size={13} testID="desktop-sync-transport-badge">
              {isCloud ? t('transportCloud') : t('transportLan')}
            </ThemedText>
          </View>

          <View style={styles.detailDivider} />

          <View style={styles.detailRow}>
            <View style={styles.detailLabel}>
              <Icon name="crown-outline" size={14} color={textMuted} />
              <ThemedText variant="muted" size={13}>{t('authorityLabel')}</ThemedText>
            </View>
            <ThemedText size={13} testID="desktop-sync-authority">{authorityLabel}</ThemedText>
          </View>

          {/* Plan 7-8: where cognition runs (the "one brain, many presences"). */}
          <View style={styles.detailDivider} />

          <View style={styles.detailRow}>
            <View style={styles.detailLabel}>
              <Icon name="brain" size={14} color={textMuted} />
              <ThemedText variant="muted" size={13}>{t('cognitionLabel')}</ThemedText>
            </View>
            <ThemedText size={13} testID="desktop-sync-cognition-authority">{cognitionLabel}</ThemedText>
          </View>

          <View style={styles.detailDivider} />

          <View style={styles.detailRow}>
            <View style={styles.detailLabel}>
              <Icon name="database-outline" size={14} color={textMuted} />
              <ThemedText variant="muted" size={13}>{t('datasetLabel')}</ThemedText>
            </View>
            <ThemedText size={12} numberOfLines={1} style={styles.mono}>
              {status?.dataset_id ?? '—'}
            </ThemedText>
          </View>

          {isCloud && (
            <>
              <View style={styles.detailDivider} />
              <View style={styles.detailRow}>
                <View style={styles.detailLabel}>
                  <Icon name="key-outline" size={14} color={textMuted} />
                  <ThemedText variant="muted" size={13}>{t('groupStateLabel')}</ThemedText>
                </View>
                <ThemedText size={13} testID="desktop-sync-group-state">
                  {t(`groupState_${syncGroup}`)}
                </ThemedText>
              </View>
              {groupStatus?.fingerprint ? (
                <>
                  <View style={styles.detailDivider} />
                  <View style={styles.detailRow}>
                    <View style={styles.detailLabel}>
                      <Icon name="fingerprint" size={14} color={textMuted} />
                      <ThemedText variant="muted" size={13}>{t('fingerprintLabel')}</ThemedText>
                    </View>
                    <ThemedText size={11} numberOfLines={1} style={styles.mono} testID="desktop-sync-fingerprint">
                      {groupStatus.fingerprint.slice(0, 16)}…
                    </ThemedText>
                  </View>
                </>
              ) : null}
            </>
          )}

          {/* Relay round-trip / buffer block (7-3). */}
          {isCloud && relay ? (
            <View style={styles.relayBlock} testID="desktop-sync-relay-status">
              <View style={styles.relayHeader}>
                <View style={[styles.dot, { backgroundColor: relay.connected ? '#4caf82' : '#f0a23b' }]} />
                <ThemedText variant="secondary" size={12} style={styles.relayHeaderText}>
                  {relay.connected ? t('relayConnected') : t('relayDisconnected')}
                </ThemedText>
              </View>
              <View style={styles.detailRow}>
                <ThemedText variant="muted" size={12}>{t('relaySeqLabel')}</ThemedText>
                <ThemedText size={12} testID="desktop-sync-relay-seq">
                  {relay.last_seq} / {relay.acked_seq}
                </ThemedText>
              </View>
              {/* Plan 7-6: the tier's device cap, shown before it is hit. */}
              <View style={styles.detailRow}>
                <ThemedText variant="muted" size={12}>{t('relayDevicesLabel')}</ThemedText>
                <ThemedText size={12} testID="desktop-sync-relay-devices">
                  {relay.sync_devices > 0 ? t('relayDevicesUpTo', { count: relay.sync_devices }) : t('relayUnlimited')}
                </ThemedText>
              </View>
              {/* Plan 7-6: buffer usage (bytes / tier cap); escalates on overflow. */}
              <View style={styles.detailRow}>
                <ThemedText variant="muted" size={12}>{t('relayBufferLabel')}</ThemedText>
                <ThemedText
                  size={12}
                  style={relay.overflow ? styles.relayWarn : undefined}
                  testID="desktop-sync-relay-buffered"
                >
                  {formatBytes(relay.buffered_bytes)} / {relay.cap > 0 ? formatBytes(relay.cap) : t('relayUnlimited')}
                </ThemedText>
              </View>
              {relay.overflow ? (
                <ThemedText size={11} style={styles.relayWarn}>{t('relayOverflow')}</ThemedText>
              ) : null}
              {relay.rejected_frames > 0 ? (
                <ThemedText size={11} style={styles.relayWarn}>
                  {t('relayRejected', { count: relay.rejected_frames })}
                </ThemedText>
              ) : null}
              {relay.decrypt_failures > 0 ? (
                <ThemedText size={11} style={styles.relayWarn}>
                  {t('relayDecryptFailures', { count: relay.decrypt_failures })}
                </ThemedText>
              ) : null}
            </View>
          ) : null}

          {state === 'auth_needed' ? (
            <ThemedCard style={styles.infoCard} testID="desktop-sync-auth-needed">
              <View style={styles.warningRow}>
                <Icon name="shield-refresh-outline" size={18} color={accentPrimary} />
                <ThemedText variant="secondary" size={13} style={styles.warningText}>
                  {t('authNeededBanner')}
                </ThemedText>
              </View>
            </ThemedCard>
          ) : null}

          {state === 'quota_exceeded' ? (
            <ThemedCard style={styles.warningCard} testID="desktop-sync-quota">
              <View style={styles.warningRow}>
                <Icon name="cloud-lock-outline" size={18} color="#f44336" />
                <ThemedText variant="secondary" size={13} style={styles.warningText}>
                  {t('quotaExceededBanner')}
                </ThemedText>
              </View>
            </ThemedCard>
          ) : null}

          {state === 'pending_approval' && !isCloud ? (
            <ThemedCard style={styles.infoCard} testID="desktop-sync-pending-hint">
              <View style={styles.warningRow}>
                <Icon name="account-clock-outline" size={18} color={accentPrimary} />
                <ThemedText variant="secondary" size={13} style={styles.warningText}>
                  {t('pendingApprovalHint', { peer: status?.config.peer_address || peerAddress })}
                </ThemedText>
              </View>
            </ThemedCard>
          ) : null}

          {/* Rejected (SYNC_REJECT / version mismatch): actionable recovery copy
              — the pairing contract's "update Soulbits Engine" UX (5-3). */}
          {state === 'rejected' ? (
            <ThemedCard style={styles.warningCard} testID="desktop-sync-rejected-hint">
              <View style={styles.warningRow}>
                <Icon name="cloud-off-outline" size={18} color="#f44336" />
                <ThemedText variant="secondary" size={13} style={styles.warningText}>
                  {t('rejectedHint')}
                </ThemedText>
              </View>
              {/* Desktop-engine deep-link (plan 7-10 §4): the desktop peer can
                  act on a direct download — pick the manifest's desktop URLs. */}
              {desktopArtifacts ? (
                <View style={styles.desktopLinks} testID="desktop-sync-engine-download">
                  <ThemedText variant="muted" size={12} style={styles.warningText}>
                    {t('updates:desktopEngine.heading')}
                  </ThemedText>
                  <View style={styles.desktopLinkRow}>
                    <ThemedButton
                      label={t('updates:desktopEngine.windows')}
                      icon="microsoft-windows"
                      variant="outline"
                      onPress={() =>
                        void Linking.openURL(desktopArtifacts.windows_amd64).catch(() => undefined)
                      }
                      style={styles.desktopLinkButton}
                      testID="desktop-sync-engine-windows"
                    />
                    <ThemedButton
                      label={t('updates:desktopEngine.linux')}
                      icon="linux"
                      variant="outline"
                      onPress={() =>
                        void Linking.openURL(desktopArtifacts.linux_amd64).catch(() => undefined)
                      }
                      style={styles.desktopLinkButton}
                      testID="desktop-sync-engine-linux"
                    />
                  </View>
                </View>
              ) : null}
            </ThemedCard>
          ) : null}

          {status?.narration_paused ? (
            <ThemedCard style={styles.warningCard} testID="desktop-sync-narration-paused">
              <View style={styles.warningRow}>
                <Icon name="pause-circle-outline" size={18} color="#f0a23b" />
                <ThemedText variant="secondary" size={13} style={styles.warningText}>
                  {t('narrationPausedBanner')}
                </ThemedText>
              </View>
            </ThemedCard>
          ) : null}

          {pendingWrites > 0 ? (
            <ThemedCard style={styles.warningCard} testID="desktop-sync-pending-writes">
              <View style={styles.warningRow}>
                <Icon name="alert-circle-outline" size={18} color="#f0a23b" />
                <ThemedText variant="secondary" size={13} style={styles.warningText}>
                  {t('pendingWritesWarning', { count: pendingWrites })}
                </ThemedText>
              </View>
            </ThemedCard>
          ) : null}

          {status?.last_error ? (
            <ThemedCard style={styles.warningCard} testID="desktop-sync-last-error">
              <View style={styles.warningRow}>
                <Icon name="alert-outline" size={18} color="#f44336" />
                <ThemedText variant="secondary" size={12} style={styles.warningText}>
                  {status.last_error}
                </ThemedText>
              </View>
            </ThemedCard>
          ) : null}

          {loadError ? (
            <ThemedText variant="muted" size={12} style={styles.errorText} testID="desktop-sync-load-error">
              {t('statusUnavailable', { message: loadError })}
            </ThemedText>
          ) : null}
        </ThemedCard>

        {/* ── Rotation-required banner (portal-triggered, 7-2/7-3) ─────── */}
        {isCloud && rotationPending ? (
          <ThemedCard style={styles.rotationCard} testID="desktop-sync-rotation-banner">
            <View style={styles.warningRow}>
              <Icon name="rotate-left" size={18} color="#f0a23b" />
              <ThemedText variant="secondary" size={13} style={styles.warningText}>
                {t('rotationBanner')}
              </ThemedText>
            </View>
            <ThemedButton
              label={busy ? t('groupWorking') : t('resetKeyButton')}
              icon="rotate-left"
              variant="outline"
              onPress={handleResetKey}
              disabled={busy}
              style={styles.actionButton}
              testID="desktop-sync-reset-key"
            />
          </ThemedCard>
        ) : null}

        {/* ── Config card ─────────────────────────────────────────────── */}
        <ThemedCard accentStripe style={styles.card}>
          <View style={styles.cardHeader}>
            <Icon name="cog-outline" size={18} color={accentPrimary} />
            <ThemedText weight="medium" size={15} style={styles.cardTitle}>
              {t('configSection')}
            </ThemedText>
          </View>

          <SettingsToggleRow
            icon="sync"
            label={t('enabledLabel')}
            value={enabled}
            onValueChange={handleToggleEnabled}
            theme={theme}
          />

          <View style={styles.fieldWrapper}>
            <ThemedText weight="medium" size={13} style={styles.fieldLabel}>
              {t('transportSection')}
            </ThemedText>
            <TransportPicker value={transport} onChange={setTransport} theme={theme} t={t} cloudOnly={storeVariant} />
            <ThemedText variant="muted" size={11} style={styles.fieldHint}>
              {isCloud ? t('transportCloudHint') : t('transportLanHint')}
            </ThemedText>
          </View>

          {!isCloud ? (
            <>
              <TouchableOpacity
                style={styles.advancedToggle}
                onPress={() => {
                  hapticLightPress();
                  setShowAdvanced(v => !v);
                }}
                accessibilityRole="button"
                accessibilityState={{ expanded: showAdvanced }}
                testID="desktop-sync-advanced-toggle"
              >
                <Icon
                  name={showAdvanced ? 'chevron-up' : 'chevron-down'}
                  size={18}
                  color={textMuted}
                />
                <ThemedText size={13} variant="secondary" style={styles.advancedToggleText}>
                  {t('advancedToggle')}
                </ThemedText>
              </TouchableOpacity>

              {showAdvanced ? (
                <>
                  <ThemedText variant="muted" size={11} style={styles.fieldHint}>
                    {t('advancedHint')}
                  </ThemedText>

                  <Field
                    label={t('peerAddressLabel')}
                    value={peerAddress}
                    onChangeText={setPeerAddress}
                    placeholder="192.168.1.10:28080"
                    hint={t('peerAddressHint')}
                    backgroundColor={inputBg}
                    inputTextColor={textPrimary}
                    inputPlaceholderColor={textMuted}
                  />

                  <Field
                    label={t('peerWssAddressLabel')}
                    value={peerWssAddress}
                    onChangeText={setPeerWssAddress}
                    placeholder={t('optionalPlaceholder')}
                    hint={t('peerWssAddressHint')}
                    backgroundColor={inputBg}
                    inputTextColor={textPrimary}
                    inputPlaceholderColor={textMuted}
                  />

                  <View style={styles.fieldWrapper}>
                    <ThemedText weight="medium" size={13} style={styles.fieldLabel}>
                      {t('securityModeLabel')}
                    </ThemedText>
                    <SelectPicker
                      label={t('securityModeLabel')}
                      value={securityMode}
                      options={SECURITY_MODES}
                      onChange={setSecurityMode}
                    />
                    {/* Security shield badge (recycled from ConnectionSetupScreen). */}
                    <View style={styles.securityBadge}>
                      <Icon name={secBadge.icon} size={14} color={secBadge.color} />
                      <ThemedText size={12} variant="secondary" style={styles.securityBadgeText}>
                        {secBadge.label}
                      </ThemedText>
                    </View>
                    <ThemedText variant="muted" size={11} style={styles.fieldHint}>
                      {securityModeHint(securityMode, t)}
                    </ThemedText>
                  </View>
                </>
              ) : null}
            </>
          ) : (
            <>
              <Field
                label={t('relayUrlLabel')}
                value={relayUrl}
                onChangeText={setRelayUrl}
                placeholder={SYNC_RELAY.defaultRelayUrl}
                hint={t('relayUrlHint')}
                backgroundColor={inputBg}
                inputTextColor={textPrimary}
                inputPlaceholderColor={textMuted}
                testID="desktop-sync-relay-url"
              />

              <Field
                label={t('deviceIdLabel')}
                value={deviceId}
                onChangeText={setDeviceId}
                hint={t('deviceIdHint')}
                backgroundColor={inputBg}
                inputTextColor={textPrimary}
                inputPlaceholderColor={textMuted}
                testID="desktop-sync-device-id"
              />

              <Field
                label={t('datasetIdLabel')}
                value={datasetId}
                onChangeText={setDatasetId}
                hint={t('datasetIdHint')}
                backgroundColor={inputBg}
                inputTextColor={textPrimary}
                inputPlaceholderColor={textMuted}
                testID="desktop-sync-dataset-id"
              />

              <View style={styles.detailRow}>
                <View style={styles.detailLabel}>
                  <Icon name="account-circle-outline" size={14} color={textMuted} />
                  <ThemedText variant="muted" size={13}>{t('accountLabel')}</ThemedText>
                </View>
                <ThemedText size={13} testID="desktop-sync-account">
                  {signedIn ? t('accountSignedIn') : t('accountSignedOut')}
                </ThemedText>
              </View>
              {!signedIn ? (
                <ThemedText variant="muted" size={11} style={styles.fieldHint}>
                  {t('accountSignedOutHint')}
                </ThemedText>
              ) : null}
            </>
          )}

          <Field
            label={t('deviceNameLabel')}
            value={deviceName}
            onChangeText={setDeviceName}
            placeholder={t('deviceNamePlaceholder')}
            backgroundColor={inputBg}
            inputTextColor={textPrimary}
            inputPlaceholderColor={textMuted}
          />

          <ThemedButton
            label={busy ? t('applying') : t('connectButton')}
            icon="link-variant"
            onPress={handleConnect}
            disabled={busy}
            style={styles.actionButton}
            testID="desktop-sync-connect"
          />
        </ThemedCard>

        {/* ── Sync-group key card (7-3) ───────────────────────────────── */}
        {isCloud ? (
          <ThemedCard accentStripe style={styles.card}>
            <View style={styles.cardHeader}>
              <Icon name="key-variant" size={18} color={accentPrimary} />
              <ThemedText weight="medium" size={15} style={styles.cardTitle}>
                {t('groupSection')}
              </ThemedText>
            </View>

            <ThemedText variant="muted" size={12} style={styles.fieldHint}>
              {t(`groupHelp_${syncGroup}`)}
            </ThemedText>

            {syncGroup === 'uninitialized' ? (
              <ThemedButton
                label={busy ? t('groupWorking') : t('startCloudSyncButton')}
                icon="key-plus"
                onPress={handleStartCloudSync}
                disabled={busy || !signedIn}
                style={styles.actionButton}
                testID="desktop-sync-start-cloud-sync"
              />
            ) : null}

            {syncGroup === 'key_pending' ? (
              <ThemedButton
                label={busy ? t('groupWorking') : t('joinCloudSyncButton')}
                icon="key-link"
                onPress={handleJoinCloudSync}
                disabled={busy || !signedIn}
                style={styles.actionButton}
                testID="desktop-sync-join-cloud-sync"
              />
            ) : null}

            {syncGroup === 'member' ? (
              <ThemedButton
                label={busy ? t('groupWorking') : t('resetKeyButton')}
                icon="rotate-left"
                variant="outline"
                onPress={handleResetKey}
                disabled={busy}
                style={styles.actionButton}
                testID="desktop-sync-reset-key"
              />
            ) : null}
          </ThemedCard>
        ) : null}

        {/* ── Actions ─────────────────────────────────────────────────── */}
        <ThemedCard accentStripe style={styles.card}>
          <View style={styles.cardHeader}>
            <Icon name="tune-variant" size={18} color={accentPrimary} />
            <ThemedText weight="medium" size={15} style={styles.cardTitle}>
              {t('actionsSection')}
            </ThemedText>
          </View>

          <ThemedButton
            label={t('disconnectButton')}
            icon="lan-disconnect"
            variant="outline"
            onPress={handleDisconnect}
            disabled={busy || !status?.enabled}
            style={styles.actionButton}
            testID="desktop-sync-disconnect"
          />

          <ThemedButton
            label={t('disableButton')}
            icon="sync-off"
            variant="outline"
            onPress={() => handleToggleEnabled(false)}
            disabled={busy || !status?.enabled}
            style={styles.actionButton}
            testID="desktop-sync-disable"
          />

          <ThemedButton
            label={t('yieldButton')}
            icon="crown-outline"
            variant="outline"
            onPress={handleYield}
            disabled={busy || state !== 'syncing'}
            style={styles.actionButton}
            testID="desktop-sync-yield"
          />
        </ThemedCard>

        <ThemedText variant="muted" size={12} style={styles.footerText}>
          {t('footer')}
        </ThemedText>
      </ScrollView>

      {/* QR pairing-code scanner (7-3 follow-up). */}
      <QrScannerModal
        visible={scannerVisible}
        onClose={() => setScannerVisible(false)}
        onScanned={handleScanned}
      />

      {/* Post-scan LAN confirmation sheet (plan 7-15 §A3). */}
      <LanPairingConfirmSheet
        visible={lanSheetVisible}
        payload={pendingLan}
        signedIn={signedIn}
        busy={busy}
        onConfirm={() => void confirmLanPairing()}
        onCancel={() => {
          setLanSheetVisible(false);
          setPendingLan(null);
        }}
      />
    </ThemedView>
  );
};

// ── Styles ──────────────────────────────────────────────────────────────────

const ORB_SIZE = 90;
const GLOW_RING_1 = ORB_SIZE + 28;
const GLOW_RING_2 = ORB_SIZE + 12;

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: { padding: 20, paddingBottom: 40, gap: 16 },

  // ── Hero orb (recycled from the deleted SyncSettingsScreen) ────────────────
  heroOrbContainer: { alignItems: 'center', marginBottom: 8, marginTop: 4 },
  heroGlowRing: {
    width: GLOW_RING_1,
    height: GLOW_RING_1,
    borderRadius: GLOW_RING_1 / 2,
    borderWidth: 3,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 14,
  },
  heroGlowMid: {
    width: GLOW_RING_2,
    height: GLOW_RING_2,
    borderRadius: GLOW_RING_2 / 2,
    borderWidth: 2,
    justifyContent: 'center',
    alignItems: 'center',
  },
  heroOrb: {
    width: ORB_SIZE,
    height: ORB_SIZE,
    borderRadius: ORB_SIZE / 2,
    justifyContent: 'center',
    alignItems: 'center',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 24,
    elevation: 12,
  },
  heroOrbHighlight: {
    position: 'absolute',
    top: 16,
    left: 19,
    width: 28,
    height: 18,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.25)',
    transform: [{ rotate: '-30deg' }],
  },
  heroStatusText: { marginBottom: 4 },
  heroSubtext: { textAlign: 'center', paddingHorizontal: 30 },

  // ── Cards ──────────────────────────────────────────────────────────────────
  card: { gap: 12 },
  rotationCard: { gap: 12, borderWidth: 1, borderColor: 'rgba(240,162,59,0.5)' },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cardTitle: { flex: 1 },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
  },
  detailLabel: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  detailDivider: { height: 1, backgroundColor: 'rgba(255,255,255,0.05)', marginVertical: 2 },
  stateBadge: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  mono: { maxWidth: '60%' },
  infoCard: { marginTop: 4 },
  warningCard: { marginTop: 4 },
  warningRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  warningText: { flex: 1, lineHeight: 18 },
  desktopLinks: { marginTop: 10, gap: 8 },
  desktopLinkRow: { flexDirection: 'row', gap: 10 },
  desktopLinkButton: { flex: 1 },
  errorText: { marginTop: 6 },

  // ── Transport picker ───────────────────────────────────────────────────────
  transportRow: { flexDirection: 'row', gap: 10 },
  transportChip: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
  },

  // ── Relay status block ─────────────────────────────────────────────────────
  relayBlock: {
    marginTop: 6,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.06)',
    gap: 4,
  },
  relayHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 },
  relayHeaderText: { flex: 1 },
  relayWarn: { color: '#f0a23b', marginTop: 2, lineHeight: 15 },

  // ── Fields (recycled from the deleted ConnectionSetupScreen) ───────────────
  fieldWrapper: { marginBottom: 6 },
  fieldLabel: { marginBottom: 6, marginLeft: 2 },
  fieldBody: { borderRadius: 12, overflow: 'hidden' },
  fieldInput: { paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, fontWeight: '500' },
  fieldInputMultiline: { minHeight: 72, textAlignVertical: 'top' },
  fieldHint: { marginTop: 6, marginLeft: 2, lineHeight: 15 },
  securityBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(255,255,255,0.06)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    marginTop: 10,
  },
  securityBadgeText: {},

  // ── Advanced disclosure (plan 7-15 §A5) ────────────────────────────────────
  advancedToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
  },
  advancedToggleText: { flex: 1 },

  // ── Buttons ────────────────────────────────────────────────────────────────
  actionButton: { marginTop: 4 },
  footerText: { textAlign: 'center', paddingHorizontal: 16 },
});
