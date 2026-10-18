/**
 * ProvidersScreen — the central provider-account management surface
 * (provider-registry 6-2).
 *
 * Account-centric list/create/edit/delete over the new accounts API
 * (`services/engine/repositories/providers.ts`):
 *   - accounts grouped by provider type (variant-filtered via
 *     `providerAvailability.isProviderAvailable`);
 *   - per-row: name, masked key (`sk-…1234`), base_url, in-use badge;
 *   - "Test key" → `POST /api/providers/verify` → state chip + provider payload
 *     (ElevenLabs tier/character quota, versions, …); auto-runs once after save;
 *   - delete → 409 `provider_in_use` surfaces the engine's `referencing_configs`.
 *
 * The engine returns the api_key UNMASKED (single-user local engine — noted
 * decision), so a saved account can be re-verified client-side without a
 * second round-trip.
 *
 * Scope note: this screen manages ACCOUNTS only. The module-config account
 * picker + capability-only forms are 6-3; seeding is 6-4.
 */

import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  RefreshControl,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useAppTheme } from '../../contexts/ThemeContext';
import { useAppAlert } from '../../contexts/AppAlertContext';
import { useToast } from '../../contexts/AppToastContext';
import { ThemedView } from '../../components/themed/ThemedView';
import { ThemedText } from '../../components/themed/ThemedText';
import { ThemedCard } from '../../components/themed/ThemedCard';
import { SectionHeader } from '../../components/themed/SectionHeader';
import { ScreenHeader } from '../../components/themed/ScreenHeader';
import { TAB_BAR_CONTENT_PAD } from '../../components/navigation/GlassTabBar';
import { AccountForm } from '../../components/providers/AccountForm';
import { hapticLightPress } from '../../utils/haptics';
import { hexToRgba } from '../../utils/colorUtils';
import { createLogger } from '../../utils/logger';
import { isProviderAvailable } from '../../services/variant/providerAvailability';
import {
  accountToFormValues,
  maskApiKey,
  parseAccountExtra,
} from '../../constants/accountFieldSchemas';
import type { ProviderAccount } from '../../database/models';
import type {
  ProviderAccountWriteDto,
  ProviderVerifyResultDto,
  ProviderVerifyState,
} from '../../services/engine/EngineApiClient';
import { engineApiClient } from '../../services/engine/EngineApiClient';
import {
  createAccount,
  deleteAccount,
  isAccountInUse,
  listAccounts,
  updateAccount,
  ProviderInUseError,
} from '../../services/engine/repositories/providers';

const log = createLogger('[ProvidersScreen]');

/** Canonical provider-type display order + labels (13 surviving types). */
const PROVIDER_TYPE_ORDER: readonly string[] = [
  'openai',
  'anthropic',
  'google',
  'xai',
  'mistral',
  'openrouter',
  'elevenlabs',
  'openaicompatible',
  'ollama',
  'localai',
  'comfyui',
  'soulvoice',
  'soulbitscloud',
];

const PROVIDER_TYPE_LABELS: Record<string, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic Claude',
  google: 'Google Gemini',
  xai: 'xAI / Grok',
  mistral: 'Mistral',
  openrouter: 'OpenRouter',
  elevenlabs: 'ElevenLabs',
  openaicompatible: 'OpenAI Compatible',
  ollama: 'Ollama',
  localai: 'LocalAI',
  comfyui: 'ComfyUI',
  soulvoice: 'Soulvoice',
  soulbitscloud: 'Soulbits Cloud',
};

