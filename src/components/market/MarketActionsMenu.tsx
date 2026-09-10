/**
 * MarketActionsMenu — a single "⋯" header menu for the Marketplace.
 * Declutters the header by hiding Publish / My Listings / My Library behind
 * one tappable icon that opens a small themed dropdown.
 */
import React, { useState } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  TouchableWithoutFeedback,
  Modal,
  useWindowDimensions,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useAppTheme } from '../../contexts/ThemeContext';
import { ThemedText } from '../themed/ThemedText';
import { hexToRgba } from '../../utils/colorUtils';
import { hapticLightPress } from '../../utils/haptics';

interface MarketActionsMenuProps {
  accent: string;
  onPublish: () => void;
  onMyListings: () => void;
  onMyLibrary: () => void;
}

interface Anchor {
  top: number;
  left: number;
  width: number;
  height: number;
}

const MENU_WIDTH = 200;

export const MarketActionsMenu: React.FC<MarketActionsMenuProps> = ({
  accent,
  onPublish,
  onMyListings,
  onMyLibrary,
}) => {
  const { theme } = useAppTheme();
  const { width: windowWidth } = useWindowDimensions();
  const triggerRef = React.useRef<View>(null);
  const measureRef = (node: View | null) => {
    (triggerRef as React.MutableRefObject<View | null>).current = node;
  };
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<Anchor | null>(null);

  if (!theme) return null;

  const openMenu = () => {
    hapticLightPress();
    triggerRef.current?.measureInWindow((x, y, w, h) => {
      setAnchor({ top: y + h + 6, left: x, width: w, height: h });
      setOpen(true);
    });
  };

  const menuLeft = anchor
    ? Math.max(12, Math.min(anchor.left + anchor.width - MENU_WIDTH, windowWidth - MENU_WIDTH - 12))
    : 0;

  const items = [
    { icon: 'plus', label: 'Sell', onPress: onPublish },
    { icon: 'storefront-outline', label: 'My Listings', onPress: onMyListings },
    { icon: 'bookmark-outline', label: 'My Library', onPress: onMyLibrary },
  ];

  return (
    <>
      <TouchableOpacity
        ref={measureRef}
        onPress={openMenu}
        activeOpacity={0.7}
        hitSlop={8}
        style={[styles.btn, { backgroundColor: hexToRgba(accent, 0.14), borderColor: hexToRgba(accent, 0.3) }]}
        accessibilityRole="button"
        accessibilityLabel="Market actions"
      >
        <Icon name="dots-horizontal" size={18} color={accent} />
      </TouchableOpacity>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <TouchableWithoutFeedback onPress={() => setOpen(false)}>
          <View style={styles.overlay}>
            <TouchableWithoutFeedback>
              <View
                style={[
                  styles.menu,
                  {
                    top: anchor?.top ?? 120,
                    left: menuLeft,
                    backgroundColor: theme.colors.background.surface,
                    borderColor: hexToRgba(accent, 0.3),
                  },
                ]}
              >
                {items.map(item => (
                  <TouchableOpacity
                    key={item.label}
                    onPress={() => {
                      hapticLightPress();
                      setOpen(false);
                      item.onPress();
                    }}
                    style={styles.item}
                  >
                    <Icon name={item.icon} size={18} color={accent} style={styles.itemIcon} />
                    <ThemedText variant="primary" size={14}>
                      {item.label}
                    </ThemedText>
                  </TouchableOpacity>
                ))}
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>
    </>
  );
};

const styles = StyleSheet.create({
  btn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  overlay: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  menu: {
    position: 'absolute',
    width: MENU_WIDTH,
    borderRadius: 14,
    borderWidth: 1,
    paddingVertical: 6,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  itemIcon: { marginRight: 12 },
});