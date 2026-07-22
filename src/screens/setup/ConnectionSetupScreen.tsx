import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  TextInput,
  Alert,
  TouchableOpacity,
  Animated,
  Easing,
} from 'react-native';
import { ActivityIndicator } from 'react-native-paper';
import LinearGradient from 'react-native-linear-gradient';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';
import { createLogger } from '../../utils/logger';
import { useAppTheme } from '../../contexts/ThemeContext';
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
import { cloudSessionService, type CloudSessionStatus } from '../../services/cloud/CloudSessionService';
import { useSyncConnection } from '../../contexts/SyncConnectionContext';
import { useAuth } from '../../contexts/AuthContext';
import { hexToRgba } from '../../utils/colorUtils';
import type { RootStackParamList } from '../../navigation/AppNavigator';

const log = createLogger('ConnectionSetupScreen');

// ─── Status category derived from status text ─────────────────────────
type RadarState = 'idle' | 'connecting' | 'waiting' | 'connected' | 'error';

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

// ─── ConnectionRadar ──────────────────────────────────────────────────
interface ConnectionRadarProps {
  radarState: RadarState;
  accentColor: string;
}

const RING_BASE_SIZE = 180;

const RadarRing: React.FC<{
  delay: number;
  radarState: RadarState;
  accentColor: string;
  ringSize: number;
}> = ({ delay, radarState, accentColor, ringSize }) => {
  const scale = useRef(new Animated.Value(1)).current;
  const opacity = useRef(new Animated.Value(0.5)).current;

  useEffect(() => {
    // Determine animation params based on radar state
    let cycleMs: number;
    let maxScale: number;
    const minOpacity = 0.08;
    const maxOpacity = 0.75;

    switch (radarState) {
      case 'connecting':
        cycleMs = 1100;
        maxScale = 2.0;
        break;
      case 'waiting':
        cycleMs = 1800;
        maxScale = 1.6;
        break;
      case 'connected':
        cycleMs = 3500;
        maxScale = 1.3;
        break;
      case 'error':
        cycleMs = 0; // static
        maxScale = 1.15;
        break;
      case 'idle':
      default:
        cycleMs = 2500;
        maxScale = 1.55;
        break;
    }

    if (cycleMs === 0) {
      // Static ring for error state
      scale.setValue(1.15);
      opacity.setValue(0.4);
      return;
    }

    const halfCycle = cycleMs / 2;

    const anim = Animated.loop(
      Animated.parallel([
        Animated.sequence([
          Animated.timing(scale, {
            toValue: maxScale,
            duration: halfCycle,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
          }),
          Animated.timing(scale, {
            toValue: 1,
            duration: halfCycle,
            easing: Easing.in(Easing.cubic),
            useNativeDriver: true,
          }),
        ]),
        Animated.sequence([
          Animated.timing(opacity, {
            toValue: minOpacity,
            duration: halfCycle,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
          }),
          Animated.timing(opacity, {
            toValue: maxOpacity,
            duration: halfCycle,
            easing: Easing.in(Easing.cubic),
            useNativeDriver: true,
          }),
        ]),
      ]),
    );

    // Staggered start
    const timer = setTimeout(() => anim.start(), delay);

    return () => {
      clearTimeout(timer);
      anim.stop();
    };
  }, [radarState, delay, scale, opacity]);

  const halfRing = ringSize / 2;

  return (
    <Animated.View
      style={[
        styles.radarRing,
        {
          width: ringSize,
          height: ringSize,
          borderRadius: halfRing,
          borderColor: accentColor + 'CC',
          borderWidth: 2.5,
          opacity,
          transform: [{ scale }],
        },
      ]}
      pointerEvents="none"
    />
  );
};

