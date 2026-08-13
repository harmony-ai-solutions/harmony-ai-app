/**
 * CharacterCoverFlowCarousel — sleek 3D Vertical/Perspective Cover Flow carousel
 * for browsing AI character cards.
 *
 * The active (center) card is highlighted at full scale with an elevated neon
 * glow while preceding/following cards are angled, scaled down (≈0.85) and
 * recessed along the Z-axis — the classic "stacked deck" cover-flow look.
 *
 * Implementation notes:
 * - Built on React Native's built-in `Animated` API (project convention — the
 *   app deliberately does NOT ship react-native-reanimated / gesture-handler).
 * - All per-card transforms (translate/scale/rotate/opacity/glow) are driven by
 *   a single `Animated.Value` fed by the FlatList scroll offset via
 *   `Animated.event` with the JS driver (`useNativeDriver: false`) — the
 *   battle-tested RN pattern for scroll-driven effects, safe inside a `<Modal>`
 *   on the New Architecture (a native-driver animated scroll event attach there
 *   can throw a render error).
 * - Swipe = native FlatList paging (snapToInterval); tap = smooth scrollToOffset
 *   to center the tapped card, then `onSelect` fires once the card settles.
 */

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Animated,
  FlatList,
  Image,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import LinearGradient from 'react-native-linear-gradient';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useAppTheme } from '../../contexts/ThemeContext';
import { ThemedText } from '../themed/ThemedText';
import { hexToRgba, clamp } from '../../utils/colorUtils';
import { hapticLightPress } from '../../utils/haptics';
import type { CharacterProfile } from '../../database/models';

interface CharacterCoverFlowCarouselProps {
  /** Profiles to browse — rendered as a stacked 3D deck. */
  profiles: CharacterProfile[];
  /** profileId → primary-avatar data URL (or null when the profile has none). */
  images: Record<string, string | null>;
  /** Which intent opened the carousel — controls the copy-pip icon. */
  mode: 'duplicate' | 'fromExisting';
  /** Fired when the user taps a card and it settles into the center focus. */
  onSelect: (profile: CharacterProfile) => void;
}

// ── Card geometry ───────────────────────────────────────────────────────
const CARD_WIDTH = 252;
const CARD_HEIGHT = 336;
const CARD_GAP = 16;
/**
 * Width of each FlatList slot. Each slot is exactly this wide with the card
 * centered inside, so slot center == card center — this is what makes
 * `snapToInterval` land every card perfectly centered (the classic RN
 * carousel pattern). If the slots were only CARD_WIDTH wide while snapping
 * to this interval, every stop would drift off-center.
 */
const ITEM_WIDTH = CARD_WIDTH + CARD_GAP;
/** Camera distance — how strong the 3D depth effect is. */
const PERSPECTIVE = 1100;
/** Scale of non-focused neighbor cards. */
const NEIGHBOR_SCALE = 0.85;
/** Opacity of non-focused neighbor cards. */
const NEIGHBOR_OPACITY = 0.55;
/** How far neighbor cards sink vertically (stacked-deck feel). */
const NEIGHBOR_DROP = 18;
/** How far neighbor cards are pushed toward the center (cover-flow converge). */
const NEIGHBOR_SLIDE = CARD_WIDTH * 0.18;
/** Angle (deg) applied to neighbor cards along the Y axis. */
const NEIGHBOR_ANGLE = 16;

interface CarouselCardProps {
  profile: CharacterProfile;
  imageUri: string | null;
  index: number;
  scrollX: Animated.Value;
  mode: 'duplicate' | 'fromExisting';
  currentIndex: number;
  accent: string;
  accentSecondary: string;
  glassBg: string;
  borderStart: string;
  borderEnd: string;
  textMuted: string;
  onTap: (index: number, profile: CharacterProfile) => void;
}

/**
 * A single deck card. Interpolates its transform/opacity/glow from the shared
 * scroll offset so every frame is native-driver driven.
 */
