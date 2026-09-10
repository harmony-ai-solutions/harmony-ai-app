/**
 * ImportReviewSheet (3-5) — post-import review, shown AFTER the card parses and
 * BEFORE it persists.
 *
 * Moved here in Phase 8 (Track C) so the Characters-screen import flow
 * (`CharactersScreen` → `parseCardFile` → `ImportReviewSheet` → persist)
 * survives the deletion of the comparison-only editor screen (Phase 8).
 *
 * Shows a ✓/⚠ detection summary (greeting? alt-greetings? lorebook? tags?
 * provenance) with actions: Cancel / "Review & edit fields" (deep-link the
 * editor) / Save; and a prominent "Generate a greeting" CTA + "author one"
 * prompt when no greeting was detected. Built on paper `Modal`+`Portal` via the
 * shared `SheetModal` (§A18).
 */

import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTranslation } from 'react-i18next';
import { useAppTheme } from '../../../contexts/ThemeContext';
import { ThemedText } from '../../themed/ThemedText';
import { ThemedButton } from '../../themed/ThemedButton';
import { SheetModal } from '../SheetModal';
import type { TavernCardV2 } from '../../../utils/charactercard/types';

export interface ImportProvenanceSummary {
  spec?: string | null;
  specVersion?: string | null;
  source?: string[] | null;
}

export interface ImportDetectionSummary {
  name: string;
  hasGreeting: boolean;
  alternateGreetingsCount: number;
  lorebookEntryCount: number;
  constantEntryCount: number;
  tags: string[];
  provenance: ImportProvenanceSummary | null;
}

/** Build the post-parse detection summary from a parsed card. */
export function buildImportDetectionSummary(
  card: TavernCardV2,
): ImportDetectionSummary {
  const data = card.data;
  const book = data.character_book ?? null;
  const entries = book?.entries ?? [];
  const rawSource = data.source;
  return {
    name: data.name,
    hasGreeting: !!data.first_mes && data.first_mes.trim().length > 0,
    alternateGreetingsCount: Array.isArray(data.alternate_greetings)
      ? data.alternate_greetings.length
      : 0,
    lorebookEntryCount: entries.length,
    constantEntryCount: entries.filter(e => e.constant).length,
    tags: Array.isArray(data.tags) ? data.tags : [],
    provenance:
      card.spec || card.spec_version || (rawSource != null && rawSource.length > 0)
        ? {
            spec: card.spec ?? null,
            specVersion: card.spec_version ?? null,
            source: Array.isArray(rawSource)
              ? rawSource
              : rawSource
                ? [String(rawSource)]
                : null,
          }
        : null,
  };
}

export interface ImportReviewSheetProps {
  open: boolean;
  summary: ImportDetectionSummary | null;
  onCancel: () => void;
  /** Persist the imported profile (+ image) and reload. */
  onSave: () => void;
  /** Persist, then deep-link the profile editor. */
  onReviewAndEdit: () => void;
  /** No-greeting CTA — persist + open the editor to author/generate an opening. */
  onGenerateGreeting: () => void;
}

export const ImportReviewSheet: React.FC<ImportReviewSheetProps> = ({
  open,
  summary,
  onCancel,
  onSave,
  onReviewAndEdit,
  onGenerateGreeting,
}) => {
  const { theme } = useAppTheme();
  const { t } = useTranslation('characters');

  if (!theme || !summary) return null;

  const success = theme.colors.status.success;
  const warning = theme.colors.status.warning;

  const renderRow = (
    testID: string,
    ok: boolean,
    label: string,
    detail?: string,
  ) => (
    <View style={styles.row} testID={testID}>
      <Icon
        name={ok ? 'check-circle' : 'alert-circle-outline'}
        size={20}
        color={ok ? success : warning}
      />
      <View style={styles.rowText}>
        <ThemedText size={14} variant={ok ? 'primary' : 'secondary'}>
          {label}
        </ThemedText>
        {detail ? (
          <ThemedText variant="muted" size={12}>
            {detail}
          </ThemedText>
        ) : null}
      </View>
    </View>
  );

  return (
    <SheetModal open={open} onClose={onCancel} testID="import-review-sheet">
      <View style={styles.header}>
        <ThemedText size={18} weight="bold" style={styles.title}>
          {t('importReviewTitle')}
        </ThemedText>
        <ThemedText variant="muted" size={13}>
          {t('importReviewSubtitle')}
        </ThemedText>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        <ThemedText size={15} weight="bold" style={styles.name} testID="import-review-name">
          {summary.name}
        </ThemedText>

        {summary.hasGreeting ? (
          renderRow(
            'import-review-greeting',
            true,
            t('importGreetingDetected'),
            t('importGreetingDetectedDetail'),
          )
        ) : (
          <View testID="import-review-no-greeting">
            {renderRow(
              'import-review-no-greeting-row',
              false,
              t('importNoGreeting'),
              t('importNoGreetingHint'),
            )}
            <ThemedButton
              variant="primary"
              label={t('generateGreeting')}
              icon="auto-fix"
              onPress={onGenerateGreeting}
              style={styles.generateButton}
              testID="import-review-generate-greeting"
            />
            <ThemedText variant="muted" size={12} style={styles.authorHint}>
              {t('importAuthorOnePrompt')}
            </ThemedText>
          </View>
        )}

        {renderRow(
          'import-review-alternates',
          true,
          t('importAltGreetings', { count: summary.alternateGreetingsCount }),
          summary.alternateGreetingsCount > 0 ? t('importAltGreetingsDetectedDetail') : undefined,
        )}

        {renderRow(
          'import-review-lorebook',
          summary.lorebookEntryCount > 0,
          t('importLorebookEntries', { count: summary.lorebookEntryCount }),
          summary.constantEntryCount > 0
            ? t('importLorebookConstantDetail', { count: summary.constantEntryCount })
            : undefined,
        )}

        {renderRow(
          'import-review-tags',
          summary.tags.length > 0,
          t('importTagsDetected', { count: summary.tags.length }),
          summary.tags.length > 0 ? summary.tags.join(', ') : undefined,
        )}

        {renderRow(
          'import-review-provenance',
          !!summary.provenance,
          summary.provenance
            ? t('importProvenanceDetected')
            : t('importProvenanceNone'),
          summary.provenance?.source?.length
            ? summary.provenance.source.join(', ')
            : undefined,
        )}
      </ScrollView>

      {/* Actions */}
      <View style={styles.actions}>
        <ThemedButton
          variant="ghost"
          label={t('importCancel')}
          onPress={onCancel}
          style={styles.actionButton}
          testID="import-review-cancel"
        />
        <ThemedButton
          variant="outline"
          label={t('reviewAndEditFields')}
          onPress={onReviewAndEdit}
          style={styles.actionButton}
          testID="import-review-edit"
        />
        <ThemedButton
          variant="primary"
          label={t('importSave')}
          onPress={onSave}
          style={styles.actionButton}
          testID="import-review-save"
        />
      </View>
    </SheetModal>
  );
};

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 8,
  },
  title: {
    letterSpacing: 0.3,
  },
  scroll: {
    flexShrink: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 4,
    paddingBottom: 8,
    gap: 10,
  },
  name: {
    marginBottom: 4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  rowText: {
    flex: 1,
    gap: 2,
  },
  generateButton: {
    marginTop: 8,
    height: 46,
  },
  authorHint: {
    marginTop: 6,
    textAlign: 'center',
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 12,
    gap: 10,
  },
  actionButton: {
    minWidth: 110,
    height: 44,
  },
});