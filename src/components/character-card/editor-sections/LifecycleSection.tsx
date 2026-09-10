/**
 * LifecycleSection (Phase 8, Step 1) — extracted from the legacy
 * comparison-only editor. Defaults banner + `LifecycleConfigEditor`
 * (props-in/onChange-out; numeric validation alerts live at the screen's save
 * path — no silent clamping).
 */

import React from 'react';
import { StyleSheet, View } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTranslation } from 'react-i18next';
import { useAppTheme } from '../../../contexts/ThemeContext';
import { ThemedText } from '../../themed/ThemedText';
import { LifecycleConfigEditor } from '../LifecycleConfigEditor';
import type { LifecycleConfig } from '../LifecycleConfigEditor';

export interface LifecycleSectionProps {
  config: LifecycleConfig;
  onChange: (next: LifecycleConfig) => void;
}

export const LifecycleSection: React.FC<LifecycleSectionProps> = ({
  config,
  onChange,
}) => {
  const { theme } = useAppTheme();
  const { t } = useTranslation('characters');

  if (!theme) return null;

  return (
    <View style={styles.container} testID="lifecycle-section">
      <View
        style={[
          styles.defaultsBanner,
          {
            borderColor: theme.colors.accent.primary + '40',
            backgroundColor: theme.colors.accent.primary + '14',
          },
        ]}>
        <Icon
          name="information-outline"
          size={15}
          color={theme.colors.accent.primary}
          style={styles.defaultsBannerIcon}
        />
        <ThemedText
          variant="secondary"
          size={12}
          style={styles.defaultsBannerText}>
          {t('lifecycle.defaultsNote')}
        </ThemedText>
      </View>
      <LifecycleConfigEditor config={config} onChange={onChange} />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    gap: 12,
  },
  defaultsBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  defaultsBannerIcon: {
    marginTop: 1,
  },
  defaultsBannerText: {
    flex: 1,
    lineHeight: 17,
  },
});