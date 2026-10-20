/**
 * ChatBackgroundPicker — choose a per-entity chat background.
 *
 * Owner-approved mock (chat background):
 *   - ONE grid with two source tabs, counts in the labels:
 *       Profile       → the character's gallery (incl. its avatar / primary
 *                       image), resolved by URL exactly like
 *                       `AIProfileScreen.galleryTileImageSource` (thumb when the
 *                       engine advertises one).
 *       Chat history  → images that appeared in this conversation
 *                       (`message.image_data` base64).
 *   - A dashed "No background" tile clears the setting.
 *   - The current background tile carries a ✓ overlay.
 *   - Dim slider (0–100, default 40) sets the dark scrim behind chat bubbles.
 *
 * Tap applies INSTANTLY and closes (haptic + goBack): a picker whose result is
 * visible on the chat screen does not need a separate confirm affordance.
 * The slider stays (it has no navigational result) and persists on release.
 *
 * Scope: the background is stored against the partner ENTITY id, so it is
 * independent of the persona the user chats as.
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
  ActivityIndicator,
} from 'react-native';
import Slider from '@react-native-community/slider';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useAppTheme } from '../contexts/ThemeContext';
import { ThemedView } from '../components/themed/ThemedView';
import { ThemedText } from '../components/themed/ThemedText';
import { ScreenHeader } from '../components/themed/ScreenHeader';
import { hapticLightPress } from '../utils/haptics';
import {
  getEntity,
  getCharacterImagesMetadata,
  characterImageSource,
  shouldUseThumbnail,
  getRecentConversationMessages,
} from '../database/repositories';
import type { CharacterImage, ConversationMessage } from '../database/models';
import ChatBackgroundService, {
  DEFAULT_CHAT_BACKGROUND_DIM,
} from '../services/ChatBackgroundService';
import type { ChatBackgroundRecord } from '../services/ChatBackgroundService';
import type { RootStackParamList } from '../navigation/AppNavigator';
import { createLogger } from '../utils/logger';

const log = createLogger('[ChatBackgroundPicker]');

type Nav = NativeStackNavigationProp<RootStackParamList, 'ChatBackgroundPicker'>;
type Route = RouteProp<RootStackParamList, 'ChatBackgroundPicker'>;
type SourceTab = 'profile' | 'history';

/** How many recent messages to scan for image bubbles (matches ChatDetail's page size). */
const HISTORY_MESSAGE_LIMIT = 200;

/** One chat-history image bubble (keyed by message id). */
interface HistoryImage {
  messageId: string;
  base64: string;
  mimeType: string;
}

/**
 * Chat-history images in newest-first order, de-duplicated by the image bytes
 * (the same picture re-sent twice should not fill the grid).
 */
export function collectHistoryImages(
  messages: ConversationMessage[],
): HistoryImage[] {
  const seen = new Set<string>();
  const out: HistoryImage[] = [];
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    const base64 = message.image_data;
    if (!base64 || base64.length === 0) continue;
    if (seen.has(base64)) continue;
    seen.add(base64);
    out.push({
      messageId: message.id,
      base64,
      mimeType: message.image_mime_type || 'image/jpeg',
    });
  }
  return out;
}

