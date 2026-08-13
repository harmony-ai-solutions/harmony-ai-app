/**
 * ProfileTabs — icon-only tab bar for profile screens.
 *
 * A horizontal bar with icon-only tabs (no text labels). The active tab is
 * highlighted with an accent underline indicator beneath its icon.
 *
 * The tab key type is generic so the same component powers both the user's
 * My Profile screen (Posts / Favorites / Personas) and the AI character
 * profile screen (Images / Copies).
 */

import React from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useAppTheme } from '../../contexts/ThemeContext';
import { hapticLightPress } from '../../utils/haptics';

/** Tab keys used by the user's My Profile screen. */
export type ProfileTabKey = 'posts' | 'saved' | 'personas';

export interface ProfileTabDef<T extends string = ProfileTabKey> {
  key: T;
  /** MaterialCommunityIcons name when the tab is inactive */
  icon: string;
  /** MaterialCommunityIcons name when the tab is active (optional) */
  iconFocused?: string;
  /** Accessible label for the tab (screen readers + E2E) */
  label: string;
}

interface ProfileTabsProps<T extends string> {
  active: T;
  onChange: (key: T) => void;
  /** Ordered tab definitions — rendered left to right */
  tabs: ProfileTabDef<T>[];
  /** testID prefix for each tab button: `<prefix>-<key>` */
  testIDPrefix?: string;
}

export const ProfileTabs = <T extends string>({
  active,
  onChange,
  tabs,
  testIDPrefix = 'profile-tab',
}: ProfileTabsProps<T>) => {
  const { theme } = useAppTheme();

  if (!theme) return null;

  return (
    <View style={styles.container}>
      {tabs.map(tab => {
        const isActive = tab.key === active;
        return (
          <TouchableOpacity
            key={tab.key}
            onPress={() => {
              hapticLightPress();
              onChange(tab.key);
            }}
            activeOpacity={0.7}
            style={styles.tab}
            testID={`${testIDPrefix}-${tab.key}`}
            accessibilityRole="tab"
            accessibilityLabel={tab.label}
            accessibilityState={{ selected: isActive }}
          >
            <Icon
              name={isActive ? (tab.iconFocused ?? tab.icon) : tab.icon}
              size={26}
              color={
                isActive
                  ? theme.colors.accent.primary
                  : theme.colors.text.muted
              }
            />
            {/* Active underline indicator */}
            <View
              style={[
                styles.indicator,
                { backgroundColor: theme.colors.accent.primary },
                !isActive && styles.indicatorHidden,
              ]}
            />
          </TouchableOpacity>
        );
      })}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginTop: 20,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.10)',
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 12,
    gap: 8,
  },
  indicator: {
    width: 32,
    height: 3,
    borderRadius: 999,
  },
  indicatorHidden: {
    opacity: 0,
  },
});

export default ProfileTabs;
