import React from 'react';
import { Modal, View, StyleSheet, TouchableOpacity, TouchableWithoutFeedback } from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { ThemedText } from '../themed/ThemedText';
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

  if (!theme) return null;

  const accent = theme.colors.accent.primary;
  const accentSecondary = theme.colors.accent.secondary ?? theme.colors.accent.primaryHover;

  return (
    <Modal
      visible={visible}
      transparent={true}
      animationType="fade"
      onRequestClose={onClose}
    >
      {/* Overlay — tap outside to dismiss */}
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={styles.overlay}>
          {/* ── Card — block outside taps ── */}
          <TouchableWithoutFeedback onPress={() => {}}>
            <View style={styles.modalShadow}>
              {/* ── Obsidian Glass card background ── */}
              <LinearGradient
                colors={[
                  theme.colors.background.elevated,
                  theme.colors.background.surface,
                ]}
                start={{ x: 0, y: 0 }}
                end={{ x: 0, y: 1 }}
                style={styles.modal}
              >
                {/* Prismatic tint overlay */}
                <LinearGradient
                  colors={[accent + '10', 'transparent']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0.6 }}
                  style={StyleSheet.absoluteFill}
                  pointerEvents="none"
                />

                {/* ── Accent stripe at top ── */}
                <LinearGradient
                  colors={[accent, accentSecondary]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={styles.accentStripe}
                />

                {/* ── Close button ── */}
                <TouchableOpacity
                  style={styles.closeButton}
                  onPress={onClose}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Icon name="close" size={20} color={theme.colors.text.secondary} />
                </TouchableOpacity>

                {/* ── Icon ── */}
                <View style={styles.iconContainer}>
                  <LinearGradient
                    colors={[accent + '22', accentSecondary + '10']}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={styles.iconBadge}
                  >
                    <Icon name={icon} size={28} color={accent} />
                  </LinearGradient>
                </View>

                {/* ── Title ── */}
                <ThemedText size={20} weight="bold" style={styles.title}>
                  {title}
                </ThemedText>

                {/* ── Message paragraphs ── */}
                {message.split('\n\n').map((paragraph, index) => (
                  <ThemedText
                    key={index}
                    variant="secondary"
                    size={14}
                    style={[styles.message, index > 0 && styles.paragraphSpacing]}
                  >
                    {paragraph}
                  </ThemedText>
                ))}
              </LinearGradient>
            </View>
          </TouchableWithoutFeedback>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modalShadow: {
    width: '100%',
    maxWidth: 330,
    borderRadius: 18,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.35,
    shadowRadius: 20,
    elevation: 12,
  },
  modal: {
    borderRadius: 18,
    padding: 28,
    alignItems: 'center',
    overflow: 'hidden',
  },
  accentStripe: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 3,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
  },
  closeButton: {
    position: 'absolute',
    top: 14,
    right: 14,
    padding: 4,
    zIndex: 1,
  },
  iconContainer: {
    marginBottom: 16,
  },
  iconBadge: {
    width: 56,
    height: 56,
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: {
    textAlign: 'center',
    marginBottom: 12,
  },
  message: {
    textAlign: 'left',
    lineHeight: 21,
  },
  paragraphSpacing: {
    marginTop: 12,
  },
});