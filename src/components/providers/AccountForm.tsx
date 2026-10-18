/**
 * AccountForm — the shared account create/edit form (provider-registry 6-2).
 *
 * Renders the per-type account fields from `accountFieldSchemas.ts`, validates
 * inline per the plan §3.1 matrix, and emits an account write body
 * (`{name, api_key, base_url?, extra?}`). Exported for 6-3's inline
 * "Add account…" flow in the module-config picker.
 *
 * System-managed account types (soulbitscloud) render read-only and expose no
 * submit action — 6-4 owns their writes.
 */

import React, { useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useAppTheme } from '../../contexts/ThemeContext';
import { ThemedText } from '../themed/ThemedText';
import { ThemedButton } from '../themed/ThemedButton';
import { FormField } from '../config/FormField';
import {
  getAccountSchema,
  isAccountManaged,
  validateAccount,
  accountValuesToWriteDto,
} from '../../constants/accountFieldSchemas';
import type { ProviderAccountWriteDto } from '../../services/engine/EngineApiClient';

export interface AccountFormProps {
  /** Provider type whose account schema is rendered. */
  type: string;
  /** Seed values (edit mode) — typically `accountToFormValues(type, account)`. */
  initialValues?: Record<string, unknown> | null;
  /** Disables the submit button while the caller persists the account. */
  submitting?: boolean;
  submitLabel?: string;
  onCancel?: () => void;
  /** Called with the validated account write body. */
  onSubmit: (account: ProviderAccountWriteDto) => void;
}

export const AccountForm: React.FC<AccountFormProps> = ({
  type,
  initialValues,
  submitting = false,
  submitLabel,
  onCancel,
  onSubmit,
}) => {
  const { theme } = useAppTheme();
  const { t } = useTranslation('providers');
  const schema = getAccountSchema(type);
  const managed = isAccountManaged(type);

  const [values, setValues] = useState<Record<string, unknown>>(() => ({
    ...(initialValues ?? {}),
  }));
  const [errors, setErrors] = useState<Record<string, string>>({});

  if (!theme) return null;
  if (!schema) {
    return (
      <ThemedText size={13} variant="secondary" testID="account-unknown-type">
        {t('unknownType')}
      </ThemedText>
    );
  }

  const handleChange = (key: string, value: unknown) => {
    setValues(prev => ({ ...prev, [key]: value }));
    setErrors(prev => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const handleSubmit = () => {
    const nextErrors = validateAccount(type, values);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;
    onSubmit(accountValuesToWriteDto(type, values));
  };

  return (
    <View style={styles.container}>
      {managed && (
        <ThemedText
          size={12}
          variant="muted"
          style={styles.managedHint}
          testID="account-managed-hint"
        >
          {t('managedHint')}
        </ThemedText>
      )}

      {schema.fields.map(field => {
        const readOnly = managed || field.readOnly === true;
        return (
          <View key={field.key}>
            <FormField
              field={field}
              value={values[field.key]}
              onChange={handleChange}
              readOnly={readOnly}
              testID={`account-field-${field.key}`}
            />
            {errors[field.key] && (
              <ThemedText
                size={12}
                testID={`account-error-${field.key}`}
                style={[styles.error, { color: theme.colors.status.error }]}
              >
                {errors[field.key]}
              </ThemedText>
            )}
          </View>
        );
      })}

      <View style={styles.actions}>
        {onCancel && (
          <ThemedButton
            label={t('cancel')}
            variant="secondary"
            onPress={onCancel}
            style={styles.action}
            testID="account-cancel"
          />
        )}
        {!managed && (
          <ThemedButton
            label={submitLabel ?? t('save')}
            onPress={handleSubmit}
            disabled={submitting}
            style={styles.action}
            testID="account-submit"
          />
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    gap: 4,
  },
  managedHint: {
    marginBottom: 12,
  },
  error: {
    marginTop: -10,
    marginBottom: 10,
  },
  actions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 8,
  },
  action: {
    flex: 1,
  },
});

export default AccountForm;
