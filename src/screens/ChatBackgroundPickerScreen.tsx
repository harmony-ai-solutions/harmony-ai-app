/**
 * ChatBackgroundPicker — choose a per-entity chat background.
 *
 * Owner-approved mock (chat background):
 *   - ONE grid with two source tabs, counts in the labels:
 *       Profile       → the character's gallery (incl. its avatar / primary
 *                       image), resolved by URL exactly like
 *                       `AIProfileScreen.galleryTileImageSource` (thumb when the
 *                       engine advertises one).
 *       Chat history  → every image that ever appeared in this conversation.
 *   - A dashed "No background" tile clears the setting.
 *   - The current background tile carries a ✓ overlay.
 *   - Dim slider (0–100, default 40) sets the dark scrim behind chat bubbles.
 *
 * Tap applies INSTANTLY (haptic) and the screen STAYS OPEN: the ✓ overlay moves
 * to the tapped tile while the previous one loses it, so the user can keep
 * tuning the dim against the live preview strip (that image with the CURRENT
 * scrim opacity) without bouncing to the chat. Leaving is the header back
 * arrow; the chat screen reloads the background on focus.
 *
 * Chat-history source — FULL scan + lazy tiles
 * --------------------------------------------
 * The history tab scans the WHOLE conversation: `getConversationImageMessages`
 * walks every page with the engine's opaque cursor (same pagination/ordering as
 * the chat screen) instead of reading the last 200 messages, so old images and
 * the tab count are complete. State holds LIGHTWEIGHT metadata only (message
 * id, mime type, approximate byte size) — never base64 blobs.
 *
 * Reused from the character list (`CharactersScreen`): a WINDOWED grid, so only
 * on-screen tiles mount, and a per-item progressive image load through a small
 * bounded LRU cache with in-flight dedupe (`loadHistoryImageBytes`, 24
 * entries), mirroring how each `CharacterProfileCard` receives its portrait as
 * soon as ITS `getPrimaryImage` thumbnail lands instead of waiting for all.
 * Adapted: conversation-message images have NO engine-derived preview (unlike
 * `CharacterImage`, which has `thumbnail_state` + `?variant=thumb`), and true
 * downscale-thumbnailing of raw base64 would need a new native image dependency
 * — which this feature forbids. So each visible tile lazily fetches its own
 * bytes by message id and lets the platform decoder scale the tile; adopted
 * byte-identical re-sends still collapse into one tile (a length + head/tail
 * fingerprint, computed during the scan, without keeping the blob).
 *
 * Scope: the background is stored against the partner ENTITY id, so it is
 * independent of the persona the user chats as.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Image,
  ActivityIndicator,
} from 'react-native';
import type { ImageSourcePropType } from 'react-native';
import Slider from '@react-native-community/slider';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useAppTheme } from '../contexts/ThemeContext';
import { useToast } from '../contexts/AppToastContext';
import { ThemedView } from '../components/themed/ThemedView';
import { ThemedText } from '../components/themed/ThemedText';
import { ScreenHeader } from '../components/themed/ScreenHeader';
import { hapticLightPress } from '../utils/haptics';
import {
  getEntity,
  getCharacterImagesMetadata,
  getCachedImageBytes,
  shouldUseThumbnail,
  getConversationImageMessages,
  getConversationMessageImageBase64,
} from '../database/repositories';
import { createDataURL } from '../database/base64';
import type { CharacterImage } from '../database/models';
import type { ConversationImageMessageRef } from '../services/engine/repositories/conversation_messages';
import ChatBackgroundService, {
  DEFAULT_CHAT_BACKGROUND_DIM,
  chatBackgroundFileUri,
} from '../services/ChatBackgroundService';
import type { ChatBackgroundRecord } from '../services/ChatBackgroundService';
import type { RootStackParamList } from '../navigation/AppNavigator';
import { createLogger } from '../utils/logger';

const log = createLogger('[ChatBackgroundPicker]');

type Nav = NativeStackNavigationProp<RootStackParamList, 'ChatBackgroundPicker'>;
type Route = RouteProp<RootStackParamList, 'ChatBackgroundPicker'>;
type SourceTab = 'profile' | 'history';

/** Grid row width model — three tiles plus the row gap, as in the mock. */
const GRID_COLUMNS = 3;

/** Visible tiles buffered above/below the viewport (windowed grid). */
const GRID_WINDOW_SIZE = 5;