const ConnectionRadar: React.FC<ConnectionRadarProps> = ({ radarState, accentColor }) => {
  // Center dot pulse animation
  const dotPulse = useRef(new Animated.Value(1)).current;
  const dotOpacity = useRef(new Animated.Value(0.95)).current;

  useEffect(() => {
    let cycleMs: number;
    switch (radarState) {
      case 'connecting':
        cycleMs = 600;
        break;
      case 'waiting':
        cycleMs = 900;
        break;
      case 'connected':
        cycleMs = 2000;
        break;
      case 'error':
        cycleMs = 0;
        break;
      case 'idle':
      default:
        cycleMs = 1500;
        break;
    }

    if (cycleMs === 0) {
      dotPulse.setValue(1);
      dotOpacity.setValue(0.9);
      return;
    }

    const halfCycle = cycleMs / 2;

    const anim = Animated.loop(
      Animated.parallel([
        Animated.sequence([
          Animated.timing(dotPulse, {
            toValue: 1.12,
            duration: halfCycle,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
          }),
          Animated.timing(dotPulse, {
            toValue: 1,
            duration: halfCycle,
            easing: Easing.in(Easing.cubic),
            useNativeDriver: true,
          }),
        ]),
        Animated.sequence([
          Animated.timing(dotOpacity, {
            toValue: 0.6,
            duration: halfCycle * 0.8,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
          }),
          Animated.timing(dotOpacity, {
            toValue: 0.95,
            duration: halfCycle * 1.2,
            easing: Easing.in(Easing.cubic),
            useNativeDriver: true,
          }),
        ]),
      ]),
    );

    anim.start();
    return () => anim.stop();
  }, [radarState, dotPulse, dotOpacity]);

  // Dot color by state
  const dotColor = useMemo(() => {
    switch (radarState) {
      case 'connected':
        return '#4CAF50';
      case 'error':
        return '#F44336';
      case 'waiting':
        return '#F0A23B';
      case 'connecting':
        return accentColor;
      default:
        return accentColor;
    }
  }, [radarState, accentColor]);

  return (
    <View style={styles.radarContainer}>
      {/* Outer glow ring */}
      <View
        style={[
          styles.radarGlow,
          {
            width: RING_BASE_SIZE + 48,
            height: RING_BASE_SIZE + 48,
            borderRadius: (RING_BASE_SIZE + 48) / 2,
            backgroundColor: accentColor + '15',
          },
        ]}
        pointerEvents="none"
      />

      {/* Animated rings — staggered */}
      <RadarRing delay={0} radarState={radarState} accentColor={accentColor} ringSize={RING_BASE_SIZE} />
      <RadarRing delay={300} radarState={radarState} accentColor={accentColor} ringSize={RING_BASE_SIZE - 40} />
      <RadarRing delay={600} radarState={radarState} accentColor={accentColor} ringSize={RING_BASE_SIZE - 80} />

      {/* Center dot — a concentric set of circles for a soft radial glow */}
      <View style={styles.centerDotWrapper} pointerEvents="none">
        {/* Outer halo */}
        <View
          style={[
            styles.centerDotHalo,
            {
              backgroundColor: dotColor + '28',
              shadowColor: dotColor,
              shadowOpacity: 0.5,
              shadowRadius: 18,
            },
          ]}
        />
        {/* Mid glow */}
        <View
          style={[
            styles.centerDotMid,
            {
              backgroundColor: dotColor + '44',
            },
          ]}
        />
        {/* Core dot */}
        <Animated.View
          style={[
            styles.centerDotCore,
            {
              backgroundColor: dotColor,
              opacity: dotOpacity,
              transform: [{ scale: dotPulse }],
            },
          ]}
        />
      </View>
    </View>
  );
};

// ─── GlassFormField ────────────────────────────────────────────────────
interface GlassFormFieldProps {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  keyboardType?: 'default' | 'url' | 'numeric';
  editable?: boolean;
  accentColor: string;
  borderGradientStart: string;
  borderGradientEnd: string;
  backgroundColor: string;
}

const GlassFormField: React.FC<GlassFormFieldProps> = ({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType = 'default',
  editable = true,
  accentColor,
  borderGradientStart,
  borderGradientEnd,
  backgroundColor,
}) => (
  <View style={styles.glassFieldWrapper}>
    <ThemedText weight="medium" size={13} style={styles.glassFieldLabel}>
      {label}
    </ThemedText>
    <LinearGradient
      colors={[borderGradientStart, borderGradientEnd]}
      start={{ x: 0.15, y: 0 }}
      end={{ x: 0.85, y: 1 }}
      style={styles.glassFieldBorder}
    >
      <View style={[styles.glassFieldBody, { backgroundColor }]}>
        <TextInput
          style={[styles.glassFieldInput, { opacity: editable ? 1 : 0.55 }]}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor="#6b6780"
          keyboardType={keyboardType}
          autoCapitalize="none"
          autoCorrect={false}
          editable={editable}
        />
        {/* Subtle inner shimmer at top-left */}
        <LinearGradient
          colors={['rgba(255,255,255,0.06)', 'transparent']}
          start={{ x: 0, y: 0 }}
          end={{ x: 0.6, y: 0.4 }}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />
      </View>
    </LinearGradient>
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
  borderStart: string;
  borderEnd: string;
  bgColor: string;
  selectedBgColor: string;
  borderDefault: string;
}

