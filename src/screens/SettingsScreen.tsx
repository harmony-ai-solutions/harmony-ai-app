import React, { useState, useEffect } from 'react';
import { View, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { Appbar } from 'react-native-paper';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../navigation/AppNavigator';
import { useAppTheme } from '../contexts/ThemeContext';
import { useSyncConnection } from '../contexts/SyncConnectionContext';
import { ThemedView } from '../components/themed/ThemedView';
import { ThemedText } from '../components/themed/ThemedText';
import { ThemedButton } from '../components/themed/ThemedButton';
import { SettingsMenu } from '../components/navigation/SettingsMenu';

type Nav = NativeStackNavigationProp<RootStackParamList>;
type ConnectionType = 'Harmony Link' | 'Cloud' | 'Not configured';

export const SettingsScreen: React.FC = () => {
  const navigation = useNavigation<Nav>();
  const { theme } = useAppTheme();
  const { isConnected, isPaired, isReconnecting } = useSyncConnection();

  const [menuVisible, setMenuVisible] = useState(false);
  const [connectionType, setConnectionType] =
    useState<ConnectionType>('Not configured');
  const [lastSyncTime, setLastSyncTime] = useState<string>('Never');

  useEffect(() => {
    const loadData = async () => {
      // Connection type
      const wsUrl = await AsyncStorage.getItem('harmony_ws_url');
      const wssUrl = await AsyncStorage.getItem('harmony_wss_url');
      if (wsUrl || wssUrl) {
        setConnectionType('Harmony Link');
      } else {
        setConnectionType('Not configured');
      }

      // Last sync time
      const ts = await AsyncStorage.getItem('last_sync_timestamp');
      if (ts) {
        const date = new Date(parseInt(ts) * 1000);
        setLastSyncTime(date.toLocaleString());
      }
    };
    loadData();
  }, []);

  const connectionStatusText = isConnected
    ? 'Connected'
    : isReconnecting
      ? 'Reconnecting…'
      : isPaired
        ? 'Disconnected'
        : 'Not paired';

  const connectionStatusColor = isConnected
    ? (theme?.colors.status?.success ?? '#4caf50')
    : isReconnecting || isPaired
      ? (theme?.colors.status?.warning ?? '#ff9800')
      : (theme?.colors.status?.error ?? '#f44336');

  const syncStatusText = isConnected ? '✓ Up to date' : '⚠ Offline';

  if (!theme) return null;

  return (
    <ThemedView style={styles.container}>
      {/* Header */}
      <Appbar.Header
        style={[
          styles.header,
          { backgroundColor: theme.colors.background.surface },
        ]}
      >
        <Appbar.BackAction
          color={theme.colors.text.primary}
          onPress={() => navigation.goBack()}
        />
        <Appbar.Content
          title="Settings"
          titleStyle={{ color: theme.colors.text.primary, fontWeight: 'bold' }}
        />
        <Appbar.Action
          icon="menu"
          color={theme.colors.text.primary}
          onPress={() => setMenuVisible(true)}
        />
      </Appbar.Header>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Connection Card ── */}
        <View
          style={[
            styles.card,
            {
              backgroundColor: theme.colors.background.elevated,
              borderColor: theme.colors.border.default,
            },
          ]}
        >
          <ThemedText
            weight="bold"
            size={14}
            variant="muted"
            style={styles.cardTitle}
          >
            CONNECTION
          </ThemedText>

          <View style={styles.row}>
            <ThemedText variant="secondary">Type</ThemedText>
            <ThemedText weight="bold">{connectionType}</ThemedText>
          </View>

          <View style={styles.row}>
            <ThemedText variant="secondary">Status</ThemedText>
            <View style={styles.statusRow}>
              <View
                style={[
                  styles.statusDot,
                  { backgroundColor: connectionStatusColor },
                ]}
              />
              <ThemedText weight="bold">{connectionStatusText}</ThemedText>
            </View>
          </View>

          <ThemedButton
            variant="outline"
            label="Configure Connection"
            onPress={() => navigation.navigate('ConnectionSetup')}
            style={styles.cardButton}
          />
        </View>

        {/* ── Sync Card ── */}
        <View
          style={[
            styles.card,
            {
              backgroundColor: theme.colors.background.elevated,
              borderColor: theme.colors.border.default,
            },
          ]}
        >
          <ThemedText
            weight="bold"
            size={14}
            variant="muted"
            style={styles.cardTitle}
          >
            SYNC
          </ThemedText>

          <View style={styles.row}>
            <ThemedText variant="secondary">Last Sync</ThemedText>
            <ThemedText weight="bold">{lastSyncTime}</ThemedText>
          </View>

          <View style={styles.row}>
            <ThemedText variant="secondary">Status</ThemedText>
            <ThemedText weight="bold">{syncStatusText}</ThemedText>
          </View>

          <ThemedButton
            variant="outline"
            label="Sync Settings"
            onPress={() => navigation.navigate('SyncSettings')}
            style={styles.cardButton}
          />
        </View>

        {/* ── Account Card ── */}
        <View
          style={[
            styles.card,
            {
              backgroundColor: theme.colors.background.elevated,
              borderColor: theme.colors.border.default,
            },
          ]}
        >
          <ThemedText
            weight="bold"
            size={14}
            variant="muted"
            style={styles.cardTitle}
          >
            ACCOUNT
          </ThemedText>

          <SettingsLinkRow
            icon="account-circle"
            label="User Profile"
            onPress={() => navigation.navigate('ProfileSettings')}
            theme={theme}
          />
          <SettingsLinkRow
            icon="palette"
            label="Appearance & Theme"
            onPress={() => navigation.navigate('ThemeSettings')}
            theme={theme}
            badge="⭐"
          />
        </View>

        {/* ── Development Card (DEV only) ── */}
        {__DEV__ && (
          <View
            style={[
              styles.card,
              {
                backgroundColor: theme.colors.background.elevated,
                borderColor: theme.colors.border.default,
              },
            ]}
          >
            <ThemedText
              weight="bold"
              size={14}
              variant="muted"
              style={styles.cardTitle}
            >
              DEVELOPMENT
            </ThemedText>
            <SettingsLinkRow
              icon="test-tube"
              label="Database Tests"
              badge="DEV"
              onPress={() => navigation.navigate('DatabaseTests')}
              theme={theme}
            />
            <SettingsLinkRow
              icon="database-eye"
              label="Database Table Viewer"
              badge="DEV"
              onPress={() => navigation.navigate('DatabaseTableViewer')}
              theme={theme}
            />
          </View>
        )}
      </ScrollView>

      <SettingsMenu
        visible={menuVisible}
        onClose={() => setMenuVisible(false)}
        onNavigate={screen => navigation.navigate(screen as any)}
      />
    </ThemedView>
  );
};

