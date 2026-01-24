import React, { useState, useEffect, useCallback, useRef } from 'react';
import { View, StyleSheet, ScrollView, TextInput, Alert } from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useAppTheme } from '../../contexts/ThemeContext';
import { ThemedText } from '../../components/themed/ThemedText';
import { ThemedView } from '../../components/themed/ThemedView';
import { ThemedButton } from '../../components/themed/ThemedButton';
import { CertificateVerificationModal } from '../../components/modals/CertificateVerificationModal';
import { CertificateDetailsModal } from '../../components/modals/CertificateDetailsModal';
import AsyncStorage from '@react-native-async-storage/async-storage';
import ConnectionManager from '../../services/connection/ConnectionManager';
import SyncService from '../../services/SyncService';
import ConnectionStateManager from '../../services/ConnectionStateManager';
import { useSyncConnection } from '../../contexts/SyncConnectionContext';
import type { RootStackParamList } from '../../navigation/AppNavigator';

export const ConnectionSetupScreen: React.FC = () => {
  const { theme } = useAppTheme();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { showToast, isPaired, isConnected, isConnecting, reconnect } = useSyncConnection();
  
  const [url, setUrl] = useState('192.168.1.');
  const [port, setPort] = useState('8080');
  const [status, setStatus] = useState('Idle');
  const [isManuallyConnecting, setIsManuallyConnecting] = useState(false);
  const [showCertModal, setShowCertModal] = useState(false);
  const [showCertDetailsModal, setShowCertDetailsModal] = useState(false);
  const [serverCertificate, setServerCertificate] = useState<string>('');
  const [pendingCredentials, setPendingCredentials] = useState<any>(null);
  const [securityMode, setSecurityMode] = useState<string>('');
  
  const connectionManager = ConnectionManager;
  
  // Use ref to track security mode selection without causing re-renders
  const hasSelectedSecurityModeRef = useRef(false);

  /**
   * Load connection data from storage
   */
  const loadConnectionData = useCallback(async () => {
    console.log('[ConnectionSetupScreen] Loading connection data, isPaired:', isPaired, 'isManuallyConnecting:', isManuallyConnecting);
    
    if (isPaired) {
      const mode = await ConnectionStateManager.getSecurityMode();
      setSecurityMode(mode || 'secure');
      
      // Load URL and port based on security mode
      if (mode === 'unencrypted') {
        // For unencrypted, use WS URL
        const wsUrl = await ConnectionStateManager.getWSUrl();
        if (wsUrl) {
          const match = wsUrl.match(/ws:\/\/([^:]+):(\d+)/);
          if (match) {
            setUrl(match[1]);
            setPort(match[2]);
          }
        }
      } else {
        // For secure/insecure-ssl, use WSS URL
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
      // Not paired - only reset to defaults if we're not in the middle of connecting
      if (!isManuallyConnecting) {
        setUrl('192.168.1.');
        setPort('8080');
        setSecurityMode('');
        setServerCertificate('');
        setStatus('Idle');
      }
      // If we're connecting, keep the current status (e.g., "Waiting for approval...")
    }
  }, [isPaired, isConnected, isManuallyConnecting]);

  /**
   * Reload connection data when screen comes into focus
   */
  useFocusEffect(
    useCallback(() => {
      console.log('[ConnectionSetupScreen] Screen focused, reloading connection data');
      loadConnectionData();
    }, [loadConnectionData])
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
        // Already connected via ws:// during handshake, just verify
      }
      
      setStatus('Connected successfully!');
      setIsManuallyConnecting(false);
      showToast('Successfully connected to Harmony Link!');
      
      // Navigate back after a short delay
      setTimeout(() => {
        navigation.navigate('SyncSettings');
      }, 1000);
    } catch (err: any) {
      console.error('[ConnectionSetupScreen] Secure connection failed:', err);
      
      // Check if this is a certificate error
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
        console.log('[ConnectionSetupScreen] Detected cert error in catch block - showing modal');
        setStatus('Certificate verification failed');
        setShowCertModal(true);
        // Don't re-throw - we're handling it with the modal
      } else {
        // For non-cert errors, re-throw to be handled by outer catch
        setIsManuallyConnecting(false);
        throw err;
      }
    }
  };


  const handleCertModalChoice = async (mode: 'insecure-ssl' | 'unencrypted' | 'abort') => {
    // Mark that user has made a security choice to prevent modal from reopening
    hasSelectedSecurityModeRef.current = true;
    setShowCertModal(false);
    
    if (mode === 'abort') {
      setStatus('Connection aborted by user');
      setIsManuallyConnecting(false);
      showToast('Connection cancelled');
      return;
    }
    
    try {
      // Save the security mode preference
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
        // Disconnect secure and reconnect unencrypted
        connectionManager.disconnectConnection('sync');
        // Use the original WS URL (different port than WSS)
        const wsUrl = await ConnectionStateManager.getWSUrl();
        if (!wsUrl) {
          throw new Error('No WS URL available for unencrypted connection');
        }
        await connectionManager.createConnection('sync', 'sync', wsUrl, 'unencrypted');
        setStatus('Connected unencrypted!');
      }
      
      setIsManuallyConnecting(false);
      showToast('Successfully connected to Harmony Link!');
      
      // Navigate back after a short delay
      setTimeout(() => {
        navigation.navigate('SyncSettings');
      }, 1000);
    } catch (err: any) {
      console.error('[ConnectionSetupScreen] Connection with selected mode failed:', err);
      setStatus('Connection failed');
      setIsManuallyConnecting(false);
      showToast('Failed to connect with selected security mode');
      Alert.alert('Connection Failed', 'Failed to connect: ' + (err.message || 'Unknown error'));
    }
  };

  useEffect(() => {
    // Load connection data on mount and when isPaired/isConnected changes
    loadConnectionData();

    const handleHandshakePending = (payload: any) => {
      console.log('[ConnectionSetupScreen] Handshake pending approval');
      setStatus('Waiting for approval on Harmony Link...');
    };

    const handleHandshakeAccepted = async (payload: any) => {
      console.log('[ConnectionSetupScreen] Handshake accepted');
      setStatus('Handshake accepted! Saving credentials...');
      
      try {
        // Save credentials using ConnectionStateManager
        await ConnectionStateManager.saveConnectionCredentials(
          payload.jwt_token,
          payload.wss_url,
          payload.server_cert,
          payload.token_expires_at
        );
        
        setServerCertificate(payload.server_cert || '');
        setPendingCredentials(payload);
        
        setStatus('Credentials saved! Connecting securely...');
        
        // Try to connect with saved security mode, or default to secure
        await attemptSecureConnection();
      } catch (err: any) {
        console.error('[ConnectionSetupScreen] Connection setup failed:', err);
        setStatus('Connection failed');
        setIsManuallyConnecting(false);
        showToast('Failed to establish connection');
      }
    };

    const handleHandshakeRejected = (payload: any) => {
      console.log('[ConnectionSetupScreen] Handshake rejected');
      setStatus('Connection rejected');
      setIsManuallyConnecting(false);
      showToast('Harmony Link rejected the connection request');
      Alert.alert('Connection Rejected', 'Harmony Link rejected the connection request. Please try again or check device approval settings on Harmony Link.');
    };

    const handleConnectionError = (id: string, error: any) => {
      if (id !== 'sync') return;
      console.error('[ConnectionSetupScreen] Sync connection error:', error);
      setStatus('Connection error');
      setIsManuallyConnecting(false);
      showToast('Connection error occurred');
    };

    const handleCertVerificationFailed = (error: any) => {
      console.log('[ConnectionSetupScreen] Certificate verification failed:', error);
      // Only show modal if user hasn't already made a security choice
      if (!hasSelectedSecurityModeRef.current) {
        setStatus('Certificate verification failed');
        setShowCertModal(true);
      } else {
        console.log('[ConnectionSetupScreen] Ignoring cert error - user already selected security mode');
      }
    };

    const handleCredentialsCleared = () => {
      console.log('[ConnectionSetupScreen] Credentials cleared, resetting state');
      // Reset local state immediately
      setUrl('192.168.1.');
      setPort('8080');
      setSecurityMode('');
      setServerCertificate('');
      setStatus('Idle');
    };

    // Subscribe to events
    SyncService.on('handshake:pending', handleHandshakePending);
    SyncService.on('handshake:accepted', handleHandshakeAccepted);
    SyncService.on('handshake:rejected', handleHandshakeRejected);
    connectionManager.on('connection:error', handleConnectionError);
    connectionManager.on('cert:verification_failed', handleCertVerificationFailed);
    ConnectionStateManager.on('credentials:cleared', handleCredentialsCleared);

    return () => {
      // Cleanup
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
      console.log('[ConnectionSetupScreen] Connecting to:', wsUrl);
      await connectionManager.createConnection('sync', 'sync', wsUrl, 'unencrypted');
      await AsyncStorage.setItem('harmony_server_url', wsUrl);
      setStatus('Connected! Sending handshake request...');
      await SyncService.requestHandshake();
    } catch (err: any) {
      console.error('[ConnectionSetupScreen] Connection failed:', err);
      setStatus('Connection failed');
      setIsManuallyConnecting(false);
      showToast('Failed to connect to Harmony Link');
      Alert.alert('Connection Failed', 'Failed to connect to Harmony Link. Please check the IP address and port, and ensure Harmony Link is running.');
    }
  };

  if (!theme) return null;

  return (
    <ThemedView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <ThemedText size={24} weight="bold" style={styles.title}>Harmony Link Sync</ThemedText>
        <ThemedText variant="secondary" style={styles.description}>
          {isPaired 
            ? 'View and manage your Harmony Link connection settings.' 
            : 'Connect your app to Harmony Link to sync characters, messages, and configurations across devices.'}
        </ThemedText>

        <View style={styles.form}>
          <ThemedText weight="medium">Harmony Link IP Address</ThemedText>
          <TextInput
            style={[styles.input, { color: theme.colors.text.primary }]}
            value={url}
            onChangeText={setUrl}
            placeholder="e.g. 192.168.1.10"
            placeholderTextColor={theme.colors.text.muted}
            keyboardType="numeric"
            editable={!isPaired}
          />

          <ThemedText weight="medium">Port</ThemedText>
          <TextInput
            style={[styles.input, { color: theme.colors.text.primary }]}
            value={port}
            onChangeText={setPort}
            placeholder="8080"
            placeholderTextColor={theme.colors.text.muted}
            keyboardType="numeric"
            editable={!isPaired}
          />

          {isPaired && securityMode && (
            <>
              <ThemedText weight="medium">Security Mode</ThemedText>
              <View style={[styles.input, { justifyContent: 'center' }]}>
                <ThemedText>
                  {securityMode === 'secure' && '🔒 Secure (Verified SSL)'}
                  {securityMode === 'insecure-ssl' && '🔓 Trusted Certificate (Self-Signed)'}
                  {securityMode === 'unencrypted' && '⚠️ Unencrypted (No SSL)'}
                </ThemedText>
              </View>
            </>
          )}

          <View style={styles.statusContainer}>
            <ThemedText>Status: </ThemedText>
            <ThemedText weight="medium" style={[styles.statusText, { 
              color: isPaired ? (isConnected ? '#4CAF50' : '#F44336') : theme.colors.accent.primary 
            }]}>
              {status}
            </ThemedText>
          </View>

          {!isPaired ? (
            <ThemedButton
              label={isManuallyConnecting ? "Connecting..." : "Connect & Pair"}
              onPress={handleConnect}
              disabled={isManuallyConnecting || isConnecting}
            />
          ) : (
            <View style={styles.pairedActions}>
              {!isConnected && (
                <ThemedButton
                  label={isConnecting ? "Reconnecting..." : "Reconnect"}
                  onPress={async () => {
                    try {
                      setStatus('Reconnecting...');
                      await reconnect();
                      setStatus('Connected!');
                      showToast('Reconnected successfully');
                    } catch (error: any) {
                      console.error('[ConnectionSetupScreen] Manual reconnect failed:', error);
                      setStatus('Reconnection failed');
                      showToast('Failed to reconnect');
                    }
                  }}
                  disabled={isConnecting}
                  style={styles.reconnectButton}
                />
              )}
              <ThemedButton
                label="Unpair Device"
                onPress={async () => {
                Alert.alert(
                  'Unpair Device',
                  'This will remove all pairing data. You will need to pair again to sync with Harmony Link.',
                  [
                    { text: 'Cancel', style: 'cancel' },
                    {
                      text: 'Unpair',
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
                      }
                    }
                  ]
                );
                }}
                variant="secondary"
              />
            </View>
          )}

        </View>

      </ScrollView>

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

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    padding: 20,
    alignItems: 'center',
  },
  title: {
    marginBottom: 10,
  },
  description: {
    textAlign: 'center',
    marginBottom: 30,
    opacity: 0.8,
  },
  form: {
    width: '100%',
    maxWidth: 400,
  },
  input: {
    backgroundColor: 'rgba(150, 150, 150, 0.1)',
    borderRadius: 8,
    padding: 12,
    marginTop: 8,
    marginBottom: 20,
    fontSize: 16,
  },
  statusContainer: {
    flexDirection: 'row',
    marginBottom: 20,
    justifyContent: 'center',
  },
  statusText: {
    // Color applied dynamically via theme
  },
  pairedActions: {
    gap: 10,
  },
  reconnectButton: {
    marginBottom: 10,
  },
});
