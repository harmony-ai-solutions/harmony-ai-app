/**
 * AccountPicker — the module-config account step (provider-registry 6-3, plan
 * §7 "Concept: provider (type) vs account (instance)").
 *
 * Renders the existing accounts of the chosen provider TYPE and an "Add
 * account…" affordance (the shared {@link AccountForm} lives in the parent's
 * modal). UX guard (plan §7): when only ONE account of the type exists the step
 * auto-collapses to a caption ("Using: <name> · add another"), so simple setups
 * never see a two-picker wall.
 *
 * Keys entered once, rotated once, referenced everywhere (R1): switching the
 * account here only changes which credential serves this config — capability
 * values stay (with account-scoped refs revalidated by the parent, §3.2).
 */

import React from 'react';
import { View, TouchableOpacity, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useAppTheme } from '../../contexts/ThemeContext';
import { ThemedText } from '../themed/ThemedText';
import { hapticLightPress } from '../../utils/haptics';
import { maskApiKey } from '../../constants/accountFieldSchemas';
import type { ProviderAccount } from '../../database/models';

interface AccountPickerProps {
  /** Slot key — namespaces the test ids for the STT dual-slot form. */
  slot: string;
  accounts: ProviderAccount[];
  selectedId: string | null;
  onSelect: (accountId: string) => void;
  onAddAccount: () => void;
}

export const AccountPicker: React.FC<AccountPickerProps> = ({
  slot,
  accounts,
  selectedId,
  onSelect,
  onAddAccount,
}) => {
  const { theme } = useAppTheme();
  const { t } = useTranslation('moduleConfig');

  if (!theme) return null;

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
      style={[styles.addButton, { borderColor: theme.colors.accent.primary }]}
    >
      <Icon name="plus" size={14} color={theme.colors.accent.primary} />
      <ThemedText size={13} variant="accent" weight="medium">
        {t('accountAdd')}
      </ThemedText>
    </TouchableOpacity>
  );

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

  // Exactly one account → auto-collapse to a caption (plan §7 UX guard).
  if (accounts.length === 1) {
    const only = accounts[0];
    return (
      <View style={styles.container}>
        <View
          testID={`account-collapse-${slot}`}
          style={[
            styles.collapsed,
            { borderColor: theme.colors.border.default, backgroundColor: theme.colors.background.base },
          ]}
        >
          <Icon name="key-variant" size={16} color={theme.colors.text.muted} />
          <View style={styles.collapsedCopy}>
            <ThemedText size={13} weight="medium">
              {t('accountUsing', { name: only.name })}
            </ThemedText>
            <ThemedText size={11} variant="muted">
              {keyLine(only)}
            </ThemedText>
          </View>
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
  collapsed: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  collapsedCopy: { flex: 1, gap: 2 },
  addButton: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
});
