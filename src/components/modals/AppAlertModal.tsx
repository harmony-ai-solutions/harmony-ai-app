/**
 * AppAlertModal — Themed replacement for React Native's Alert.alert().
 *
 * Visual design mirrors InfoModal (obsidian glass card, gradient accent stripe,
 * themed text) but supports the Alert.alert() button API (default / cancel / destructive).
 *
 * Rendered imperatively via AppAlertContext.showAlert(title, message, buttons).
 */

import React from 'react';
import {
  Modal,
  View,
  StyleSheet,
  TouchableOpacity,
  TouchableWithoutFeedback,
} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { ThemedText } from '../themed/ThemedText';
import { ThemedButton } from '../themed/ThemedButton';
import { useAppTheme } from '../../contexts/ThemeContext';

// ── Types ────────────────────────────────────────────────────────────────────

export interface AlertButton {
  text: string;
  onPress?: () => void;
  style?: 'default' | 'cancel' | 'destructive';
}

export interface AlertConfig {
  title: string;
  message?: string;
  buttons?: AlertButton[];
  /** Optional MaterialCommunityIcons icon name (e.g. 'alert', 'information', 'delete') */
  icon?: string;
  /** When true, tapping the overlay backdrop does NOT dismiss the alert */
  blockBackdropDismiss?: boolean;
}

// ── Default icon per alert context ───────────────────────────────────────────

const DEFAULT_ICONS: Record<string, string> = {
  error: 'alert-circle',
  Error: 'alert-circle',
  delete: 'delete',
  Delete: 'delete',
  warning: 'alert',
  success: 'check-circle',
  confirm: 'help-circle',
};

function inferIcon(title: string): string | undefined {
  for (const [keyword, icon] of Object.entries(DEFAULT_ICONS)) {
    if (title.toLowerCase().includes(keyword.toLowerCase())) {
      return icon;
    }
  }
  return undefined;
}

// ── Props ────────────────────────────────────────────────────────────────────

interface AppAlertModalProps {
  visible: boolean;
  config: AlertConfig | null;
  onDismiss: () => void;
}

// ── Component ────────────────────────────────────────────────────────────────

