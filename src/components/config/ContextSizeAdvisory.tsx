/**
 * ContextSizeAdvisory — cross-slot context-window hint for an AI entity.
 *
 * The backend (chat) slot and the cognition (memory/decisions) slot each carry
 * their own `context_window`. Replies can never outgrow the BACKEND window, and
 * memory compaction follows the same point — so a cognition window larger than
 * the backend's is misleading rather than helpful.
 *
 * This is deliberately NON-BLOCKING (an advisory row, not a modal/validation):
 *  - renders only when both slots resolve a window AND backend < cognition;
 *  - silent when backend ≥ cognition or either window is unknown;
 *  - "Align" lowers the pair to the backend's value (both configs' overlays).
 *
 * Rendered in the entity module wiring card (CreateAIScreen), below the
 * Cognition selector.
 */

import React from 'react';
import { View, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTranslation } from 'react-i18next';
import { useAppTheme } from '../../contexts/ThemeContext';
import { ThemedText } from '../themed/ThemedText';
import { formatTokenCount } from '../../utils/contextSize';

export const CONTEXT_SIZE_ADVISORY_TESTID = 'context-size-advisory';
export const CONTEXT_SIZE_ADVISORY_ALIGN_TESTID = 'context-size-advisory-align';

/**
 * True only when both windows are known and the backend is the smaller one.
 * Either side unknown / not finite ⇒ silent (no fabricated ceiling).
 */
export function shouldShowContextSizeAdvisory(
  backendTokens?: number | null,
  cognitionTokens?: number | null,
): boolean {
  if (typeof backendTokens !== 'number' || !Number.isFinite(backendTokens)) return false;
  if (typeof cognitionTokens !== 'number' || !Number.isFinite(cognitionTokens)) return false;
  return backendTokens < cognitionTokens;
}

interface ContextSizeAdvisoryProps {
  /** Effective backend (chat) window, tokens. */
  backendTokens?: number;
  /** Effective cognition window, tokens. */
  cognitionTokens?: number;
  /** Lower both configs to the backend's window. */
  onAlign: () => void;
  /** Writes are in flight. */
  busy?: boolean;
}

export const ContextSizeAdvisory: React.FC<ContextSizeAdvisoryProps> = ({
  backendTokens,
  cognitionTokens,
  onAlign,
  busy = false,
}) => {
  const { theme } = useAppTheme();
  const { t } = useTranslation('createAI');

  if (!theme) return null;
  if (!shouldShowContextSizeAdvisory(backendTokens, cognitionTokens)) return null;

  const backendLabel = formatTokenCount(backendTokens as number);

  return (
    <View
      testID={CONTEXT_SIZE_ADVISORY_TESTID}
      accessibilityRole="alert"
      style={[
        styles.row,
        {
          borderColor: theme.colors.status.warning + '66',
          backgroundColor: theme.colors.status.warning + '12',
        },
      ]}
    >
      <Icon name="alert-outline" size={15} color={theme.colors.status.warning} />
      <ThemedText size={11.5} style={[styles.body, { color: theme.colors.status.warning }]}>
        {t('contextAdvisoryBody', { backend: backendLabel })}
      </ThemedText>
      <TouchableOpacity
        testID={CONTEXT_SIZE_ADVISORY_ALIGN_TESTID}
        accessibilityRole="button"
        accessibilityLabel={t('contextAdvisoryAlignA11y', { backend: backendLabel })}
        accessibilityState={{ disabled: busy }}
        disabled={busy}
        onPress={onAlign}
        activeOpacity={0.75}
        style={[
          styles.alignButton,
          { borderColor: theme.colors.status.warning },
          busy && styles.alignButtonBusy,
        ]}
      >
        {busy ? (
          <ActivityIndicator size="small" color={theme.colors.status.warning} />
        ) : (
          <ThemedText size={11} weight="medium" style={{ color: theme.colors.status.warning }}>
            {t('contextAdvisoryAlign')}
          </ThemedText>
        )}
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginBottom: 12,
  },
  body: { flex: 1, lineHeight: 16 },
  alignButton: {
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 9,
    paddingVertical: 4,
    minWidth: 52,
    alignItems: 'center',
    justifyContent: 'center',
  },
  alignButtonBusy: { opacity: 0.5 },
});
