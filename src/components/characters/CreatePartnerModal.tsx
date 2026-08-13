/**
 * CreatePartnerModal — "create a new AI partner or use an existing one?"
 *
 * Opens as an obsidian-glass bottom sheet when the user taps the ＋ FAB on the
 * Characters screen. Presents three ways to bring a new AI partner in:
 *   - New AI Partner           → CreateAI (fresh profile + entity wizard)
 *   - From an Existing One     → CreateAI (links an existing character profile)
 *   - Import Character Card    → existing PNG/JSON import flow
 *
 * Navigation and persistence are delegated to the parent via callbacks so the
 * screen keeps ownership of the import/creation flows.
 */

import React from 'react';
import {
  Modal,
  View,
  StyleSheet,
  TouchableOpacity,
  TouchableWithoutFeedback,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import LinearGradient from 'react-native-linear-gradient';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useAppTheme } from '../../contexts/ThemeContext';
import { ThemedText } from '../themed/ThemedText';
import { hexToRgba } from '../../utils/colorUtils';
import { hapticLightPress } from '../../utils/haptics';

interface CreatePartnerModalProps {
  visible: boolean;
  onClose: () => void;
  /** Start a brand-new AI partner (Create AI screen, fresh-profile mode) */
  onNewPartner: () => void;
  /** Create a partner from an existing character profile */
  onFromExisting: () => void;
  /** Import a character card (PNG / JSON) */
  onImport: () => void;
}

export const CreatePartnerModal: React.FC<CreatePartnerModalProps> = ({
  visible,
  onClose,
  onNewPartner,
  onFromExisting,
  onImport,
}) => {
  const { theme } = useAppTheme();
  const { bottom: safeBottom } = useSafeAreaInsets();
  const { t } = useTranslation('characters');

  if (!theme) return null;

  const accent = theme.colors.accent.primary;
  const accentSecondary =
    theme.colors.accent.secondary ?? theme.colors.accent.primaryHover;

  const handleAction = (action: () => void) => {
    hapticLightPress();
    onClose();
    action();
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
                  <ThemedText size={18} weight="bold">
                    {t('createPartnerTitle')}
                  </ThemedText>
                  <ThemedText variant="muted" size={13}>
                    {t('createPartnerMessage')}
                  </ThemedText>
                </View>
                <TouchableOpacity
                  onPress={onClose}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  accessibilityLabel={t('common:close')}
                  accessibilityRole="button"
                >
                  <Icon name="close" size={22} color={theme.colors.text.muted} />
                </TouchableOpacity>
              </View>

              {/* Actions */}
              <View style={styles.actions}>
                <TouchableOpacity
                  onPress={() => handleAction(onNewPartner)}
                  activeOpacity={0.7}
                  style={[
                    styles.actionRow,
                    {
                      backgroundColor: theme.colors.background.base + '55',
                      borderColor: theme.colors.border.default + '66',
                    },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={t('createNewPartner')}
                  testID="create-new-partner"
                >
                  <View
                    style={[
                      styles.actionIcon,
                      { backgroundColor: hexToRgba(accent, 0.15) },
                    ]}
                  >
                    <Icon name="creation" size={20} color={accent} />
                  </View>
                  <View style={styles.actionText}>
                    <ThemedText size={15} variant="primary" weight="bold">
                      {t('createNewPartner')}
                    </ThemedText>
                    <ThemedText size={12} variant="muted">
                      {t('createNewPartnerHint')}
                    </ThemedText>
                  </View>
                  <Icon name="chevron-right" size={20} color={theme.colors.text.muted} />
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={() => handleAction(onFromExisting)}
                  activeOpacity={0.7}
                  style={[
                    styles.actionRow,
                    {
                      backgroundColor: theme.colors.background.base + '55',
                      borderColor: theme.colors.border.default + '66',
                    },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={t('fromExistingProfile')}
                  testID="from-existing-profile"
                >
                  <View
                    style={[
                      styles.actionIcon,
                      { backgroundColor: hexToRgba(accent, 0.15) },
                    ]}
                  >
                    <Icon name="account-multiple-outline" size={20} color={accent} />
                  </View>
                  <View style={styles.actionText}>
                    <ThemedText size={15} variant="primary" weight="bold">
                      {t('fromExistingProfile')}
                    </ThemedText>
                    <ThemedText size={12} variant="muted">
                      {t('fromExistingProfileHint')}
                    </ThemedText>
                  </View>
                  <Icon name="chevron-right" size={20} color={theme.colors.text.muted} />
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={() => handleAction(onImport)}
                  activeOpacity={0.7}
                  style={[
                    styles.actionRow,
                    {
                      backgroundColor: theme.colors.background.base + '55',
                      borderColor: theme.colors.border.default + '66',
                    },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={t('importCard')}
                  testID="import-character-card"
                >
                  <View
                    style={[
                      styles.actionIcon,
                      { backgroundColor: hexToRgba(accent, 0.15) },
                    ]}
                  >
                    <Icon name="file-import-outline" size={20} color={accent} />
                  </View>
                  <View style={styles.actionText}>
                    <ThemedText size={15} variant="primary" weight="bold">
                      {t('importCard')}
                    </ThemedText>
                    <ThemedText size={12} variant="muted">
                      {t('importCardHint')}
                    </ThemedText>
                  </View>
                  <Icon name="chevron-right" size={20} color={theme.colors.text.muted} />
                </TouchableOpacity>
              </View>
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
    paddingBottom: 14,
    gap: 12,
  },
  headerText: {
    flex: 1,
    gap: 2,
  },
  actions: {
    paddingHorizontal: 20,
    paddingBottom: 8,
    gap: 10,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  actionIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    justifyContent: 'center',
    alignItems: 'center',
  },
  actionText: {
    flex: 1,
    gap: 1,
  },
});
