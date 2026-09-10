/**
 * LibraryItemRow — a row in My Library showing an owned asset (purchase /
 * free / own badge + content-kind icon + title). Operates on the stub
 * `ContentAsset` kind vocabulary (Phase-1 service type).
 */
import React from 'react';
import { Pressable, View, Text, StyleSheet } from 'react-native';
import { useAppTheme } from '../../contexts/ThemeContext';
import { hexToRgba } from '../../utils/colorUtils';
import { contentKindIcon } from '../../utils/marketTypes';
import { FreeBadge } from './FreeBadge';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

interface LibraryItemRowProps {
  title: string;
  /** Delivered asset kind ('character_card' | 'text' | 'theme'). */
  kind: 'character_card' | 'text' | 'theme';
  /** How the entry was obtained (badge). */
  acquiredKind?: 'purchase' | 'free' | 'own';
  acquiredLabel?: string;
  onPress?: () => void;
  t?: (key: string) => string;
}

export const LibraryItemRow: React.FC<LibraryItemRowProps> = ({
  title,
  kind,
  acquiredKind,
  acquiredLabel,
  onPress,
  t,
}) => {
  const { theme } = useAppTheme();
  if (!theme) return null;
  const accent = theme.colors.accent.primary;

  const kindLabel =
    acquiredKind === 'purchase'
      ? t?.('purchaseBadge') ?? 'Purchase'
      : acquiredKind === 'free'
        ? 'FREE'
        : t?.('ownedBadge') ?? 'Owned';

  return (
    <Pressable onPress={onPress}>
      {({ pressed }) => (
        <View
          style={[
            styles.row,
            {
              backgroundColor: pressed
                ? hexToRgba(accent, 0.12)
                : hexToRgba(theme.colors.background.base, 0.4),
              borderColor: hexToRgba(accent, 0.2),
            },
          ]}
        >
          <View style={[styles.iconWrap, { backgroundColor: hexToRgba(accent, 0.14) }]}>
            <Icon name={contentKindIcon(kind)} size={20} color={accent} />
          </View>

          <View style={styles.body}>
            <Text style={[styles.title, { color: theme.colors.text.primary }]} numberOfLines={1}>
              {title}
            </Text>
            {acquiredLabel ? (
              <Text style={[styles.meta, { color: theme.colors.text.muted }]}>
                {acquiredLabel}
              </Text>
            ) : null}
          </View>

          {acquiredKind === 'free' ? (
            <FreeBadge />
          ) : (
            <View style={styles.badgeWrap}>
              <Text style={[styles.kindText, { color: theme.colors.text.muted }]}>
                {kindLabel}
              </Text>
            </View>
          )}
        </View>
      )}
    </Pressable>
  );
};

export default LibraryItemRow;

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
  },
  badgeWrap: {
    alignItems: 'flex-end',
  },
  kindText: {
    fontSize: 11,
    fontWeight: '600',
  },
});