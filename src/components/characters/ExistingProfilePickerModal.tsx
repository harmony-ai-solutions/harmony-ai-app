/**
 * ExistingProfilePickerModal — "create a new AI partner from an existing one?"
 *
 * Opens as an obsidian-glass bottom sheet from the Characters screen "New AI
 * Partner" flow. Lists every existing character profile as a tappable row
 * (name + description + primary avatar). Selecting one navigates to the
 * Create AI Partner screen with `prefillProfileId` so the new partner links
 * that profile instead of creating a fresh one.
 */

import React, { useEffect, useState } from 'react';
import {
  Modal,
  View,
  StyleSheet,
  TouchableOpacity,
  TouchableWithoutFeedback,
  ScrollView,
  ActivityIndicator,
  Image,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import LinearGradient from 'react-native-linear-gradient';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useAppTheme } from '../../contexts/ThemeContext';
import { ThemedText } from '../themed/ThemedText';
import { ThemedEmptyState } from '../themed/ThemedEmptyState';
import { hexToRgba } from '../../utils/colorUtils';
import { hapticLightPress } from '../../utils/haptics';
import { getAllCharacterProfiles, getCharacterImages } from '../../database/repositories/characters';
import { createDataURL } from '../../database/base64';
import type { CharacterProfile } from '../../database/models';
import { createLogger } from '../../utils/logger';

const log = createLogger('[ExistingProfilePickerModal]');

interface ExistingProfilePickerModalProps {
  visible: boolean;
  onClose: () => void;
  /** Fired when the user picks an existing profile (id) */
  onSelect: (profileId: string) => void;
}

export const ExistingProfilePickerModal: React.FC<ExistingProfilePickerModalProps> = ({
  visible,
  onClose,
  onSelect,
}) => {
  const { theme } = useAppTheme();
  const { bottom: safeBottom } = useSafeAreaInsets();
  const { t } = useTranslation('characters');

  const [profiles, setProfiles] = useState<CharacterProfile[]>([]);
  const [images, setImages] = useState<Record<string, string | null>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    setLoading(true);

    (async () => {
      try {
        const data = await getAllCharacterProfiles();
        if (cancelled) return;
        setProfiles(data);

        const imageMap: Record<string, string | null> = {};
        await Promise.all(
          data.map(async profile => {
            try {
              const imgs = await getCharacterImages(profile.id);
              const primary = imgs.find(img => img.is_primary === true);
              imageMap[profile.id] = primary
                ? createDataURL(primary.image_data, primary.mime_type)
                : null;
            } catch {
              imageMap[profile.id] = null;
            }
          }),
        );
        if (cancelled) return;
        setImages(imageMap);
      } catch (err) {
        log.error('Failed to load profiles for picker:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [visible]);

  if (!theme) return null;

  const accent = theme.colors.accent.primary;
  const accentSecondary =
    theme.colors.accent.secondary ?? theme.colors.accent.primaryHover;

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
                    {t('pickExistingTitle')}
                  </ThemedText>
                  <ThemedText variant="muted" size={13}>
                    {t('pickExistingHint')}
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

              {/* Profile list */}
              {loading ? (
                <View style={styles.loadingWrap}>
                  <ActivityIndicator size="large" color={accent} />
                </View>
              ) : profiles.length === 0 ? (
                <ThemedEmptyState
                  compact
                  icon="account-group-outline"
                  title={t('pickExistingEmpty')}
                  subtitle={t('pickExistingEmptyHint')}
                  style={styles.empty}
                />
              ) : (
                <ScrollView
                  style={styles.list}
                  contentContainerStyle={styles.listContent}
                  keyboardShouldPersistTaps="handled"
                >
                  {profiles.map(profile => {
                    const imageUri = images[profile.id] ?? null;
                    return (
                      <TouchableOpacity
                        key={profile.id}
                        onPress={() => {
                          hapticLightPress();
                          onSelect(profile.id);
                        }}
                        activeOpacity={0.7}
                        style={[
                          styles.row,
                          {
                            backgroundColor: theme.colors.background.base + '55',
                            borderColor: theme.colors.border.default + '66',
                          },
                        ]}
                        accessibilityRole="button"
                        accessibilityLabel={profile.name}
                        testID={`pick-profile-${profile.id}`}
                      >
                        {imageUri ? (
                          <Image source={{ uri: imageUri }} style={styles.rowAvatar} resizeMode="cover" />
                        ) : (
                          <View
                            style={[
                              styles.rowAvatar,
                              { backgroundColor: hexToRgba(accent, 0.12) },
                            ]}
                          >
                            <Icon name="account" size={18} color={accent} />
                          </View>
                        )}
                        <View style={styles.rowText}>
                          <ThemedText size={15} variant="primary" weight="bold" numberOfLines={1}>
                            {profile.name}
                          </ThemedText>
                          <ThemedText size={12} variant="muted" numberOfLines={1}>
                            {profile.description || t('pickExistingNoDesc')}
                          </ThemedText>
                        </View>
                        <Icon name="chevron-right" size={20} color={theme.colors.text.muted} />
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              )}
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
    maxHeight: '80%',
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
    paddingBottom: 12,
    gap: 12,
  },
  headerText: {
    flex: 1,
    gap: 2,
  },
  loadingWrap: {
    paddingVertical: 48,
    alignItems: 'center',
  },
  empty: {
    paddingVertical: 32,
  },
  list: {
    maxHeight: 420,
  },
  listContent: {
    paddingHorizontal: 20,
    gap: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  rowAvatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowText: {
    flex: 1,
    gap: 1,
  },
});
