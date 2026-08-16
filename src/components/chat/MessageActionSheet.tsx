import React from 'react';
import {
  View,
  StyleSheet,
  Modal,
  TouchableOpacity,
  TouchableWithoutFeedback,
  ScrollView,
  useWindowDimensions,
} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import { useTranslation } from 'react-i18next';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppTheme } from '../../contexts/ThemeContext';
import { ThemedText } from '../themed/ThemedText';
import { hapticLightPress } from '../../utils/haptics';
import { ConversationMessage } from '../../database/models';

/** The 5 "essential" emoji reactions shown at the top of the action sheet. */
export const QUICK_REACTIONS = ['❤️', '👍', '😂', '😮', '😢'] as const;

export type MessageAction =
  | 'delete'
  | 'copy'
  | 'forward'
  | 'translate'
  | 'pin';

interface MessageActionSheetProps {
  visible: boolean;
  message: ConversationMessage | null;
  isOwn: boolean;
  partnerName?: string;
  /** The currently pinned state of the message (for the pin/unpin toggle label). */
  isPinned?: boolean;
  /** Hide the quick emoji reaction row (still rendered internally, just not shown). */
  hideReactions?: boolean;
  /** Hide the "Forward" action from the list (still handled internally, just not shown). */
  hideForward?: boolean;
  onAction: (action: MessageAction) => void;
  onReact: (emoji: string) => void;
  onClose: () => void;
}

/**
 * MessageActionSheet — bottom-sheet shown when the user long-presses a message
 * bubble. Contains a preview of the message, a row of 5 quick reactions, and
 * the action list: Delete, Copy, Forward, Translate, Pin/Unpin.
 *
 * Styling follows the app's glass/gradient design language (see the chat
 * context menu in ChatDetailScreen for the shared visual vocabulary).
 */
