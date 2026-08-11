import React, { useCallback, useRef, useState } from 'react';
import {
  Dimensions,
  NativeScrollEvent,
  NativeSyntheticEvent,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { ThemedButton } from '../themed/ThemedButton';
import { ThemedText } from '../themed/ThemedText';
import { GreetingBubble } from './GreetingBubble';
import { GreetingShimmer } from './GreetingShimmer';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { Theme } from '../../theme/types';

const SCREEN_WIDTH = Dimensions.get('window').width;

export interface AlternateGreetingSwiperProps {
  /** Authored greetings: `[first_mes, ...alternate_greetings]`. Raw text — macros resolved at render. */
  greetings: string[];
  /** Character display name — substitutes {{char}}. */
  charName: string;
  /** User/own display name — substitutes {{user}}. */
  userName: string;
  theme: Theme | null;
  /** P2: regenerate-swipe callback. Undefined/disabled in P1 (authored only). */
  onRegenerateSwipe?: () => void;
}

/**
 * Parse the `alternate_greetings` JSON TEXT column into a string[].
 * Malformed / non-array values degrade to an empty list (never throw).
 */
export function parseAlternateGreetings(json: string | null | undefined): string[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    if (Array.isArray(parsed)) {
      return parsed.filter(
        (x): x is string => typeof x === 'string' && x.trim().length > 0,
      );
    }
  } catch {
    // Malformed JSON column — treat as no alternates.
  }
  return [];
}

/**
 * AlternateGreetingSwiper — horizontal pager over the authored greetings
 * `[first_mes, ...alternate_greetings]` with chevron navigation and a
 * `{{n}}/{{total}}` indicator.
 *
 * P2: when `onRegenerateSwipe` is provided, a regenerate slot appears AFTER
 * the last authored greeting: swiping past the last page (or tapping ⟳)
 * shows a shimmer slot + dispatches GENERATE_GREETING. Generated greetings are
 * ephemeral until chosen. The slot is only rendered while the greeting is
 * still the only message (the parent gates `onRegenerateSwipe`).
 *
 * Reduced-motion: renders a single static page with chevron navigation only
 * (no swipe pager, no scroll animation).
 */
export const AlternateGreetingSwiper: React.FC<AlternateGreetingSwiperProps> = ({
  greetings,
  charName,
  userName,
  theme,
  onRegenerateSwipe,
}) => {
  const reduceMotion = useReducedMotion();
  const { t } = useTranslation('scenario');
  const scrollRef = useRef<ScrollView>(null);
  const [index, setIndex] = useState(0);

  const total = greetings.length;
  const hasRegenerateSlot = !!onRegenerateSwipe;
  const pageCount = total + (hasRegenerateSlot ? 1 : 0);
  const clampedIndex = pageCount === 0 ? 0 : Math.min(index, pageCount - 1);
  const isRegeneratePage = hasRegenerateSlot && clampedIndex === total;
  const current = isRegeneratePage ? '' : (greetings[clampedIndex] ?? '');

  const goTo = useCallback(
    (next: number) => {
      const target = Math.max(0, Math.min(next, pageCount - 1));
      setIndex(target);
      if (scrollRef.current) {
        scrollRef.current.scrollTo({
          x: target * SCREEN_WIDTH,
          animated: !reduceMotion,
        });
      }
      // Swiping/stepping past the last authored greeting lands on the
      // regenerate slot → dispatch (parent gates while greeting is the only
      // message).
      if (hasRegenerateSlot && target === total) {
        onRegenerateSwipe?.();
      }
    },
    [pageCount, reduceMotion, hasRegenerateSlot, onRegenerateSwipe],
  );

  const onMomentumScrollEnd = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const page = Math.round(e.nativeEvent.contentOffset.x / SCREEN_WIDTH);
      const clamped = Math.max(0, Math.min(page, pageCount - 1));
      setIndex(clamped);
      if (hasRegenerateSlot && clamped === total) {
        onRegenerateSwipe?.();
      }
    },
    [pageCount, hasRegenerateSlot, onRegenerateSwipe],
  );

  const renderRegenerateSlot = () => (
    <View testID="greeting-swiper-regenerate">
      {/* Shimmer skeleton — communicates the in-flight generation (no
          streaming; this is the sole latency affordance). */}
      <GreetingShimmer />
      <ThemedButton
        label={t('generateAnother')}
        icon="refresh"
        variant="ghost"
        onPress={() => onRegenerateSwipe?.()}
        testID="greeting-swiper-regenerate-button"
        style={styles.regenerateButton}
      />
    </View>
  );

  if (total === 0) {
    return null;
  }

  return (
    <View style={styles.container}>
      {reduceMotion ? (
        // Chevrons only — single static page, no swipe pager.
        <View testID="greeting-swiper-page" style={styles.page}>
          {isRegeneratePage ? (
            renderRegenerateSlot()
          ) : (
            <GreetingBubble
              text={current}
              charName={charName}
              userName={userName}
              theme={theme}
            />
          )}
        </View>
      ) : (
        <ScrollView
          ref={scrollRef}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={onMomentumScrollEnd}
          testID="greeting-swiper-pager"
        >
          {greetings.map((greeting, i) => (
            <View key={i} style={[styles.page, { width: SCREEN_WIDTH }]}>
              <GreetingBubble
                text={greeting}
                charName={charName}
                userName={userName}
                theme={theme}
              />
            </View>
          ))}
          {hasRegenerateSlot && (
            <View key="regenerate" style={[styles.page, { width: SCREEN_WIDTH }]}>
              {renderRegenerateSlot()}
            </View>
          )}
        </ScrollView>
      )}

      <View style={styles.controls}>
        <ThemedButton
          label=""
          icon="chevron-left"
          variant="ghost"
          onPress={() => goTo(index - 1)}
          disabled={clampedIndex <= 0}
          testID="greeting-swiper-prev"
          style={styles.chevron}
        />
        <ThemedText
          variant="muted"
          size={12}
          testID="greeting-swiper-indicator"
        >
          {t('swipeIndicator', { n: clampedIndex + 1, total })}
        </ThemedText>
        <ThemedButton
          label=""
          icon="chevron-right"
          variant="ghost"
          onPress={() => goTo(index + 1)}
          disabled={clampedIndex >= pageCount - 1}
          testID="greeting-swiper-next"
          style={styles.chevron}
        />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    width: '100%',
  },
  page: {
    paddingHorizontal: 2,
  },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  chevron: {
    height: 32,
    width: 44,
    alignSelf: 'center',
    paddingHorizontal: 0,
  },
  regenerateButton: {
    height: 36,
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    marginTop: 8,
  },
});
