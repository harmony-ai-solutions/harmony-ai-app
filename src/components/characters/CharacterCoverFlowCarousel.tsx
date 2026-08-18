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
  /** Which intent opened the carousel — controls the fork-pip icon. */
  mode: 'duplicate' | 'fromExisting';
  /** Fired when the user taps a card and it settles into the center focus. */
  onSelect: (profile: CharacterProfile) => void;
}

// ── Card geometry (BASE sizes) ────────────────────────────────────────
// The deck dimensions are derived from these in the component so every device
// gets a card that keeps a TRUE 3:4 portrait shape and that fits inside the
// 86%-height bottom sheet (header + search + hint + footer + deck). Fixed
// pixel sizes here used to overflow small screens (cards clipped / squashed)
// and leave huge dead space on large ones.
const BASE_CARD_WIDTH = 252;
const BASE_CARD_GAP = 16;
/** Never shrink the card below this width. */
const MIN_CARD_WIDTH = 190;
/** Max fraction of the usable screen width the card may occupy (≤ BASE). */
const CARD_WIDTH_RATIO = 0.62;
/** Max deck height as a fraction of screen height (leaves room for UI above/below). */
const MAX_DECK_HEIGHT_RATIO = 0.38;
/** Portrait aspect ratio — width × this = height. */
const CARD_HEIGHT_RATIO = 4 / 3;
/** Camera distance factor — 3D depth strength, scaled to the card width. */
const PERSPECTIVE_FACTOR = 4.4;
/** Scale of non-focused neighbor cards. */
const NEIGHBOR_SCALE = 0.85;
/** Opacity of non-focused neighbor cards. */
const NEIGHBOR_OPACITY = 0.55;
/** Angle (deg) applied to neighbor cards along the Y axis. */
const NEIGHBOR_ANGLE = 12;
/** Neighbor vertical sink as a fraction of card height. */
const NEIGHBOR_DROP_RATIO = 0.045;
/** Neighbor converge toward the center as a fraction of card width. */
const NEIGHBOR_SLIDE_RATIO = 0.14;
/** Halo headroom as a fraction of card height (with a floor). */
const STAGE_PAD_RATIO = 0.05;
const MIN_STAGE_PAD = 14;

/**
 * Resolved, screen-aware deck geometry. Everything the FlatList and the deck
 * cards need is derived once per layout so the snapshot/scroll math always
 * agrees with the rendered frame.
 */
interface DeckGeometry {
  cardWidth: number;
  cardHeight: number;
  itemWidth: number; // cardWidth + gap — slot width AND snap step
  deckHeight: number; // cardHeight + 2 × stagePad
  stagePad: number;
  neighborDrop: number;
  neighborSlide: number;
  perspective: number;
}

/**
 * Derive the deck geometry from the current window size, always preserving a
 * true 3:4 portrait shape and a total deck height that fits the sheet.
 */
