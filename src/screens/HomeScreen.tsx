import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text, Button } from 'react-native-paper';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../navigation/AppNavigator';
import { colors } from '../theme/colors';

type Props = NativeStackScreenProps<RootStackParamList, 'Home'>;

export const HomeScreen: React.FC<Props> = ({ navigation }) => {
  return (
    <View style={styles.container}>
      <View style={styles.content}>
        <Text variant="headlineLarge" style={styles.title}>
          Harmony AI
        </Text>
        <Text variant="bodyLarge" style={styles.subtitle}>
          Your AI Companion
        </Text>
        <Text variant="bodyMedium" style={styles.description}>
          Connect with AI characters powered by your own backend or Harmony Cloud
        </Text>
        
        <Button
          mode="contained"
          onPress={() => navigation.navigate('Chat')}
          style={styles.button}
          contentStyle={styles.buttonContent}
        >
          Start Chat
        </Button>
        
        <Text variant="bodySmall" style={styles.footer}>
          Bootstrap Complete - Core Functionality Ready
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
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  title: {
    color: colors.primary,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  subtitle: {
    color: colors.text.primary,
    marginBottom: 16,
  },
  description: {
    color: colors.text.secondary,
    textAlign: 'center',
    marginBottom: 32,
    maxWidth: 300,
  },
  button: {
    marginTop: 16,
  },
  buttonContent: {
    paddingVertical: 8,
    paddingHorizontal: 24,
  },
  footer: {
    marginTop: 48,
    color: colors.text.disabled,
  },
});