const DeckCard = React.memo(function DeckCardImpl({
  profile,
  imageUri,
  index,
  scrollX,
  mode,
  currentIndex,
  accent,
  accentSecondary,
  glassBg,
  borderStart,
  borderEnd,
  textMuted,
  onTap,
}: CarouselCardProps) {
  // Input range in absolute scroll-offset units around this card's center.
  // Because the content padding centers card 0 at scrollX = 0, card `index`
  // is perfectly centered at scrollX = index * ITEM_WIDTH — matching the
  // native snap offsets exactly.
  const inputRange = useMemo(
    () => [(index - 1) * ITEM_WIDTH, index * ITEM_WIDTH, (index + 1) * ITEM_WIDTH],
    [index],
  );

  const translateX = scrollX.interpolate({
    inputRange,
    outputRange: [NEIGHBOR_SLIDE, 0, -NEIGHBOR_SLIDE],
    extrapolate: 'clamp',
  });
  const translateY = scrollX.interpolate({
    inputRange,
    outputRange: [NEIGHBOR_DROP, 0, NEIGHBOR_DROP],
    extrapolate: 'clamp',
  });
  const scale = scrollX.interpolate({
    inputRange,
    outputRange: [NEIGHBOR_SCALE, 1, NEIGHBOR_SCALE],
    extrapolate: 'clamp',
  });
  // Rotation MUST use string degree units with the native driver — the native
  // animated module (Android in particular) rejects raw numbers for rotate
  // transforms and throws a Render Error when the node config is created.
  const rotateY = scrollX.interpolate({
    inputRange,
    outputRange: [`${NEIGHBOR_ANGLE}deg`, '0deg', `-${NEIGHBOR_ANGLE}deg`],
    extrapolate: 'clamp',
  });
  const opacity = scrollX.interpolate({
    inputRange,
    outputRange: [NEIGHBOR_OPACITY, 1, NEIGHBOR_OPACITY],
    extrapolate: 'clamp',
  });
  const glow = scrollX.interpolate({
    inputRange,
    outputRange: [0, 1, 0],
    extrapolate: 'clamp',
  });

  // The focused card renders above the deck; depth controls layering.
  const zIndex = Math.max(1, 10 - Math.abs(index - currentIndex));

  return (
    <Animated.View
      style={{
        width: CARD_WIDTH,
        height: CARD_HEIGHT,
        zIndex,
        opacity,
        transform: [
          { perspective: PERSPECTIVE },
          { translateX },
          { translateY },
          { rotateY },
          { scale },
        ],
      }}
    >
      {/* Neon glow halo — fades in on the focused card only */}
      <Animated.View
        pointerEvents="none"
        style={[
          styles.halo,
          {
            opacity: glow,
            backgroundColor: hexToRgba(accent, 0.32),
            borderColor: hexToRgba(accent, 0.6),
            shadowColor: accent,
          },
        ]}
      />

      {/* Specular gradient border (glass hairline) */}
      <LinearGradient
        colors={[borderStart, hexToRgba(accent, 0.25), borderEnd]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.gradientBorder}
      >
        <View style={[styles.glassBody, { backgroundColor: glassBg }]}>
          {/* Portrait avatar */}
          <View style={styles.portraitWrap}>
            {imageUri ? (
              <Image
                source={{ uri: imageUri }}
                style={styles.portrait}
                resizeMode="cover"
              />
            ) : (
              <View style={styles.portraitPlaceholder}>
                <Icon name="account" size={44} color={textMuted} />
              </View>
            )}
            <LinearGradient
              colors={['transparent', 'rgba(0,0,0,0.72)']}
              start={{ x: 0, y: 0 }}
              end={{ x: 0, y: 1 }}
              style={StyleSheet.absoluteFill}
              pointerEvents="none"
            />
          </View>

          {/* Name + persona tag */}
          <View style={styles.cardBody}>
            <ThemedText size={17} weight="bold" numberOfLines={1} style={styles.cardName}>
              {profile.name}
            </ThemedText>
            <ThemedText
              size={12}
              variant="muted"
              numberOfLines={2}
              style={styles.personaTag}
            >
              {profile.personality ||
                profile.description ||
                '…'}
            </ThemedText>
          </View>

          {/* Mode pip — copy badge for duplication, arrow for linking */}
          <LinearGradient
            colors={[accent, accentSecondary]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.cardPip}
          >
            <Icon
              name={mode === 'duplicate' ? 'content-copy' : 'arrow-right'}
              size={14}
              color="#fff"
            />
          </LinearGradient>

          {/* Bottom accent stripe (focused card feels premium) */}
          <LinearGradient
            colors={[accent, 'transparent']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.bottomStripe}
            pointerEvents="none"
          />
        </View>
      </LinearGradient>

      <Pressable
        onPress={() => onTap(index, profile)}
        style={StyleSheet.absoluteFill}
        accessibilityRole="button"
        accessibilityLabel={`${mode === 'duplicate' ? 'Duplicate' : 'Select'} ${profile.name}`}
        testID={`ai-picker-card-${profile.id}`}
      />
    </Animated.View>
  );
});

