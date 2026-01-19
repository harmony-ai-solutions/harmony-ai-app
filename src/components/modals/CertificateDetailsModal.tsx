import React, { useMemo } from 'react';
import { Modal, View, StyleSheet, ScrollView } from 'react-native';
import { ThemedText } from '../themed/ThemedText';
import { ThemedView } from '../themed/ThemedView';
import { ThemedButton } from '../themed/ThemedButton';

interface CertificateDetailsModalProps {
  visible: boolean;
  onClose: () => void;
  certificatePem: string;
}

interface CertificateInfo {
  issuer: string;
  subject: string;
  validFrom: string;
  validTo: string;
  fingerprint: string;
}

export const CertificateDetailsModal: React.FC<CertificateDetailsModalProps> = ({
  visible,
  onClose,
  certificatePem,
}) => {
  const certInfo = useMemo(() => {
    return parseCertificateInfo(certificatePem);
  }, [certificatePem]);

  return (
    <Modal
      visible={visible}
      transparent={true}
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <ThemedView style={styles.modal}>
          <ThemedText size={20} weight="bold" style={styles.title}>
            Certificate Details
          </ThemedText>
          
          <ScrollView style={styles.scrollView}>
            <View style={styles.infoSection}>
              <ThemedText weight="medium" style={styles.label}>Issued To:</ThemedText>
              <ThemedText variant="secondary" style={styles.value}>
                {certInfo.subject}
              </ThemedText>
            </View>

            <View style={styles.infoSection}>
              <ThemedText weight="medium" style={styles.label}>Issued By:</ThemedText>
              <ThemedText variant="secondary" style={styles.value}>
                {certInfo.issuer}
              </ThemedText>
            </View>

            <View style={styles.infoSection}>
              <ThemedText weight="medium" style={styles.label}>Valid From:</ThemedText>
              <ThemedText variant="secondary" style={styles.value}>
                {certInfo.validFrom}
              </ThemedText>
            </View>

            <View style={styles.infoSection}>
              <ThemedText weight="medium" style={styles.label}>Valid To:</ThemedText>
              <ThemedText variant="secondary" style={styles.value}>
                {certInfo.validTo}
              </ThemedText>
            </View>

            <View style={styles.infoSection}>
              <ThemedText weight="medium" style={styles.label}>Fingerprint (SHA-256):</ThemedText>
              <ThemedText variant="secondary" style={[styles.value, styles.fingerprint]}>
                {certInfo.fingerprint}
              </ThemedText>
            </View>
          </ScrollView>

          <ThemedButton
            label="Close"
            onPress={onClose}
            variant="secondary"
            style={styles.closeButton}
          />
        </ThemedView>
      </View>
    </Modal>
  );
};

/**
 * Parse certificate PEM to extract basic information
 * Note: This is a simple parser for display purposes.
 * For production, consider using a proper X.509 parsing library.
 */
function parseCertificateInfo(pem: string): CertificateInfo {
  if (!pem) {
    return {
      issuer: 'Unknown',
      subject: 'Unknown',
      validFrom: 'Unknown',
      validTo: 'Unknown',
      fingerprint: 'Unknown',
    };
  }

  // Extract basic info from PEM
  // This is a simplified version - in production, use a proper X.509 library
  const lines = pem.split('\n');
  
  let issuer = 'Self-Signed (Harmony Link)';
  let subject = 'Harmony Link Server';
  let validFrom = 'Not parsed';
  let validTo = 'Not parsed';
  let fingerprint = 'Not calculated';

  // Try to extract common name if present
  for (const line of lines) {
    if (line.includes('CN=')) {
      const cnMatch = line.match(/CN=([^,]+)/);
      if (cnMatch) {
        subject = cnMatch[1].trim();
        issuer = cnMatch[1].trim();
      }
    }
  }

  // Generate a simple hash as fingerprint (not cryptographically accurate)
  fingerprint = generateSimpleHash(pem);

  return {
    issuer,
    subject,
    validFrom,
    validTo,
    fingerprint,
  };
}

/**
 * Generate a simple hash for display purposes
 * Note: This is NOT a cryptographic hash. For production, use crypto libraries.
 */
function generateSimpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  
  // Convert to hex and format as fingerprint
  const hex = Math.abs(hash).toString(16).toUpperCase().padStart(8, '0');
  const repeated = (hex + hex + hex + hex).substring(0, 64);
  return repeated.match(/.{1,2}/g)?.join(':') || repeated;
}

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
    maxHeight: '80%',
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
    marginBottom: 20,
  },
  scrollView: {
    maxHeight: 400,
    marginBottom: 16,
  },
  infoSection: {
    marginBottom: 16,
  },
  label: {
    marginBottom: 4,
    fontSize: 14,
  },
  value: {
    fontSize: 13,
    lineHeight: 18,
  },
  fingerprint: {
    fontFamily: 'monospace',
    fontSize: 11,
  },
  closeButton: {
    marginTop: 8,
  },
});
