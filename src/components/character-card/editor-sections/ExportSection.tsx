/**
 * ExportSection (Phase 8, Step 1) — extracted from the legacy
 * comparison-only editor (4-4). The [Export card] trigger + the JSON/PNG
 * export sheet. The actual export (RNFS write + Share) is a screen-owned side
 * effect invoked through `onExport` — the section never couples to filesystem
 * or navigation.
 */

import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { ThemedText } from '../../themed/ThemedText';
import { ThemedButton } from '../../themed/ThemedButton';
import { SheetModal } from '../SheetModal';

export interface ExportSectionProps {
  /** Perform the export for a given kind (screen-owned side effects). */
  onExport: (kind: 'json' | 'png') => void;
  /** Disables the trigger (e.g. no name yet). */
  disabled?: boolean;
}

export const ExportSection: React.FC<ExportSectionProps> = ({
  onExport,
  disabled = false,
}) => {
  const { t } = useTranslation('characters');
  // Export sheet open state is pure UI — owned here, not by the screen.
  const [showExportSheet, setShowExportSheet] = useState(false);

  return (
    <View style={styles.container} testID="export-section">
      <ThemedButton
        variant="outline"
        label={t('exportCard')}
        onPress={() => setShowExportSheet(true)}
        disabled={disabled}
        style={styles.trigger}
        testID="export-card-button"
      />

      {/* Export sheet (4-4) — JSON / PNG ccv3 */}
      <SheetModal
        open={showExportSheet}
        onClose={() => setShowExportSheet(false)}
        testID="export-sheet"
      >
        <View style={styles.exportSheetHeader}>
          <ThemedText size={18} weight="bold" style={styles.exportSheetTitle}>
            {t('exportCard')}
          </ThemedText>
          <ThemedText variant="muted" size={12}>
            {t('exportSheetHint')}
          </ThemedText>
        </View>
        <View style={styles.exportSheetActions}>
          <ThemedButton
            variant="outline"
            label={t('exportAsJSON')}
            onPress={() => onExport('json')}
            style={styles.exportSheetButton}
            testID="export-json"
          />
          <ThemedButton
            variant="outline"
            label={t('exportAsPNG')}
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