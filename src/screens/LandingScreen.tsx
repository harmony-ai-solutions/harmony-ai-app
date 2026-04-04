import React from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { Appbar } from 'react-native-paper';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../navigation/AppNavigator';
import { useAppTheme } from '../contexts/ThemeContext';
import { ThemedView } from '../components/themed/ThemedView';
import { ThemedText } from '../components/themed/ThemedText';
import { LandingCard } from '../components/landing/LandingCard';
import { ConnectionStatusBadge } from '../components/settings/ConnectionStatusBadge';
import { ThemedGradient } from '../components/themed/ThemedGradient';
import { getAppVersion } from '../utils/version';

type Nav = NativeStackNavigationProp<RootStackParamList>;

export const LandingScreen: React.FC = () => {
  const navigation = useNavigation<Nav>();
  const { theme } = useAppTheme();

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
        <Appbar.Content
          title="Harmony AI"
          titleStyle={{
            color: theme.colors.text.primary,
            fontWeight: 'bold',
            fontSize: 20,
          }}
        />
        {/* Connection status dot */}
        <ConnectionStatusBadge />
        {/* Settings shortcut */}
        <Appbar.Action
          icon="cog"
          color={theme.colors.text.primary}
          onPress={() => navigation.navigate('Settings')}
        />
      </Appbar.Header>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Branded gradient stripe at the top */}
        <ThemedGradient gradient="primary" style={styles.gradientAccent} />

        {/* Hero: AI Chat card */}
        <LandingCard
          icon="chat-processing"
          title="AI Chat"
          description="Continue your conversations with AI partners"
          variant="hero"
          onPress={() => navigation.navigate('ChatList')}
          style={styles.heroCard}
        />

        {/* Secondary row: Characters + Settings */}
        <View style={styles.secondaryRow}>
          <LandingCard
            icon="account-group"
            title="Characters"
            description="Manage AI character profiles"
            variant="secondary"
            onPress={() => navigation.navigate('Characters')}
          />
          <LandingCard
            icon="tune"
            title="Settings"
            description="Connection, sync & account"
            variant="secondary"
            onPress={() => navigation.navigate('Settings')}
          />
        </View>

        {/* Footer */}
        <View style={styles.footer}>
          <ThemedText variant="muted" size={11}>
            Harmony AI · v{getAppVersion()}
          </ThemedText>
        </View>
      </ScrollView>
    </ThemedView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    elevation: 0,
  },
  scrollContent: {
    padding: 16,
    gap: 16,
    flexGrow: 1,
  },
  gradientAccent: {
    height: 4,
    borderRadius: 2,
    marginBottom: 8,
  },
  heroCard: {
    marginBottom: 4,
  },
  secondaryRow: {
    flexDirection: 'row',
    gap: 12,
  },
  footer: {
    marginTop: 'auto',
    paddingTop: 24,
    paddingBottom: 16,
    alignItems: 'center',
  },
});
