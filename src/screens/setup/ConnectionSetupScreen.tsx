import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  RefreshControl,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';
import { createLogger } from '../../utils/logger';
import { useAppTheme } from '../../contexts/ThemeContext';
import { useAppAlert } from '../../contexts/AppAlertContext';
import { ThemedText } from '../../components/themed/ThemedText';
import { ThemedView } from '../../components/themed/ThemedView';
import { ScreenHeader } from '../../components/themed/ScreenHeader';
import { ThemedButton } from '../../components/themed/ThemedButton';
import { CertificateVerificationModal } from '../../components/modals/CertificateVerificationModal';
import { CertificateDetailsModal } from '../../components/modals/CertificateDetailsModal';
import AsyncStorage from '@react-native-async-storage/async-storage';
import ConnectionManager from '../../services/connection/ConnectionManager';
import SyncService from '../../services/SyncService';
import ConnectionStateManager from '../../services/ConnectionStateManager';
import { cloudSessionService, type CloudSessionStatus, type CloudSessionInfo } from '../../services/cloud/CloudSessionService';
import { StatusPulseDot, type RadarState } from '../../components/cloud/StatusPulseDot';
import { CloudProvisioningCard } from '../../components/cloud/CloudProvisioningCard';
import { useSyncConnection } from '../../contexts/SyncConnectionContext';
import { useAuth } from '../../contexts/AuthContext';
import { hexToRgba } from '../../utils/colorUtils';
import type { RootStackParamList } from '../../navigation/AppNavigator';

const log = createLogger('ConnectionSetupScreen');

// ─── Status category derived from status text ─────────────────────────

function classifyStatus(statusText: string): RadarState {
  const s = statusText.toLowerCase();
  if (s.includes('connected') || s.includes('success')) return 'connected';
  if (s.includes('reconnecting')) return 'connecting';
  if (s.includes('connecting') || s.includes('saving') || s.includes('switching')) return 'connecting';
  if (s.includes('waiting') || s.includes('approval') || s.includes('pending')) return 'waiting';
  if (
    s.includes('failed') ||
    s.includes('rejected') ||
    s.includes('error') ||
    s.includes('aborted') ||
    s.includes('cancelled')
  )
    return 'error';
  return 'idle';
}

// ─── FormField ─────────────────────────────────────────────────────────
interface FormFieldProps {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  keyboardType?: 'default' | 'url' | 'numeric';
  editable?: boolean;
  backgroundColor: string;
  inputTextColor: string;
  inputPlaceholderColor: string;
}