const ModeSelectorCard: React.FC<ModeSelectorCardProps> = ({
  selected,
  onPress,
  icon,
  title,
  description,
  accentColor,
  borderStart,
  borderEnd,
  bgColor,
  selectedBgColor,
  borderDefault,
}) => (
  <TouchableOpacity
    style={[styles.modeCard, { flex: 1 }]}
    onPress={onPress}
    activeOpacity={0.7}
  >
    <LinearGradient
      colors={
        selected ? [borderStart, borderEnd] : [borderDefault + '44', borderDefault + '22']
      }
      start={{ x: 0.15, y: 0 }}
      end={{ x: 0.85, y: 1 }}
      style={[styles.modeCardBorder, { flex: 1 }]}
    >
      <View style={[styles.modeCardBody, { flex: 1, backgroundColor: selected ? selectedBgColor : bgColor }]}>
        {/* Selected accent highlight at top */}
        {selected && (
          <LinearGradient
            colors={[accentColor + '30', 'transparent']}
            start={{ x: 0, y: 0 }}
            end={{ x: 0, y: 0.6 }}
            style={StyleSheet.absoluteFill}
            pointerEvents="none"
          />
        )}

        <View style={[styles.modeCardIconWrap, { backgroundColor: accentColor + (selected ? '22' : '10') }]}>
          <Icon name={icon} size={24} color={selected ? accentColor : '#6b6780'} />
        </View>

        <ThemedText
          weight="bold"
          size={14}
          variant="primary"
          style={styles.modeCardTitle}
        >
          {title}
        </ThemedText>
        <ThemedText size={12} variant={selected ? 'secondary' : 'muted'} style={styles.modeCardDesc}>
          {description}
        </ThemedText>

        {/* Selected checkmark */}
        {selected && (
          <View style={[styles.modeCardCheck, { backgroundColor: accentColor }]}>
            <Icon name="check" size={10} color="#fff" />
          </View>
        )}
      </View>
    </LinearGradient>
  </TouchableOpacity>
);

// ─── StatusPulseDot ────────────────────────────────────────────────────
interface StatusPulseDotProps {
  radarState: RadarState;
  accentColor: string;
  size?: number;
  glowSize?: number;
}

const StatusPulseDot: React.FC<StatusPulseDotProps> = ({
  radarState,
  accentColor,
  size = 10,
  glowSize = 16,
}) => {
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const glowOpacity = useRef(new Animated.Value(0.35)).current;

  useEffect(() => {
    if (radarState === 'error') {
      pulseAnim.setValue(1);
      glowOpacity.setValue(0.45);
      return;
    }

    let cycleMs: number;
    switch (radarState) {
      case 'connecting':
        cycleMs = 600;
        break;
      case 'connected':
        cycleMs = 2000;
        break;
      default:
        cycleMs = 1500;
        break;
    }

    const half = cycleMs / 2;

    const anim = Animated.loop(
      Animated.parallel([
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1.3,
            duration: half,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: half,
            easing: Easing.in(Easing.cubic),
            useNativeDriver: true,
          }),
        ]),
        Animated.sequence([
          Animated.timing(glowOpacity, {
            toValue: 0.15,
            duration: half,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
          }),
          Animated.timing(glowOpacity, {
            toValue: 0.35,
            duration: half,
            easing: Easing.in(Easing.cubic),
            useNativeDriver: true,
          }),
        ]),
      ]),
    );

    anim.start();
    return () => anim.stop();
  }, [radarState, pulseAnim, glowOpacity]);

  const dotColor = useMemo(() => {
    switch (radarState) {
      case 'connected':
        return '#4CAF50';
      case 'error':
        return '#F44336';
      case 'waiting':
        return '#F0A23B';
      case 'connecting':
        return accentColor;
      default:
        return accentColor;
    }
  }, [radarState, accentColor]);

  const halfGlow = glowSize / 2;

  return (
    <View style={[styles.statusDotOuter, { width: glowSize, height: glowSize }]}>
      <Animated.View
        style={[
          styles.statusDotGlow,
          {
            width: glowSize,
            height: glowSize,
            borderRadius: halfGlow,
            backgroundColor: dotColor,
            opacity: glowOpacity,
          },
        ]}
      />
      <Animated.View
        style={[
          styles.statusDotCore,
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            backgroundColor: dotColor,
            transform: [{ scale: pulseAnim }],
          },
        ]}
      />
    </View>
  );
};