/** How many lazily-fetched history images stay decoded in the LRU. */
export const HISTORY_IMAGE_CACHE_MAX_ENTRIES = 24;

// ── Lazy chat-history image bytes ───────────────────────────────────────────
//
// Chat-history images are raw base64 with no engine thumbnail. The grid keeps
// metadata only; each tile asks for ITS bytes when it mounts (and unmounts when
// it leaves the window), so a 500-image chat decodes a handful at a time. The
// bounded LRU keeps the most recent tiles instant on scroll-back and gives the
// apply path the already-loaded bytes without a second request.

const historyImageCache = new Map<string, string>();
const historyImageInFlight = new Map<string, Promise<string>>();

/** Cached bytes for a message id (LRU bump), or null when not loaded. */
export function getCachedHistoryImageBytes(messageId: string): string | null {
  const cached = historyImageCache.get(messageId);
  if (!cached) return null;
  historyImageCache.delete(messageId);
  historyImageCache.set(messageId, cached);
  return cached;
}

function cacheHistoryImageBytes(messageId: string, base64: string): void {
  historyImageCache.delete(messageId);
  historyImageCache.set(messageId, base64);
  while (historyImageCache.size > HISTORY_IMAGE_CACHE_MAX_ENTRIES) {
    const oldest = historyImageCache.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    historyImageCache.delete(oldest);
  }
}

/** Drop every cached blob (tests / engine restart). */
export function clearHistoryImageCache(): void {
  historyImageCache.clear();
  historyImageInFlight.clear();
}

/**
 * Lazily fetch ONE message's image bytes: LRU hit → in-flight join → single
 * `getConversationMessageImageBase64` request. Empty string when the message
 * has no blob; transport errors propagate so the tile can show its placeholder.
 */
export async function loadHistoryImageBytes(messageId: string): Promise<string> {
  const cached = getCachedHistoryImageBytes(messageId);
  if (cached) return cached;

  const inFlight = historyImageInFlight.get(messageId);
  if (inFlight) return inFlight;

  const pending = (async (): Promise<string> => {
    try {
      const data = await getConversationMessageImageBase64(messageId);
      if (data) cacheHistoryImageBytes(messageId, data);
      return data;
    } finally {
      historyImageInFlight.delete(messageId);
    }
  })();

  historyImageInFlight.set(messageId, pending);
  return pending;
}

// ── Grid model ─────────────────────────────────────────────────────────────

type GridItem =
  | { kind: 'none' }
  | { kind: 'profile'; image: CharacterImage }
  | { kind: 'history'; imageRef: ConversationImageMessageRef };

function gridItemKey(item: GridItem): string {
  switch (item.kind) {
    case 'none':
      return 'none';
    case 'profile':
      return item.image.id;
    default:
      return item.imageRef.messageId;
  }
}

// ── History tile (lazy, per-tile) ───────────────────────────────────────────

interface HistoryTileProps {
  imageRef: ConversationImageMessageRef;
  active: boolean;
  accent: string;
  borderColor: string;
  backgroundColor: string;
  onPress: () => void;
}

/**
 * A chat-history tile. Defined at module scope so the windowed grid does not
 * remount (and re-fetch) tiles on every parent render — the same reason the
 * character list keeps its card component separate from the screen.
 */
const HistoryImageTile: React.FC<HistoryTileProps> = ({
  imageRef,
  active,
  accent,
  borderColor,
  backgroundColor,
  onPress,
}) => {
  const [base64, setBase64] = useState<string | null>(() =>
    getCachedHistoryImageBytes(imageRef.messageId),
  );

  useEffect(() => {
    let cancelled = false;
    // A tile only mounts while it is inside the list window → this is the
    // visibility gate (no eager fetch for off-screen history).
    loadHistoryImageBytes(imageRef.messageId)
      .then(data => {
        if (!cancelled) setBase64(data || null);
      })
      .catch(err => {
        log.warn('Failed to load chat-history image:', err);
      });
    return () => {
      cancelled = true;
    };
  }, [imageRef.messageId]);

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.8}
      style={[
        styles.tile,
        { borderColor: active ? accent : borderColor, backgroundColor },
      ]}
      testID={`background-history-tile-${imageRef.messageId}`}
      accessibilityRole="button"
    >
      {base64 ? (
        <Image
          source={{ uri: `data:${imageRef.mimeType};base64,${base64}` }}
          style={styles.tileImage}
          resizeMode="cover"
        />
      ) : (
        <ActivityIndicator size="small" color={accent} />
      )}
      {active && (
        <View style={styles.checkOverlay} testID="background-current-check">
          <Icon name="check" size={18} color="#fff" />
        </View>
      )}
    </TouchableOpacity>
  );
};

