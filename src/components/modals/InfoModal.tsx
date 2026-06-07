import React from 'react';
import { Modal, View, StyleSheet, TouchableOpacity } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { ThemedText } from '../themed/ThemedText';
import { ThemedView } from '../themed/ThemedView';
import { useAppTheme } from '../../contexts/ThemeContext';

interface InfoModalProps {
  visible: boolean;
  onClose: () => void;
  title: string;
  message: string;
  icon?: string;
}

export const InfoModal: React.FC<InfoModalProps> = ({
  visible,
  onClose,
  title,
  message,
  icon = 'information'
}) => {
  const { theme } = useAppTheme();

  return (
    <Modal
      visible={visible}
      transparent={true}
      animationType="fade"
      onRequestClose={onClose}
    >
      <TouchableOpacity 
        style={styles.overlay} 
        activeOpacity={1} 
        onPress={onClose}
      >
        <ThemedView style={styles.modal}>
          <TouchableOpacity 
            style={styles.closeButton} 
            onPress={onClose}
          >
            <Icon name="close" size={20} color={theme?.colors.text.secondary} />
          </TouchableOpacity>
          
          <View style={styles.iconContainer}>
            <Icon name={icon} size={32} color={theme?.colors.accent.primary} />
          </View>
          
          <ThemedText size={20} weight="bold" style={styles.title}>
            {title}
          </ThemedText>
          
          {message.split('\\n\\n').map((paragraph, index) => (
            <ThemedText
              key={index}
              variant="secondary"
              style={[styles.message, index > 0 && styles.paragraphSpacing]}
            >
              {paragraph}
            </ThemedText>
          ))}
        </ThemedView>
      </TouchableOpacity>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24
  },
  modal: {
    width: '100%',
    maxWidth: 320,
    borderRadius: 16,
    padding: 24,
    alignItems: 'center'
  },
  closeButton: {
    position: 'absolute',
    top: 12,
    right: 12,
    padding: 4,
    zIndex: 1
  },
  iconContainer: {
    marginBottom: 16
  },
  title: {
    textAlign: 'center',
    marginBottom: 12
  },
  message: {
    textAlign: 'left',
    lineHeight: 20
  },
  paragraphSpacing: {
    marginTop: 12
  }
});