export const CharacterCoverFlowCarousel: React.FC<CharacterCoverFlowCarouselProps> = ({
  profiles,
  images,
  mode,
  onSelect,
}) => {
  const { theme } = useAppTheme();
  const { width: screenWidth } = useWindowDimensions();
  const { t } = useTranslation('characters');

  const listRef = useRef<FlatList<CharacterProfile>>(null);
  const scrollX = useRef(new Animated.Value(0)).current;
  // Track which index is currently centered — drives z-layering + pending taps.
  const initialIndex = useMemo(
    () => (profiles.length === 0 ? 0 : Math.floor((profiles.length - 1) / 2)),
    [profiles.length],
  );

  // Horizontal padding that lets the FIRST and LAST cards center too.
  // The centered card sits at `edgePad + ITEM_WIDTH/2` from the list start, so
  // the viewport center (screenWidth/2) must equal that when the list is at
  // offset 0 → edgePad = (screenWidth - ITEM_WIDTH) / 2.
  const edgePad = Math.max(0, (screenWidth - ITEM_WIDTH) / 2);
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const currentIndexRef = useRef(initialIndex);
  const pendingSelectRef = useRef<{
    index: number;
    profile: CharacterProfile;
    timeout: ReturnType<typeof setTimeout>;
  } | null>(null);

  // Keep the pending-tap timer from firing after unmount.
  useEffect(
    () => () => {
      if (pendingSelectRef.current) {
        clearTimeout(pendingSelectRef.current.timeout);
      }
    },
    [],
  );

  // Center the deck on the middle card when the list first mounts (or when the
  // filtered set changes). `initialScrollIndex` alone left-aligns the item, so
  // we drive the scroll to the exact centered offset ourselves. The content
  // padding already centers card 0 at scrollX = 0, so index N centers at
  // scrollX = N * ITEM_WIDTH.
  useEffect(() => {
    if (profiles.length === 0) return;
    setCurrentIndex(initialIndex);
    currentIndexRef.current = initialIndex;
    const target = initialIndex * ITEM_WIDTH;
    const raf = requestAnimationFrame(() => {
      listRef.current?.scrollToOffset({ offset: target, animated: false });
    });
    return () => cancelAnimationFrame(raf);
  }, [profiles.length, initialIndex]);

  const commitPendingSelect = useCallback(
    (settledIndex?: number) => {
      const pending = pendingSelectRef.current;
      if (!pending) return;
      if (settledIndex !== undefined && settledIndex !== pending.index) return;
      clearTimeout(pending.timeout);
      pendingSelectRef.current = null;
      onSelect(pending.profile);
    },
    [onSelect],
  );

  const handleTap = useCallback(
    (index: number, profile: CharacterProfile) => {
      hapticLightPress();
      // Already centered — select immediately.
      if (index === currentIndexRef.current) {
        onSelect(profile);
        return;
      }
      // Smoothly bring the tapped card to the center focus, then select once
      // it settles (momentum end → immediate; timer as a safety net).
      setCurrentIndex(index);
      currentIndexRef.current = index;
      listRef.current?.scrollToOffset({
        offset: index * ITEM_WIDTH,
        animated: true,
      });

      if (pendingSelectRef.current) {
        clearTimeout(pendingSelectRef.current.timeout);
      }
      const timeout = setTimeout(() => {
        if (
          pendingSelectRef.current &&
          pendingSelectRef.current.index === index
        ) {
          const p = pendingSelectRef.current.profile;
          pendingSelectRef.current = null;
          onSelect(p);
        }
      }, 420);
      pendingSelectRef.current = { index, profile, timeout };
    },
    [onSelect],
  );

  const handleScrollEnd = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const x = e.nativeEvent.contentOffset.x;
      const idx = clamp(
        Math.round(x / ITEM_WIDTH),
        0,
        Math.max(0, profiles.length - 1),
      );
      setCurrentIndex(idx);
      currentIndexRef.current = idx;
      commitPendingSelect(idx);
    },
    [commitPendingSelect, profiles.length],
  );

  // JS-driver scroll event. We deliberately do NOT use `useNativeDriver: true`
  // here: attaching a native animated event to a view inside a `<Modal>`
  // (separate Android window/root) can throw a render error on the New
  // Architecture, and this app has no other precedent for event-driven native
  // animated values. The JS driver recomputes the card interpolations on the
  // JS thread — perfectly fluid for a small deck.
  const onScroll = useMemo(
    () =>
      Animated.event(
        [{ nativeEvent: { contentOffset: { x: scrollX } } }],
        { useNativeDriver: false },
      ),
    [scrollX],
  );

  const accent = theme?.colors.accent.primary ?? '#8f3ba7';
  const accentSecondary =
    theme?.colors.accent.secondary ?? theme?.colors.accent.primaryHover ?? '#c084fc';
  const glassBg = hexToRgba(theme?.colors.background.elevated ?? '#151d30', 0.82);
  const borderStart =
    theme?.colors.glass?.borderGradientStart ?? 'rgba(255,255,255,0.35)';
  const borderEnd =
    theme?.colors.glass?.borderGradientEnd ?? 'rgba(255,255,255,0.1)';

  const textMuted = theme?.colors.text.muted ?? 'rgba(255,255,255,0.6)';

  // Dynamic (theme-derived) active-dot color — hoisted out of JSX so the
  // react-native/no-inline-styles rule stays happy.
  const activeDotStyle = useMemo(() => ({ backgroundColor: accent }), [accent]);

  // Exact scroll offset at which each index is perfectly centered. Feeding
  // these to `snapToOffsets` makes the native snap points EXACTLY match the
  // interpolation peak for that index — no platform-dependent drift. Card 0 is
  // already centered at scrollX = 0 by the content padding, so offset i = i*W.
  const snapOffsets = useMemo(
    () => profiles.map((_, index) => index * ITEM_WIDTH),
    [profiles],
  );

  const renderCard = useCallback(
    ({ item, index }: { item: CharacterProfile; index: number }) => (
      // Slot wrapper — ITEM_WIDTH wide with the card centered, so every
      // snap offset lands a card dead-center.
      <View style={styles.cardSlot}>
        <DeckCard
          profile={item}
          imageUri={images[item.id] ?? null}
          index={index}
          scrollX={scrollX}
          mode={mode}
          currentIndex={currentIndex}
          accent={accent}
          accentSecondary={accentSecondary}
          glassBg={glassBg}
          borderStart={borderStart}
          borderEnd={borderEnd}
          textMuted={textMuted}
          onTap={handleTap}
        />
      </View>
    ),
    [
      images,
      scrollX,
      mode,
      currentIndex,
      accent,
      accentSecondary,
      glassBg,
      borderStart,
      borderEnd,
      textMuted,
      handleTap,
    ],
  );

  if (!theme) return null;

  const focusedName = profiles[currentIndex]?.name ?? '';

  return (
    <View style={styles.container}>
      {/* Swipe hint */}
      <View style={[styles.hintPill, { borderColor: hexToRgba(accent, 0.3) }]}>
        <Icon name="gesture-swipe-horizontal" size={15} color={accent} />
        <ThemedText size={12} variant="muted">
          {t('carouselSwipeHint')}
        </ThemedText>
      </View>

      {profiles.length === 0 ? null : (
        <FlatList
          ref={listRef}
          data={profiles}
          keyExtractor={item => item.id}
          horizontal
          showsHorizontalScrollIndicator={false}
          snapToOffsets={snapOffsets}
          decelerationRate="fast"
          scrollEventThrottle={16}
          getItemLayout={(_, index) => ({
            length: ITEM_WIDTH,
            offset: ITEM_WIDTH * index,
            index,
          })}
          initialNumToRender={7}
          windowSize={9}
          maxToRenderPerBatch={7}
          onScroll={onScroll}
          onMomentumScrollEnd={handleScrollEnd}
          onScrollEndDrag={handleScrollEnd}
          contentContainerStyle={{ paddingHorizontal: edgePad }}
          renderItem={renderCard}
          testID="cover-flow-carousel"
        />
      )}

      {/* Focused profile name + pagination dots */}
      <View style={styles.footer}>
        <ThemedText size={14} weight="bold" numberOfLines={1} style={styles.footerName}>
          {focusedName}
        </ThemedText>
        <View style={styles.dotsRow}>
          {profiles.map((p, i) => {
            const active = i === currentIndex;
            return (
              <View
                key={p.id}
                style={[
                  styles.dot,
                  active ? styles.dotActive : styles.dotIdle,
                  active && activeDotStyle,
                ]}
              />
            );
          })}
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    paddingTop: 4,
  },
  cardSlot: {
    width: ITEM_WIDTH,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hintPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 5,
    marginBottom: 10,
    backgroundColor: 'rgba(0,0,0,0.28)',
  },
  halo: {
    position: 'absolute',
    top: -10,
    bottom: -10,
    left: -10,
    right: -10,
    borderRadius: 28,
    borderWidth: 1.5,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.55,
    shadowRadius: 26,
    elevation: 0,
  },
  gradientBorder: {
    flex: 1,
    borderRadius: 22,
    padding: 1,
    overflow: 'hidden',
  },
  glassBody: {
    flex: 1,
    borderRadius: 21,
    overflow: 'hidden',
  },
  portraitWrap: {
    flex: 1,
    overflow: 'hidden',
  },
  portrait: {
    width: '100%',
    height: '100%',
  },
  portraitPlaceholder: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  cardBody: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 14,
    paddingTop: 30,
    paddingBottom: 14,
    gap: 3,
  },
  cardName: {
    color: '#fff',
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  personaTag: {
    color: 'rgba(255,255,255,0.72)',
  },
  cardPip: {
    position: 'absolute',
    top: 10,
    right: 10,
    width: 26,
    height: 26,
    borderRadius: 13,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.35,
    shadowRadius: 4,
    elevation: 4,
  },
  bottomStripe: {
    position: 'absolute',
    left: 14,
    right: 14,
    bottom: 0,
    height: 2,
    borderRadius: 1,
  },
  footer: {
    alignItems: 'center',
    marginTop: 12,
    gap: 8,
    minHeight: 40,
  },
  footerName: {
    textAlign: 'center',
    paddingHorizontal: 24,
  },
  dotsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  dot: {
    height: 6,
    borderRadius: 3,
  },
  dotActive: {
    width: 18,
  },
  dotIdle: {
    width: 6,
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
});
