import React, { useState, useEffect } from 'react';
import { View, StyleSheet, ScrollView, Alert, TouchableOpacity } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useAppTheme } from '../../contexts/ThemeContext';
import { useSyncConnection } from '../../contexts/SyncConnectionContext';
import { ThemedText } from '../../components/themed/ThemedText';
import { ThemedView } from '../../components/themed/ThemedView';
import { ThemedButton } from '../../components/themed/ThemedButton';
import SyncService, { SyncSession } from '../../services/SyncService';
import ConnectionStateManager from '../../services/ConnectionStateManager';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createLogger } from '../../utils/logger';
import type { RootStackParamList } from '../../navigation/AppNavigator';

const log = createLogger('[SyncSettingsScreen]');

export const SyncSettingsScreen: React.FC = () => {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();

  const { theme } = useAppTheme();
  const { isConnected, isPaired, isReconnecting, reconnectAttempt, nextReconnectIn, showToast } = useSyncConnection();
  const [currentSession, setCurrentSession] = useState<SyncSession | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSyncTime, setLastSyncTime] = useState<string>('Never');
  const [securityMode, setSecurityMode] = useState<string>('');
  const [countdown, setCountdown] = useState<number>(0);

  useEffect(() => {
    // Load last sync time and security mode on mount
    const loadSettings = async () => {
      const timestamp = await AsyncStorage.getItem('last_sync_timestamp');
      if (timestamp) {
        const date = new Date(parseInt(timestamp) * 1000);
        setLastSyncTime(date.toLocaleString());
      }
      
      const mode = await ConnectionStateManager.getSecurityMode();
      if (mode) {
        setSecurityMode(mode);
      } else {
        setSecurityMode('secure');
      }
    };
    loadSettings();

    const progressListener = (session: SyncSession) => {
      setCurrentSession({ ...session });
      setIsSyncing(session.status === 'in_progress' || session.status === 'pending');
    };

    const completedListener = (session: SyncSession) => {
      setCurrentSession(null);
      setIsSyncing(false);
      setLastSyncTime(new Date().toLocaleString());
      // Toast is handled by SyncConnectionContext
    };

    const errorListener = (error: string) => {
      setIsSyncing(false);
      // Error toast is handled by SyncConnectionContext
    };

    SyncService.on('sync:progress', progressListener);
    SyncService.on('sync:completed', completedListener);
    SyncService.on('sync:error', errorListener);
    
    return () => {
      SyncService.removeListener('sync:progress', progressListener);
      SyncService.removeListener('sync:completed', completedListener);
      SyncService.removeListener('sync:error', errorListener);
    };
  }, []);

  // Dynamic countdown timer for reconnection
  useEffect(() => {
    if (!isReconnecting || nextReconnectIn <= 0) {
      setCountdown(0);
      return;
    }

    // Initialize countdown
    setCountdown(Math.ceil(nextReconnectIn / 1000));

    // Update countdown every second
    const interval = setInterval(() => {
      setCountdown((prev) => {
        const next = prev - 1;
        return next > 0 ? next : 0;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [isReconnecting, nextReconnectIn]);

  const handleSyncNow = async () => {
    if (!isConnected) {
      Alert.alert('Not Connected', 'Please connect to Harmony Link first from the Connection Setup screen.');
      return;
    }

    try {
      setIsSyncing(true);
      await SyncService.initiateSync();
    } catch (err: any) {
      setIsSyncing(false);
      showToast('Failed to start sync: ' + err.message);
      Alert.alert('Error', 'Failed to start sync: ' + err.message);
    }
  };

  const getConnectionStatusText = () => {
    if (!isPaired) {
      return 'Not Paired';
    }
    if (isConnected) {
      return 'Connected to Harmony Link';
    }
    if (isReconnecting) {
      if (reconnectAttempt === 0) {
        return 'Connection lost - Reconnecting...';
      } else {
        const retryText = countdown > 0 ? ` in ${countdown}s` : '...';
        return `Reconnecting (${reconnectAttempt} failed retries)${retryText}`;
      }
    }
    return 'Disconnected';
  };

  const getConnectionStatusColor = () => {
    if (!isPaired) {
      return '#FF9800'; // Orange
    }
    if (isConnected) {
      return '#4CAF50'; // Green
    }
    if (isReconnecting) {
      return '#FFC107'; // Amber - attempting to reconnect
    }
    return '#F44336'; // Red
  };

  const getSecurityModeDisplay = () => {
    switch (securityMode) {
      case 'secure':
        return '🔒 Secure (Verified SSL)';
      case 'insecure-ssl':
        return '🔓 Trusted Certificate (Self-Signed)';
      case 'unencrypted':
        return '⚠️ Unencrypted (No SSL)';
      default:
        return 'Not configured';
    }
  };

  const handleResetSecurityMode = async () => {
    Alert.alert(
      'Reset Security Mode',
      'This will clear your security preference and you will be prompted to choose a connection method on next connection attempt.',
      [
        { text: 'Cancel', style: 'cancel' },
        { 
          text: 'Reset', 
          style: 'destructive',
          onPress: async () => {
            await ConnectionStateManager.clearSecurityMode();
            setSecurityMode('secure');
            showToast('Security mode reset');
          }
        }
      ]
    );
  };

  if (!theme) return null;

  return (
    <ThemedView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <ThemedText size={24} weight="bold" style={styles.title}>Data Synchronization</ThemedText>
        
        <TouchableOpacity 
          onPress={() => navigation.navigate('ConnectionSetup')}
          activeOpacity={0.7}
        >
          <ThemedView style={styles.card}>
            <ThemedText weight="medium" style={styles.cardTitle}>Sync Status</ThemedText>
            <View style={styles.row}>
              <ThemedText variant="secondary">Last Synchronized:</ThemedText>
              <ThemedText>{lastSyncTime}</ThemedText>
            </View>
            <View style={styles.row}>
              <ThemedText variant="secondary">Connection:</ThemedText>
              <ThemedText style={{ color: getConnectionStatusColor() }}>
                {getConnectionStatusText()}
              </ThemedText>
            </View>
            {isPaired && (
              <View style={styles.row}>
                <ThemedText variant="secondary">Security Mode:</ThemedText>
                <ThemedText size={12}>{getSecurityModeDisplay()}</ThemedText>
              </View>
            )}
            <ThemedText variant="secondary" size={10} style={styles.tapHint}>
              Tap to view connection details →
            </ThemedText>
          </ThemedView>
        </TouchableOpacity>


        {isSyncing && currentSession && (
          <ThemedView style={styles.card}>
            <ThemedText weight="medium" style={styles.cardTitle}>Syncing in Progress...</ThemedText>
            <ThemedText variant="secondary" style={styles.progressText}>
              Status: {currentSession.status}
            </ThemedText>
            <View style={styles.statsRow}>
              <View style={styles.statItem}>
                <ThemedText size={20} weight="bold">{currentSession.recordsSent}</ThemedText>
                <ThemedText variant="secondary" size={12}>Records Sent</ThemedText>
              </View>
              <View style={styles.statItem}>
                <ThemedText size={20} weight="bold">{currentSession.recordsReceived}</ThemedText>
                <ThemedText variant="secondary" size={12}>Records Received</ThemedText>
              </View>
            </View>
          </ThemedView>
        )}

        <ThemedButton
          label={isSyncing ? "Syncing..." : "Sync Now"}
          onPress={handleSyncNow}
          disabled={isSyncing || !isConnected}
          style={styles.syncButton}
        />

        {isPaired && securityMode && (
          <ThemedButton
            label="Reset Security Mode"
            onPress={handleResetSecurityMode}
            variant="ghost"
            style={styles.resetButton}
          />
        )}

        {!isPaired && (
          <ThemedText variant="secondary" style={styles.warningText}>
            ⚠️ Not paired with Harmony Link. Go to Connection Setup to pair your device.
          </ThemedText>
        )}

        {isPaired && !isConnected && !isReconnecting && (
          <ThemedText variant="secondary" style={styles.warningText}>
            ⚠️ Not connected. Attempting to reconnect...
          </ThemedText>
        )}
        
        {isPaired && isReconnecting && (
          <ThemedText variant="secondary" style={styles.infoText}>
            🔄 Auto-reconnect in progress. The connection will be restored automatically.
          </ThemedText>
        )}

        <ThemedText variant="secondary" style={styles.infoText}>
          Synchronizing will update your characters, messages, and settings with the latest changes from Harmony Link.
        </ThemedText>
      </ScrollView>
    </ThemedView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    padding: 20,
  },
  title: {
    marginBottom: 20,
  },
  card: {
    backgroundColor: 'rgba(150, 150, 150, 0.1)',
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
  },
  cardTitle: {
    marginBottom: 12,
    fontSize: 16,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  progressText: {
    marginBottom: 16,
    textTransform: 'capitalize',
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingVertical: 10,
  },
  statItem: {
    alignItems: 'center',
  },
  syncButton: {
    marginTop: 10,
    marginBottom: 10,
  },
  resetButton: {
    marginBottom: 20,
  },
  infoText: {
    textAlign: 'center',
    fontSize: 12,
    paddingHorizontal: 20,
  },
  warningText: {
    textAlign: 'center',
    fontSize: 14,
    paddingHorizontal: 20,
    marginTop: 10,
    opacity: 0.8,
  },
  tapHint: {
    marginTop: 12,
    textAlign: 'right',
    opacity: 0.6,
  },
});
