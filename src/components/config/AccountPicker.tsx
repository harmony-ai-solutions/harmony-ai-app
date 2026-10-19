/**
 * AccountPicker — the module-config account step (provider-registry 6-3, plan
 * §7 "Concept: provider (type) vs account (instance)").
 *
 * Renders the existing accounts of the chosen provider TYPE and an "Add
 * account…" affordance (the shared {@link AccountForm} lives in the parent's
 * modal).
 *
 * Managed accounts (Phase 2-3): a system-managed provider type (currently
 * `soulbitscloud`) owns exactly one read-only account. The picker never offers
 * `+ Add account…` for it (the account form has no Save button in that mode) and
 * instead renders a compact, single-line status bar:
 *
 *   🔑 Account: Soulbits Cloud (system-managed)              [ Active ]
 *
 * Unmanaged types with exactly one account render a compact single-row bar with
 * the account summary on the left and an inline `+ Add account…` link on the
 * right. Several accounts render selectable chips.
 *
 * Keys entered once, rotated once, referenced everywhere (R1): switching the
 * account here only changes which credential serves this config — capability
 * values stay (with account-scoped refs revalidated by the parent, §3.2).
 */

import React from 'react';
import { View, TouchableOpacity, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useAppTheme } from '../../contexts/ThemeContext';
import { ThemedText } from '../themed/ThemedText';
import { hapticLightPress } from '../../utils/haptics';
import { isAccountManaged, maskApiKey } from '../../constants/accountFieldSchemas';
import type { ProviderAccount } from '../../database/models';

interface AccountPickerProps {
  /** Slot key — namespaces the test ids for the STT dual-slot form. */
  slot: string;
  accounts: ProviderAccount[];
  selectedId: string | null;
  onSelect: (accountId: string) => void;
  onAddAccount: () => void;
  /**
   * Provider type whose accounts are listed. When its account is
   * system-managed (`isAccountManaged`) the add affordance is hidden and a
   * read-only status bar is rendered instead.
   */
  providerType?: string;
}

