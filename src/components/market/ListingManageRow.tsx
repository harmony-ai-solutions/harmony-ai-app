/**
 * ListingManageRow — a management row in My Listings (edit / delist / re-list /
 * sales count, price or Free badge).
 */
import React from 'react';
import { Pressable, View, Text, StyleSheet } from 'react-native';
import { useAppTheme } from '../../contexts/ThemeContext';
import { hexToRgba } from '../../utils/colorUtils';
import { itemTypeIcon } from '../../services/marketplace/marketplaceTypes';
import { FreeBadge } from './FreeBadge';
import { formatSoulPrice } from '../../services/MarketplacePurchaseService';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import type { MarketplaceItemType } from '../../database/repositories/marketplace';

// Loosely-typed translate function — accepts i18next's TFunction.
type TranslateFn = (key: string, opts?: Record<string, unknown>) => string;

interface ListingManageRowProps {
  title: string;
  itemType: MarketplaceItemType;
  priceSouls: number;
  status: 'active' | 'delisted';
  salesCount: number;
  t: TranslateFn;
  onEdit?: () => void;
  onToggleStatus?: () => void;
}

export const ListingManageRow: React.FC<ListingManageRowProps> = ({
  title,
  itemType,
  priceSouls,
  status,
  salesCount,
  t,
  onEdit,
  onToggleStatus,
}) => {
  const { theme } = useAppTheme();
  if (!theme) return null;
  const accent = theme.colors.accent.primary;

  return (
    <View
      style={[
        styles.row,
        {
          backgroundColor: hexToRgba(theme.colors.background.base, 0.4),
          borderColor: hexToRgba(accent, 0.2),
        },
      ]}
    >
      <View style={[styles.iconWrap, { backgroundColor: hexToRgba(accent, 0.14) }]}>
        <Icon name={itemTypeIcon(itemType)} size={20} color={accent} />
      </View>

      <View style={styles.body}>
        <Text style={[styles.title, { color: theme.colors.text.primary }]} numberOfLines={1}>
          {title}
        </Text>
        <Text style={[styles.meta, { color: theme.colors.text.muted }]}>
          {status === 'active' ? t('statusActive') : t('statusDelisted')} ·{' '}
          {t('salesCountLabel', { count: salesCount })} ·{' '}
          {priceSouls > 0 ? formatSoulPrice(priceSouls) : ''}
          {priceSouls === 0 ? <FreeBadge /> : null}
        </Text>
      </View>

      <View style={styles.actions}>
        <Pressable
          onPress={onEdit}
          style={[styles.iconBtn, { backgroundColor: hexToRgba(accent, 0.14) }]}
        >
          <Icon name="pencil-outline" size={16} color={accent} />
        </Pressable>
        <Pressable
          onPress={onToggleStatus}
          style={[styles.iconBtn, { backgroundColor: hexToRgba(theme.colors.text.muted, 0.1) }]}
        >
          <Icon
            name={status === 'active' ? 'close-circle-outline' : 'reload'}
            size={16}
            color={theme.colors.text.muted}
          />
        </Pressable>
      </View>
    </View>
  );
};

export default ListingManageRow;

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 8,
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  body: {
    flex: 1,
  },
  title: {
    fontSize: 15,
    fontWeight: '600',
  },
  meta: {
    fontSize: 12,
    marginTop: 2,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  actions: {
    flexDirection: 'row',
    gap: 8,
  },
  iconBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
});