/**
 * ChatConversationMenuModal — context menu shown when the user long-presses a
 * conversation row on the Chat list screen.
 *
 * Offers the standard messaging-app actions:
 *   - Pin / Unpin        — pin the conversation to the top of the list
 *   - Archive / Unarchive — hide the conversation from the main list
 *   - Mute / Unmute      — suppress incoming-message alerts for this chat
*  - Open chat bubble   — launch the floating bubble for this AI
 *  - Reply pacing       — toggle instant ↔ realistic replies for this chat (A6)
 *  - Mark as read / Unread — reset / bump the unread state
 *   - Disable / Enable   — stop the AI from sending AND receiving messages
 *   - Delete             — delete the conversation (messages + interaction)
 *
 * All actions are delegated to the parent via callbacks so the screen owns
 * all persistence and navigation. The modal renders state-aware labels
 * (e.g. "Unpin" when already pinned, "Unmute" when muted) from the current
 * settings snapshot passed in by the parent.
 */

import React from 'react';
import {
  Modal,
  View,
  StyleSheet,
  TouchableOpacity,
  TouchableWithoutFeedback,
  ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import LinearGradient from 'react-native-linear-gradient';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useAppTheme } from '../../contexts/ThemeContext';
import { ThemedText } from '../themed/ThemedText';
import { hapticLightPress } from '../../utils/haptics';

export interface ChatConversationMenuState {
  pinned: boolean;
  archived: boolean;
  muted: boolean;
  disabled: boolean;
  unreadCount: number;
  /** Reply pacing for this conversation (A6): 'instant' | 'realistic'. */
  replyMode: 'instant' | 'realistic';
}

interface ChatConversationMenuModalProps {
  visible: boolean;
  conversationName: string;
  /** Current settings snapshot — drives state-aware labels (Pin vs Unpin…). */
  settings: ChatConversationMenuState;
  /** Disabled conversations also get the "Enable" action; others "Disable". */
  isDisabled: boolean;
  onClose: () => void;
  onTogglePin: () => void;
  onToggleArchive: () => void;
  onToggleMute: () => void;
  onOpenBubble: () => void;
  onToggleRead: () => void;
  onToggleDisable: () => void;
  onToggleReplyMode: () => void;
  onDelete: () => void;
}

interface MenuAction {
  icon: string;
  label: string;
  color?: string;
  onPress: () => void;
}