export const AccountPicker: React.FC<AccountPickerProps> = ({
  slot,
  accounts,
  selectedId,
  onSelect,
  onAddAccount,
  providerType,
}) => {
  const { theme } = useAppTheme();
  const { t } = useTranslation('moduleConfig');

  if (!theme) return null;

  const managed = providerType ? isAccountManaged(providerType) : false;
  const only = accounts[0];

  const keyLine = (account: ProviderAccount): string => {
    const masked = maskApiKey(account.api_key);
    const key = masked === '' ? t('accountKeyless') : masked;
    return account.base_url ? `${key} · ${account.base_url}` : key;
  };

  const addButton = (
    <TouchableOpacity
      onPress={() => {
        hapticLightPress();
        onAddAccount();
      }}
      accessibilityRole="button"
      accessibilityLabel={t('accountAdd')}
      testID={`account-add-${slot}`}
      style={styles.addButton}
    >
      <ThemedText size={11.5} style={styles.addButtonText}>
        + Add / Switch
      </ThemedText>
    </TouchableOpacity>
  );

  // ── System-managed account → read-only single-line status bar, no add ──
  if (managed) {
    const active = String(only?.api_key ?? '').trim() !== '';
    return (
      <View testID={`account-managed-${slot}`} style={styles.managedBar}>
        <ThemedText size={12} style={styles.accountKeyIcon}>🔑</ThemedText>
        <ThemedText size={12} weight="medium" numberOfLines={1} style={styles.managedName}>
          {`Account: ${only?.name || 'Soulbits Cloud'}`}
        </ThemedText>
        <ThemedText size={10.5} numberOfLines={1} style={styles.managedHint}>
          (system-managed)
        </ThemedText>
        <View style={styles.spacer} />
        <View
          testID={`account-managed-status-${slot}`}
          style={[
            styles.statusBadge,
            active ? styles.statusBadgeActive : styles.statusBadgeInactive,
          ]}
        >
          <ThemedText
            size={10}
            weight="medium"
            style={active ? styles.statusBadgeActiveText : styles.statusBadgeInactiveText}
          >
            {active ? 'Active' : 'Sign in required'}
          </ThemedText>
        </View>
      </View>
    );
  }

  // No accounts of this type yet → prompt to create the first one.
  if (accounts.length === 0) {
    return (
      <View style={styles.container}>
        <ThemedText size={12} variant="muted" testID={`account-none-${slot}`}>
          {t('accountNone')}
        </ThemedText>
        {addButton}
      </View>
    );
  }

  // Exactly one account → compact single-row bar with inline add (plan §7 UX).
  if (accounts.length === 1) {
    const single = accounts[0];
    return (
      <View testID={`account-single-${slot}`} style={styles.singleBar}>
        <View testID={`account-collapse-${slot}`} style={styles.singleInfo}>
          <ThemedText size={12} style={styles.accountKeyIcon}>🔑</ThemedText>
          <ThemedText
            size={11.5}
            weight="medium"
            numberOfLines={1}
            style={styles.singleAccountText}
          >
            {`Account: ${single.name} · ${keyLine(single)}`}
          </ThemedText>
        </View>
        {addButton}
      </View>
    );
  }

  // Several accounts → selectable chips.
  return (
    <View style={styles.container}>
      <ThemedText size={13} variant="secondary" style={styles.label}>
        {t('accountSelect')}
      </ThemedText>
      <View style={styles.chips}>
        {accounts.map((account) => {
          const isSelected = account.id === selectedId;
          return (
            <TouchableOpacity
              key={account.id}
              onPress={() => {
                hapticLightPress();
                onSelect(account.id);
              }}
              accessibilityRole="button"
              accessibilityState={{ selected: isSelected }}
              accessibilityLabel={account.name}
              testID={`account-option-${slot}-${account.id}`}
              style={[
                styles.chip,
                {
                  borderColor: isSelected
                    ? theme.colors.accent.primary
                    : theme.colors.border.default,
                  backgroundColor: isSelected
                    ? theme.colors.accent.primary + '1A'
                    : theme.colors.background.base,
                },
              ]}
            >
              <ThemedText size={13} variant={isSelected ? 'accent' : 'primary'} weight={isSelected ? 'medium' : 'normal'}>
                {account.name}
              </ThemedText>
              <ThemedText size={11} variant="muted">
                {keyLine(account)}
              </ThemedText>
            </TouchableOpacity>
          );
        })}
      </View>
      {addButton}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { gap: 8 },
  label: { marginBottom: 2 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 2,
  },
  singleBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    backgroundColor: 'rgba(15, 23, 42, 0.65)',
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 9,
    paddingHorizontal: 11,
    paddingVertical: 8,
  },
  singleInfo: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  singleAccountText: {
    flex: 1,
    color: '#CBD5E1',
  },
  accountKeyIcon: {
    color: '#CBD5E1',
  },
  managedBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(15, 23, 42, 0.65)',
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 9,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  managedName: { flexShrink: 0, color: '#F1F5F9' },
  managedHint: { flexShrink: 1, color: '#64748B' },
  spacer: { flex: 1 },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
  },
  statusBadgeActive: {
    backgroundColor: 'rgba(34, 197, 94, 0.15)',
  },
  statusBadgeActiveText: {
    color: '#4ADE80',
    fontWeight: '600',
  },
  statusBadgeInactive: {
    backgroundColor: 'rgba(148, 163, 184, 0.12)',
  },
  statusBadgeInactiveText: {
    color: '#94A3B8',
  },
  addButton: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(236, 72, 153, 0.14)',
    borderWidth: 1,
    borderColor: 'rgba(236, 72, 153, 0.45)',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  addButtonText: {
    color: '#f472b6',
    fontWeight: '600',
  },
});