// ─── Main Screen ───────────────────────────────────────────────────────

export const ConnectionSetupScreen: React.FC = () => {
  const { theme } = useAppTheme();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { showToast, isPaired, isConnected, isConnecting, reconnect } = useSyncConnection();
  const { t } = useTranslation('connection');
  const { t: ta } = useTranslation('auth');
  const { status: authStatus } = useAuth();

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

  // ── Cloud session status ──────────────────────────────────────────────
  const [cloudStatus, setCloudStatus] = useState<CloudSessionStatus>(cloudSessionService.getStatus());

  useEffect(() => {
    const onStatus = (s: CloudSessionStatus) => setCloudStatus(s);
    cloudSessionService.on('status', onStatus);
    return () => {
      cloudSessionService.off('status', onStatus);
    };
  }, []);

  // Apply mode change (mutation)
  const applyModeChange = useCallback(
    (mode: 'selfhosted' | 'cloud') => {
      setConnectionMode(mode);
      AsyncStorage.setItem('connection_mode', mode).catch(() => {});
      if (mode === 'cloud') {
        if (authStatus === 'authenticated') {
          cloudSessionService.connect().catch(e => log.warn('Cloud session connect failed on mode switch:', e));
        } else if (authStatus === 'unauthenticated') {
          navigation.navigate('Login');
        }
      }
    },
    [authStatus, navigation],
  );

  const handleModeChange = useCallback(
    (mode: 'selfhosted' | 'cloud') => {
      if (mode === connectionMode) return;

      Alert.alert(
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
  const [showCertModal, setShowCertModal] = useState(false);
  const [showCertDetailsModal, setShowCertDetailsModal] = useState(false);
  const [serverCertificate, setServerCertificate] = useState<string>('');
  const [pendingCredentials, setPendingCredentials] = useState<any>(null);
  const [securityMode, setSecurityMode] = useState<string>('');

  const connectionManager = ConnectionManager;

  const hasSelectedSecurityModeRef = useRef(false);

  // ── Derived radar state ───────────────────────────────────────────────
  const radarState = useMemo(() => classifyStatus(status), [status]);

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
    hasSelectedSecurityModeRef.current = true;
    setShowCertModal(false);

    if (mode === 'abort') {
      setStatus('Connection aborted by user');
      setIsManuallyConnecting(false);
      showToast('Connection cancelled');
      return;
    }

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
      Alert.alert('Connection Failed', 'Failed to connect: ' + (err.message || 'Unknown error'));
    }
  };

  useEffect(() => {
    loadConnectionData();

    const handleHandshakePending = (payload: any) => {
      log.info('Handshake pending approval');
      setStatus('Waiting for approval on Harmony Link...');
    };

    const handleHandshakeAccepted = async (payload: any) => {
      log.info('Handshake accepted');
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

    const handleHandshakeRejected = (payload: any) => {
      log.info('Handshake rejected');
      setStatus('Connection rejected');
      setIsManuallyConnecting(false);
      showToast('Harmony Link rejected the connection request');
      Alert.alert(
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
        setStatus('Certificate verification failed');
        setShowCertModal(true);
      } else {
        log.info('Ignoring cert error - user already selected security mode');
      }
    };

    const handleCredentialsCleared = () => {
      log.info('Credentials cleared, resetting state');
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
      Alert.alert('Error', 'Please enter both URL and Port');
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
      Alert.alert(
        'Connection Failed',
        'Failed to connect to Harmony Link. Please check the IP address and port, and ensure Harmony Link is running.',
      );
    }
  };

  // ── Early return if theme not ready ───────────────────────────────────
  if (!theme) return null;

  // ── Extract theme tokens ──────────────────────────────────────────────
  const { borderGradientStart, borderGradientEnd } = theme.colors.glass;
  const elevatedBg = hexToRgba(theme.colors.background.elevated, theme.colors.glass.cardOpacity);
  const surfaceBg = hexToRgba(theme.colors.background.surface, theme.colors.glass.cardOpacity * 0.65);
  const inputBg = hexToRgba(theme.colors.background.surface, 0.35);
  const accentColor = theme.colors.accent.primary;
  const borderDefault = theme.colors.border.default;
  const statusColor =
    radarState === 'connected'
      ? '#4CAF50'
      : radarState === 'error'
      ? '#F44336'
      : accentColor;

  // Shared glass card wrapper
  const GlassCard: React.FC<{ children: React.ReactNode; style?: any }> = ({ children, style }) => (
    <View
      style={[
        {
          shadowColor: theme.colors.accent.primary,
          shadowOffset: { width: 0, height: 4 },
          shadowOpacity: theme.colors.glass.glowOpacity,
          shadowRadius: theme.colors.glass.glowRadius,
          elevation: 6,
        },
        style,
      ]}
    >
      <LinearGradient
        colors={[borderGradientStart, borderGradientEnd]}
        start={{ x: 0.15, y: 0 }}
        end={{ x: 0.85, y: 1 }}
        style={styles.glassCardBorder}
      >
        <View style={[styles.glassCardBody, { backgroundColor: elevatedBg }]}>
          {/* Specular sweep */}
          <LinearGradient
            colors={['rgba(255,255,255,0.08)', 'transparent']}
            start={{ x: 0, y: 0 }}
            end={{ x: 0.7, y: 1 }}
            style={StyleSheet.absoluteFill}
            pointerEvents="none"
          />
          {children}
        </View>
      </LinearGradient>
    </View>
  );

  return (
    <ThemedView style={styles.container}>
      <ScreenHeader title={t('title')} onBack={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* ── Hero: Connection Radar ── */}
        <GlassCard style={styles.radarCard}>
          <ConnectionRadar radarState={radarState} accentColor={accentColor} />
          <View style={styles.radarLabelRow}>
            <StatusPulseDot radarState={radarState} accentColor={accentColor} size={8} glowSize={14} />
            <ThemedText variant="secondary" size={13} style={styles.radarLabel}>
              {status}
            </ThemedText>
          </View>
          <ThemedText variant="secondary" size={12} style={styles.radarHint}>
            {isPaired
              ? t('descriptionPaired')
              : t('descriptionUnpaired')}
          </ThemedText>
        </GlassCard>

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
              borderStart={borderGradientStart}
              borderEnd={borderGradientEnd}
              bgColor={surfaceBg}
              selectedBgColor={hexToRgba(accentColor, 0.1)}
              borderDefault={borderDefault}
            />
            <ModeSelectorCard
              selected={connectionMode === 'cloud'}
              onPress={() => handleModeChange('cloud')}
              icon="cloud-outline"
              title={ta('mode_cloud')}
              description={ta('mode_cloud_desc')}
              accentColor={accentColor}
              borderStart={borderGradientStart}
              borderEnd={borderGradientEnd}
              bgColor={surfaceBg}
              selectedBgColor={hexToRgba(accentColor, 0.1)}
              borderDefault={borderDefault}
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
                cloudStatus === 'spawning' ? (
                  <View style={styles.cloudSpawningRow}>
                    <ActivityIndicator size="small" color={accentColor} />
                    <ThemedText variant="secondary" size={12} style={styles.cloudHint}>
                      {ta('cloud_spawning')}
                    </ThemedText>
                  </View>
                ) : cloudStatus === 'ready' ? (
                  <View style={styles.cloudSpawningRow}>
                    <StatusPulseDot radarState="connected" accentColor={accentColor} size={8} glowSize={12} />
                    <ThemedText size={12} variant="success" style={styles.cloudHint}>
                      {ta('cloud_ready')}
                    </ThemedText>
                  </View>
                ) : cloudStatus === 'error' ? (
                  <ThemedText size={12} style={[styles.cloudHint, { color: '#F44336' }]}>
                    {ta('cloud_error')}
                  </ThemedText>
                ) : (
                  <ThemedText variant="secondary" size={12} style={styles.cloudHint}>
                    {ta('mode_cloudReady')}
                  </ThemedText>
                )
              ) : (
                <TouchableOpacity onPress={() => navigation.navigate('Login')}>
                  <ThemedText variant="accent" size={12} style={styles.cloudHint}>
                    {ta('mode_cloudSignInRequired')}
                  </ThemedText>
                </TouchableOpacity>
              )}
            </View>
          )}
        </View>

        {/* ── Self-hosted form ── */}
        {connectionMode === 'selfhosted' && (
          <GlassCard style={styles.formCard}>
            <GlassFormField
              label={t('addressLabel')}
              value={url}
              onChangeText={setUrl}
              placeholder={t('addressPlaceholder')}
              keyboardType="url"
              editable={!isPaired}
              accentColor={accentColor}
              borderGradientStart={borderGradientStart}
              borderGradientEnd={borderGradientEnd}
              backgroundColor={inputBg}
            />

            <GlassFormField
              label={t('portLabel')}
              value={port}
              onChangeText={setPort}
              placeholder="8080"
              keyboardType="numeric"
              editable={!isPaired}
              accentColor={accentColor}
              borderGradientStart={borderGradientStart}
              borderGradientEnd={borderGradientEnd}
              backgroundColor={inputBg}
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
                      Alert.alert(t('unpairTitle'), t('unpairMessage'), [
                        { text: t('common:cancel'), style: 'cancel' },
                        {
                          text: t('unpair'),
                          style: 'destructive',
                          onPress: async () => {
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
                      onPress={async () => {
                        Alert.alert(t('resetSecurityTitle'), t('resetSecurityMessage'), [
                          { text: t('common:cancel'), style: 'cancel' },
                          {
                            text: t('reset'),
                            style: 'destructive',
                            onPress: async () => {
                              await ConnectionStateManager.clearSecurityMode();
                              setSecurityMode('secure');
                              showToast('Security mode reset');
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
          </GlassCard>
        )}
      </ScrollView>

      {/* ── Certificate modals (unchanged) ── */}
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

  // ── Glass card shared ──
  glassCardBorder: {
    borderRadius: 16,
    padding: StyleSheet.hairlineWidth,
  },
  glassCardBody: {
    borderRadius: 15,
    overflow: 'hidden',
    padding: 20,
  },

  // ── Radar section ──
  radarCard: {
    width: '100%',
    maxWidth: 400,
    marginBottom: 24,
    alignItems: 'center',
  },
  radarContainer: {
    width: RING_BASE_SIZE + 48,
    height: RING_BASE_SIZE + 48,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  radarGlow: {
    position: 'absolute',
  },
  radarRing: {
    position: 'absolute',
    borderWidth: 1.5,
    backgroundColor: 'transparent',
  },
  centerDotWrapper: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  centerDotHalo: {
    position: 'absolute',
    width: 48,
    height: 48,
    borderRadius: 24,
    shadowOffset: { width: 0, height: 0 },
    elevation: 8,
  },
  centerDotMid: {
    position: 'absolute',
    width: 28,
    height: 28,
    borderRadius: 14,
  },
  centerDotCore: {
    width: 14,
    height: 14,
    borderRadius: 7,
    shadowColor: '#fff',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 4,
  },
  radarLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  radarLabel: {
    textTransform: 'capitalize',
  },
  radarHint: {
    textAlign: 'center',
    marginTop: 4,
    lineHeight: 17,
    maxWidth: '90%',
    alignSelf: 'center',
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
  modeCardBorder: {
    borderRadius: 14,
    padding: StyleSheet.hairlineWidth,
    width: '100%',
    height: '100%',
  },
  modeCardBody: {
    borderRadius: 13,
    overflow: 'hidden',
    padding: 16,
    position: 'relative',
  },
  modeCardIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
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
  cloudSpawningRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },

  // ── Form card ──
  formCard: {
    width: '100%',
    maxWidth: 400,
  },

  // ── Glass form fields ──
  glassFieldWrapper: {
    marginBottom: 18,
  },
  glassFieldLabel: {
    marginBottom: 6,
    marginLeft: 2,
  },
  glassFieldBorder: {
    borderRadius: 12,
    padding: StyleSheet.hairlineWidth,
  },
  glassFieldBody: {
    borderRadius: 11,
    overflow: 'hidden',
  },
  glassFieldInput: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: '#f0edf6',
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

  // ── Status dot (pulse) ──
  statusDotOuter: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusDotGlow: {
    position: 'absolute',
  },
  statusDotCore: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.3,
    shadowRadius: 3,
    elevation: 3,
  },

  // ── Buttons ──
  buttonGroup: {
    gap: 10,
  },
  actionButton: {
    width: '100%',
  },
});