// ─── Local helper component ──────────────────────────────────────────────────

interface SettingsLinkRowProps {
  icon: string;
  label: string;
  onPress: () => void;
  theme: any;
  badge?: string;
}

const SettingsLinkRow: React.FC<SettingsLinkRowProps> = ({
  icon,
  label,
  onPress,
  theme,
  badge,
}) => (
  <TouchableOpacity
    style={[styles.linkRow, { borderBottomColor: theme.colors.border.default }]}
    onPress={onPress}
    activeOpacity={0.7}
  >
    <Icon
      name={icon}
      size={22}
      color={theme.colors.accent.primary}
      style={styles.linkIcon}
    />
    <ThemedText style={styles.linkLabel}>{label}</ThemedText>
    {badge && (
      <ThemedText variant="muted" size={12} style={styles.badge}>
        {badge}
      </ThemedText>
    )}
    <Icon name="chevron-right" size={20} color={theme.colors.text.muted} />
  </TouchableOpacity>
);

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { elevation: 4 },
  scrollContent: {
    padding: 16,
    paddingBottom: 32,
    gap: 16,
  },
  card: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 16,
    gap: 12,
  },
  cardTitle: {
    letterSpacing: 0.8,
    marginBottom: 4,
  },
  cardButton: {
    marginTop: 4,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  linkIcon: {
    marginRight: 14,
  },
  linkLabel: {
    flex: 1,
    fontSize: 15,
  },
  badge: {
    marginRight: 8,
  },
});