function resolveDeckGeometry(
  screenWidth: number,
  screenHeight: number,
): DeckGeometry {
  let w = Math.min(BASE_CARD_WIDTH, Math.round(screenWidth * CARD_WIDTH_RATIO));
  w = Math.max(MIN_CARD_WIDTH, w);
  const hLimit = Math.round(screenHeight * MAX_DECK_HEIGHT_RATIO);
  let h = Math.round(w * CARD_HEIGHT_RATIO);
  if (h > hLimit) {
    // Keep the 3:4 shape — shrink BOTH dimensions, never squash.
    h = hLimit;
    w = Math.round(h * (1 / CARD_HEIGHT_RATIO));
  }
  const gap = Math.max(8, Math.round(w * (BASE_CARD_GAP / BASE_CARD_WIDTH)));
  const itemWidth = w + gap;
  const stagePad = Math.max(MIN_STAGE_PAD, Math.round(h * STAGE_PAD_RATIO));
  const deckHeight = h + stagePad * 2;
  const neighborDrop = Math.round(h * NEIGHBOR_DROP_RATIO);
  const neighborSlide = Math.round(w * NEIGHBOR_SLIDE_RATIO);
  const perspective = Math.round(w * PERSPECTIVE_FACTOR);
  return {
    cardWidth: w,
    cardHeight: h,
    itemWidth,
    deckHeight,
    stagePad,
    neighborDrop,
    neighborSlide,
    perspective,
  };
}

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
  /** Resolved responsive deck geometry (derived once in the parent). */
  geometry: DeckGeometry;
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
  geometry,
  onTap,
}: CarouselCardProps) {
  // Input range in absolute scroll-offset units around this card's center.
  // Because the content padding centers card 0 at scrollX = 0, card `index`
  // is perfectly centered at scrollX = index * geometry.itemWidth — matching
  // the native snap offsets exactly.
  const inputRange = useMemo(
    () => [
      (index - 1) * geometry.itemWidth,
      index * geometry.itemWidth,
      (index + 1) * geometry.itemWidth,
    ],
    [index, geometry.itemWidth],
  );

  const translateX = scrollX.interpolate({
    inputRange,
    outputRange: [geometry.neighborSlide, 0, -geometry.neighborSlide],
    extrapolate: 'clamp',
  });
  const translateY = scrollX.interpolate({
    inputRange,
    outputRange: [geometry.neighborDrop, 0, geometry.neighborDrop],
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
        width: geometry.cardWidth,
        height: geometry.cardHeight,
        zIndex,
        opacity,
        transform: [
          { perspective: geometry.perspective },
          { translateX },
          { translateY },
          { rotateY },
          { scale },
        ],
      }}
    >
      {/* Neon glow halo — soft ambient glow, no hard ring. A hard ring
          (border) layered INSIDE the same transform, 10px larger than the
          card, reads as a doubled, jagged border — especially on Android
          where the shadow is ignored and only the thick colored ring
          survives. */}
      <Animated.View
        pointerEvents="none"
        style={[
          styles.halo,
          {
            opacity: glow,
            backgroundColor: hexToRgba(accent, 0.16),
            shadowColor: accent,
          },
        ]}
      />

      {/* Specular gradient border (glass hairline) */}
      <LinearGradient
        colors={[borderStart, hexToRgba(accent, 0.16), borderEnd]}
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

          {/* Mode pip — fork badge for duplication, arrow for linking */}
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
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const { t } = useTranslation('characters');

  // Resolve the responsive geometry once per layout change. All scroll math,
  // snap offsets, deck height and per-card transforms share this one source.
  const geometry = useMemo(
    () => resolveDeckGeometry(screenWidth, screenHeight),
    [screenWidth, screenHeight],
  );

  const listRef = useRef<FlatList<CharacterProfile>>(null);
  const scrollX = useRef(new Animated.Value(0)).current;
  // Track which index is currently centered — drives z-layering + pending taps.
  const initialIndex = useMemo(
    () => (profiles.length === 0 ? 0 : Math.floor((profiles.length - 1) / 2)),
    [profiles.length],
  );

  // Horizontal padding that lets the FIRST and LAST cards center too.
  // The centered card sits at `edgePad + geometry.itemWidth/2` from the list
  // start, so the viewport center (screenWidth/2) must equal that when the
  // list is at offset 0 → edgePad = (screenWidth - itemWidth) / 2.
  const edgePad = Math.max(0, (screenWidth - geometry.itemWidth) / 2);
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const currentIndexRef = useRef(initialIndex);
  const pendingSelectRef = useRef<{
    index: number;
    profile: CharacterProfile;
    timeout: ReturnType<typeof setTimeout>;
  } | null>(null);
  // True while the user is actively touching the deck (drag/momentum). While
  // false, `snapToOffsets` is disabled so the programmatic animated glide to a
  // tapped card isn't fought by the snap grid — which is what made tap-switching
  // stutter. State (not ref) so the FlatList re-renders with the flag applied.
  const [userScrolling, setUserScrolling] = useState(false);

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
  // scrollX = N * geometry.itemWidth.
  //
  // NOTE: we key this ONLY on the profile set changing (and the derived
  // initialIndex). Re-deriving geometry on a window rotation does NOT reset the
  // deck — it would yank the user away from the card they were looking at on
  // every dimension change.
  const profileSignature = profiles.map(p => p.id).join('|');
  useEffect(() => {
    if (profiles.length === 0) return;
    setCurrentIndex(initialIndex);
    currentIndexRef.current = initialIndex;
    const target = initialIndex * geometry.itemWidth;
    const raf = requestAnimationFrame(() => {
      listRef.current?.scrollToOffset({ offset: target, animated: false });
    });
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileSignature, initialIndex, profiles.length]);

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
      // it settles (momentum end → immediate; timer as a safety net). Snap is
      // disabled for the programmatic glide so the grid doesn't fight it.
      setCurrentIndex(index);
      currentIndexRef.current = index;
      setUserScrolling(false);
      listRef.current?.scrollToOffset({
        offset: index * geometry.itemWidth,
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
    [onSelect, geometry.itemWidth],
  );

  const handleScrollEnd = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const x = e.nativeEvent.contentOffset.x;
      const idx = clamp(
        Math.round(x / geometry.itemWidth),
        0,
        Math.max(0, profiles.length - 1),
      );
      setCurrentIndex(idx);
      currentIndexRef.current = idx;
      commitPendingSelect(idx);
      // User gesture finished — re-enable snapping for the next touch.
      setUserScrolling(false);
    },
    [commitPendingSelect, profiles.length, geometry.itemWidth],
  );

  // Scroll event — JS driver, deliberately. Attaching a NATIVE-driver
  // Animated.event scroll listener to a view INSIDE a `<Modal>` (a separate
  // Android window/root) throws a render error on the New Architecture — this
  // was confirmed first-hand. The JS driver recomputes the interpolations on
  // the JS thread, which is fine for this small deck, so we keep it.
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

  // Opaque hint-pill background — hoisted like the other theme-derived styles.
  // The deck's transformed top corners overhang slightly; an opaque pill keeps
  // them from bleeding through the chip as glitchy border fragments.
  const hintPillStyle = useMemo(
    () => ({
      borderColor: hexToRgba(accent, 0.3),
      backgroundColor: hexToRgba(theme?.colors.background.base ?? '#151d30', 0.94),
    }),
    [accent, theme],
  );

  // Exact scroll offset at which each index is perfectly centered. Feeding
  // these to `snapToOffsets` makes the native snap points EXACTLY match the
  // interpolation peak for that index — no platform-dependent drift. Card 0 is
  // already centered at scrollX = 0 by the content padding, so offset i = i*W.
  const snapOffsets = useMemo(
    () => profiles.map((_, index) => index * geometry.itemWidth),
    [profiles, geometry.itemWidth],
  );

  const renderCard = useCallback(
    ({ item, index }: { item: CharacterProfile; index: number }) => (
      // Slot wrapper — itemWidth wide with the card centered, so every
      // snap offset lands a card dead-center.
      <View
        style={[
          styles.cardSlot,
          { width: geometry.itemWidth },
        ]}
      >
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
          geometry={geometry}
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
      geometry,
      handleTap,
    ],
  );

  if (!theme) return null;

  const focusedName = profiles[currentIndex]?.name ?? '';

  return (
    <View style={styles.container}>
      {/* Swipe hint */}
      <View style={[styles.hintPill, hintPillStyle]}>
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
          snapToOffsets={userScrolling ? snapOffsets : undefined}
          decelerationRate="fast"
          scrollEventThrottle={16}
          getItemLayout={(_, index) => ({
            length: geometry.itemWidth,
            offset: geometry.itemWidth * index,
            index,
          })}
          initialNumToRender={5}
          windowSize={7}
          maxToRenderPerBatch={5}
          onScroll={onScroll}
          onScrollBeginDrag={() => setUserScrolling(true)}
          onMomentumScrollEnd={handleScrollEnd}
          onScrollEndDrag={handleScrollEnd}
          contentContainerStyle={{ paddingHorizontal: edgePad }}
          style={{ height: geometry.deckHeight }}
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
    marginBottom: 6,
  },
  // NOTE: `deck` height is applied inline as `geometry.deckHeight` — it is
  // screen-dependent. The deck viewport needs vertical headroom for the 3D
  // transform overflow (the halo + rotated neighbors), otherwise a horizontal
  // FlatList clips them at its own bounds.
  halo: {
    position: 'absolute',
    top: -12,
    bottom: -12,
    left: -12,
    right: -12,
    borderRadius: 28,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.65,
    shadowRadius: 30,
    // elevation stays 0 — on Android an elevated shadow here would draw a
    // flattened dark box instead of a glow.
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
    // elevation must stay 0: inside the overflow-hidden glass body, Android
    // clips the pip's elevation shadow against the rounded bounds, leaving a
    // dark smudge on the card's top-right border.
    elevation: 0,
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
