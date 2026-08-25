/**
 * GreetingEditorSection (Phase 8, Step 1) — extracted from the legacy
 * comparison-only editor (3-5/3-6).
 *
 * Owns the `first_mes` editor (`GreetingEditor`), the greeting action bar
 * ([Preview opening] / [Test scenario generation]) and the test-result card.
 * Props-in / onChange-out — no screen coupling: the parent owns the greeting
 * state and the scenario-generation side effects; this section only renders
 * and forwards.
 */

import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useAppTheme } from '../../../contexts/ThemeContext';
import { ThemedCard } from '../../themed/ThemedCard';
import { SectionHeader } from '../../themed/SectionHeader';
import { ThemedText } from '../../themed/ThemedText';
import { ThemedButton } from '../../themed/ThemedButton';
import { GreetingEditor } from '../GreetingEditor';
import { GreetingBubble } from '../../chat/GreetingBubble';
import { SheetModal } from '../SheetModal';

export interface GreetingEditorSectionProps {
  firstMes: string;
  onChangeFirstMes: (next: string) => void;
  charName: string;
  userName: string;
  // ── Test scenario generation (screen-owned side effects) ──────────────────
  testState: 'idle' | 'generating' | 'ready';
  testGreeting: string;
  onTestScenario: () => void;
  onUseTestGreeting: () => void;
  onDiscardTestGreeting: () => void;
}

export const GreetingEditorSection: React.FC<GreetingEditorSectionProps> = ({
  firstMes,
  onChangeFirstMes,
  charName,
  userName,
  testState,
  testGreeting,
  onTestScenario,
  onUseTestGreeting,
  onDiscardTestGreeting,
}) => {
  const { theme } = useAppTheme();
  const { t } = useTranslation('characters');
  // Preview-opening sheet is pure UI — owned here, not by the screen.
  const [showOpeningPreview, setShowOpeningPreview] = useState(false);

  if (!theme) return null;

  return (
    <View style={styles.container} testID="greeting-editor-section">
      <GreetingEditor
        value={firstMes}
        onChange={onChangeFirstMes}
        charName={charName}
        userName={userName}
      />

      {/* Action bar: preview opening / test scenario generation */}
      <View style={styles.actionBar}>
        <ThemedButton
          variant="outline"
          label={t('previewOpening')}
          onPress={() => setShowOpeningPreview(true)}
          style={styles.actionBarButton}
          testID="preview-opening-button"
        />
        <ThemedButton
          variant="primary"
          label={
            testState === 'generating' ? t('testScenarioGenerating') : t('testScenario')
          }
          onPress={onTestScenario}
          disabled={testState === 'generating'}
          style={styles.actionBarButton}
          testID="test-scenario-button"
        />
      </View>

      {testState === 'ready' && testGreeting ? (
        <ThemedCard elevated accentTint style={styles.testResultCard}>
          <SectionHeader title={t('testScenario')} />
          <View style={styles.testResultBody}>
            <GreetingBubble
              text={testGreeting}
              charName={charName}
              userName={userName}
              theme={theme}
            />
            <View style={styles.testResultActions}>
              <ThemedButton
                variant="ghost"
                label={t('testScenarioDiscard')}
                onPress={onDiscardTestGreeting}
                style={styles.testResultButton}
                testID="test-scenario-discard"
              />
              <ThemedButton
                variant="primary"
                label={t('testScenarioUseThis')}
                onPress={onUseTestGreeting}
                style={styles.testResultButton}
                testID="test-scenario-use"
              />
            </View>
          </View>
        </ThemedCard>
      ) : null}

      {/* [Preview opening] — mock chat-start (macros resolved, no persistence). */}
      <SheetModal
        open={showOpeningPreview}
        onClose={() => setShowOpeningPreview(false)}
        testID="opening-preview"
      >
        <View style={styles.previewHeader}>
          <ThemedText size={18} weight="bold" style={styles.previewTitle}>
            {t('previewOpeningTitle')}
          </ThemedText>
          <ThemedText variant="muted" size={12}>
            {t('previewOnly')}
          </ThemedText>
        </View>
        <View style={styles.previewBody}>
          <GreetingBubble
            text={firstMes}
            charName={charName}
            userName={userName}
            theme={theme}
          />
        </View>
        <View style={styles.previewActions}>
          <ThemedButton
            variant="ghost"
            label={t('common:done')}
            onPress={() => setShowOpeningPreview(false)}
            style={styles.previewActionButton}
            testID="opening-preview-close"
          />
        </View>
      </SheetModal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    gap: 12,
  },
  actionBar: {
    flexDirection: 'row',
    gap: 12,
  },
  actionBarButton: {
    flex: 1,
    height: 46,
  },
  testResultCard: {
    padding: 0,
    overflow: 'hidden',
  },
  testResultBody: {
    padding: 16,
    gap: 12,
  },
  testResultActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
  },
  testResultButton: {
    minWidth: 130,
    height: 44,
  },
  previewHeader: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 8,
    gap: 2,
  },
  previewTitle: {
    letterSpacing: 0.3,
  },
  previewBody: {
    paddingHorizontal: 20,
    paddingBottom: 8,
  },
  previewActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 12,
    gap: 12,
  },
  previewActionButton: {
    minWidth: 120,
    height: 46,
  },
});