/**
 * VoiceInputSettingsScreen — the single global surface for the shared persona
 * STT ("Voice input") config (persona-modules 2-1).
 *
 * ## Mental model
 *
 * Voice input is NOT per-persona. It is the STT config wired to the canonical
 * `user` entity via `entity_module_mappings.stt_config_id`, and is used
 * whenever the user chats as ANY persona. The engine seeder owns the canonical
 * `user` mapping row (with STT); this screen never ensure-creates it.
 *
 * ## LWW hazard (CRITICAL)
 *
 * The app must NEVER blindly ensure-create the `user` mapping row: a
 * locally-inserted NULL row would win row-LWW sync and destroy the engine's
 * STT wiring. Therefore:
 *   - READ: `resolveVoiceInputState` treats a missing mapping / NULL
 *     stt_config_id / provider === 'disabled' as OFF.
 *   - WRITE: rows are created / linked ONLY on deliberate user save (a
 *     legitimate LWW win): toggling OFF writes the 'disabled' sentinel; picking
 *     a config in the selector links `mapping.stt_config_id` for the `user`
 *     entity. There is NO bootstrap or ensure-create here.
 *
 * ## Editor integration (documented choice)
 *
 * Config editing reuses the generic `ModuleConfigEditScreen` PINNED to
 * `moduleType='stt'` via navigation (route param). The mapping link
 * (`user` → stt_config_id) is owned by THIS screen, exactly the way
 * `CreateAIScreen` / `EntityModuleSelectorWithActions` wire configs: the
 * selector routes into `ModuleConfigEditScreen` to create/edit the stt row, and
 * this screen persists the mapping once the user deliberately selects a config.
 * We did NOT wrap/embed `ModuleConfigEditScreen`'s content — that would
 * duplicate ~1200 lines of provider/config-editing logic for a one-field data
 * concern; routing keeps it DRY and consistent with the existing entity wiring.
 */

import React, { useState, useCallback } from 'react';
import { View, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useAppTheme } from '../../contexts/ThemeContext';
import { ThemedView } from '../../components/themed/ThemedView';
import { ThemedText } from '../../components/themed/ThemedText';
import { ThemedCard } from '../../components/themed/ThemedCard';
import { SectionHeader } from '../../components/themed/SectionHeader';
import { ScreenHeader } from '../../components/themed/ScreenHeader';
import { SettingsToggleRow } from '../../components/settings/SettingsRows';
import { EntityModuleSelectorWithActions } from '../../components/entities/EntityModuleSelectorWithActions';
import { ModuleConfigOption } from '../../components/entities/EntityModuleSelector';
import {
  getEntity,
  getEntityModuleMapping,
  createOrUpdateEntityModuleMapping,
} from '../../database/repositories/entities';
import {
  getSTTConfig,
  getAllSTTConfigs,
  updateSTTConfig,
} from '../../database/repositories/modules';
import { resolveVoiceInputState } from '../../services/voiceInput/resolveVoiceInputState';
import { SttTestPanel } from '../../components/config/SttTestPanel';
import type { Entity, EntityModuleMapping, STTConfig } from '../../database/models';
import { createLogger } from '../../utils/logger';

const log = createLogger('[VoiceInputSettingsScreen]');

type RootStackParamList = {
  ModuleConfigEdit: {
    moduleType: string;
    configId?: string;
  };
};

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

