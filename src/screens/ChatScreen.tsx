import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Appbar } from 'react-native-paper';
import { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import { CompositeScreenProps } from '@react-navigation/native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../navigation/AppNavigator';
import { BottomTabParamList } from '../navigation/BottomNavigator';
import { useAppTheme } from '../contexts/ThemeContext';
import { ThemedView } from '../components/themed/ThemedView';
import { ThemedText } from '../components/themed/ThemedText';
import { SettingsMenu } from '../components/navigation/SettingsMenu';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

type Props = CompositeScreenProps<
  BottomTabScreenProps<BottomTabParamList, 'Chat'>,
  NativeStackScreenProps<RootStackParamList>
>;

export const ChatScreen: React.FC<Props> = ({ navigation }) => {
  const { theme } = useAppTheme();
  const [menuVisible, setMenuVisible] = useState(false);

  if (!theme) return null;

  return (
    <ThemedView style={styles.container}>
      <Appbar.Header style={[styles.header, { backgroundColor: theme.colors.background.surface }]}>
        <Appbar.Content
          title="Harmony AI"
          titleStyle={{ color: theme.colors.text.primary, fontWeight: 'bold' }}
        />
        <Appbar.Action
          icon={() => <Icon name="menu" size={24} color={theme.colors.text.primary} />}
          onPress={() => setMenuVisible(true)}
        />
      </Appbar.Header>

      <View style={styles.content}>
        <ThemedText weight="bold" size={20} style={styles.placeholder}>
          Chat Interface
        </ThemedText>
        <ThemedText variant="secondary" style={styles.description}>
          Features to be implemented:
        </ThemedText>
        <ThemedText variant="muted" style={styles.featureText}>
          • Message list with chat bubbles
        </ThemedText>
        <ThemedText variant="muted" style={styles.featureText}>
          • Text input for messages
        </ThemedText>
        <ThemedText variant="muted" style={styles.featureText}>
          • Backend connection (Harmony Link)
        </ThemedText>
        <ThemedText variant="muted" style={styles.featureText}>
          • Themed chat bubbles
        </ThemedText>
      </View>

      <SettingsMenu
        visible={menuVisible}
        onClose={() => setMenuVisible(false)}
        onNavigate={(screen) => (navigation as any).navigate(screen)}
      />
    </ThemedView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    elevation: 4,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  placeholder: {
    marginBottom: 24,
  },
  description: {
    marginBottom: 16,
    fontSize: 16,
  },
  featureText: {
    marginBottom: 8,
    fontSize: 14,
  },
});
