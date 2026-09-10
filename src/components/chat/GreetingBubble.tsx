import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { ThemedCard } from '../themed/ThemedCard';
import { ThemedText } from '../themed/ThemedText';
import { TypingIndicator } from './TypingIndicator';
import { GreetingShimmer } from './GreetingShimmer';
import { resolveMacros } from '../../utils/macros';
import { Theme } from '../../theme/types';

export interface GreetingBubbleProps {
  /** Raw authored greeting text — macros are resolved for display via resolveMacros. */
  text: string;
  /** Character display name — substitutes {{char}} (profile `nickname || name`). */
  charName: string;
  /** User/own display name — substitutes {{user}} (own entity name). */
  userName: string;
  theme: Theme | null;
  /**
   * `preparing` → shimmer + TypingIndicator (in-flight, exercised in P2).
   * `arrived`  → resolved partner glass message (P1 — authored delivery is
   *              instant, so only `arrived` is exercised in Phase 1).
   */
  state?: 'preparing' | 'arrived';
}

/**
 * GreetingBubble — renders the engine-delivered greeting as a partner glass
 * message. The greeting itself is render-only: it arrives as a normal
 * `message_type="greeting"` ConversationMessage; this component only presents
 * it (with macros resolved for display).
 */
export const GreetingBubble: React.FC<GreetingBubbleProps> = ({
  text,
  charName,
  userName,
  theme,
  state = 'arrived',
}) => {
  const resolved = useMemo(
    () => resolveMacros(text, charName, userName),
    [text, charName, userName],
  );

  if (state === 'preparing') {
    return (
      <View style={styles.preparing} testID="greeting-bubble-preparing">
        <GreetingShimmer />
        <TypingIndicator theme={theme} mode="text" />
      </View>
    );
  }

  if (!resolved || resolved.trim().length === 0) {
    return null;
  }

  return (
    <ThemedCard elevated accentTint style={styles.card}>
      <ThemedText
        variant="secondary"
        style={styles.text}
        testID="greeting-bubble-text"
      >
        {resolved}
      </ThemedText>
    </ThemedCard>
  );
};

const styles = StyleSheet.create({
  preparing: {
    alignSelf: 'flex-start',
    paddingVertical: 4,
  },
  card: {
    // Partner-style glass message — mirrors ChatBubble's partner footprint.
    alignSelf: 'flex-start',
    maxWidth: '88%',
    paddingVertical: 4,
  },
  text: {
    fontSize: 16,
    lineHeight: 22,
  },
});