/** Verify state → theme status color key. */
function verifyColor(state: ProviderVerifyState, theme: any): string {
  switch (state) {
    case 'valid':
      return theme.colors.status.success;
    case 'invalid':
    case 'blocked':
      return theme.colors.status.error;
    case 'throttled':
    case 'scope_limited':
      return theme.colors.status.warning;
    default:
      return theme.colors.text.muted;
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Pending-verify sentinel stored in the verify map. */
type VerifyEntry = ProviderVerifyResultDto | { pending: true };

/** In-flight editor state: `type: ''` = type picker; else the account form. */
interface EditorState {
  type: string;
  account: ProviderAccount | null;
}

export const ProvidersScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const { theme } = useAppTheme();
  const { bottom: safeBottom } = useSafeAreaInsets();
  const { t } = useTranslation('providers');
  const { showAlert } = useAppAlert();
  const { showToast } = useToast();

  const [accounts, setAccounts] = useState<ProviderAccount[]>([]);
  const [inUse, setInUse] = useState<Record<string, boolean>>({});
  const [verify, setVerify] = useState<Record<string, VerifyEntry>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const list = (await listAccounts()).filter(a => isProviderAvailable(a.type));
      setAccounts(list);
      const entries = await Promise.all(
        list.map(async a => [a.id, await isAccountInUse(a.id)] as const),
      );
      setInUse(Object.fromEntries(entries));
    } catch (err) {
      log.error('Failed to load provider accounts:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const grouped = useMemo(() => {
    const byType: Record<string, ProviderAccount[]> = {};
    for (const account of accounts) {
      (byType[account.type] ??= []).push(account);
    }
    return byType;
  }, [accounts]);

  const orderedTypes = useMemo(
    () => PROVIDER_TYPE_ORDER.filter(type => (grouped[type]?.length ?? 0) > 0),
    [grouped],
  );

  const availableTypes = useMemo(
    () => PROVIDER_TYPE_ORDER.filter(type => isProviderAvailable(type)),
    [],
  );

  /** Run the stateless credential check and store the verdict on the row. */
  const runVerify = useCallback(async (account: ProviderAccount) => {
    setVerify(prev => ({ ...prev, [account.id]: { pending: true } }));
    try {
      const result = await engineApiClient.verifyProvider({
        type: account.type,
        api_key: account.api_key,
        ...(account.base_url ? { base_url: account.base_url } : {}),
        extra: parseAccountExtra(account.extra),
      });
      setVerify(prev => ({ ...prev, [account.id]: result }));
    } catch (err) {
      setVerify(prev => ({
        ...prev,
        [account.id]: { state: 'unreachable', detail: messageOf(err) },
      }));
    }
  }, []);

  const handleAdd = useCallback(() => {
    hapticLightPress();
    setEditor({ type: '', account: null });
  }, []);

  const handleEdit = useCallback((account: ProviderAccount) => {
    hapticLightPress();
    setEditor({ type: account.type, account });
  }, []);

  const handleSubmitAccount = useCallback(
    async (dto: ProviderAccountWriteDto) => {
      if (!editor || editor.type === '') return;
      const type = editor.type;
      setSaving(true);
      try {
        let id: string;
        if (editor.account) {
          id = editor.account.id;
          await updateAccount(id, dto);
        } else {
          id = await createAccount(type, dto);
        }
        setEditor(null);
        await load();
        // Auto-run the key check once after a successful save (plan §7).
        const saved: ProviderAccount = {
          id,
          type,
          name: dto.name ?? '',
          api_key: dto.api_key ?? '',
          base_url: dto.base_url ?? '',
          extra: JSON.stringify(dto.extra ?? {}),
          created_at: null,
          updated_at: null,
          deleted_at: null,
        };
        void runVerify(saved);
      } catch (err) {
        showAlert(t('saveFailedTitle'), messageOf(err));
      } finally {
        setSaving(false);
      }
    },
    [editor, load, runVerify, showAlert, t],
  );

  const doDelete = useCallback(
    async (account: ProviderAccount) => {
      try {
        await deleteAccount(account.id);
        showToast(t('deletedToast'));
        await load();
      } catch (err) {
        if (err instanceof ProviderInUseError) {
          const list = err.referencingConfigs
            .map(c => t('deleteInUseItem', { module: c.module, name: c.name }))
            .join('\n');
          showAlert(t('deleteInUseTitle'), t('deleteInUseBody', { list }), [
            { text: t('ok') },
          ]);
        } else {
          showAlert(t('deleteFailedTitle'), messageOf(err));
        }
      }
    },
    [load, showAlert, showToast, t],
  );

  const handleDelete = useCallback(
    (account: ProviderAccount) => {
      hapticLightPress();
      showAlert(t('deleteTitle'), t('deleteConfirm', { name: account.name }), [
        { text: t('cancel'), style: 'cancel' },
        {
          text: t('delete'),
          style: 'destructive',
          onPress: () => {
            void doDelete(account);
          },
        },
      ]);
    },
    [doDelete, showAlert, t],
  );

  if (!theme) return null;

  // ── Row rendering ──────────────────────────────────────────────────────

  const renderPayload = (accountId: string, payload?: Record<string, unknown>) => {
    if (!payload) return null;
    const count = Number(payload.character_count);
    const limit = Number(payload.character_limit);
    const hasBar = Number.isFinite(count) && Number.isFinite(limit) && limit > 0;
    const entries = Object.entries(payload).filter(
      ([key, value]) =>
        value !== null &&
        value !== undefined &&
        !(hasBar && (key === 'character_count' || key === 'character_limit')),
    );
    if (!hasBar && entries.length === 0) return null;
    return (
      <View style={styles.payload} testID={`verify-payload-${accountId}`}>
        {hasBar && (
          <View
            style={[styles.barTrack, { backgroundColor: theme.colors.border.default }]}
            testID={`verify-charbar-${accountId}`}
          >
            <View
              style={[
                styles.barFill,
                {
                  width: `${Math.min(100, (count / limit) * 100)}%`,
                  backgroundColor: theme.colors.accent.primary,
                },
              ]}
            />
          </View>
        )}
        {entries.map(([key, value]) => (
          <ThemedText key={key} size={11} variant="muted">
            {`${key}: ${typeof value === 'object' ? JSON.stringify(value) : String(value)}`}
          </ThemedText>
        ))}
      </View>
    );
  };

  const renderVerify = (account: ProviderAccount) => {
    const entry = verify[account.id];
    if (!entry) return null;
    if ('pending' in entry) {
      return (
        <ThemedText size={11} variant="muted" testID={`verify-${account.id}-pending`}>
          {t('verifying')}
        </ThemedText>
      );
    }
    const color = verifyColor(entry.state, theme);
    return (
      <View style={styles.verifyBlock} testID={`verify-${account.id}`}>
        <View
          style={[
            styles.verifyChip,
            { backgroundColor: hexToRgba(color, 0.15) },
          ]}
          testID={`verify-chip-${account.id}`}
        >
          <ThemedText size={11} weight="medium" style={{ color }}>
            {t(`verifyState.${entry.state}`)}
          </ThemedText>
        </View>
        {entry.detail ? (
          <ThemedText size={11} variant="muted">
            {entry.detail}
          </ThemedText>
        ) : null}
        {renderPayload(account.id, entry.payload)}
      </View>
    );
  };

  const renderAccountRow = (account: ProviderAccount) => {
    const masked = maskApiKey(account.api_key);
    return (
      <View key={account.id} style={styles.accountRow}>
        <View style={styles.accountInfo}>
          <ThemedText size={15} weight="medium">
            {account.name}
          </ThemedText>
          <ThemedText size={12} variant="muted" testID={`account-key-${account.id}`}>
            {masked === '' ? t('keyless') : masked}
          </ThemedText>
          {account.base_url ? (
            <ThemedText size={12} variant="muted">
              {account.base_url}
            </ThemedText>
          ) : null}
          {inUse[account.id] ? (
            <View
              style={[
                styles.inUseBadge,
                { backgroundColor: hexToRgba(theme.colors.status.warning, 0.15) },
              ]}
              testID={`in-use-${account.id}`}
            >
              <ThemedText size={11} weight="medium" style={{ color: theme.colors.status.warning }}>
                {t('inUse')}
              </ThemedText>
            </View>
          ) : null}
          {renderVerify(account)}
        </View>

        <View style={styles.accountActions}>
          <ActionIcon
            icon="key-variant"
            label={t('testKey')}
            color={theme.colors.accent.primary}
            onPress={() => runVerify(account)}
            testID={`test-key-${account.id}`}
          />
          <ActionIcon
            icon="pencil-outline"
            label={t('edit')}
            color={theme.colors.text.secondary}
            onPress={() => handleEdit(account)}
            testID={`edit-${account.id}`}
          />
          <ActionIcon
            icon="trash-can-outline"
            label={t('delete')}
            color={theme.colors.status.error}
            onPress={() => handleDelete(account)}
            testID={`delete-${account.id}`}
          />
        </View>
      </View>
    );
  };

  // ── Modal content ──────────────────────────────────────────────────────

  const renderTypePicker = () => (
    <View testID="account-type-picker">
      <ThemedText size={16} weight="bold" style={styles.modalTitle}>
        {t('selectType')}
      </ThemedText>
      {availableTypes.map(type => (
        <TouchableOpacity
          key={type}
          style={[styles.typeRow, { borderBottomColor: theme.colors.border.default }]}
          onPress={() => {
            hapticLightPress();
            setEditor({ type, account: null });
          }}
          accessibilityRole="button"
          testID={`account-type-${type}`}
        >
          <ThemedText size={15}>{PROVIDER_TYPE_LABELS[type] ?? type}</ThemedText>
          <Icon name="chevron-right" size={20} color={theme.colors.text.muted} />
        </TouchableOpacity>
      ))}
      <View style={styles.modalActions}>
        <ActionIcon
          icon="close"
          label={t('cancel')}
          color={theme.colors.text.secondary}
          onPress={() => setEditor(null)}
          testID="account-type-cancel"
        />
      </View>
    </View>
  );

  const renderAccountEditor = (state: EditorState) => (
    <View testID="account-editor">
      <ThemedText size={16} weight="bold" style={styles.modalTitle}>
        {state.account
          ? t('editAccountTitle', { type: PROVIDER_TYPE_LABELS[state.type] ?? state.type })
          : t('addAccountTitle', { type: PROVIDER_TYPE_LABELS[state.type] ?? state.type })}
      </ThemedText>
      <AccountForm
        key={state.type}
        type={state.type}
        initialValues={state.account ? accountToFormValues(state.type, state.account) : null}
        submitting={saving}
        onSubmit={handleSubmitAccount}
        onCancel={() => setEditor(null)}
      />
    </View>
  );

  return (
    <ThemedView style={styles.container}>
      <ScreenHeader
        title={t('title')}
        subtitle={t('subtitle')}
        onBack={() => navigation.goBack()}
        right={
          <TouchableOpacity
            onPress={handleAdd}
            style={[styles.addButton, { backgroundColor: hexToRgba(theme.colors.accent.primary, 0.15) }]}
            accessibilityRole="button"
            accessibilityLabel={t('addAccount')}
            testID="providers-add"
          >
            <Icon name="plus" size={18} color={theme.colors.accent.primary} />
            <ThemedText size={13} weight="medium" variant="accent">
              {t('addAccount')}
            </ThemedText>
          </TouchableOpacity>
        }
      />

      <ScrollView
        contentContainerStyle={[styles.scrollContent, { paddingBottom: TAB_BAR_CONTENT_PAD + safeBottom }]}
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
        {loading ? (
          <ActivityIndicator color={theme.colors.accent.primary} testID="providers-loading" />
        ) : orderedTypes.length === 0 ? (
          <ThemedCard elevated accentStripe style={styles.card}>
            <View style={styles.emptyState}>
              <Icon name="key-outline" size={40} color={theme.colors.text.muted} />
              <ThemedText size={15} weight="medium" style={styles.emptyTitle}>
                {t('empty')}
              </ThemedText>
              <ThemedText size={13} variant="secondary" style={styles.emptyHint}>
                {t('emptyHint')}
              </ThemedText>
            </View>
          </ThemedCard>
        ) : (
          orderedTypes.map(type => (
            <ThemedCard key={type} elevated accentStripe style={styles.card}>
              <SectionHeader title={PROVIDER_TYPE_LABELS[type] ?? type} />
              <View style={styles.sectionContent}>
                {grouped[type].map(renderAccountRow)}
              </View>
            </ThemedCard>
          ))
        )}
      </ScrollView>

      <Modal
        visible={editor !== null}
        transparent
        animationType="slide"
        onRequestClose={() => setEditor(null)}
      >
        <View style={styles.modalOverlay}>
          <View
            style={[styles.modalShell, { backgroundColor: theme.colors.background.surface }]}
          >
            {editor && (editor.type === '' ? renderTypePicker() : renderAccountEditor(editor))}
          </View>
        </View>
      </Modal>
    </ThemedView>
  );
};

