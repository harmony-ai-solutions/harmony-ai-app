/**
 * AlternateGreetingsSection (Phase 8, Step 1) — extracted from the legacy
 * comparison-only editor. Thin props-in/onChange-out
 * wrapper around the shared `AlternateGreetingsManager`.
 */

import React from 'react';
import { StyleSheet, View } from 'react-native';
import { AlternateGreetingsManager } from '../AlternateGreetingsManager';

export interface AlternateGreetingsSectionProps {
  alternateGreetings: string[];
  /** Current default (`first_mes`) — shown as the promoted target. */
  firstMes: string;
  charName: string;
  userName: string;
  onAdd: () => void;
  onRemove: (index: number) => void;
  onMove: (index: number, direction: -1 | 1) => void;
  onEdit: (index: number, value: string) => void;
  /** Promotes the opener into `first_mes` (parent demotes the prior default). */
  onPromoteToDefault: (greeting: string) => void;
}

export const AlternateGreetingsSection: React.FC<AlternateGreetingsSectionProps> = (
  props,
) => {
  return (
    <View style={styles.container} testID="alternate-greetings-section">
      <AlternateGreetingsManager {...props} />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    gap: 8,
  },
});