export const MessageActionSheet: React.FC<MessageActionSheetProps> = ({
  visible,
  message,
  isOwn,
  partnerName = 'AI',
  isPinned = false,
  hideReactions = false,
  hideForward = false,
  onAction,
  onReact,
  onClose,
}) => {
  const { theme } = useAppTheme();
  const { t } = useTranslation('chatDetail');
  const { height } = useWindowDimensions();
  const { bottom: safeBottom } = useSafeAreaInsets();

  if (!theme) return null;

  const previewText = message?.content
    ? message.content.length > 120
      ? message.content.slice(0, 120) + '…'
      : message.content
    : message?.message_type === 'audio'
    ? t('audioMessage')
    : message?.message_type === 'image'
    ? t('imageMessage')
    : '';

  const actions: {
    key: MessageAction;
    icon: string;
    label: string;
    destructive?: boolean;
  }[] = [
    { key: 'delete', icon: 'delete-outline', label: t('delete'), destructive: true },
    { key: 'copy', icon: 'content-copy', label: t('copy') },
    ...(hideForward
      ? []
      : [{ key: 'forward' as MessageAction, icon: 'share-variant', label: t('forward') }]),
    { key: 'translate', icon: 'translate', label: t('translate') },
    {
      key: 'pin',
      icon: isPinned ? 'pin-off-outline' : 'pin-outline',
      label: isPinned ? t('unpin') : t('pin'),
    },
  ];

  const handleAction = (action: MessageAction) => {
    hapticLightPress();
    onAction(action);
  };

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
            <LinearGradient
              colors={[
                theme.colors.background.elevated,
                theme.colors.background.surface,
              ]}
              start={{ x: 0, y: 0 }}
              end={{ x: 0, y: 1 }}
              style={[
                styles.sheet,
                { maxHeight: height * 0.75, paddingBottom: Math.max(safeBottom, 16) },
              ]}
            >
              {/* Accent top stripe */}
              <LinearGradient
                colors={[
                  theme.colors.accent.primary + 'CC',
                  (theme.colors.accent.secondary ?? theme.colors.accent.primaryHover) + '66',
                  'transparent',
                ]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.topStripe}
              />

              {/* Drag handle */}
              <View
                style={[
                  styles.handle,
                  { backgroundColor: theme.colors.border.default },
                ]}
              />

              {/* Message preview */}
              <View style={[styles.preview, hideReactions && styles.previewCompact]}>
                <View
                  style={[
                    styles.senderDot,
                    { backgroundColor: isOwn ? theme.colors.accent.primary : theme.colors.text.muted },
                  ]}
                />
                <View style={styles.previewTextWrap}>
                  <ThemedText variant="muted" size={12} numberOfLines={1}>
                    {isOwn ? t('you') : partnerName}
                  </ThemedText>
                  {previewText ? (
                    <ThemedText size={14} numberOfLines={3} style={styles.previewText}>
                      {previewText}
                    </ThemedText>
                  ) : (
                    <ThemedText variant="muted" size={14} numberOfLines={1}>
                      {t('mediaMessage')}
                    </ThemedText>
                  )}
                </View>
              </View>

              {/* Quick reactions */}
              {!hideReactions && (
                <View style={styles.reactionsRow}>
                {QUICK_REACTIONS.map(emoji => (
                  <TouchableOpacity
                    key={emoji}
                    onPress={() => {
                      hapticLightPress();
                      onReact(emoji);
                    }}
                    style={[
                      styles.reactionChip,
                      { backgroundColor: theme.colors.accent.primary + '14' },
                    ]}
                    activeOpacity={0.7}
                  >
                    <ThemedText size={22}>{emoji}</ThemedText>
                  </TouchableOpacity>
                ))}
                </View>
              )}

              <View
                style={[
                  styles.separator,
                  hideReactions && styles.separatorCompact,
                  { backgroundColor: theme.colors.border.default + '44' },
                ]}
              />

              {/* Action list */}
              <ScrollView
                bounces={false}
                showsVerticalScrollIndicator={false}
                contentContainerStyle={styles.actionList}
              >
                {actions.map((action, index) => (
                  <React.Fragment key={action.key}>
                    {index > 0 && (
                      <View
                        style={[
                          styles.itemSeparator,
                          { backgroundColor: theme.colors.border.default + '22' },
                        ]}
                      />
                    )}
                    <TouchableOpacity
                      onPress={() => handleAction(action.key)}
                      style={styles.actionItem}
                      activeOpacity={0.65}
                    >
                      <View
                        style={[
                          styles.actionIconBadge,
                          {
                            backgroundColor: action.destructive
                              ? theme.colors.status.error + '1A'
                              : theme.colors.accent.primary + '1A',
                          },
                        ]}
                      >
                        <Icon
                          name={action.icon}
                          size={20}
                          color={
                            action.destructive
                              ? theme.colors.status.error
                              : theme.colors.accent.primary
                          }
                        />
                      </View>
                      <ThemedText
                        size={15}
                        weight="medium"
                        style={{
                          flex: 1,
                          color: action.destructive
                            ? theme.colors.status.error
                            : theme.colors.text.primary,
                        }}
                      >
                        {action.label}
                      </ThemedText>
                      <Icon
                        name="chevron-right"
                        size={18}
                        color={theme.colors.text.muted}
                      />
                    </TouchableOpacity>
                  </React.Fragment>
                ))}
              </ScrollView>
            </LinearGradient>
          </TouchableWithoutFeedback>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.3,
    shadowRadius: 16,
    elevation: 12,
  },
  topStripe: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 3,
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    marginTop: 10,
    marginBottom: 12,
    opacity: 0.5,
  },
  preview: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  senderDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginTop: 6,
    marginRight: 10,
  },
  previewTextWrap: {
    flex: 1,
  },
  previewText: {
    marginTop: 2,
  },
  previewCompact: {
    paddingBottom: 4,
  },
  reactionsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 4,
  },
  reactionChip: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    marginHorizontal: 20,
    marginVertical: 14,
  },
  separatorCompact: {
    marginVertical: 6,
  },
  actionList: {
    paddingBottom: 8,
  },
  actionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
    gap: 12,
  },
  actionIconBadge: {
    width: 36,
    height: 36,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  itemSeparator: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 68,
    marginRight: 20,
  },
});
