/**
 * VoiceInputScreen — the shared voice-input SELECT surface (Settings ›
 * Voice input, persona-modules 2-1 follow-up).
 *
 * Voice input is NOT per-partner: it is the STT config linked to the canonical
 * `user` entity (`entity_module_mappings.stt_config_id`) and applies whenever
 * the user speaks in ANY chat, as ANY persona. Historically the Settings row
 * jumped straight into the detail editor of the one fixed "Persona voice
 * input" config, so the only way to use a different STT setup was to overwrite
 * that config in place — mutating a shared row instead of switching links.
 *
 * This screen separates the two concerns:
 *   - SWITCH: a selector over every STT config (same sheet as Module wiring,
 *     including "Create new config…" and "Disabled"). Switching re-links the
 *     user entity through the LWW-safe full-row write (personaVoice.ts) and
 *     never touches the previously linked config.
 *   - EDIT: "✎ Edit config" runs the ensure-repair first, then opens the
 *     ModuleConfigEdit detail editor for the linked config (the old direct
 *     path, unchanged semantics).
 */

import React, { useCallback, useRef, useState } from 'react';
import { ScrollView, RefreshControl, StyleSheet, TouchableOpacity, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppTheme } from '../../contexts/ThemeContext';
import { ThemedView } from '../../components/themed/ThemedView';
import { ThemedText } from '../../components/themed/ThemedText';
import { ThemedCard } from '../../components/themed/ThemedCard';
import { SectionHeader } from '../../components/themed/SectionHeader';
import { ScreenHeader } from '../../components/themed/ScreenHeader';
import {
  EntityModuleSelector,
  formatModuleConfigSubtitle,
  type ModuleConfigOption,
} from '../../components/entities/EntityModuleSelector';
import { filterModuleConfigsForVariant } from '../../services/variant/providerAvailability';
import { getAllSTTConfigs } from '../../database/repositories';
import {
  ensurePersonaVoiceConfig,
  linkPersonaVoiceConfig,
  resolvePersonaVoice,
  setPersonaVoiceDisabled,
  type PersonaVoiceState,
} from '../../services/voiceInput/personaVoice';
import { useToast } from '../../contexts/AppToastContext';
import { createLogger } from '../../utils/logger';

const log = createLogger('[VoiceInputScreen]');

type VoiceInputNavigation = NativeStackNavigationProp<{
  ModuleConfigEdit: { moduleType: string; configId?: string };
}>;

