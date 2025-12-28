import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text, Appbar } from 'react-native-paper';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../navigation/AppNavigator';
import { colors } from '../theme/colors';

type Props = NativeStackScreenProps<RootStackParamList, 'Chat'>;

export const ChatScreen: React.FC<Props> = ({ navigation }) => {
  return (
    <View style={styles.container}>
      <Appbar.Header style={styles.header}>
        <Appbar.BackAction onPress={() => navigation.goBack()} />
        <Appbar.Content title="Chat" />
      </Appbar.Header>
      
      <View style={styles.content}>
        <Text variant="bodyLarge" style={styles.placeholder}>
          Chat Interface Placeholder
        </Text>
        <Text variant="bodyMedium" style={styles.description}>
          Features to be implemented:
        </Text>
        <Text variant="bodySmall" style={styles.featureText}>
          • Message list with chat bubbles
        </Text>
        <Text variant="bodySmall" style={styles.featureText}>
          • Text input for messages
        </Text>
        <Text variant="bodySmall" style={styles.featureText}>
          • Backend connection (Harmony Link / Cloud)
        </Text>
        <Text variant="bodySmall" style={styles.featureText}>
          • Local AI model integration
        </Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    backgroundColor: colors.surface,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  placeholder: {
    color: colors.text.primary,
    marginBottom: 24,
    fontWeight: 'bold',
  },
  description: {
    color: colors.text.secondary,
    marginBottom: 16,
  },
  featureText: {
    color: colors.text.secondary,
    marginBottom: 8,
  },
});