export const AppAlertModal: React.FC<AppAlertModalProps> = ({
  visible,
  config,
  onDismiss,
}) => {
  const { theme } = useAppTheme();

  if (!theme || !config) return null;

  const { title, message, buttons, icon, blockBackdropDismiss } = config;
  const accent = theme.colors.accent.primary;
  const accentSecondary =
    theme.colors.accent.secondary ?? theme.colors.accent.primaryHover;
  const { borderGradientStart, borderGradientEnd } = theme.colors.glass;

  // Normalize buttons: if none provided, default to a single OK
  const btns: AlertButton[] =
    buttons && buttons.length > 0 ? buttons : [{ text: 'OK' }];

  // Separate destructive / cancel / default for layout ordering
  const cancelBtn = btns.find(b => b.style === 'cancel');
  const otherBtns = btns.filter(b => b.style !== 'cancel');

  const iconName = icon ?? inferIcon(title);
  const isDestructive = btns.some(
    b => b.style === 'destructive',
  );

  return (
    <Modal
      visible={visible}
      transparent={true}
      animationType="fade"
      onRequestClose={blockBackdropDismiss ? undefined : onDismiss}
    >
      {/* ── Overlay — tap outside to dismiss (unless blocked) ── */}
      <TouchableWithoutFeedback
        onPress={blockBackdropDismiss ? undefined : onDismiss}
        disabled={blockBackdropDismiss}
      >
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
                  colors={[
                    isDestructive
                      ? theme.colors.status.error + '10'
                      : accent + '10',
                    'transparent',
                  ]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0.6 }}
                  style={StyleSheet.absoluteFill}
                  pointerEvents="none"
                />

                {/* ── Accent stripe at top ── */}
                <LinearGradient
                  colors={
                    isDestructive
                      ? [theme.colors.status.error, theme.colors.status.error]
                      : [accent, accentSecondary]
                  }
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={styles.accentStripe}
                />

                {/* ── Close button (only when backdrop dismiss is not blocked) ── */}
                {!blockBackdropDismiss && (
                  <TouchableOpacity
                    style={styles.closeButton}
                    onPress={onDismiss}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Icon
                      name="close"
                      size={18}
                      color={theme.colors.text.secondary}
                    />
                  </TouchableOpacity>
                )}

                {/* ── Icon ── */}
                {iconName && (
                  <View style={styles.iconContainer}>
                    <LinearGradient
                      colors={
                        isDestructive
                          ? [
                              theme.colors.status.error + '22',
                              theme.colors.status.error + '10',
                            ]
                          : [accent + '22', accentSecondary + '10']
                      }
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}
                      style={styles.iconBadge}
                    >
                      <Icon
                        name={iconName}
                        size={28}
                        color={
                          isDestructive
                            ? theme.colors.status.error
                            : accent
                        }
                      />
                    </LinearGradient>
                  </View>
                )}

                {/* ── Title ── */}
                <ThemedText
                  size={18}
                  weight="bold"
                  style={[styles.title, !iconName && styles.titleNoIcon]}
                >
                  {title}
                </ThemedText>

                {/* ── Message ── */}
                {message ? (
                  <ThemedText
                    variant="secondary"
                    size={14}
                    style={styles.message}
                  >
                    {message}
                  </ThemedText>
                ) : null}

                {/* ── Buttons ── */}
                <View style={styles.buttonRow}>
                  {/* Cancel button on the left */}
                  {cancelBtn && (
                    <TouchableOpacity
                      onPress={() => {
                        onDismiss();
                        cancelBtn.onPress?.();
                      }}
                      activeOpacity={0.7}
                      style={styles.cancelBtnWrapper}
                    >
                      <LinearGradient
                        colors={
                          isDestructive
                            ? [theme.colors.status.error + '35', theme.colors.status.error + '18']
                            : [borderGradientStart, borderGradientEnd]
                        }
                        start={{ x: 0.15, y: 0 }}
                        end={{ x: 0.85, y: 1 }}
                        style={styles.cancelBtnBorder}
                      >
                        <View style={[styles.cancelBtnInner, isDestructive && { backgroundColor: theme.colors.status.error + '10' }]}>
                          <ThemedText
                            variant="secondary"
                            size={14}
                            weight="medium"
                            style={[styles.cancelBtnText, isDestructive && { color: theme.colors.status.error }]}
                          >
                            {cancelBtn.text}
                          </ThemedText>
                        </View>
                      </LinearGradient>
                    </TouchableOpacity>
                  )}

                  {/* Action buttons on the right */}
                  {otherBtns.map((btn, idx) => {
                    const isDestructiveBtn = btn.style === 'destructive';

                    return (
                      <TouchableOpacity
                        key={idx}
                        onPress={() => {
                          onDismiss();
                          btn.onPress?.();
                        }}
                        activeOpacity={0.8}
                        style={[
                          styles.actionBtnWrapper,
                          cancelBtn && styles.actionBtnWithCancel,
                        ]}
                      >
                        <LinearGradient
                          colors={
                            isDestructiveBtn
                              ? [
                                  theme.colors.status.error,
                                  theme.colors.status.error,
                                ]
                              : [accent, accentSecondary]
                          }
                          start={{ x: 0, y: 0 }}
                          end={{ x: 1, y: 1 }}
                          style={[
                            styles.actionBtnGradient,
                            {
                              shadowColor: isDestructiveBtn
                                ? theme.colors.status.error
                                : accent,
                            },
                          ]}
                        >
                          <ThemedText
                            size={14}
                            weight="bold"
                            style={styles.actionBtnText}
                          >
                            {btn.text}
                          </ThemedText>
                        </LinearGradient>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </LinearGradient>
            </View>
          </TouchableWithoutFeedback>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
};

// ── Styles ───────────────────────────────────────────────────────────────────

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
    maxWidth: 340,
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
    top: 12,
    right: 12,
    padding: 4,
    zIndex: 1,
  },
  iconContainer: {
    marginBottom: 14,
  },
  iconBadge: {
    width: 52,
    height: 52,
    borderRadius: 26,
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: {
    textAlign: 'center',
    marginBottom: 10,
  },
  titleNoIcon: {
    marginTop: 6,
  },
  message: {
    textAlign: 'center',
    lineHeight: 21,
    marginBottom: 20,
  },
  buttonRow: {
    flexDirection: 'row',
    width: '100%',
    justifyContent: 'center',
    gap: 10,
  },
  cancelBtnWrapper: {
    flex: 1,
    minWidth: 0,
  },
  cancelBtnBorder: {
    borderRadius: 14,
    padding: StyleSheet.hairlineWidth,
  },
  cancelBtnInner: {
    borderRadius: 13,
    paddingVertical: 10,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelBtnText: {
    textAlign: 'center',
  },
  actionBtnWrapper: {
    flex: 1,
    minWidth: 0,
  },
  actionBtnWithCancel: {
    // action button shares space with cancel
  },
  actionBtnGradient: {
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  actionBtnText: {
    textAlign: 'center',
    color: '#FFFFFF',
  },
});
