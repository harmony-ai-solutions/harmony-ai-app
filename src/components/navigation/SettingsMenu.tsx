import React, { useMemo } from 'react';
import {
  Modal,
  View,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  TouchableWithoutFeedback,
} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTranslation } from 'react-i18next';
import { useAppTheme } from '../../contexts/ThemeContext';
import { ThemedText } from '../themed/ThemedText';

/**
 * Screen-name map for tab navigation.
 * When the user taps a navigation item that corresponds to a primary tab,
 * we route through the MainTabs navigator so the tab indicator also updates.
 */
const SCREEN_TO_TAB: Record<string, string> = {
  ChatList: 'Chat',
  Characters: 'Characters',
  Settings: 'Settings',
};

interface SettingsMenuProps {
  visible: boolean;
  onClose: () => void;
  /** Callback receiving the resolved screen name (mapped for tab targets) */
  onNavigate: (screen: string) => void;
}

interface MenuSection {
  title: string;
  items: MenuItem[];
}

interface MenuItem {
  icon: string;
  label: string;
  screen: string;
  badge?: string;
  type?: 'navigate' | 'setting';
}

const getMenuSections = (t: ReturnType<typeof useTranslation<'navigation'>>['t']): MenuSection[] => [
  {
    title: t('nav.title'),
    items: [
      { icon: 'chat-processing', label: t('nav.aiChat'), screen: 'Chat', type: 'navigate' },
      { icon: 'account-group', label: t('nav.characters'), screen: 'Characters', type: 'navigate' },
      { icon: 'tune', label: t('nav.settings'), screen: 'Settings', type: 'navigate' },
      { icon: 'compass', label: t('nav.discover'), screen: 'Discover', type: 'navigate' },
      { icon: 'magnify', label: t('nav.search'), screen: 'Search', type: 'navigate' },
    ],
  },
  {
    title: t('user.title'),
    items: [{ icon: 'account-circle', label: t('user.userProfile'), screen: 'ProfileSettings' }],
  },
  {
    title: t('appSettings.title'),
    items: [{ icon: 'palette', label: t('appSettings.appearanceTheme'), screen: 'ThemeSettings', badge: '⭐' }],
  },
  {
    title: t('syncConnection.title'),
    items: [
      { icon: 'sync', label: t('syncConnection.syncSettings'), screen: 'SyncSettings' },
      { icon: 'connection', label: t('syncConnection.connectionSetup'), screen: 'ConnectionSetup' },
    ],
  },
  ...(__DEV__
    ? [{
        title: t('development.title'),
        items: [
          { icon: 'database-eye', label: t('development.databaseTableViewer'), screen: 'DatabaseTableViewer', badge: 'DEV' },
        ],
      }]
    : []),
];