export const VoiceInputSettingsScreen: React.FC = () => {
  const { theme } = useAppTheme();
  const { bottom: safeBottom } = useSafeAreaInsets();
  const navigation = useNavigation<NavigationProp>();
  const { t } = useTranslation('voiceInput');

  // The canonical `user` identity entity (A1) — its mapping row is engine-seeded.
  const USER_ENTITY_ID = 'user';

  const [loading, setLoading] = useState(true);
  // A fresh-install state: the `user` entity is not present locally yet because
  // the engine seeder has not synced. Never ensure-create it here.
  const [userEntity, setUserEntity] = useState<Entity | null>(null);
  const [mapping, setMapping] = useState<EntityModuleMapping | null>(null);
  const [sttConfig, setSttConfig] = useState<STTConfig | null>(null);
  const [sttConfigs, setSttConfigs] = useState<STTConfig[]>([]);
  const [disabling, setDisabling] = useState(false);

  // READ-only resolution — respects the LWW hazard (see module doc).
  const state = resolveVoiceInputState({ mapping, sttConfig });
  // Pre-sync: the `user` entity (and thus its canonical mapping) is not local yet.
  const isPreSync = !loading && userEntity === null;

  const load = useCallback(async () => {
    try {
      // 1. Does the canonical `user` entity exist locally yet?
      const entity = await getEntity(USER_ENTITY_ID);
      setUserEntity(entity);

      // 2. The canonical mapping row — the engine seeder owns creation.
      const map = entity ? await getEntityModuleMapping(USER_ENTITY_ID) : null;
      setMapping(map);

      // 3. Resolve the linked STT config (if any).
      const config = map?.stt_config_id
        ? await getSTTConfig(map.stt_config_id)
        : null;
      setSttConfig(config);

      // 4. Any other STT configs the user could select (selector options).
      setSttConfigs(await getAllSTTConfigs());
    } catch (err) {
      log.error('Failed to load voice input state:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  /**
   * Master switch: reflects the READ state. Toggling OFF is a DELIBERATE user
   * save that persists the engine 'disabled' sentinel into the existing stt
   * config (legitimate LWW win — the user explicitly disabled it). Toggling ON
   * opens the pinned `ModuleConfigEditScreen` (stt) to provision/edit a live
   * provider.
   */
  const handleToggle = useCallback(
    async (value: boolean) => {
      if (value) {
        // ON → open the pinned STT editor to provision/select a provider.
        navigation.navigate('ModuleConfigEdit', {
          moduleType: 'stt',
          ...(state.configId ? { configId: state.configId } : {}),
        });
        return;
      }

      // OFF → write the sentinel only when there is a live config to disable.
      if (!state.configId || !sttConfig) return;
      setDisabling(true);
      try {
        await updateSTTConfig({
          ...sttConfig,
          transcription_provider: 'disabled',
          transcription_provider_config_id: null,
          vad_provider: 'disabled',
          vad_provider_config_id: null,
        });
        await load();
      } catch (err) {
        log.error('Failed to disable voice input:', err);
      } finally {
        setDisabling(false);
      }
    },
    [navigation, state.configId, sttConfig, load],
  );

  /**
   * Deliberate mapping write: the user picked a config in the selector. This is
   * the ONLY place the app writes the `user` mapping's stt_config_id — a real
   * user save, never a background ensure-create. Selecting '' (Disabled) clears
   * the link (OFF).
   */
  const handleSelectConfig = useCallback(
    async (configId: string) => {
      try {
        await createOrUpdateEntityModuleMapping({
          entity_id: USER_ENTITY_ID,
          backend_config_id: null,
          cognition_config_id: null,
          imagination_config_id: null,
          movement_config_id: null,
          rag_config_id: null,
          stt_config_id: configId || null,
          tts_config_id: null,
          vision_config_id: null,
        });
        await load();
      } catch (err) {
        log.error('Failed to link voice input config:', err);
      }
    },
    [load],
  );

  if (!theme) return null;

  const configOptions: ModuleConfigOption[] = sttConfigs.map(c => ({
    id: c.id,
    name: c.name,
  }));

  // NB: the STT test block (2-2) no longer receives a draft config — the
  // eventserver debug session INITs the persona entity and the engine runs its
  // SYNCED STT config (drafts can't be tested over the eventserver transport).
  return (
    <ThemedView style={styles.container}>
      <ScreenHeader
        title={t('title')}
        onBack={() => navigation.goBack()}
      />

      <View style={[styles.scrollContent, { paddingBottom: 32 + safeBottom }]}>
        {/* ── Pre-sync empty state (fresh install; no engine seed yet) ── */}
        {isPreSync ? (
          <ThemedCard elevated accentStripe style={styles.card}>
            <View style={styles.emptyState}>
              <Icon name="link-off" size={40} color={theme.colors.text.muted} />
              <ThemedText size={15} weight="medium" style={styles.emptyTitle}>
                {t('preSyncTitle')}
              </ThemedText>
              <ThemedText size={13} variant="secondary" style={styles.emptyHint}>
                {t('preSyncHint')}
              </ThemedText>
            </View>
          </ThemedCard>
        ) : (
          <>
            {/* ── Shared-across-personas explanation ── */}
            <ThemedCard elevated accentStripe style={styles.card}>
              <SectionHeader title={t('header')} />
              <View style={styles.sectionContent}>
                <ThemedText size={13} variant="secondary">
                  {t('sharedExplanation')}
                </ThemedText>
                <SettingsToggleRow
                  icon="microphone"
                  label={t('switchLabel')}
                  value={state.enabled}
                  onValueChange={handleToggle}
                  theme={theme}
                  showSeparator
                />
                {disabling && (
                  <ThemedText size={12} variant="muted">
                    {t('disabling')}
                  </ThemedText>
                )}
              </View>
            </ThemedCard>

            {/* ── STT config selection / management ── */}
            <ThemedCard elevated accentStripe style={styles.card}>
              <SectionHeader title={t('configSection')} />
              <View style={styles.sectionContent}>
                {state.enabled ? (
                  <View style={styles.activeConfigSummary}>
                    <View style={styles.activeConfigRow}>
                      <Icon
                        name="check-circle"
                        size={18}
                        color={theme.colors.status.success}
                      />
                      <ThemedText size={14} weight="medium" style={styles.activeConfigText}>
                        {sttConfig?.name ?? t('configUnknown')}
                      </ThemedText>
                      <ThemedText size={12} variant="muted">
                        {state.providerType?.toUpperCase() ?? ''}
                      </ThemedText>
                    </View>
                  </View>
                ) : (
                  <ThemedText size={13} variant="secondary" style={styles.offHint}>
                    {t('offHint')}
                  </ThemedText>
                )}

                <EntityModuleSelectorWithActions
                  label={t('selectorLabel')}
                  moduleType="stt"
                  configs={configOptions}
                  selectedId={state.configId ?? ''}
                  onChange={handleSelectConfig}
                  isLoading={loading}
                />
              </View>
            </ThemedCard>

            {/* ── STT/VAD test block (phase 2-2) ── */}
            {state.enabled && (
              <ThemedCard elevated accentStripe style={styles.card}>
                <SectionHeader title={t('testSection')} />
                <View style={styles.sectionContent}>
                  <SttTestPanel />
                </View>
              </ThemedCard>
            )}
          </>
        )}
      </View>
    </ThemedView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: { padding: 16, gap: 16 },
  card: { padding: 0, overflow: 'hidden' },
  sectionContent: { padding: 16, gap: 12 },
  emptyState: { alignItems: 'center', gap: 8, padding: 24 },
  emptyTitle: { textAlign: 'center' },
  emptyHint: { textAlign: 'center' },
  activeConfigSummary: { marginBottom: 4 },
  activeConfigRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  activeConfigText: { flex: 1 },
  offHint: { marginBottom: 4 },
});
