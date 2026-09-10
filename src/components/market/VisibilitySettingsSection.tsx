/**
 * VisibilitySettingsSection — reusable, theme-aware visibility control for
 * marketplace content elements.
 *
 * Extracted from the old CreateAI "Visibility & Sharing" section (59739e0)
 * per the user ruling: the classification UI does NOT belong in the create
 * screen, but MUST exist for the settings of marketplace content elements.
 *
 * Renders:
 *   - a summary row (icon + current label + hint), and
 *   - the 3-way segmented control (Private AI / Public AI / Marketplace), and
 *   - a SOUL price input (numeric, clamped ≥ 0) when Marketplace is selected.
 *
 * i18n: reuses the legacy `createAI` visibility keys (visibilityLabel,
 * visibilityPrivate/Public/Marketplace + their hints) plus `market`'s
 * priceLabel / priceHint. Keys are NOT moved or deleted — CreateAIScreen no
 * longer renders this section; this component is the UI surface for the
 * future backend's visibility contract (see 20-Backend-Concept). The stub
 * backend currently only understands marketplace semantics: the private/
 * public intent is persisted by the caller in its draft state and ignored by
 * the stub beyond the marketplace classification.
 */

import React from 'react';
import { View, Text, TextInput, Pressable, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useAppTheme } from '../../contexts/ThemeContext';
import { hexToRgba } from '../../utils/colorUtils';
import { SoulIcon } from './SoulIcon';

/** Availability classification — mirrors the future backend contract. */
export type VisibilityValue = 'private' | 'public' | 'marketplace';

interface VisibilitySettingsSectionProps {
  /** Currently selected availability classification. */
  value: VisibilityValue;
  /** Fired when the user taps a segment. */
  onChange: (next: VisibilityValue) => void;
  /** Current SOUL price (marketplace mode). */
  priceSouls: number;
  /** Fired when the marketplace price is edited (already clamped ≥ 0). */
  onPriceChange: (next: number) => void;
  /** Disable the whole control (e.g. while a save is in flight). */
  disabled?: boolean;
}

const SEGMENTS: {
  key: VisibilityValue;
  icon: string;
  labelKey: string;
  hintKey: string;
}[] = [
  {
    key: 'private',
    icon: 'lock-outline',
    labelKey: 'visibilityPrivate',
    hintKey: 'visibilityPrivateHint',
  },
  {
    key: 'public',
    icon: 'earth',
    labelKey: 'visibilityPublic',
    hintKey: 'visibilityPublicHint',
  },
  {
    key: 'marketplace',
    icon: 'storefront-outline',
    labelKey: 'visibilityMarketplace',
    hintKey: 'visibilityMarketplaceHint',
  },
];

export const VisibilitySettingsSection: React.FC<VisibilitySettingsSectionProps> = ({
  value,
  onChange,
  priceSouls,
  onPriceChange,
  disabled = false,
}) => {
  const { t } = useTranslation('createAI');
  const { theme } = useAppTheme();
  if (!theme) return null;

  const accent = theme.colors.accent.primary;
  const surface = theme.colors.background.surface;
  const active = SEGMENTS.find(s => s.key === value) ?? SEGMENTS[2];

  const handlePriceText = (raw: string) => {
    const n = Number(raw);
    if (!Number.isFinite(n)) return;
    onPriceChange(Math.max(0, n));
  };

  return (
    <View style={styles.wrap}>
      <Text style={[styles.groupLabel, { color: accent }]}>{t('visibilityLabel')}</Text>

      {/* Summary row — icon + current selection + hint */}
      <View
        style={[
          styles.summaryRow,
          {
            backgroundColor: hexToRgba(surface, 0.55),
            borderColor: hexToRgba(accent, 0.25),
          },
        ]}
      >
        <View style={[styles.iconWrap, { backgroundColor: hexToRgba(accent, 0.14) }]}>
          <Icon name={active.icon} size={22} color={accent} />
        </View>
        <View style={styles.labelGroup}>
          <Text style={[styles.summaryLabel, { color: theme.colors.text.primary }]}>
            {t(active.labelKey)}
          </Text>
          <Text style={[styles.summaryHint, { color: theme.colors.text.muted }]}>
            {t(active.hintKey)}
          </Text>
        </View>
      </View>

      {/* Segment picker: Private | Public | Marketplace */}
      <View style={styles.segments}>
        {SEGMENTS.map(seg => {
          const isActive = value === seg.key;
          return (
            <Pressable
              key={seg.key}
              onPress={() => onChange(seg.key)}
              disabled={disabled}
              accessibilityRole="button"
              accessibilityLabel={t(seg.labelKey)}
              testID={`visibility-segment-${seg.key}`}
              style={[
                styles.segment,
                {
                  backgroundColor: isActive
                    ? hexToRgba(accent, 0.18)
                    : hexToRgba(surface, 0.45),
                  borderColor: isActive ? accent : theme.colors.border.default,
                  opacity: disabled ? 0.6 : 1,
                },
              ]}
            >
              <Icon
                name={seg.icon}
                size={16}
                color={isActive ? accent : theme.colors.text.muted}
              />
              <Text
                numberOfLines={1}
                style={[
                  styles.segmentLabel,
                  {
                    color: isActive
                      ? theme.colors.text.primary
                      : theme.colors.text.muted,
                    fontWeight: isActive ? '700' : '500',
                  },
                ]}
              >
                {t(seg.labelKey)}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {/* SOUL price (marketplace only) */}
      {value === 'marketplace' && (
        <View style={styles.priceBlock}>
          <Text style={[styles.priceLabel, { color: theme.colors.text.secondary }]}>
            {t('priceLabel', { ns: 'market' })}
          </Text>
          <View
            style={[
              styles.priceShell,
              {
                backgroundColor: hexToRgba(surface, 0.55),
                borderColor: theme.colors.border.default,
                opacity: disabled ? 0.6 : 1,
              },
            ]}
          >
            <SoulIcon size={18} />
            <TextInput
              style={[styles.priceInput, { color: theme.colors.text.primary }]}
              value={String(priceSouls)}
              onChangeText={handlePriceText}
              placeholder="100"
              placeholderTextColor={theme.colors.text.muted}
              keyboardType="numeric"
              returnKeyType="done"
              editable={!disabled}
              testID="visibility-price-input"
            />
          </View>
          <Text style={[styles.priceHint, { color: theme.colors.text.muted }]}>
            {t('priceHint', { ns: 'market' })}
          </Text>
        </View>
      )}
    </View>
  );
};

export default VisibilitySettingsSection;

const styles = StyleSheet.create({
  wrap: {
    marginTop: 4,
  },
  groupLabel: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.6,
    marginBottom: 8,
    textTransform: 'uppercase',
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 8,
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  labelGroup: {
    flex: 1,
    gap: 2,
  },
  summaryLabel: {
    fontSize: 15,
    fontWeight: '700',
  },
  summaryHint: {
    fontSize: 12,
    lineHeight: 16,
  },
  segments: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 4,
  },
  segment: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 6,
  },
  segmentLabel: {
    flexShrink: 1,
    fontSize: 12,
  },
  priceBlock: {
    marginTop: 10,
  },
  priceLabel: {
    fontSize: 13,
    marginBottom: 8,
    marginLeft: 4,
  },
  priceShell: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  priceInput: {
    flex: 1,
    textAlign: 'center',
    fontSize: 15,
    fontWeight: '700',
    paddingVertical: 8,
  },
  priceHint: {
    marginTop: 6,
    marginLeft: 4,
    fontSize: 11,
    lineHeight: 15,
  },
});