const FormField: React.FC<FormFieldProps> = ({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType = 'default',
  editable = true,
  backgroundColor,
  inputTextColor,
  inputPlaceholderColor,
}) => (
  <View style={styles.fieldWrapper}>
    <ThemedText weight="medium" size={13} style={styles.fieldLabel}>
      {label}
    </ThemedText>
    <View style={[styles.fieldBody, { backgroundColor }]}>
      <TextInput
        style={[styles.fieldInput, { color: inputTextColor, opacity: editable ? 1 : 0.55 }]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={inputPlaceholderColor}
        keyboardType={keyboardType}
        autoCapitalize="none"
        autoCorrect={false}
        editable={editable}
      />
    </View>
  </View>
);

// ─── ModeSelectorCard ──────────────────────────────────────────────────
interface ModeSelectorCardProps {
  selected: boolean;
  onPress: () => void;
  icon: string;
  title: string;
  description: string;
  accentColor: string;
  bgColor: string;
  selectedBgColor: string;
}

const ModeSelectorCard: React.FC<ModeSelectorCardProps> = ({
  selected,
  onPress,
  icon,
  title,
  description,
  accentColor,
  bgColor,
  selectedBgColor,
}) => (
  <TouchableOpacity
    style={[styles.modeCard, { flex: 1 }]}
    onPress={onPress}
    activeOpacity={0.7}
  >
    <View style={[styles.modeCardBody, { flex: 1, backgroundColor: selected ? selectedBgColor : bgColor }]}>
      {selected && (
        <View style={[styles.modeCardAccentBar, { backgroundColor: accentColor }]} />
      )}
      <View style={[styles.modeCardIconWrap, { backgroundColor: accentColor + (selected ? '22' : '10') }]}>
        <Icon name={icon} size={24} color={selected ? accentColor : '#6b6780'} />
      </View>
      <ThemedText weight="bold" size={14} variant="primary" style={styles.modeCardTitle}>
        {title}
      </ThemedText>
      <ThemedText size={12} variant={selected ? 'secondary' : 'muted'} style={styles.modeCardDesc}>
        {description}
      </ThemedText>
      {selected && (
        <View style={[styles.modeCardCheck, { backgroundColor: accentColor }]}>
          <Icon name="check" size={10} color="#fff" />
        </View>
      )}
    </View>
  </TouchableOpacity>
);



// ─── Main Screen ───────────────────────────────────────────────────────

export const ConnectionSetupScreen: React.FC = () => {
  const { theme } = useAppTheme();
  const { showAlert } = useAppAlert();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { showToast, isPaired, isConnected, isConnecting, reconnect } = useSyncConnection();
  const { t } = useTranslation('connection');
  const { t: ta } = useTranslation('auth');
  const { status: authStatus, logout } = useAuth();
  
  // ── Mode toggle state ─────────────────────────────────────────────────
  const [connectionMode, setConnectionMode] = useState<'selfhosted' | 'cloud'>('selfhosted');

  // Load persisted mode on mount
  useEffect(() => {
    AsyncStorage.getItem('connection_mode').then(saved => {
      if (saved === 'cloud' || saved === 'selfhosted') {
        setConnectionMode(saved);
      }
    });
  }, []);

  // ── Cloud session status (rich payload) ───────────────────────────────
  const [cloudSession, setCloudSession] = useState<{
    status: CloudSessionStatus;
    info?: CloudSessionInfo;
  }>({ status: cloudSessionService.getStatus() });
  const [isRetrying, setIsRetrying] = useState(false);

  useEffect(() => {
    const onStatus = (s: CloudSessionStatus, info?: CloudSessionInfo) => {
      setCloudSession({ status: s, info });
      // Clear retrying flag on terminal status
      if (s === 'ready' || s === 'failed') {
        setIsRetrying(false);
      }
      // Show a toast when the cloud session fails so the user is
      // informed even if they're not looking at the ConnectionSetup
      // screen. showToast + ta are stable (Toast.show wrapper + i18next),
      // so capturing them at mount time is safe.
      if (s === 'failed') {
        showToast(`${ta('cloud_failed_prefix')}${info?.failureReason ?? ''}`);
      }
    };
    cloudSessionService.on('status', onStatus);
    return () => {
      cloudSessionService.off('status', onStatus);
    };
  }, []);

  // Apply the mode change (mutation) — extracted so the confirm dialog can call it.
  const applyModeChange = useCallback((mode: 'selfhosted' | 'cloud') => {
    setConnectionMode(mode);
    AsyncStorage.setItem('connection_mode', mode).catch(() => {}); // canonical key (6-3A)

    // Clean up stale state from the OTHER mode so one does not interfere
    // with the other (e.g. stale self-hosted harmony_paired keeps
    // SyncConnectionContext in an infinite reconnect loop).
    if (mode === 'cloud') {
      // Clear self-hosted credentials so SyncConnectionContext doesn't
      // try to re-establish a stale WS:// connection on next init.
      ConnectionStateManager.clearSelfHostedCredentials().catch(() => {});
      connectionManager.disconnectConnection('sync');

      if (authStatus === 'authenticated') {
        // Explicitly spawn the cloud session — AuthContext's listener only fires on auth:changed,
        // not on mode change, so an already-authenticated user switching to cloud needs this.
        cloudSessionService.connect().catch(e => log.warn('Cloud session connect failed on mode switch:', e instanceof Error ? `${e.name}: ${e.message}` : String(e)));
      } else if (authStatus === 'unauthenticated') {
        navigation.navigate('Login');
      }
      // authStatus === 'loading' → do nothing; AuthContext resolves.
    } else {
      // Switching to self-hosted — disconnect cloud session so it doesn't
      // hold the HL container open (avoiding unnecessary ECS costs).
      cloudSessionService.disconnect().catch(() => {});
    }
  }, [authStatus, navigation]);

  const handleModeChange = useCallback(
    (mode: 'selfhosted' | 'cloud') => {
      if (mode === connectionMode) return;

      showAlert(
        ta('switch_warning_title'),
        mode === 'cloud'
          ? ta('switch_warning_message_cloud')
          : ta('switch_warning_message_selfhosted'),
        [
          { text: t('common:cancel'), style: 'cancel' },
          { text: ta('switch_confirm'), onPress: () => applyModeChange(mode) },
        ],
      );
    },
    [connectionMode, applyModeChange, ta, t],
  );

  const [url, setUrl] = useState('192.168.1.');
  const [port, setPort] = useState('8080');
  const [status, setStatus] = useState(t('idle'));
  const [isManuallyConnecting, setIsManuallyConnecting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [showCertModal, setShowCertModal] = useState(false);
  const [showCertDetailsModal, setShowCertDetailsModal] = useState(false);
  const [serverCertificate, setServerCertificate] = useState<string>('');
  const [_pendingCredentials, setPendingCredentials] = useState<any>(null);
  const [securityMode, setSecurityMode] = useState<string>('');

  const connectionManager = ConnectionManager;

  const hasSelectedSecurityModeRef = useRef(false);

  // ── Derived radar state ───────────────────────────────────────────────
  const radarState = useMemo(() => classifyStatus(status), [status]);

  // ── Cloud action handlers ────────────────────────────────────────────

  /**
   * Retry a failed cloud session: disconnect then reconnect.
   * isRetrying is set to true on press and cleared on next terminal status
   * event (ready or failed) via the status listener.
   */
  const handleRetry = useCallback(async () => {
    setIsRetrying(true);
    try {
      await cloudSessionService.disconnect();
      await cloudSessionService.connect();
      showToast(ta('cloud_reconnect_success'));
    } catch (e: any) {
      log.warn('Cloud retry failed:', e instanceof Error ? `${e.name}: ${e.message}` : String(e));
      setIsRetrying(false);
      showToast(ta('cloud_reconnect_failed'));
    }
  }, [showToast, ta]);

  /**
   * Restart session (full disconnect → connect).
   * Distinct from a transient WS reconnect, which is automatic (Phase 8).
   */
  const handleRestart = useCallback(async () => {
    try {
      await cloudSessionService.disconnect();
      await cloudSessionService.connect();
      showToast(ta('cloud_reconnect_success'));
    } catch (e: any) {
      log.warn('Cloud restart failed:', e instanceof Error ? `${e.name}: ${e.message}` : String(e));
      showToast(ta('cloud_reconnect_failed'));
    }
  }, [showToast, ta]);

  /**
   * Disconnect cloud session + tear down sync + sign out.
   */
  const handleDisconnectCloud = useCallback(async () => {
    try {
      await cloudSessionService.disconnect();
      connectionManager.disconnectConnection('sync');
      await logout();
      showToast(ta('cloud_disconnect_success'));
    } catch (e: any) {
      log.warn('Cloud disconnect failed:', e instanceof Error ? `${e.name}: ${e.message}` : String(e));
      showToast(ta('cloud_disconnect_failed'));
    }
  }, [logout]);

  /**
   * Load connection data from storage
   */
  const loadConnectionData = useCallback(async () => {
    log.info('Loading connection data, isPaired:', isPaired, 'isManuallyConnecting:', isManuallyConnecting);

    if (isPaired) {
      const mode = await ConnectionStateManager.getSecurityMode();
      setSecurityMode(mode || 'secure');

      if (mode === 'unencrypted') {
        const wsUrl = await ConnectionStateManager.getWSUrl();
        if (wsUrl) {
          const match = wsUrl.match(/ws:\/\/([^:]+):(\d+)/);
          if (match) {
            setUrl(match[1]);
            setPort(match[2]);
          }
        }
      } else {
        const wssUrl = await ConnectionStateManager.getWSSUrl();
        if (wssUrl) {
          const match = wssUrl.match(/wss:\/\/([^:]+):(\d+)/);
          if (match) {
            setUrl(match[1]);
            setPort(match[2]);
          }
        }
      }

      const cert = await ConnectionStateManager.getServerCert();
      if (cert) {
        setServerCertificate(cert);
      }

      setStatus(isConnected ? 'Connected' : 'Disconnected');
    } else {
      if (!isManuallyConnecting) {
        setUrl('192.168.1.');
        setPort('8080');
        setSecurityMode('');
        setServerCertificate('');
        setStatus('Idle');
      }
    }
  }, [isPaired, isConnected, isManuallyConnecting]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadConnectionData();
    setRefreshing(false);
  }, [loadConnectionData]);

  /**
   * Reload connection data when screen comes into focus
   */
  useFocusEffect(
    useCallback(() => {
      log.info('Screen focused, reloading connection data');
      loadConnectionData();
    }, [loadConnectionData]),
  );

  const attemptSecureConnection = async () => {
    try {
      const savedMode = await ConnectionStateManager.getSecurityMode();

      if (savedMode === 'insecure-ssl' || savedMode === 'secure') {
        setStatus('Connecting with trusted certificate...');
        const wssUrl = await ConnectionStateManager.getWSSUrl();
        if (wssUrl) {
          await connectionManager.createConnection('sync', 'sync', wssUrl, savedMode);
        } else {
          throw new Error('No server URL saved for encrypted connection');
        }
      } else {
        setStatus('Connecting unencrypted...');
      }

      setStatus('Connected successfully!');
      setIsManuallyConnecting(false);
      showToast('Successfully connected to Harmony Link!');

      setTimeout(() => {
        navigation.navigate('SyncSettings');
      }, 1000);
    } catch (err: any) {
      log.error('Secure connection failed:', err);

      const errorString = (err?.message || err?.toString?.() || JSON.stringify(err) || '').toLowerCase();
      const isCertError =
        errorString.includes('certificate') ||
        errorString.includes('ssl') ||
        errorString.includes('tls') ||
        errorString.includes('cert_') ||
        errorString.includes('trust anchor') ||
        errorString.includes('self signed') ||
        errorString.includes('unable to verify');

      if (isCertError) {
        log.info('Detected cert error in catch block - showing modal');
        setStatus('Certificate verification failed');
        setShowCertModal(true);
      } else {
        setIsManuallyConnecting(false);
        throw err;
      }
    }
  };

  const handleCertModalChoice = async (mode: 'insecure-ssl' | 'unencrypted' | 'abort') => {
    setShowCertModal(false);

    if (mode === 'abort') {
      hasSelectedSecurityModeRef.current = false;
      setStatus('Connection aborted by user');
      setIsManuallyConnecting(false);
      showToast('Connection cancelled');
      return;
    }

    hasSelectedSecurityModeRef.current = true;

    try {
      await ConnectionStateManager.saveSecurityMode(mode);

      if (mode === 'insecure-ssl') {
        setStatus('Connecting with trusted certificate...');
        const wssUrl = await ConnectionStateManager.getWSSUrl();
        if (wssUrl) {
          await connectionManager.createConnection('sync', 'sync', wssUrl, 'insecure-ssl');
        } else {
          throw new Error('No server URL saved for encrypted connection');
        }
        setStatus('Connected with trusted certificate!');
      } else if (mode === 'unencrypted') {
        setStatus('Switching to unencrypted connection...');
        connectionManager.disconnectConnection('sync');
        const wsUrl = await ConnectionStateManager.getWSUrl();
        if (!wsUrl) {
          throw new Error('No WS URL available for unencrypted connection');
        }
        await connectionManager.createConnection('sync', 'sync', wsUrl, 'unencrypted');
        setStatus('Connected unencrypted!');
      }

      setIsManuallyConnecting(false);
      showToast('Successfully connected to Harmony Link!');

      setTimeout(() => {
        navigation.navigate('SyncSettings');
      }, 1000);
    } catch (err: any) {
      log.error('Connection with selected mode failed:', err);
      setStatus('Connection failed');
      setIsManuallyConnecting(false);
      showToast('Failed to connect with selected security mode');
      showAlert('Connection Failed', 'Failed to connect: ' + (err.message || 'Unknown error'));
    }
  };

  useEffect(() => {
    loadConnectionData();

    const handleHandshakePending = (_payload: any) => {
      log.info('Handshake pending approval');
      setStatus('Waiting for approval on Harmony Link...');
    };

    const handleHandshakeAccepted = async (payload: any) => {
      log.info('Handshake accepted');
      // Fresh pairing flow — the user hasn't made a security mode choice yet,
      // so a subsequent cert failure must re-prompt (see handleCertVerificationFailed).
      hasSelectedSecurityModeRef.current = false;
      setStatus('Handshake accepted! Saving credentials...');

      try {
        await ConnectionStateManager.saveConnectionCredentials(
          payload.jwt_token,
          payload.wss_url,
          payload.server_cert,
          payload.token_expires_at,
        );

        setServerCertificate(payload.server_cert || '');
        setPendingCredentials(payload);

        setStatus('Credentials saved! Connecting securely...');

        await attemptSecureConnection();
      } catch (err: any) {
        log.error('Connection setup failed:', err);
        setStatus('Connection failed');
        setIsManuallyConnecting(false);
        showToast('Failed to establish connection');
      }
    };

    const handleHandshakeRejected = (_payload: any) => {
      log.info('Handshake rejected');
      setStatus('Connection rejected');
      setIsManuallyConnecting(false);
      showToast('Harmony Link rejected the connection request');
      showAlert(
        'Connection Rejected',
        'Harmony Link rejected the connection request. Please try again or check device approval settings on Harmony Link.',
      );
    };

    const handleConnectionError = (id: string, error: any) => {
      if (id !== 'sync') return;
      log.error('Sync connection error:', error);
      setStatus('Connection error');
      setIsManuallyConnecting(false);
      showToast('Connection error occurred');
    };

    const handleCertVerificationFailed = (error: any) => {
      log.info('Certificate verification failed:', error);

      if (!hasSelectedSecurityModeRef.current) {
        // User hasn't chosen a security mode in the current pairing flow —
        // show the certificate choice popup directly.
        setStatus('Certificate verification failed');
        setShowCertModal(true);
        return;
      }

      // The user already picked a mode, but the secure connection still
      // failed to verify the server certificate. Inform them and offer to
      // reset the security mode so they can choose a different method
      // (e.g. insecure-ssl for self-signed certs).
      log.info('Cert verification failed after mode selection - offering security mode reset');
      setStatus('Certificate verification failed');
      showAlert(
        t('certResetTitle'),
        t('certResetMessage'),
        [
          { text: t('common:cancel'), style: 'cancel' },
          {
            text: t('certResetConfirm'),
            onPress: async () => {
              try {
                await ConnectionStateManager.clearSecurityMode();
                hasSelectedSecurityModeRef.current = false;
                setSecurityMode('');
                setShowCertModal(true);
              } catch (e) {
                log.error('Failed to reset security mode:', e);
              }
            },
          },
        ],
      );
    };

    const handleCredentialsCleared = () => {
      log.info('Credentials cleared, resetting state');
      hasSelectedSecurityModeRef.current = false;
      setUrl('192.168.1.');
      setPort('8080');
      setSecurityMode('');
      setServerCertificate('');
      setStatus('Idle');
    };

    SyncService.on('handshake:pending', handleHandshakePending);
    SyncService.on('handshake:accepted', handleHandshakeAccepted);
    SyncService.on('handshake:rejected', handleHandshakeRejected);
    connectionManager.on('connection:error', handleConnectionError);
    connectionManager.on('cert:verification_failed', handleCertVerificationFailed);
    ConnectionStateManager.on('credentials:cleared', handleCredentialsCleared);

    return () => {
      SyncService.off('handshake:pending', handleHandshakePending);
      SyncService.off('handshake:accepted', handleHandshakeAccepted);
      SyncService.off('handshake:rejected', handleHandshakeRejected);
      connectionManager.off('connection:error', handleConnectionError);
      connectionManager.off('cert:verification_failed', handleCertVerificationFailed);
      ConnectionStateManager.off('credentials:cleared', handleCredentialsCleared);
    };
  }, [isPaired, isConnected, loadConnectionData]);

  const handleConnect = async () => {
    if (!url || !port) {
      showAlert('Error', 'Please enter both URL and Port');
      return;
    }

    const wsUrl = `ws://${url}:${port}/events`;
    setIsManuallyConnecting(true);
    setStatus('Connecting to Harmony Link...');

    try {
      log.info('Connecting to:', wsUrl);
      await connectionManager.createConnection('sync', 'sync', wsUrl, 'unencrypted');
      await AsyncStorage.setItem('harmony_server_url', wsUrl);
      setStatus('Connected! Sending handshake request...');
      await SyncService.requestHandshake();
    } catch (err: any) {
      log.error('Connection failed:', err);
      setStatus('Connection failed');
      setIsManuallyConnecting(false);
      showToast('Failed to connect to Harmony Link');
      showAlert(
        'Connection Failed',
        'Failed to connect to Harmony Link. Please check the IP address and port, and ensure Harmony Link is running.',
      );
    }
  };

  // ── Early return if theme not ready ───────────────────────────────────
  if (!theme) return null;

  // ── Extract theme tokens ──────────────────────────────────────────────
  const cardBg = theme.colors.background.base;
  const inputBg = theme.colors.background.surface;
  const accentColor = theme.colors.accent.primary;
  const textPrimary = theme.colors.text.primary;
  const textMuted = theme.colors.text.muted;
  const selectedCardBg = hexToRgba(accentColor, 0.08);
  const statusColor =
    radarState === 'connected'
      ? '#4CAF50'
      : radarState === 'error'
      ? '#F44336'
      : accentColor;

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
            colors={[theme!.colors.accent.primary]}
            tintColor={theme!.colors.accent.primary}
            progressBackgroundColor={theme!.colors.background.surface}
          />
        }
      >
        {/* ── Mode Toggle ── */}
        <View style={styles.section}>
          <ThemedText weight="bold" size={15} style={styles.sectionTitle}>
            {ta('mode_title')}
          </ThemedText>
          <ThemedText variant="muted" size={12} style={styles.sectionDesc}>
            {ta('mode_description')}
          </ThemedText>

          <View style={styles.modeToggleRow}>
            <ModeSelectorCard
              selected={connectionMode === 'selfhosted'}
              onPress={() => handleModeChange('selfhosted')}
              icon="home-outline"
              title={ta('mode_selfhosted')}
              description={ta('mode_selfhosted_desc')}
              accentColor={accentColor}
              bgColor={cardBg}
              selectedBgColor={selectedCardBg}
            />
            <ModeSelectorCard
              selected={connectionMode === 'cloud'}
              onPress={() => handleModeChange('cloud')}
              icon="cloud-outline"
              title={ta('mode_cloud')}
              description={ta('mode_cloud_desc')}
              accentColor={accentColor}
              bgColor={cardBg}
              selectedBgColor={selectedCardBg}
            />
          </View>

          {/* Cloud hint */}
          {connectionMode === 'cloud' && (
            <View style={styles.cloudHintRow}>
              {authStatus === 'loading' ? (
                <ThemedText variant="muted" size={12} style={styles.cloudHint}>
                  {ta('mode_cloudCheckingAuth')}
                </ThemedText>
              ) : authStatus === 'authenticated' ? (
                <>
                  <CloudProvisioningCard
                    status={cloudSession.status}
                    info={cloudSession.info}
                    isConnected={isConnected}
                    onRetry={handleRetry}
                    isRetrying={isRetrying}
                    accentColor={accentColor}
                  />

                  {/* ── Cloud action buttons ── */}
                  <View style={styles.cloudActionRow}>
                    <ThemedButton
                      label={ta('cloud_restart')}
                      onPress={handleRestart}
                      variant="outline"
                      style={styles.cloudActionButton}
                    />
                    <ThemedButton
                      label={ta('cloud_disconnect')}
                      onPress={handleDisconnectCloud}
                      variant="secondary"
                      style={styles.cloudActionButton}
                    />
                  </View>
                </>
              ) : (
                <View>
                  <ThemedText variant="accent" size={12} style={styles.cloudHint}>{ta('mode_cloudSignInRequired')}</ThemedText>
                  <ThemedButton
                    label={ta('mode_cloudSignIn')}
                    onPress={() => navigation.navigate('Login')}
                    style={{ marginTop: 8, alignSelf: 'flex-start' }}
                  />
                </View>
              )}
            </View>
          )}
        </View>

        {/* ── Self-hosted form ── */}
        {connectionMode === 'selfhosted' && (
          <View style={styles.formCard}>
            <FormField
              label={t('addressLabel')}
              value={url}
              onChangeText={setUrl}
              placeholder={t('addressPlaceholder')}
              keyboardType="url"
              editable={!isPaired}
              backgroundColor={inputBg}
              inputTextColor={textPrimary}
              inputPlaceholderColor={textMuted}
            />

            <FormField
              label={t('portLabel')}
              value={port}
              onChangeText={setPort}
              placeholder="8080"
              keyboardType="numeric"
              editable={!isPaired}
              backgroundColor={inputBg}
              inputTextColor={textPrimary}
              inputPlaceholderColor={textMuted}
            />

            {/* Security mode display */}
            {isPaired && securityMode && (
              <View style={styles.securityRow}>
                <ThemedText weight="medium" size={13} style={styles.securityLabel}>
                  {t('securityMode')}
                </ThemedText>
                <View style={styles.securityBadge}>
                  <Icon
                    name={
                      securityMode === 'secure'
                        ? 'shield-check'
                        : securityMode === 'insecure-ssl'
                        ? 'shield-alert'
                        : 'shield-off'
                    }
                    size={14}
                    color={securityMode === 'secure' ? '#4CAF50' : securityMode === 'insecure-ssl' ? '#F0A23B' : '#F44336'}
                  />
                  <ThemedText size={12} variant="secondary" style={styles.securityBadgeText}>
                    {securityMode === 'secure' && t('secureMode')}
                    {securityMode === 'insecure-ssl' && t('insecureSSlMode')}
                    {securityMode === 'unencrypted' && t('unencryptedMode')}
                  </ThemedText>
                </View>
              </View>
            )}

            {/* Status display */}
            <View style={styles.statusRow}>
              <StatusPulseDot radarState={radarState} accentColor={accentColor} size={9} glowSize={15} />
              <ThemedText weight="medium" size={13} style={{ color: statusColor, marginLeft: 8 }}>
                {status}
              </ThemedText>
            </View>

            {/* Action buttons */}
            <View style={styles.buttonGroup}>
              {!isPaired ? (
                <ThemedButton
                  label={isManuallyConnecting ? t('connecting') : t('connectPair')}
                  onPress={handleConnect}
                  disabled={isManuallyConnecting || isConnecting}
                  icon="link-variant"
                />
              ) : (
                <>
                  {!isConnected && (
                    <ThemedButton
                      label={isConnecting ? t('reconnecting') : t('reconnect')}
                      onPress={async () => {
                        try {
                          setStatus('Reconnecting...');
                          await reconnect();
                          setStatus('Connected!');
                          showToast('Reconnected successfully');
                        } catch (error: any) {
                          log.error('Manual reconnect failed:', error);
                          setStatus('Reconnection failed');
                          showToast('Failed to reconnect');
                        }
                      }}
                      disabled={isConnecting}
                      icon="refresh"
                      style={styles.actionButton}
                    />
                  )}
                  <ThemedButton
                    label={t('unpairDevice')}
                    onPress={async () => {
                      showAlert(t('unpairTitle'), t('unpairMessage'), [
                        { text: t('common:cancel'), style: 'cancel' },
                        {
                          text: t('unpair'),
                          style: 'destructive',
                          onPress: async () => {
                            hasSelectedSecurityModeRef.current = false;
                            await ConnectionStateManager.clearAllCredentials();
                            await ConnectionStateManager.clearSecurityMode();
                            connectionManager.disconnectConnection('sync');
                            setUrl('192.168.1.');
                            setPort('8080');
                            setStatus('Idle');
                            setSecurityMode('');
                            setServerCertificate('');
                            showToast('Device unpaired');
                          },
                        },
                      ]);
                    }}
                    variant="secondary"
                    icon="link-off"
                    style={styles.actionButton}
                  />
                  {securityMode && (
                    <ThemedButton
                      label={t('resetSecurityMode')}
                      onPress={() => {
                        showAlert(t('resetSecurityTitle'), t('resetSecurityMessage'), [
                          { text: t('common:cancel'), style: 'cancel' },
                          {
                            text: t('reset'),
                            style: 'destructive',
                            onPress: async () => {
                              try {
                                await ConnectionStateManager.clearSecurityMode();
                                hasSelectedSecurityModeRef.current = false;
                                setSecurityMode('');
                                showToast(t('resetToast'));
                                // Continue to the certificate choice popup so the
                                // user can pick insecure-ssl / unencrypted / abort
                                // right away instead of waiting for another attempt.
                                setShowCertModal(true);
                              } catch (e) {
                                log.error('Failed to reset security mode:', e);
                              }
                            },
                          },
                        ]);
                      }}
                      variant="outline"
                      icon="shield-refresh"
                      style={styles.actionButton}
                    />
                  )}
                </>
              )}
            </View>
          </View>
        )}
      </ScrollView>

      {/* ── Certificate modals ── */}
      <CertificateVerificationModal
        visible={showCertModal}
        onSelectMode={handleCertModalChoice}
        onViewCertificate={() => {
          setShowCertModal(false);
          setShowCertDetailsModal(true);
        }}
      />
      <CertificateDetailsModal
        visible={showCertDetailsModal}
        onClose={() => {
          setShowCertDetailsModal(false);
          setShowCertModal(true);
        }}
        certificatePem={serverCertificate}
      />
    </ThemedView>
  );
};

