/**
 * SoulBalanceDropdown — tappable SOUL balance badge with a wallet action dropdown.
 *
 * The Market header shows the user's SOUL balance as a compact pill. Tapping it
 * opens a small dropdown offering "Buy Souls" and "Sell Souls". Both actions are
 * placeholders for the upcoming wallet feature — tapping one closes the dropdown
 * and shows a themed "Coming soon" alert (AppAlertContext).
 *
 * Visual language mirrors the app's obsidian-glass sheets (CharacterCardMenuModal,
 * CategoryFilterDropdown): gradient glass surface, accent stripe, soft shadows.
 */

import React, { useRef, useState } from 'react';
import {
  View,
  StyleSheet,
  Modal,
  TouchableOpacity,
  TouchableWithoutFeedback,
  useWindowDimensions,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import LinearGradient from 'react-native-linear-gradient';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useAppTheme } from '../../contexts/ThemeContext';
import { useAppAlert } from '../../contexts/AppAlertContext';
import { ThemedText } from '../themed/ThemedText';
import { SoulIcon } from './SoulIcon';
import { hexToRgba } from '../../utils/colorUtils';
import { hapticLightPress } from '../../utils/haptics';

const DROPDOWN_WIDTH = 190;

interface SoulBalanceDropdownProps {
  /** Current SOUL wallet balance */
  balance: number;
}

interface DropdownAnchor {
  top: number;
  left: number;
  width: number;
  height: number;
}