/** Small labelled icon button used for the row actions + modal cancel. */
const ActionIcon: React.FC<{
  icon: string;
  label: string;
  color: string;
  onPress: () => void;
  testID: string;
}> = ({ icon, label, color, onPress, testID }) => (
  <TouchableOpacity
    onPress={() => {
      hapticLightPress();
      onPress();
    }}
    style={styles.actionIcon}
    accessibilityRole="button"
    accessibilityLabel={label}
    testID={testID}
  >
    <Icon name={icon} size={20} color={color} />
  </TouchableOpacity>
);

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: { padding: 16, gap: 16 },
  card: { gap: 12, padding: 0, overflow: 'hidden' },
  sectionContent: { paddingHorizontal: 16, paddingBottom: 12 },
  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
  },
  accountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    gap: 8,
  },
  accountInfo: { flex: 1, gap: 3 },
  accountActions: { flexDirection: 'row', gap: 4 },
  actionIcon: { padding: 8 },
  inUseBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  verifyBlock: { gap: 4, marginTop: 4 },
  verifyChip: {
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  payload: { gap: 4, marginTop: 2 },
  barTrack: { height: 6, borderRadius: 3, overflow: 'hidden' },
  barFill: { height: 6, borderRadius: 3 },
  emptyState: { alignItems: 'center', gap: 8, padding: 24 },
  emptyTitle: { textAlign: 'center' },
  emptyHint: { textAlign: 'center' },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  modalShell: {
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 20,
    maxHeight: '85%',
  },
  modalTitle: { marginBottom: 12 },
  typeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 12 },
});
