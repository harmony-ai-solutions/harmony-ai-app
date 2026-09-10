import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { ThemedText } from '../themed/ThemedText';
import { Theme } from '../../theme/types';

interface DayDividerProps {
  date: Date;
  theme: Theme;
}

/**
 * DayDivider — shows a subtle "Today", "Yesterday", or formatted date between
 * messages from different calendar days. Uses glass styling to match the
 * frosted panels used across the app.
 */
export const DayDivider: React.FC<DayDividerProps> = ({ date, theme }) => {
  const { t } = useTranslation('chatDetail');
  const label = formatDayLabel(date, t);

  return (
    <View style={styles.container}>
      <View style={[styles.line, { backgroundColor: theme.colors.border.default + '33' }]} />
      <View
        style={[
          styles.labelPill,
          {
            backgroundColor: theme.colors.background.elevated + '99',
            borderColor: theme.colors.border.default + '44',
          },
        ]}
      >
        <ThemedText variant="muted" size={11} weight="medium">
          {label}
        </ThemedText>
      </View>
      <View style={[styles.line, { backgroundColor: theme.colors.border.default + '33' }]} />
    </View>
  );
};

function formatDayLabel(date: Date, t: (key: string) => string): string {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.round((startOfToday.getTime() - startOfDate.getTime()) / 86_400_000);

  if (diffDays === 0) return t('today');
  if (diffDays === 1) return t('yesterday');
  if (diffDays < 7) {
    return date.toLocaleDateString([], { weekday: 'long' });
  }
  return date.toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
    year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
  });
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 14,
    paddingHorizontal: 24,
  },
  line: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
  },
  labelPill: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    marginHorizontal: 10,
  },
});

export default DayDivider;
