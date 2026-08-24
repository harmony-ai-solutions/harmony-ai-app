/**
 * MarketFilterDropdown — compact type filter for the marketplace catalog.
 * A single tappable pill that opens a modal dropdown list (All | types | Free).
 */
import React, { useState } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  TouchableWithoutFeedback,
  Modal,
  FlatList,
  Text,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useAppTheme } from '../../contexts/ThemeContext';
import { hexToRgba } from '../../utils/colorUtils';
import { hapticLightPress } from '../../utils/haptics';
import { MARKETPLACE_ITEM_TYPES, itemTypeIcon, itemTypeLabelKey } from '../../utils/marketTypes';

export type MarketFilterKey = 'all' | 'free' | (typeof MARKETPLACE_ITEM_TYPES)[number];

interface MarketFilterDropdownProps {
  value: string;
  onChange: (value: string) => void;
  t: (key: string, opts?: Record<string, unknown>) => string;
}

export const MarketFilterDropdown: React.FC<MarketFilterDropdownProps> = ({ value, onChange, t }) => {
  const { theme } = useAppTheme();
  const [open, setOpen] = useState(false);
  if (!theme) return null;

  const accent = theme.colors.accent.primary;
  const baseHex = theme.colors.background.base;

  const options: { id: MarketFilterKey; label: string; icon: string }[] = [
    { id: 'all', label: t('allItems'), icon: 'view-grid-outline' },
    ...MARKETPLACE_ITEM_TYPES.map(type => ({
      id: type as MarketFilterKey,
      label: t(itemTypeLabelKey(type)),
      icon: itemTypeIcon(type),
    })),
    { id: 'free', label: t('freeItems'), icon: 'gift-outline' },
  ];

  const selected = options.find(o => o.id === value);

  return (
    <>
      <TouchableOpacity
        onPress={() => {
          hapticLightPress();
          setOpen(true);
        }}
        activeOpacity={0.7}
        style={[styles.trigger, { backgroundColor: hexToRgba(baseHex, 0.6), borderColor: hexToRgba(accent, 0.3) }]}
      >
        <Icon
          name={selected?.icon ?? 'view-grid-outline'}
          size={15}
          color={accent}
          style={styles.triggerIcon}
        />
        <Text style={[styles.triggerText, { color: theme.colors.text.primary }]}>
          {selected?.label ?? t('allItems')}
        </Text>
        <Icon name="chevron-down" size={16} color={theme.colors.text.muted} />
      </TouchableOpacity>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <TouchableWithoutFeedback onPress={() => setOpen(false)}>
          <View style={styles.overlay}>
            <TouchableWithoutFeedback>
              <View
                style={[
                  styles.sheet,
                  { backgroundColor: theme.colors.background.surface, borderColor: hexToRgba(accent, 0.3) },
                ]}
              >
                <FlatList
                  data={options}
                  keyExtractor={item => item.id}
                  renderItem={({ item }) => {
                    const active = item.id === value;
                    return (
                      <TouchableOpacity
                        onPress={() => {
                          hapticLightPress();
                          onChange(item.id);
                          setOpen(false);
                        }}
                        style={[
                          styles.row,
                          active && { backgroundColor: hexToRgba(accent, 0.14) },
                        ]}
                      >
                        <Icon
                          name={item.icon}
                          size={18}
                          color={active ? accent : theme.colors.text.muted}
                          style={styles.rowIcon}
                        />
                        <Text
                          style={[
                            styles.rowText,
                            { color: active ? accent : theme.colors.text.primary },
                          ]}
                        >
                          {item.label}
                        </Text>
                        {active ? (
                          <Icon name="check" size={16} color={accent} />
                        ) : null}
                      </TouchableOpacity>
                    );
                  }}
                />
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>
    </>
  );
};

const styles = StyleSheet.create({
  trigger: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    marginHorizontal: 16,
    marginBottom: 8,
  },
  triggerIcon: { marginRight: 6 },
  triggerText: { fontSize: 13, fontWeight: '600', marginRight: 4 },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    padding: 32,
  },
  sheet: {
    borderRadius: 18,
    borderWidth: 1,
    paddingVertical: 8,
    maxHeight: '70%',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 13,
  },
  rowIcon: { marginRight: 12 },
  rowText: { flex: 1, fontSize: 14, fontWeight: '600' },
});