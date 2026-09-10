/**
 * AICardPickerModal — "build a partner on an existing card?"
 *
 * Opens as a smooth obsidian-glass bottom sheet from the Characters screen's
 * "From an Existing One" flow. Presents every existing character profile as a
 * sleek 3D Vertical/Perspective Cover Flow carousel — a stacked deck where the
 * active center card is highlighted (scale 1.0, full opacity, elevated neon
 * glow) while preceding/following cards are angled, scaled down and recessed
 * along the Z-axis.
 *
 * - Swipe left/right (or drag/scroll) to flip through the deck (native paging,
 *   native-driver animations → 60fps).
 * - Tap any card to smoothly bring it to the center focus; selection fires once
 *   it settles.
 * - The search bar filters the deck; when a query is active the carousel
 *   re-renders with just the matching cards.
 *
 * Picking a card fires `onSelect(profile)` — the parent navigates to the
 * Create AI Partner screen with `prefillProfileId` so the new AI entity LIVE
 * LINKS the SAME character profile (engine parity — no card copy). The name
 * the user types there becomes the new entity's alias; the card is shared.
 *
 * The legacy `duplicate` mode (full fork) is retired — the AI-create fork path
 * no longer exists; `mode` is kept for the shared carousel contract.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Modal,
  View,
  StyleSheet,
  TouchableOpacity,
  TouchableWithoutFeedback,
  ActivityIndicator,
  TextInput,
  Animated,
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
import { CharacterCoverFlowCarousel } from './CharacterCoverFlowCarousel';

const log = createLogger('[AICardPickerModal]');

interface AICardPickerModalProps {
  visible: boolean;
  onClose: () => void;
  /** Fired when the user picks a profile */
  onSelect: (profile: CharacterProfile) => void;
  /** Which intent opened the sheet — controls the title/hint copy */
  mode?: 'duplicate' | 'fromExisting';
}

export const AICardPickerModal: React.FC<AICardPickerModalProps> = ({
  visible,
  onClose,
  onSelect,
  mode = 'duplicate',
}) => {
  const { theme } = useAppTheme();
  const { bottom: safeBottom } = useSafeAreaInsets();
  const { t } = useTranslation('characters');

  const [profiles, setProfiles] = useState<CharacterProfile[]>([]);
  const [images, setImages] = useState<Record<string, string | null>>({});
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');

  // ── Entrance animations ──────────────────────────────────────────────
  const sheetProgress = useRef(new Animated.Value(0)).current; // 0 → 1

  useEffect(() => {
    if (!visible) return;
    // Springy sheet slide-up
    sheetProgress.setValue(0);
    Animated.spring(sheetProgress, {
      toValue: 1,
      useNativeDriver: true,
      friction: 7,
      tension: 65,
    }).start();
  }, [visible, sheetProgress]);

  // Load profiles + primary images each time the sheet opens
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    setLoading(true);
    setQuery('');

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
        log.error('Failed to load profiles for AI picker:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [visible]);

  const filteredProfiles = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return profiles;
    return profiles.filter(
      p =>
        p.name.toLowerCase().includes(q) ||
        (p.description?.toLowerCase().includes(q) ?? false),
    );
  }, [profiles, query]);

  if (!theme) return null;

  const accent = theme.colors.accent.primary;
  const accentSecondary =
    theme.colors.accent.secondary ?? theme.colors.accent.primaryHover;

  const translateY = sheetProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [420, 0],
  });

  const handleSelect = (profile: CharacterProfile) => {
    hapticLightPress();
    onSelect(profile);
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={onClose}
    >
      {/* Fade backdrop */}
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={styles.overlay}>
          <Animated.View
            style={[
              styles.sheet,
              {
                paddingBottom: safeBottom + 24,
                transform: [{ translateY }],
              },
            ]}
          >
            <TouchableWithoutFeedback>
              <View style={styles.sheetInner}>
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
                  colors={[accent + '12', 'transparent']}
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
                      {mode === 'duplicate'
                        ? t('duplicateTitle')
                        : t('pickExistingTitle')}
                    </ThemedText>
                    <ThemedText variant="muted" size={13}>
                      {mode === 'duplicate'
                        ? t('duplicateHint')
                        : t('pickExistingHint')}
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

                {/* Search */}
                <View
                  style={[
                    styles.searchWrap,
                    {
                      backgroundColor: hexToRgba(theme.colors.background.base, 0.55),
                      borderColor: hexToRgba(accent, 0.25),
                    },
                  ]}
                >
                  <Icon name="magnify" size={18} color={theme.colors.text.muted} />
                  <TextInput
                    style={[styles.searchInput, { color: theme.colors.text.primary }]}
                    placeholder={t('duplicateSearch')}
                    placeholderTextColor={theme.colors.text.disabled}
                    value={query}
                    onChangeText={setQuery}
                    autoCorrect={false}
                    returnKeyType="search"
                  />
                  {query.length > 0 && (
                    <TouchableOpacity onPress={() => setQuery('')} hitSlop={8}>
                      <Icon name="close-circle" size={17} color={theme.colors.text.muted} />
                    </TouchableOpacity>
                  )}
                </View>

                {/* 3D Cover Flow carousel */}
                {loading ? (
                  <View style={styles.loadingWrap}>
                    <ActivityIndicator size="large" color={accent} />
                  </View>
                ) : filteredProfiles.length === 0 ? (
                  <ThemedEmptyState
                    compact
                    icon={query ? 'file-search-outline' : 'account-group-outline'}
                    title={
                      query
                        ? t('noResults')
                        : mode === 'duplicate'
                          ? t('duplicateEmpty')
                          : t('pickExistingEmpty')
                    }
                    subtitle={
                      query
                        ? t('noResultsHint')
                        : mode === 'duplicate'
                          ? t('duplicateEmptyHint')
                          : t('pickExistingEmptyHint')
                    }
                    style={styles.empty}
                  />
                ) : (
                  <CharacterCoverFlowCarousel
                    profiles={filteredProfiles}
                    images={images}
                    mode={mode}
                    onSelect={handleSelect}
                  />
                )}
              </View>
            </TouchableWithoutFeedback>
          </Animated.View>
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
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    overflow: 'hidden',
    backgroundColor: '#151d30',
    maxHeight: '86%',
  },
  sheetInner: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    overflow: 'hidden',
  },
  sheetRadius: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
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
    paddingBottom: 10,
    gap: 12,
  },
  headerText: {
    flex: 1,
    gap: 2,
  },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 20,
    marginBottom: 12,
    paddingHorizontal: 12,
    height: 42,
    borderRadius: 12,
    borderWidth: 1,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    paddingVertical: 0,
  },
  loadingWrap: {
    paddingVertical: 56,
    alignItems: 'center',
  },
  empty: {
    paddingVertical: 32,
  },
});
