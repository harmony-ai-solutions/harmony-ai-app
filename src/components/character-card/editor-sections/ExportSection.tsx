/**
 * ExportSection (Phase 8, Step 1) — extracted from the legacy
 * comparison-only editor (4-4). The export trigger + the JSON/PNG export
 * sheet. The actual export (RNFS write + Share) is a screen-owned side
 * effect invoked through `onExport` — the section never couples to filesystem
 * or navigation.
 *
 * `compact` (4-1) renders just the sleek outline pill used in `ScreenHeader`'s
 * `right` slot (edit mode) instead of the old full-width mid-form card.
 */

import React, { useState } from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTranslation } from 'react-i18next';
import { useAppTheme } from '../../../contexts/ThemeContext';
import { ThemedText } from '../../themed/ThemedText';
import { ThemedButton } from '../../themed/ThemedButton';
import { SheetModal } from '../SheetModal';

export interface ExportSectionProps {
  /** Perform the export for a given kind (screen-owned side effects). */
  onExport: (kind: 'json' | 'png') => void;
  /** Disables the trigger (e.g. no name yet). */
  disabled?: boolean;
  /** Header mode: a small outline pill instead of the full-width trigger. */
  compact?: boolean;
}

export const ExportSection: React.FC<ExportSectionProps> = ({
  onExport,
  disabled = false,
  compact = false,
}) => {
  const { t } = useTranslation(['characters', 'common'], { nsMode: 'fallback' });
  const { theme } = useAppTheme();
  // Export sheet open state is pure UI — owned here, not by the screen.
  const [showExportSheet, setShowExportSheet] = useState(false);

  return (
    <View style={styles.container} testID="export-section">
      {compact ? (
        // `clean-outline-btn` from the Edit AI Partner design: a compact
        // dark-surface pill with a pink tray icon + semibold label.
        <TouchableOpacity
          onPress={() => setShowExportSheet(true)}
          disabled={disabled}
          activeOpacity={0.75}
          accessibilityRole="button"
          accessibilityLabel={t('characters:exportAction', 'Export')}
          testID="export-header-button"
          style={[
            styles.compactTrigger,
            {
              backgroundColor: theme?.colors.background.base ?? '#0f172a',
              borderColor: 'rgba(236, 72, 153, 0.55)',
              opacity: disabled ? 0.5 : 1,
            },
          ]}
        >
          <Icon name="tray-arrow-up" size={15} color="#f472b6" />
          <ThemedText size={12} weight="medium" style={styles.compactLabel}>
            {t('characters:exportAction', 'Export')}
          </ThemedText>
        </TouchableOpacity>
      ) : (
        <ThemedButton
          variant="outline"
          icon="export-variant"
          iconSize={18}
          label={t('characters:exportCard')}
          onPress={() => setShowExportSheet(true)}
          disabled={disabled}
          style={styles.trigger}
          testID="export-card-button"
        />
      )}

      {/* Export sheet (4-4) — JSON / PNG ccv3 */}
      <SheetModal
        open={showExportSheet}
        onClose={() => setShowExportSheet(false)}
        testID="export-sheet"
      >
        <View style={styles.exportSheetHeader}>
          <ThemedText size={18} weight="bold" style={styles.exportSheetTitle}>
            {t('characters:exportCard')}
          </ThemedText>
          <ThemedText variant="muted" size={12}>
            {t('characters:exportSheetHint')}
          </ThemedText>
        </View>
        <View style={styles.exportSheetActions}>
          <ThemedButton
            variant="outline"
            label={t('characters:exportAsJSON')}
            onPress={() => onExport('json')}
            style={styles.exportSheetButton}
            testID="export-json"
          />
          <ThemedButton
            variant="outline"
            label={t('characters:exportAsPNG')}
            onPress={() => onExport('png')}
            style={styles.exportSheetButton}
            testID="export-png"
          />
          <ThemedButton
            variant="ghost"
            label={t('common:cancel')}
            onPress={() => setShowExportSheet(false)}
            style={styles.exportSheetButton}
            testID="export-cancel"
          />
        </View>
      </SheetModal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    gap: 8,
  },
  trigger: {
    height: 46,
    width: '100%',
  },
  compactTrigger: {
    height: 34,
    borderRadius: 9,
    borderWidth: 1,
    paddingHorizontal: 11,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  compactLabel: {
    color: '#f472b6',
    fontWeight: '600',
  },
  exportSheetHeader: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 8,
    gap: 2,
  },
  exportSheetTitle: {
    letterSpacing: 0.3,
  },
  exportSheetActions: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 16,
    gap: 10,
  },
  exportSheetButton: {
    width: '100%',
    height: 46,
  },
});