// ── Profile gallery tile (progressive, per-tile) ────────────────────────────
//
// Display bytes come from the app's own fetch + byte cache as a data URL, never
// from a URL + `source.headers` Image source: under RN New Architecture the
// Fabric image loader does not forward the headers, so the engine's token check
// 401'd the image GET and Fresco painted the tile blank with no JS error (owner
// device, Android 15, v0.4.18-dev, 2026-10-21). Module scope, like the history
// tile, so a parent re-render (dim slider, ✓ move) does not restart the load.

interface ProfileImageTileProps {
  profileId: string;
  image: CharacterImage;
  active: boolean;
  accent: string;
  borderColor: string;
  backgroundColor: string;
  onPress: () => void;
}

const ProfileImageTile: React.FC<ProfileImageTileProps> = ({
  profileId,
  image,
  active,
  accent,
  borderColor,
  backgroundColor,
  onPress,
}) => {
  // Metadata rows carry `image_data: ''`; a row that already has bytes renders
  // synchronously.
  const [uri, setUri] = useState<string | null>(() =>
    image.image_data ? createDataURL(image.image_data, image.mime_type) : null,
  );
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (image.image_data) return undefined;
    let cancelled = false;
    setFailed(false);
    const variant = shouldUseThumbnail(image) ? 'thumb' : 'original';
    (async () => {
      try {
        const bytes =
          (await getCachedImageBytes(profileId, image.id, variant, {
            thumbnailState: image.thumbnail_state,
          })) ??
          // A remembered "no thumbnail" (thumb 404) still has the original.
          (variant === 'thumb'
            ? await getCachedImageBytes(profileId, image.id, 'original')
            : null);
        if (cancelled) return;
        if (!bytes) {
          setFailed(true);
          return;
        }
        setUri(createDataURL(bytes.data, bytes.contentType || image.mime_type));
      } catch (err) {
        if (!cancelled) {
          // Keep the plain tile background; one missing image is not an error
          // the user needs to see.
          log.warn('Failed to load profile tile image:', err);
          setFailed(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [profileId, image]);

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.8}
      style={[
        styles.tile,
        { borderColor: active ? accent : borderColor, backgroundColor },
      ]}
      testID={`background-profile-tile-${image.id}`}
      accessibilityRole="button"
    >
      {uri ? (
        <Image
          source={{ uri }}
          style={styles.tileImage}
          resizeMode="cover"
          testID={`background-profile-image-${image.id}`}
        />
      ) : (
        !failed && <ActivityIndicator size="small" color={accent} />
      )}
      {active && (
        <View style={styles.checkOverlay} testID="background-current-check">
          <Icon name="check" size={18} color="#fff" />
        </View>
      )}
    </TouchableOpacity>
  );
};

export const ChatBackgroundPickerScreen: React.FC = () => {
  const { theme } = useAppTheme();
  const { bottom: safeBottom } = useSafeAreaInsets();
  const { showToast } = useToast();
  const navigation = useNavigation<Nav>();
  const route = useRoute<Route>();
  const { t } = useTranslation('chatDetail');

  const { entityId, participantKey, povEntityId } = route.params;

  const [tab, setTab] = useState<SourceTab>('profile');
  const [loading, setLoading] = useState(true);
  const [profileId, setProfileId] = useState<string | null>(null);
  const [images, setImages] = useState<CharacterImage[]>([]);
  // Full-scan metadata ONLY (no base64) — tiles fetch their own bytes lazily.
  const [historyImages, setHistoryImages] = useState<ConversationImageMessageRef[]>(
    [],
  );
  const [record, setRecord] = useState<ChatBackgroundRecord>({
    ref: null,
    dim: DEFAULT_CHAT_BACKGROUND_DIM,
  });
  const [dim, setDim] = useState(DEFAULT_CHAT_BACKGROUND_DIM);
  const [applying, setApplying] = useState(false);
  // The full history scan runs on its own so a long chat never blocks the
  // profile tab (its count fills in when the scan lands).
  const [historyLoading, setHistoryLoading] = useState(false);

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
      } catch (err) {
        log.error('Failed to load background picker:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [entityId]);

  // FULL scan of the conversation for image messages (every page, metadata
  // only — see the header comment). Deliberately separate from the load above:
  // a 10k-message history must not gate the picker's first paint.
  useEffect(() => {
    if (!participantKey) return undefined;
    let cancelled = false;
    setHistoryLoading(true);
    (async () => {
      try {
        const refs = await getConversationImageMessages(
          povEntityId || entityId,
          participantKey,
        );
        if (!cancelled) setHistoryImages(refs);
      } catch (err) {
        log.warn('Failed to load chat history images:', err);
      } finally {
        if (!cancelled) setHistoryLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [entityId, participantKey, povEntityId]);

  // ── Apply (stays on this screen) ───────────────────────────────────────
  const handleClear = useCallback(async () => {
    if (applying) return;
    setApplying(true);
    try {
      await ChatBackgroundService.clearChatBackground(entityId);
      setRecord(prev => ({ ...prev, ref: null }));
      hapticLightPress();
    } catch (err) {
      log.warn('Failed to clear chat background:', err);
      showToast(t('backgroundSetFailed'));
    } finally {
      setApplying(false);
    }
  }, [applying, entityId, showToast, t]);

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
        hapticLightPress();
      } catch (err) {
        log.warn('Failed to set profile background:', err);
        showToast(t('backgroundSetFailed'));
      } finally {
        setApplying(false);
      }
    },
    [applying, entityId, profileId, showToast, t],
  );

  const handlePickHistory = useCallback(
    async (imageRef: ConversationImageMessageRef) => {
      if (applying) return;
      setApplying(true);
      try {
        // The tile usually already fetched these bytes (it is visible to be
        // tapped); the fallback covers a cache eviction right before the tap.
        const base64 =
          getCachedHistoryImageBytes(imageRef.messageId) ??
          (await loadHistoryImageBytes(imageRef.messageId));
        if (!base64) {
          showToast(t('backgroundSetFailed'));
          return;
        }
        const path = await ChatBackgroundService.setChatBackgroundFromBase64(
          entityId,
          base64,
          imageRef.mimeType,
          imageRef.messageId,
        );
        if (!path) {
          // The service swallows the write error and returns null — surface it
          // instead of leaving the tap a silent no-op.
          showToast(t('backgroundSetFailed'));
          return;
        }
        setRecord(prev => ({
          ...prev,
          ref: {
            kind: 'file',
            path,
            mimeType: imageRef.mimeType,
            messageId: imageRef.messageId,
          },
        }));
        hapticLightPress();
      } catch (err) {
        log.warn('Failed to set chat-history background:', err);
        showToast(t('backgroundSetFailed'));
      } finally {
        setApplying(false);
      }
    },
    [applying, entityId, showToast, t],
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

  // The ✓ survives the metadata-only list: `ref.messageId` is all it needs.
  const isCurrentHistory = useCallback(
    (messageId: string) =>
      record.ref?.kind === 'file' && record.ref.messageId === messageId,
    [record.ref],
  );

  /**
   * Render-ready source of the CURRENT background (preview strip).
   *
   * File refs are local `file://` URIs. Profile refs resolve the ORIGINAL bytes
   * through the byte cache into a data URL — a URL + headers source is unusable
   * under Fabric (see {@link ProfileImageTile}).
   */
  const [previewSource, setPreviewSource] = useState<ImageSourcePropType | null>(
    null,
  );
  useEffect(() => {
    const ref = record.ref;
    if (!ref) {
      setPreviewSource(null);
      return undefined;
    }
    if (ref.kind === 'file') {
      setPreviewSource({ uri: chatBackgroundFileUri(ref.path) });
      return undefined;
    }
    let cancelled = false;
    // Clear first: never show the previous background while this one loads.
    setPreviewSource(null);
    getCachedImageBytes(ref.profileId, ref.imageId, 'original')
      .then(bytes => {
        if (cancelled || !bytes) return;
        setPreviewSource({
          uri: createDataURL(bytes.data, bytes.contentType || 'image/jpeg'),
        });
      })
      .catch(err => {
        // The strip keeps its muted placeholder.
        log.warn('Failed to load the background preview:', err);
      });
    return () => {
      cancelled = true;
    };
  }, [record.ref]);

  const gridItems: GridItem[] = useMemo(() => {
    const none: GridItem = { kind: 'none' };
    if (tab === 'profile') {
      return [none, ...images.map(image => ({ kind: 'profile' as const, image }))];
    }
    return [
      none,
      ...historyImages.map(imageRef => ({ kind: 'history' as const, imageRef })),
    ];
  }, [tab, images, historyImages]);

  const sourceIsEmpty =
    tab === 'profile' ? images.length === 0 : historyImages.length === 0;

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

  const renderProfileTile = (image: CharacterImage) => (
    <ProfileImageTile
      profileId={profileId!}
      image={image}
      active={isCurrentProfile(image.id)}
      accent={accent}
      borderColor={theme.colors.border.default + '55'}
      backgroundColor={elevated}
      onPress={() => handlePickProfile(image)}
    />
  );

  const renderItem = ({ item }: { item: GridItem }) => {
    if (item.kind === 'none') return renderNoBackgroundTile();
    if (item.kind === 'profile') return renderProfileTile(item.image);
    return (
      <HistoryImageTile
        imageRef={item.imageRef}
        active={isCurrentHistory(item.imageRef.messageId)}
        accent={accent}
        borderColor={theme.colors.border.default + '55'}
        backgroundColor={elevated}
        onPress={() => handlePickHistory(item.imageRef)}
      />
    );
  };

  const renderEmptyState = () => {
    if (tab === 'history' && historyLoading) {
      return (
        <View style={styles.emptyState} testID="background-history-scanning">
          <ActivityIndicator size="small" color={accent} />
        </View>
      );
    }
    if (!sourceIsEmpty) return null;
    return (
      <View
        style={styles.emptyState}
        testID={
          tab === 'profile'
            ? 'background-profile-empty'
            : 'background-history-empty'
        }
      >
        <Icon
          name={tab === 'profile' ? 'image-multiple-outline' : 'image-off-outline'}
          size={34}
          color={theme.colors.text.muted}
        />
        <ThemedText variant="muted" size={13}>
          {tab === 'profile'
            ? t('backgroundProfileEmpty')
            : t('backgroundHistoryEmpty')}
        </ThemedText>
      </View>
    );
  };

  /** Dim scrim card + live preview of the CURRENT background at `dim / 100`. */
  const renderDimCard = () => (
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
      {/* Live preview: tune dim here instead of bouncing to the chat. */}
      <View style={styles.previewStrip} testID="background-dim-preview">
        {previewSource ? (
          <>
            <Image
              source={previewSource}
              style={styles.previewImage}
              resizeMode="cover"
              testID="background-dim-preview-image"
            />
            <View
              pointerEvents="none"
              style={[styles.previewScrim, { opacity: dim / 100 }]}
              testID="background-dim-preview-scrim"
            />
          </>
        ) : (
          <View style={styles.previewEmpty} testID="background-dim-preview-empty">
            <Icon
              name="image-off-outline"
              size={18}
              color={theme.colors.text.muted}
            />
            <ThemedText variant="muted" size={11}>
              {t('noBackground')}
            </ThemedText>
          </View>
        )}
      </View>
    </View>
  );

  return (
    <ThemedView style={styles.container}>
      <ScreenHeader
        title={t('backgroundPickerTitle')}
        subtitle={t('setBackgroundCaption')}
        onBack={() => navigation.goBack()}
      />

      {loading ? (
        <View style={styles.loadingRow}>
          <ActivityIndicator size="small" color={accent} />
        </View>
      ) : (
        /* Windowed grid: only on-screen tiles mount, so chat-history tiles
           fetch their base64 lazily (character-list pattern). */
        <FlatList
          key={tab}
          data={gridItems}
          keyExtractor={gridItemKey}
          numColumns={GRID_COLUMNS}
          columnWrapperStyle={styles.gridRow}
          contentContainerStyle={[
            styles.scrollContent,
            { paddingBottom: 32 + safeBottom },
          ]}
          initialNumToRender={12}
          maxToRenderPerBatch={12}
          windowSize={GRID_WINDOW_SIZE}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={
            <View style={styles.tabRow}>
              {renderTab('profile', t('profileSource'), images.length)}
              {renderTab('history', t('chatHistorySource'), historyImages.length)}
            </View>
          }
          ListFooterComponent={
            <View style={styles.footer}>
              {renderEmptyState()}
              {renderDimCard()}
            </View>
          }
          renderItem={renderItem}
        />
      )}
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
  gridRow: {
    gap: 8,
    marginBottom: 8,
  },
  footer: {
    gap: 14,
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
    paddingVertical: 24,
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
  previewStrip: {
    height: 120,
    borderRadius: 12,
    overflow: 'hidden',
    marginTop: 6,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  previewImage: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  previewScrim: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: '#000',
  },
  previewEmpty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
});

export default ChatBackgroundPickerScreen;