export const ChatBackgroundPickerScreen: React.FC = () => {
  const { theme } = useAppTheme();
  const { bottom: safeBottom } = useSafeAreaInsets();
  const navigation = useNavigation<Nav>();
  const route = useRoute<Route>();
  const { t } = useTranslation('chatDetail');

  const { entityId, participantKey, povEntityId } = route.params;

  const [tab, setTab] = useState<SourceTab>('profile');
  const [loading, setLoading] = useState(true);
  const [profileId, setProfileId] = useState<string | null>(null);
  const [images, setImages] = useState<CharacterImage[]>([]);
  const [historyImages, setHistoryImages] = useState<HistoryImage[]>([]);
  const [record, setRecord] = useState<ChatBackgroundRecord>({
    ref: null,
    dim: DEFAULT_CHAT_BACKGROUND_DIM,
  });
  const [dim, setDim] = useState(DEFAULT_CHAT_BACKGROUND_DIM);
  const [applying, setApplying] = useState(false);

  // ── Load sources + current setting ─────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const stored = await ChatBackgroundService.getChatBackgroundRecord(entityId);
        if (cancelled) return;
        setRecord(stored);
        setDim(stored.dim);

        const entity = await getEntity(entityId);
        const pid = entity?.character_profile_id ?? null;
        if (cancelled) return;
        setProfileId(pid);

        if (pid) {
          try {
            const gallery = await getCharacterImagesMetadata(pid);
            if (!cancelled) setImages(gallery);
          } catch (err) {
            log.warn('Failed to load profile gallery:', err);
          }
        }

        if (participantKey) {
          try {
            const messages = await getRecentConversationMessages(
              povEntityId || entityId,
              participantKey,
              HISTORY_MESSAGE_LIMIT,
            );
            if (!cancelled) setHistoryImages(collectHistoryImages(messages));
          } catch (err) {
            log.warn('Failed to load chat history images:', err);
          }
        }
      } catch (err) {
        log.error('Failed to load background picker:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [entityId, participantKey, povEntityId]);

  // ── Apply ──────────────────────────────────────────────────────────────
  const finish = useCallback(() => {
    hapticLightPress();
    navigation.goBack();
  }, [navigation]);

  const handleClear = useCallback(async () => {
    if (applying) return;
    setApplying(true);
    try {
      await ChatBackgroundService.clearChatBackground(entityId);
      setRecord(prev => ({ ...prev, ref: null }));
      finish();
    } finally {
      setApplying(false);
    }
  }, [applying, entityId, finish]);

  const handlePickProfile = useCallback(
    async (image: CharacterImage) => {
      if (applying || !profileId) return;
      setApplying(true);
      try {
        await ChatBackgroundService.setChatBackgroundProfile(
          entityId,
          profileId,
          image.id,
        );
        setRecord(prev => ({
          ...prev,
          ref: { kind: 'profile', profileId, imageId: image.id },
        }));
        finish();
      } finally {
        setApplying(false);
      }
    },
    [applying, entityId, finish, profileId],
  );

  const handlePickHistory = useCallback(
    async (image: HistoryImage) => {
      if (applying) return;
      setApplying(true);
      try {
        const path = await ChatBackgroundService.setChatBackgroundFromBase64(
          entityId,
          image.base64,
          image.mimeType,
          image.messageId,
        );
        if (path) {
          setRecord(prev => ({
            ...prev,
            ref: {
              kind: 'file',
              path,
              mimeType: image.mimeType,
              messageId: image.messageId,
            },
          }));
          finish();
        }
      } finally {
        setApplying(false);
      }
    },
    [applying, entityId, finish],
  );

  const handleDimChange = useCallback((value: number) => {
    setDim(Math.round(value));
  }, []);

  const handleDimComplete = useCallback(
    (value: number) => {
      const next = Math.round(value);
      setDim(next);
      ChatBackgroundService.setChatBackgroundDim(entityId, next).catch(err =>
        log.warn('Failed to persist background dim:', err),
      );
    },
    [entityId],
  );

  const isCurrentProfile = useCallback(
    (imageId: string) =>
      record.ref?.kind === 'profile' &&
      record.ref.profileId === profileId &&
      record.ref.imageId === imageId,
    [profileId, record.ref],
  );

  const isCurrentHistory = useCallback(
    (messageId: string) =>
      record.ref?.kind === 'file' && record.ref.messageId === messageId,
    [record.ref],
  );

  if (!theme) return null;

  const accent = theme.colors.accent.primary;
  const accentSecondary =
    theme.colors.accent.secondary ?? theme.colors.accent.primaryHover;
  const surface = theme.colors.background.surface;
  const elevated = theme.colors.background.elevated;

  const renderTab = (key: SourceTab, label: string, count: number) => {
    const active = tab === key;
    return (
      <TouchableOpacity
        key={key}
        onPress={() => {
          hapticLightPress();
          setTab(key);
        }}
        activeOpacity={0.75}
        style={[
          styles.tab,
          {
            borderColor: active ? accent + 'AA' : theme.colors.border.default + '55',
            backgroundColor: active ? accent + '22' : surface,
          },
        ]}
        testID={`background-source-${key}`}
        accessibilityRole="button"
        accessibilityState={{ selected: active }}
      >
        <ThemedText
          size={13}
          weight="medium"
          style={{ color: active ? accent : theme.colors.text.secondary }}
        >
          {label} ({count})
        </ThemedText>
      </TouchableOpacity>
    );
  };

  const renderNoBackgroundTile = () => (
    <TouchableOpacity
      onPress={handleClear}
      activeOpacity={0.75}
      style={[
        styles.tile,
        styles.noBackgroundTile,
        { borderColor: theme.colors.border.default + '99' },
      ]}
      testID="background-none-tile"
      accessibilityRole="button"
      accessibilityLabel={t('noBackground')}
    >
      <Icon name="image-off-outline" size={24} color={theme.colors.text.muted} />
      <ThemedText
        variant="muted"
        size={10}
        numberOfLines={1}
        style={styles.tileLabel}
      >
        {t('noBackground')}
      </ThemedText>
    </TouchableOpacity>
  );

  const renderProfileGrid = () => {
    if (images.length === 0) {
      return (
        <View testID="background-profile-empty">
          <View style={styles.grid}>{renderNoBackgroundTile()}</View>
          <View style={styles.emptyState}>
            <Icon name="image-multiple-outline" size={34} color={theme.colors.text.muted} />
            <ThemedText variant="muted" size={13}>
              {t('backgroundProfileEmpty')}
            </ThemedText>
          </View>
        </View>
      );
    }
    return (
      <View style={styles.grid}>
        {renderNoBackgroundTile()}
        {images.map(image => {
          const active = isCurrentProfile(image.id);
          const source = characterImageSource(
            profileId!,
            image.id,
            shouldUseThumbnail(image) ? 'thumb' : undefined,
          );
          return (
            <TouchableOpacity
              key={image.id}
              onPress={() => handlePickProfile(image)}
              activeOpacity={0.8}
              style={[
                styles.tile,
                {
                  borderColor: active ? accent : theme.colors.border.default + '55',
                  backgroundColor: elevated,
                },
              ]}
              testID={`background-profile-tile-${image.id}`}
              accessibilityRole="button"
            >
              <Image
                source={source ?? undefined}
                style={styles.tileImage}
                resizeMode="cover"
              />
              {active && (
                <View style={styles.checkOverlay} testID="background-current-check">
                  <Icon name="check" size={18} color="#fff" />
                </View>
              )}
            </TouchableOpacity>
          );
        })}
      </View>
    );
  };

  const renderHistoryGrid = () => {
    if (historyImages.length === 0) {
      return (
        <View testID="background-history-empty">
          <View style={styles.grid}>{renderNoBackgroundTile()}</View>
          <View style={styles.emptyState}>
            <Icon name="image-off-outline" size={34} color={theme.colors.text.muted} />
            <ThemedText variant="muted" size={13}>
              {t('backgroundHistoryEmpty')}
            </ThemedText>
          </View>
        </View>
      );
    }
    return (
      <View style={styles.grid}>
        {renderNoBackgroundTile()}
        {historyImages.map(image => (
          <TouchableOpacity
            key={image.messageId}
            onPress={() => handlePickHistory(image)}
            activeOpacity={0.8}
            style={[
              styles.tile,
              {
                borderColor: isCurrentHistory(image.messageId)
                  ? accent
                  : theme.colors.border.default + '55',
                backgroundColor: elevated,
              },
            ]}
            testID={`background-history-tile-${image.messageId}`}
            accessibilityRole="button"
          >
            <Image
              source={{
                uri: `data:${image.mimeType};base64,${image.base64}`,
              }}
              style={styles.tileImage}
              resizeMode="cover"
            />
            {isCurrentHistory(image.messageId) && (
              <View style={styles.checkOverlay} testID="background-current-check">
                <Icon name="check" size={18} color="#fff" />
              </View>
            )}
          </TouchableOpacity>
        ))}
      </View>
    );
  };

  return (
    <ThemedView style={styles.container}>
      <ScreenHeader
        title={t('backgroundPickerTitle')}
        subtitle={t('setBackgroundCaption')}
        onBack={() => navigation.goBack()}
      />

      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: 32 + safeBottom },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {loading ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator size="small" color={accent} />
          </View>
        ) : (
          <>
            <View style={styles.tabRow}>
              {renderTab('profile', t('profileSource'), images.length)}
              {renderTab('history', t('chatHistorySource'), historyImages.length)}
            </View>

            {tab === 'profile' ? renderProfileGrid() : renderHistoryGrid()}

            {/* ── Dim scrim (0–100) ── */}
            <View
              style={[
                styles.dimCard,
                {
                  backgroundColor: surface,
                  borderColor: theme.colors.border.default + '66',
                },
              ]}
            >
              <View style={styles.dimHeader}>
                <Icon name="brightness-6" size={16} color={accentSecondary} />
                <ThemedText size={13} weight="medium" style={{ flex: 1 }}>
                  {t('dim')}
                </ThemedText>
                <ThemedText size={12} variant="muted">
                  {dim}%
                </ThemedText>
              </View>
              <Slider
                style={styles.slider}
                minimumValue={0}
                maximumValue={100}
                step={1}
                value={dim}
                onValueChange={handleDimChange}
                onSlidingComplete={handleDimComplete}
                minimumTrackTintColor={accent}
                maximumTrackTintColor={theme.colors.border.default}
                thumbTintColor={accent}
                testID="background-dim-slider"
              />
            </View>
          </>
        )}
      </ScrollView>
    </ThemedView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: {
    padding: 16,
    gap: 14,
  },
  loadingRow: {
    paddingVertical: 48,
    alignItems: 'center',
  },
  tabRow: {
    flexDirection: 'row',
    gap: 8,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 9,
    borderRadius: 999,
    borderWidth: 1,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  tile: {
    width: '31.5%',
    aspectRatio: 1,
    borderRadius: 12,
    borderWidth: 1,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  noBackgroundTile: {
    borderStyle: 'dashed',
    gap: 6,
  },
  tileImage: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  tileLabel: {
    paddingHorizontal: 4,
    textAlign: 'center',
  },
  checkOverlay: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(184,79,208,0.92)',
  },
  emptyState: {
    alignItems: 'center',
    gap: 8,
    paddingVertical: 36,
  },
  dimCard: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 12,
    gap: 4,
  },
  dimHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  slider: {
    width: '100%',
    height: 36,
  },
});

export default ChatBackgroundPickerScreen;