// ─── Styles ────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    alignItems: 'center',
    paddingBottom: 40,
  },

  // ── Section ──
  section: {
    width: '100%',
    maxWidth: 400,
    marginBottom: 24,
  },
  sectionTitle: {
    marginBottom: 2,
  },
  sectionDesc: {
    marginBottom: 16,
    opacity: 0.7,
  },

  // ── Mode toggle ──
  modeToggleRow: {
    flexDirection: 'row',
    gap: 12,
  },
  modeCard: {},
  modeCardBody: {
    borderRadius: 14,
    overflow: 'hidden',
    padding: 16,
    position: 'relative',
  },
  modeCardAccentBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 2,
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
  },
  modeCardIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
    marginTop: 4,
  },
  modeCardTitle: {
    marginBottom: 4,
  },
  modeCardDesc: {
    lineHeight: 15,
  },
  modeCardCheck: {
    position: 'absolute',
    top: 12,
    right: 12,
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // ── Cloud hint ──
  cloudHintRow: {
    marginTop: 12,
    alignItems: 'center',
  },
  cloudHint: {
    textAlign: 'center',
    opacity: 0.75,
  },

  // ── Form card ──
  formCard: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: 'transparent',
  },

  // ── Form fields ──
  fieldWrapper: {
    marginBottom: 18,
  },
  fieldLabel: {
    marginBottom: 6,
    marginLeft: 2,
  },
  fieldBody: {
    borderRadius: 12,
    overflow: 'hidden',
  },
  fieldInput: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    fontWeight: '500',
  },

  // ── Security row ──
  securityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 18,
  },
  securityLabel: {},
  securityBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(255,255,255,0.06)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
  },
  securityBadgeText: {},

  // ── Status row ──
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
    justifyContent: 'center',
  },
  cloudActionRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 12,
    justifyContent: 'center',
  },
  cloudActionButton: {
    flex: 1,
  },

  // ── Buttons ──
  buttonGroup: {
    gap: 10,
  },
  actionButton: {
    width: '100%',
  },
});
