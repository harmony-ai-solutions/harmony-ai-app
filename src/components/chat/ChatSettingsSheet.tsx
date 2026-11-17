/**
 * ChatSettingsSheet — per-conversation display settings (tts-voice-ux Phase 5).
 *
 * Opened from the in-chat overflow menu. v1 has one preference:
 * "Show emotional state" — opt-in, app-local (AsyncStorage per participantKey),
 * no engine change. The character-state sheet stays reachable from here even
 * when the header chip is hidden.
 */

import React from 'react';
import { Modal, StyleSheet, Switch, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useAppTheme } from '../../contexts/ThemeContext';
import { ThemedText } from '../themed/ThemedText';
import { hapticLightPress } from '../../utils/haptics';

export interface ChatSettingsSheetProps {
  visible: boolean;
  onClose: () => void;
  /** Current value of the app-local "Show emotional state" preference. */
  showEmotionState: boolean;
  onToggleShowEmotionState: (enabled: boolean) => void;
  /** Opens the combined character-state sheet (State | Memories | Knowledge). */
  onOpenCharacterState: () => void;
  characterName: string;
}

export const ChatSettingsSheet: React.FC<ChatSettingsSheetProps> = ({
  visible,
  onClose,
  showEmotionState,
  onToggleShowEmotionState,
  onOpenCharacterState,
  characterName,
}) => {
  const { theme } = useAppTheme();
  const { t } = useTranslation('chatDetail');
  const { bottom: safeBottom } = useSafeAreaInsets();

  if (!theme) return null;

  const accent = theme.colors.accent.primary;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={styles.overlay}>
        <TouchableOpacity
          style={StyleSheet.absoluteFill}
          activeOpacity={1}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={t('common:close')}
        />

        <View
          style={[
            styles.sheet,
            {
              paddingBottom: safeBottom + 20,
              backgroundColor: theme.colors.background.surface,
              borderColor: theme.colors.border.default,
            },
          ]}
          testID="chat-settings-sheet"
        >
          <View style={styles.grabber} />

          <View style={styles.header}>
            <ThemedText size={16} weight="bold" hierarchy="header" style={styles.headerText}>
              {t('chatSettings')}
            </ThemedText>
            <TouchableOpacity
              onPress={onClose}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityRole="button"
              accessibilityLabel={t('common:close')}
              testID="chat-settings-close"
            >
              <Icon name="close" size={20} color={theme.colors.text.muted} />
            </TouchableOpacity>
          </View>

          {/* Show emotional state (opt-in, app-local) */}
          <View
            style={[
              styles.row,
              {
                borderColor: theme.colors.border.default + '66',
                backgroundColor: theme.colors.background.base + '55',
              },
            ]}
          >
            <View style={styles.rowText}>
              <ThemedText size={14} weight="medium">
                {t('showEmotionState')}
              </ThemedText>
              <ThemedText size={11} variant="muted">
                {t('showEmotionStateHint')}
              </ThemedText>
            </View>
            <Switch
              value={showEmotionState}
              onValueChange={value => {
                hapticLightPress();
                onToggleShowEmotionState(value);
              }}
              trackColor={{ false: theme.colors.border.default, true: accent + '99' }}
              thumbColor={showEmotionState ? accent : theme.colors.text.muted}
              accessibilityRole="switch"
              accessibilityLabel={t('showEmotionState')}
              accessibilityState={{ checked: showEmotionState }}
              testID="chat-settings-emotion-switch"
            />
          </View>

          {/* Character state — always reachable, even with the chip hidden. */}
          <TouchableOpacity
            onPress={() => {
              hapticLightPress();
              onClose();
              onOpenCharacterState();
            }}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={t('characterState')}
            testID="chat-settings-open-character-state"
            style={[
              styles.row,
              {
                borderColor: theme.colors.border.default + '66',
                backgroundColor: theme.colors.background.base + '55',
              },
            ]}
          >
            <View
              style={[styles.iconBadge, { backgroundColor: accent + '1A' }]}
            >
              <Icon name="heart-pulse" size={18} color={accent} />
            </View>
            <View style={styles.rowText}>
              <ThemedText size={14} weight="medium">
                {t('characterState')}
              </ThemedText>
              <ThemedText size={11} variant="muted" numberOfLines={1}>
                {t('characterStateCaption', { name: characterName })}
              </ThemedText>
            </View>
            <Icon name="chevron-right" size={18} color={theme.colors.text.muted} />
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(2, 6, 23, 0.78)',
  },
  sheet: {
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderTopWidth: 1,
    paddingHorizontal: 20,
  },
  grabber: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(148,163,184,0.4)',
    marginTop: 8,
    marginBottom: 8,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 12,
    gap: 12,
  },
  headerText: {
    flex: 1,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 10,
  },
  rowText: {
    flex: 1,
    gap: 2,
  },
  iconBadge: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default ChatSettingsSheet;