export const ChatConversationMenuModal: React.FC<ChatConversationMenuModalProps> = ({
  visible,
  conversationName,
  settings,
  isDisabled,
  onClose,
  onTogglePin,
  onToggleArchive,
  onToggleMute,
  onOpenBubble,
  onToggleRead,
  onToggleDisable,
  onToggleReplyMode,
  onDelete,
}) => {
  const { theme } = useAppTheme();
  const { bottom: safeBottom } = useSafeAreaInsets();
  const { t } = useTranslation('chatList');

  if (!theme) return null;

  const accent = theme.colors.accent.primary;
  const accentSecondary =
    theme.colors.accent.secondary ?? theme.colors.accent.primaryHover;
  const errorColor = theme.colors.status.error;

  const actions: MenuAction[] = [
    {
      icon: settings.pinned ? 'pin-off-outline' : 'pin-outline',
      label: settings.pinned ? t('menuUnpin') : t('menuPin'),
      color: accent,
      onPress: onTogglePin,
    },
    {
      icon: settings.archived ? 'archive-arrow-up-outline' : 'archive-outline',
      label: settings.archived ? t('menuUnarchive') : t('menuArchive'),
      color: accent,
      onPress: onToggleArchive,
    },
    {
      icon: settings.muted ? 'volume-high' : 'volume-off',
      // Entity-scoped mute (Q8) — the label reads "Mute {name}" / "Unmute {name}"
      // with the partner name, reflecting global per-entity semantics.
      label: settings.muted
        ? t('unmuteEntity', { name: conversationName })
        : t('muteEntity', { name: conversationName }),
      color: accent,
      onPress: onToggleMute,
    },
    {
      icon: 'chat-processing-outline',
      label: t('menuOpenBubble'),
      color: accentSecondary,
      onPress: onOpenBubble,
    },
    {
      // Reply pacing toggle (A6): shows the ACTION like Pin/Unpin — tapping
      // switches instant ↔ realistic. Not the reply-to-message feature (O4).
      icon: settings.replyMode === 'realistic' ? 'flash-outline' : 'clock-outline',
      label:
        settings.replyMode === 'realistic'
          ? t('menuReplyModeInstant')
          : t('menuReplyModeRealistic'),
      color: accent,
      onPress: onToggleReplyMode,
    },
    {
      icon: settings.unreadCount > 0 ? 'check-all' : 'email-outline',
      // Unread → "Mark as read"; already read → "Mark as unread".
      label: settings.unreadCount > 0 ? t('menuMarkRead') : t('menuMarkUnread'),
      color: accent,
      onPress: onToggleRead,
    },
    {
      icon: isDisabled ? 'shield-account-outline' : 'shield-off-outline',
      // Entity-scoped disable (Q8) — "Disable {name}" / "Enable {name}".
      label: isDisabled
        ? t('enableEntity', { name: conversationName })
        : t('disableEntity', { name: conversationName }),
      color: errorColor,
      onPress: onToggleDisable,
    },
    {
      icon: 'delete-outline',
      label: t('menuDelete'),
      color: errorColor,
      onPress: onDelete,
    },
  ];

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={styles.overlay}>
          <TouchableWithoutFeedback>
            <View style={[styles.sheet, { paddingBottom: safeBottom + 24 }]}>
              {/* Gradient background */}
              <LinearGradient
                colors={[
                  theme.colors.background.elevated,
                  theme.colors.background.surface,
                ]}
                start={{ x: 0, y: 0 }}
                end={{ x: 0, y: 1 }}
                style={[StyleSheet.absoluteFill, styles.sheetRadius]}
              />
              {/* Prismatic tint */}
              <LinearGradient
                colors={[accent + '10', 'transparent']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0.6 }}
                style={[StyleSheet.absoluteFill, styles.sheetRadius]}
                pointerEvents="none"
              />
              {/* Top accent stripe */}
              <LinearGradient
                colors={[accent + 'CC', accentSecondary + '66', 'transparent']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.topStripe}
              />

              {/* Header */}
              <View style={styles.header}>
                <View style={styles.headerText}>
                  <ThemedText
                    size={16}
                    weight="bold"
                    numberOfLines={1}
                    style={styles.title}
                  >
                    {conversationName}
                  </ThemedText>
                  <ThemedText variant="muted" size={12}>
                    {t('menuActionsFor')}
                  </ThemedText>
                </View>
                <TouchableOpacity
                  onPress={onClose}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  accessibilityLabel="Close"
                  accessibilityRole="button"
                >
                  <Icon name="close" size={22} color={theme.colors.text.muted} />
                </TouchableOpacity>
              </View>

              {/* Actions */}
              <ScrollView
                contentContainerStyle={styles.actions}
                showsVerticalScrollIndicator={false}
                bounces={false}
              >
                {actions.map((action, index) => (
                  <TouchableOpacity
                    key={index}
                    onPress={() => {
                      hapticLightPress();
                      onClose();
                      action.onPress();
                    }}
                    activeOpacity={0.7}
                    style={[
                      styles.actionRow,
                      {
                        backgroundColor: theme.colors.background.base + '55',
                        borderColor: theme.colors.border.default + '66',
                      },
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel={action.label}
                  >
                    <Icon name={action.icon} size={20} color={action.color ?? accent} />
                    <ThemedText
                      size={15}
                      variant="primary"
                      weight="medium"
                      style={[
                        styles.actionLabel,
                        action.color === errorColor && { color: errorColor },
                      ]}
                    >
                      {action.label}
                    </ThemedText>
                  </TouchableOpacity>
                ))}
              </ScrollView>
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
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    overflow: 'hidden',
    backgroundColor: '#151d30',
    maxHeight: '82%',
  },
  sheetRadius: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
  },
  topStripe: {
    height: 2,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 12,
    gap: 12,
  },
  headerText: {
    flex: 1,
  },
  title: {
    flexShrink: 1,
    letterSpacing: 0.3,
  },
  actions: {
    paddingHorizontal: 20,
    paddingTop: 4,
    paddingBottom: 8,
    gap: 10,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  actionLabel: {
    flex: 1,
  },
});