export const SettingsMenu: React.FC<SettingsMenuProps> = ({
  visible,
  onClose,
  onNavigate,
}) => {
  const { theme } = useAppTheme();
  const { t } = useTranslation('navigation');

  const menuSections = useMemo(() => getMenuSections(t), [t]);

  if (!theme) return null;

  const accentPrimary = theme.colors.accent.primary;
  const accentSecondary = theme.colors.accent.secondary ?? theme.colors.accent.primaryHover;

  const handleItemPress = (item: MenuItem) => {
    onClose();
    // Resolve tab-mapped screen name for navigation
    const resolved = (item.type === 'navigate')
      ? (SCREEN_TO_TAB[item.screen] ?? item.screen)
      : item.screen;
    onNavigate(resolved);
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={styles.overlay}>
          <TouchableWithoutFeedback>
            <View style={styles.menuShell}>
              {/* Gradient background */}
              <LinearGradient
                colors={[
                  theme.colors.background.elevated,
                  theme.colors.background.surface,
                ]}
                start={{ x: 0, y: 0 }}
                end={{ x: 0, y: 1 }}
                style={[StyleSheet.absoluteFill, styles.menuGradientRadius]}
              />

              {/* Prismatic tint from top-left */}
              <LinearGradient
                colors={[accentPrimary + '12', 'transparent']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0.6 }}
                style={[StyleSheet.absoluteFill, styles.menuGradientRadius]}
                pointerEvents="none"
              />

              {/* Top accent stripe */}
              <LinearGradient
                colors={[accentPrimary + 'CC', accentSecondary + '66', 'transparent']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.menuTopStripe}
              />

              <ScrollView showsVerticalScrollIndicator={false}>
                {menuSections.map((section, sectionIndex) => (
                  <View key={sectionIndex}>
                    {/* Section header */}
                    <View style={styles.sectionHeader}>
                      <ThemedText
                        size={11}
                        weight="medium"
                        variant="muted"
                        style={styles.sectionTitle}
                      >
                        {section.title.toUpperCase()}
                      </ThemedText>
                    </View>

                    {section.items.map((item, itemIndex) => {
                      const iconColor = accentSecondary ?? accentPrimary;
                      const isLastInSection = itemIndex === section.items.length - 1;

                      return (
                        <TouchableOpacity
                          key={itemIndex}
                          style={styles.menuItem}
                          onPress={() => handleItemPress(item)}
                          activeOpacity={0.65}
                        >
                          {/* Icon badge */}
                          <View
                            style={[
                              styles.iconBadge,
                              { backgroundColor: iconColor + '1A' },
                            ]}
                          >
                            <Icon name={item.icon} size={18} color={iconColor} />
                          </View>

                          {/* Label */}
                          <View style={styles.labelContainer}>
                            <ThemedText size={15} weight="medium">
                              {item.label}
                            </ThemedText>
                            {item.badge && (
                              <View
                                style={[
                                  styles.badgePill,
                                  { backgroundColor: accentPrimary + '22' },
                                ]}
                              >
                                <ThemedText
                                  size={10}
                                  weight="bold"
                                  style={{ color: accentPrimary }}
                                >
                                  {item.badge}
                                </ThemedText>
                              </View>
                            )}
                          </View>

                          <Icon
                            name="chevron-right"
                            size={18}
                            color={theme.colors.text.muted}
                          />

                          {/* Row separator (not on last item of section) */}
                          {!isLastInSection && (
                            <View
                              style={[
                                styles.itemSeparator,
                                { backgroundColor: theme.colors.border.default + '44' },
                              ]}
                            />
                          )}
                        </TouchableOpacity>
                      );
                    })}

                    {/* Section separator */}
                    {sectionIndex < menuSections.length - 1 && (
                      <View
                        style={[
                          styles.sectionSeparator,
                          { backgroundColor: theme.colors.border.default + '66' },
                        ]}
                      />
                    )}
                  </View>
                ))}
              </ScrollView>
            </View>
          </TouchableWithoutFeedback>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-start',
    alignItems: 'flex-end',
  },
  menuShell: {
    width: 300,
    maxHeight: '80%',
    marginTop: 56,
    marginRight: 8,
    borderRadius: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 10,
    overflow: 'hidden',
  },
  menuGradientRadius: {
    borderRadius: 14,
  },
  menuTopStripe: {
    height: 2,
  },
  sectionHeader: {
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 6,
  },
  sectionTitle: {
    letterSpacing: 0.8,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 13,
    paddingHorizontal: 16,
    gap: 12,
  },
  iconBadge: {
    width: 34,
    height: 34,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    flexShrink: 0,
  },
  labelContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  badgePill: {
    borderRadius: 10,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  itemSeparator: {
    position: 'absolute',
    left: 62,
    right: 0,
    bottom: 0,
    height: StyleSheet.hairlineWidth,
  },
  sectionSeparator: {
    height: StyleSheet.hairlineWidth,
    marginHorizontal: 0,
    marginTop: 4,
    marginBottom: 2,
  },
});
