import React from 'react';
import { Modal, View, StyleSheet } from 'react-native';
import { ThemedText } from '../themed/ThemedText';
import { ThemedView } from '../themed/ThemedView';
import { ThemedButton } from '../themed/ThemedButton';

interface InitialPairingModalProps {
  visible: boolean;
  onPair: () => void;
  onMaybeLater: () => void;
}

export const InitialPairingModal: React.FC<InitialPairingModalProps> = ({
  visible,
  onPair,
  onMaybeLater
}) => {
  return (
    <Modal
      visible={visible}
      transparent={true}
      animationType="fade"
      onRequestClose={onMaybeLater}
    >
      <View style={styles.overlay}>
        <ThemedView style={styles.modal}>
          <ThemedText size={24} weight="bold" style={styles.title}>
            Welcome to Harmony AI
          </ThemedText>
          
          <ThemedText style={styles.description}>
            Would you like to connect to Harmony Link to sync your characters, messages, and settings across devices?
          </ThemedText>
          
          <View style={styles.features}>
            <ThemedText style={styles.feature}>✓ Sync characters across devices</ThemedText>
            <ThemedText style={styles.feature}>✓ Backup your data</ThemedText>
            <ThemedText style={styles.feature}>✓ Access from multiple devices</ThemedText>
          </View>
          
          <View style={styles.buttonContainer}>
            <ThemedButton
              label="Connect to Harmony Link"
              onPress={onPair}
              style={styles.primaryButton}
            />
            <ThemedButton
              label="Maybe Later"
              onPress={onMaybeLater}
              variant="secondary"
              style={styles.secondaryButton}
            />
          </View>
          
          <ThemedText variant="secondary" style={styles.note}>
            You can always connect later from Settings
          </ThemedText>
        </ThemedView>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modal: {
    width: '100%',
    maxWidth: 400,
    borderRadius: 16,
    padding: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  title: {
    textAlign: 'center',
    marginBottom: 16,
  },
  description: {
    textAlign: 'center',
    marginBottom: 20,
    lineHeight: 22,
  },
  features: {
    marginBottom: 24,
  },
  feature: {
    marginBottom: 8,
    paddingLeft: 8,
  },
  buttonContainer: {
    gap: 12,
  },
  primaryButton: {
    marginBottom: 0,
  },
  secondaryButton: {
    marginBottom: 0,
  },
  note: {
    textAlign: 'center',
    fontSize: 12,
    marginTop: 16,
    opacity: 0.7,
  },
});