export const SoulBalanceDropdown: React.FC<SoulBalanceDropdownProps> = ({
  balance,
}) => {
  const { theme } = useAppTheme();
  const { showAlert } = useAppAlert();
  const { t } = useTranslation('market');
  const { width: windowWidth } = useWindowDimensions();
  const triggerRef = useRef<View>(null);

  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<DropdownAnchor | null>(null);

  if (!theme) return null;

  const accent = theme.colors.accent.primary;
  const accentSecondary =
    theme.colors.accent.secondary ?? theme.colors.accent.primaryHover;

  const openDropdown = () => {
    hapticLightPress();
    triggerRef.current?.measureInWindow((x, y, w, h) => {
      setAnchor({ top: y, left: x, width: w, height: h });
      setOpen(true);
    });
  };

  const handleAction = (action: 'buy' | 'sell') => {
    setOpen(false);
    hapticLightPress();
    showAlert(
      t('comingSoonTitle'),
      t(action === 'buy' ? 'buySoulsComingSoon' : 'sellSoulsComingSoon'),
      [{ text: t('common:ok') }],
      { icon: 'hammer-wrench' },
    );
  };

  const balanceText = Number.isInteger(balance)
    ? String(balance)
    : balance.toFixed(2);

  const dropdownLeft = anchor
    ? Math.max(
        12,
        Math.min(
          anchor.left + anchor.width - DROPDOWN_WIDTH,
          windowWidth - DROPDOWN_WIDTH - 12,
        ),
      )
    : 0;

  return (
    <>
      {/* ── Trigger: tappable SOUL balance badge ── */}
      <TouchableOpacity
        ref={triggerRef}
        onPress={openDropdown}
        activeOpacity={0.7}
        style={[
          styles.badge,
          {
            borderColor: open
              ? hexToRgba(accent, 0.6)
              : hexToRgba(accent, 0.35),
            backgroundColor: open
              ? hexToRgba(accent, 0.16)
              : 'rgba(0,0,0,0.22)',
          },
        ]}
        accessibilityRole="button"
        accessibilityLabel={t('walletAccessibilityLabel')}
        accessibilityState={{ expanded: open }}
        testID="soul-balance-badge"
      >
        <SoulIcon size={18} />
        <ThemedText
          variant="primary"
          size={14}
          weight="bold"
          hierarchy="header"
          numberOfLines={1}
          style={styles.balanceText}
        >
          {balanceText}
        </ThemedText>
        <ThemedText
          variant="secondary"
          size={12}
          hierarchy="subtext"
          numberOfLines={1}
          style={styles.balanceLabel}
        >
          {t('souls')}
        </ThemedText>
        <Icon
          name={open ? 'chevron-up' : 'chevron-down'}
          size={14}
          color={theme.colors.text.muted}
        />
      </TouchableOpacity>

      {/* ── Dropdown ── */}
      <Modal
        visible={open}
        transparent
        animationType="fade"
        onRequestClose={() => setOpen(false)}
      >
        <TouchableWithoutFeedback onPress={() => setOpen(false)}>
          <View style={styles.overlay} testID="soul-wallet-dropdown-overlay">
            {anchor && (
              <TouchableWithoutFeedback>
                <View
                  style={[
                    styles.dropdown,
                    {
                      top: anchor.top + anchor.height + 6,
                      left: dropdownLeft,
                      width: DROPDOWN_WIDTH,
                    },
                  ]}
                  testID="soul-wallet-dropdown"
                >
                  {/* Glass background */}
                  <LinearGradient
                    colors={[
                      theme.colors.background.elevated,
                      theme.colors.background.surface,
                    ]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 0, y: 1 }}
                    style={[StyleSheet.absoluteFill, styles.dropdownRadius]}
                  />
                  {/* Prismatic tint */}
                  <LinearGradient
                    colors={[accent + '12', 'transparent']}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0.6 }}
                    style={[StyleSheet.absoluteFill, styles.dropdownRadius]}
                    pointerEvents="none"
                  />
                  {/* Top accent stripe */}
                  <LinearGradient
                    colors={[accent + 'CC', accentSecondary + '66', 'transparent']}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={styles.topStripe}
                  />

                  {/* Header */}
                  <View style={styles.header}>
                    <ThemedText size={12} variant="muted" weight="medium">
                      {t('walletTitle')}
                    </ThemedText>
                  </View>

                  {/* Buy Souls */}
                  <TouchableOpacity
                    onPress={() => handleAction('buy')}
                    activeOpacity={0.7}
                    style={styles.actionRow}
                    accessibilityRole="button"
                    accessibilityLabel={t('buySouls')}
                    testID="wallet-action-buy"
                  >
                    <View
                      style={[
                        styles.actionIcon,
                        { backgroundColor: hexToRgba(accent, 0.16) },
                      ]}
                    >
                      <Icon name="plus-circle-outline" size={18} color={accent} />
                    </View>
                    <ThemedText
                      size={15}
                      variant="primary"
                      weight="medium"
                      style={styles.actionLabel}
                    >
                      {t('buySouls')}
                    </ThemedText>
                  </TouchableOpacity>

                  <View
                    style={[
                      styles.separator,
                      { backgroundColor: theme.colors.border.default + '44' },
                    ]}
                  />

                  {/* Sell Souls */}
                  <TouchableOpacity
                    onPress={() => handleAction('sell')}
                    activeOpacity={0.7}
                    style={styles.actionRow}
                    accessibilityRole="button"
                    accessibilityLabel={t('sellSouls')}
                    testID="wallet-action-sell"
                  >
                    <View
                      style={[
                        styles.actionIcon,
                        { backgroundColor: hexToRgba(theme.colors.status.error, 0.16) },
                      ]}
                    >
                      <Icon
                        name="bank-transfer-out"
                        size={18}
                        color={theme.colors.status.error}
                      />
                    </View>
                    <ThemedText
                      size={15}
                      variant="primary"
                      weight="medium"
                      style={styles.actionLabel}
                    >
                      {t('sellSouls')}
                    </ThemedText>
                  </TouchableOpacity>
                </View>
              </TouchableWithoutFeedback>
            )}
          </View>
        </TouchableWithoutFeedback>
      </Modal>
    </>
  );
};

const styles = StyleSheet.create({
  // ── Trigger badge ───────────────────────────────────────────────────────
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 18,
    borderWidth: 1,
    alignSelf: 'flex-start',
  },
  balanceText: {
    minWidth: 14,
  },
  balanceLabel: {
    opacity: 0.85,
  },
  // ── Dropdown ─────────────────────────────────────────────────────────────
  overlay: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  dropdown: {
    position: 'absolute',
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: '#151d30',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 14,
    elevation: 12,
  },
  dropdownRadius: {
    borderRadius: 14,
  },
  topStripe: {
    height: 2,
    width: '100%',
  },
  header: {
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 8,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  actionIcon: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionLabel: {
    flex: 1,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    marginHorizontal: 12,
  },
});

export default SoulBalanceDropdown;