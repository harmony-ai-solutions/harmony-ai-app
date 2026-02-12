import React, { useState } from 'react';
import { Modal, View, StyleSheet, TouchableOpacity } from 'react-native';
import { ThemedText } from '../themed/ThemedText';
import { ThemedView } from '../themed/ThemedView';
import { ThemedButton } from '../themed/ThemedButton';
import { useAppTheme } from '../../contexts/ThemeContext';

interface CertificateVerificationModalProps {
  visible: boolean;
  onSelectMode: (mode: 'insecure-ssl' | 'unencrypted' | 'abort') => void;
  onViewCertificate?: () => void;
}

export const CertificateVerificationModal: React.FC<CertificateVerificationModalProps> = ({
  visible,
  onSelectMode,
  onViewCertificate,
}) => {
  const { theme } = useAppTheme();
  const [selectedMode, setSelectedMode] = useState<'insecure-ssl' | 'unencrypted' | null>(null);

  if (!theme) return null;

  const handleConfirm = () => {
    if (selectedMode) {
      onSelectMode(selectedMode);
    }
  };

  const handleAbort = () => {
    setSelectedMode(null);
    onSelectMode('abort');
  };

  const RadioOption = ({ 
    value, 
    label, 
    description 
  }: { 
    value: 'insecure-ssl' | 'unencrypted';
    label: string; 
    description: string; 
  }) => (
    <TouchableOpacity
      style={[
        styles.radioContainer,
        { borderColor: selectedMode === value ? theme.colors.accent.primary : theme.colors.text.muted }
      ]}
      onPress={() => setSelectedMode(value)}
    >
      <View style={styles.radioCircle}>
        {selectedMode === value && (
          <View style={[styles.radioSelected, { backgroundColor: theme.colors.accent.primary }]} />
        )}
      </View>
      <View style={styles.radioContent}>
        <ThemedText weight="medium">{label}</ThemedText>
        <ThemedText variant="secondary" size={12} style={styles.radioDescription}>
          {description}
        </ThemedText>
      </View>
    </TouchableOpacity>
  );

  return (
    <Modal
      visible={visible}
      transparent={true}
      animationType="fade"
      onRequestClose={handleAbort}
    >
      <View style={styles.overlay}>
        <ThemedView style={styles.modal}>
          <ThemedText size={20} weight="bold" style={styles.title}>
            Certificate Verification Failed
          </ThemedText>
          
          <ThemedText style={styles.description}>
            The server's SSL certificate could not be verified. This is common with self-signed certificates. Choose how to proceed:
          </ThemedText>

          <View style={styles.optionsContainer}>
            <RadioOption
              value="insecure-ssl"
              label="Trust This Certificate"
              description="Use encrypted connection but skip certificate validation. Recommended for self-signed certificates on trusted networks."
            />
            
            <RadioOption
              value="unencrypted"
              label="Use Unencrypted Connection"
              description="Connect without SSL/TLS encryption. Only use on secure private networks."
            />
          </View>

          {onViewCertificate && (
            <TouchableOpacity onPress={onViewCertificate} style={styles.certLink}>
              <ThemedText 
                style={{ color: theme.colors.accent.primary }} 
                size={14}
              >
                View Certificate Details
              </ThemedText>
            </TouchableOpacity>
          )}

          <View style={styles.buttonContainer}>
            <ThemedButton
              label="Continue"
              onPress={handleConfirm}
              disabled={!selectedMode}
              style={styles.confirmButton}
            />
            <ThemedButton
              label="Cancel"
              onPress={handleAbort}
              variant="secondary"
              style={styles.cancelButton}
            />
          </View>

          <ThemedText variant="secondary" style={styles.note}>
            ⚠️ Your choice will be saved for this device
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
    maxWidth: 450,
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
    marginBottom: 12,
  },
  description: {
    textAlign: 'center',
    marginBottom: 20,
    lineHeight: 20,
  },
  optionsContainer: {
    marginBottom: 16,
    gap: 12,
  },
  radioContainer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: 12,
    borderRadius: 8,
    borderWidth: 2,
  },
  radioCircle: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: '#888',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 2,
  },
  radioSelected: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  radioContent: {
    flex: 1,
    marginLeft: 12,
  },
  radioDescription: {
    marginTop: 4,
    lineHeight: 16,
  },
  certLink: {
    alignItems: 'center',
    marginBottom: 16,
  },
  buttonContainer: {
    gap: 10,
    marginTop: 8,
  },
  confirmButton: {
    marginBottom: 0,
  },
  cancelButton: {
    marginBottom: 0,
  },
  note: {
    textAlign: 'center',
    fontSize: 11,
    marginTop: 12,
    opacity: 0.7,
  },
});
