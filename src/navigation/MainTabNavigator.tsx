/**
 * MainTabNavigator — 5-Tab Bottom Navigation with GlassTabBar
 *
 * Layout order (Discover is centered and is the default tab shown on app open):
 *   Characters  |  Chat  |  Discover [CENTER]  |  Market  |  My Profile
 *
 * Settings is NOT a tab anymore — it's pushed over the tabs from the root
 * stack and is reachable via the hamburger (☰) menu in each tab header
 * (see HeaderMenuButton).
 *
 * Each tab screen renders with a transparent/glass background so the
 * persistent DynamicAtmosphericBackground aurora layer bleeds through.
 */

import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { GlassTabBar } from '../components/navigation/GlassTabBar';
import { DiscoverScreen } from '../screens/DiscoverScreen';
import { ChatListScreen } from '../screens/ChatListScreen';
import { CharactersScreen } from '../screens/CharactersScreen';
import { MarketScreen } from '../screens/MarketScreen';
import { MyProfileScreen } from '../screens/MyProfileScreen';

// ── Tab param list ──────────────────────────────────────────────────────────
export type MainTabParamList = {
  Discover: undefined;
  Chat: undefined;
  Characters: undefined;
  Market: undefined;
  MyProfile: undefined;
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
      initialRouteName="Discover"
    >
      <Tab.Screen
        name="Characters"
        component={CharactersScreen}
        options={{
          tabBarLabel: 'My Characters',
          tabBarButtonTestID: 'tab-characters',
        }}
      />
      <Tab.Screen
        name="Chat"
        component={ChatListScreen}
        options={{
          tabBarLabel: 'Chat',
          tabBarButtonTestID: 'tab-chat',
        }}
      />
      <Tab.Screen
        name="Discover"
        component={DiscoverScreen}
        options={{
          tabBarLabel: 'Discover',
          tabBarButtonTestID: 'tab-discover',
        }}
      />
      <Tab.Screen
        name="Market"
        component={MarketScreen}
        options={{
          tabBarLabel: 'Market',
          tabBarButtonTestID: 'tab-market',
        }}
      />
      <Tab.Screen
        name="MyProfile"
        component={MyProfileScreen}
        options={{
          tabBarLabel: 'My Profile',
          tabBarButtonTestID: 'tab-my-profile',
        }}
      />
    </Tab.Navigator>
  );
};

export default MainTabNavigator;
