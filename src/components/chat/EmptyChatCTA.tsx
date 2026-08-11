import React from 'react';
import { StyleSheet, TouchableOpacity, ViewStyle } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTranslation } from 'react-i18next';
import { ThemedButton } from '../themed/ThemedButton';
import { Theme } from '../../theme/types';

export interface EmptyChatCTAProps {
  /**
   * `icon` — ✨ button on the right of ChatInput (shown while the input is
   * empty, vanishes on typing).
   * `pill` — ✨ Scenario pill beside the AlternateGreetingSwiper
   * (discoverability when the chat opens with a greeting).
   */
  variant?: 'icon' | 'pill';
  /** P1: generation is NOT available — the CTA is PRESENT but DISABLED. */
  disabled?: boolean;
  /**
   * Tapped in P1 to surface the "coming soon" state (no generation). P2 wires
   * this to ScenarioGeneratorSheet. NOTE: ThemedButton fires onPress even when
   * `disabled`, so the pill keeps this callback live in both states.
   */
  onPress?: () => void;
  theme: Theme;
  style?: ViewStyle;
}

/**
 * EmptyChatCTA — the scenario trigger (empty-chat CTA).
 *
 * P1: present but disabled. Generation ships in P2 (2-4); the ✨ icon and the
 * Scenario pill only render the disabled/"coming soon" state in Phase 1.
 */
export const EmptyChatCTA: React.FC<EmptyChatCTAProps> = ({
  variant = 'icon',
  disabled = true,
  onPress,
  theme,
  style,
}) => {
  const { t } = useTranslation('scenario');
  const label = t('ctaScenario');

  if (variant === 'pill') {
    return (
      <ThemedButton
        label={label}
        icon="creation"
        variant="ghost"
        onPress={onPress ?? (() => {})}
        disabled={disabled}
        testID="empty-chat-cta-pill"
        style={{ ...styles.pill, ...style }}
      />
    );
  }

  return (
    <TouchableOpacity
      // Kept tappable in P1 so tapping shows the "coming soon" state, but
      // rendered + flagged visually disabled (no generation).
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      testID="empty-chat-cta-icon"
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      style={[styles.iconButton, style]}
    >
      <Icon
        name="creation"
        size={24}
        color={
          disabled ? theme.colors.text.disabled : theme.colors.accent.primary
        }
        testID="empty-chat-cta-icon-glyph"
      />
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  iconButton: {
    padding: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  pill: {
    height: 36,
    alignSelf: 'flex-start',
    paddingHorizontal: 14,
  },
});