export const VoiceInputScreen: React.FC = () => {
  const { theme } = useAppTheme();
  const { t } = useTranslation('settings');
  const navigation = useNavigation<VoiceInputNavigation>();
  const { showToast } = useToast();
  const insets = useSafeAreaInsets();

  const [refreshing, setRefreshing] = useState(false);
  const [voiceState, setVoiceState] = useState<PersonaVoiceState | null>(null);
  const [configs, setConfigs] = useState<ModuleConfigOption[] | null>(null);
  const [busy, setBusy] = useState(false);
  // Guards against double writes when the selector fires while a relink of the
  // SAME id is already in flight (sheet re-render, quick re-tap).
  const writeInFlight = useRef(false);

  /**
   * Read-only load: the resolved link state + every STT config as picker
   * options (variant-filtered, provider·model subtitles — the exact same
   * shaping the Module wiring rows use).
   */
  const load = useCallback(async () => {
    try {
      const [state, rows] = await Promise.all([
        resolvePersonaVoice(),
        getAllSTTConfigs(),
      ]);
      setVoiceState(state);
      setConfigs(
        filterModuleConfigsForVariant('stt', rows as unknown as Array<Record<string, unknown>>).map(
          c => ({
            id: String(c.id),
            name: c.name as string,
            subtitle: formatModuleConfigSubtitle(c as Record<string, unknown>),
          }),
        ),
      );
    } catch (err) {
      log.warn('Failed to load voice input state:', err);
      setVoiceState(prev => prev ?? { status: 'off' });
      setConfigs(prev => prev ?? []);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  /**
   * Selector semantics:
   *  - '' (Disabled)      → OFF: the sentinel write, routed so a SHARED linked
   *                         config is never mutated (link moves to the fixed
   *                         row in its OFF state).
   *  - any real config id → link switch: full-row write, previous config kept.
   */
  const handleSelect = useCallback(
    async (id: string) => {
      if (writeInFlight.current) return;
      writeInFlight.current = true;
      setBusy(true);
      try {
        if (id === '') {
          await setPersonaVoiceDisabled();
        } else if (id !== voiceState?.configId) {
          await linkPersonaVoiceConfig(id);
        }
        await load();
      } catch (err) {
        log.error('Failed to switch voice input config:', err);
        showToast(t('voiceInputUnavailable'));
        await load();
      } finally {
        writeInFlight.current = false;
        setBusy(false);
      }
    },
    [voiceState?.configId, load, showToast, t],
  );

  /**
   * Edit the linked config (the historical direct path). ensure-repair runs on
   * the tap: it reuses the link, repairs a dangling id or re-creates the fixed
   * config, then the editor opens on the resulting row.
   */
  const handleEdit = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      const { configId } = await ensurePersonaVoiceConfig();
      navigation.navigate('ModuleConfigEdit', { moduleType: 'stt', configId });
    } catch (err) {
      log.error('Failed to open voice input config:', err);
      showToast(t('voiceInputUnavailable'));
    } finally {
      setBusy(false);
    }
  }, [busy, navigation, showToast, t]);

  if (!theme) return null;

  const isOn = voiceState?.status === 'ok';
  // '' renders the sheet's "Disabled" option as selected; a linked-but-disabled
  // config is therefore shown as OFF — matching what the chat actually uses.
  const selectedId = isOn ? voiceState?.configId ?? '' : '';

  return (
    <ThemedView style={styles.container}>
      <ScreenHeader title={t('voiceInput')} onBack={() => navigation.goBack()} />

      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: 48 + insets.bottom },
        ]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            colors={[theme.colors.accent.primary]}
            tintColor={theme.colors.accent.primary}
            progressBackgroundColor={theme.colors.background.surface}
          />
        }
      >
        {/* ── What this is: shared, per-user, never per-partner ── */}
        <ThemedCard elevated accentStripe style={styles.card}>
          <View style={styles.sharedRow}>
            <Icon
              name="microphone-outline"
              size={18}
              color={theme.colors.accent.primary}
            />
            <ThemedText size={12.5} variant="secondary" style={styles.sharedText}>
              {t('voiceInputSharedFull')}
            </ThemedText>
          </View>
          <View style={styles.statusRow}>
            <ThemedText size={11} variant="muted">
              {t('voiceInputStatus')}
            </ThemedText>
            <ThemedText
              size={11.5}
              variant={isOn ? 'accent' : 'muted'}
              weight="medium"
              testID="voice-input-status"
            >
              {isOn
                ? voiceState?.modelLabel
                  ? `${t('on')} · ${voiceState.modelLabel}`
                  : t('on')
                : t('off')}
            </ThemedText>
          </View>
        </ThemedCard>

        {/* ── The config link: switch without editing in place ── */}
        <ThemedCard elevated accentStripe style={styles.card}>
          <SectionHeader title={t('voiceInputActiveConfig')} style={styles.sectionHeader} />
          <View style={styles.labelRow}>
            <ThemedText size={12} style={styles.label} numberOfLines={1}>
              {t('voiceInputSttLabel')}
            </ThemedText>
            {voiceState?.configId ? (
              <TouchableOpacity
                onPress={() => void handleEdit()}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityRole="button"
                accessibilityLabel={t('voiceInputEditConfig')}
                testID="voice-input-edit-config"
                disabled={busy}
              >
                <ThemedText size={11.5} style={styles.editLink} weight="medium">
                  ✎ {t('voiceInputEditConfig')}
                </ThemedText>
              </TouchableOpacity>
            ) : null}
          </View>
          <EntityModuleSelector
            label={t('voiceInputActiveConfig')}
            hideLabel
            configs={configs ?? []}
            selectedId={selectedId}
            onChange={id => void handleSelect(id)}
            isLoading={configs === null || busy}
            onCreateNew={() =>
              navigation.navigate('ModuleConfigEdit', { moduleType: 'stt' })
            }
          />
          <ThemedText size={10.5} variant="muted" style={styles.switchHint}>
            {t('voiceInputSwitchHint')}
          </ThemedText>
        </ThemedCard>
      </ScrollView>
    </ThemedView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  card: {
    marginBottom: 12,
  },
  sharedRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  sharedText: {
    flex: 1,
    lineHeight: 18,
  },
  statusRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 10,
    paddingTop: 9,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(148, 163, 184, 0.18)',
  },
  sectionHeader: {
    marginBottom: 10,
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    paddingLeft: 2,
    marginBottom: 6,
  },
  label: {
    color: '#cbd5e1',
  },
  editLink: {
    color: '#ec4899',
  },
  switchHint: {
    marginTop: 6,
    paddingLeft: 2,
    lineHeight: 15,
  },
});
