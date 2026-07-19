/**
 * MainTabNavigator — 5-Tab Bottom Navigation with GlassTabBar
 *
 * Layout order (center-anchored Chat as primary workspace):
 *   Discover  |  Search  |  Chat [CENTER]  |  Characters  |  Settings
 *
 * Each tab screen renders with a transparent/glass background so the
 * persistent DynamicAtmosphericBackground aurora layer bleeds through.
 */

import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { GlassTabBar } from '../components/navigation/GlassTabBar';
import { DiscoverScreen } from '../screens/DiscoverScreen';
import { SearchScreen } from '../screens/SearchScreen';
import { ChatListScreen } from '../screens/ChatListScreen';
import { CharactersScreen } from '../screens/CharactersScreen';
import { SettingsScreen } from '../screens/SettingsScreen';

// ── Tab param list ──────────────────────────────────────────────────────────
export type MainTabParamList = {
  Discover: undefined;
  Search: undefined;
  Chat: undefined;
  Characters: undefined;
  Settings: undefined;
};

const Tab = createBottomTabNavigator<MainTabParamList>();

// ── Tab screen options ──────────────────────────────────────────────────────
const screenOptions = {
  headerShown: false,
  // Transparent scene — the aurora background layer shows through
  sceneStyle: { backgroundColor: 'transparent' },
};

const tabBarOptions = {
  // Prevent React Navigation's default tab bar positioning;
  // GlassTabBar is absolutely positioned for floating effect
  style: { position: 'absolute' as const },
};

// ── Component ───────────────────────────────────────────────────────────────
export const MainTabNavigator: React.FC = () => {
  return (
    <Tab.Navigator
      tabBar={(props) => <GlassTabBar {...props} />}
      screenOptions={{
        ...screenOptions,
        tabBarStyle: tabBarOptions.style,
      }}
      initialRouteName="Chat"
    >
      <Tab.Screen
        name="Discover"
        component={DiscoverScreen}
        options={{ tabBarLabel: 'Discover' }}
      />
      <Tab.Screen
        name="Search"
        component={SearchScreen}
        options={{ tabBarLabel: 'Search' }}
      />
      <Tab.Screen
        name="Chat"
        component={ChatListScreen}
        options={{ tabBarLabel: 'Chat' }}
      />
      <Tab.Screen
        name="Characters"
        component={CharactersScreen}
        options={{ tabBarLabel: 'Characters' }}
      />
      <Tab.Screen
        name="Settings"
        component={SettingsScreen}
        options={{ tabBarLabel: 'Settings' }}
      />
    </Tab.Navigator>
  );
};

export default MainTabNavigator;
