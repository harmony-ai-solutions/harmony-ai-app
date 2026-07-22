import React from 'react';
import {
  NavigationContainer,
  NavigationContainerRef,
  DefaultTheme,
} from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { MainTabNavigator } from './MainTabNavigator';
import { LandingScreen } from '../screens/LandingScreen';
import { ChatDetailScreen } from '../screens/ChatDetailScreen';
import { CharacterProfileEditScreen } from '../screens/CharacterProfileEditScreen';
import { CreateAIScreen } from '../screens/CreateAIScreen';
import { EntityConfigScreen } from '../screens/EntityConfigScreen';
import { EntityConfigEditScreen } from '../screens/EntityConfigEditScreen';
import { ThemeSettingsScreen } from '../screens/settings/ThemeSettingsScreen';
import { ThemeEditorScreen } from '../screens/settings/ThemeEditorScreen';
import { EmojiActionEditorScreen } from '../screens/settings/EmojiActionEditorScreen';
import { ProfileSettingsScreen } from '../screens/settings/ProfileSettingsScreen';
import { DatabaseTableViewerScreen } from '../screens/development/DatabaseTableViewerScreen';
import { ConnectionSetupScreen } from '../screens/setup/ConnectionSetupScreen';
import { LoginScreen } from '../screens/auth/LoginScreen';
import { RegisterScreen } from '../screens/auth/RegisterScreen';
import { SyncSettingsScreen } from '../screens/settings/SyncSettingsScreen';
import { ModuleConfigEditScreen } from '../screens/config/ModuleConfigEditScreen';

export type RootStackParamList = {
  /** Tab container — the primary navigation surface (5-tab layout) */
  MainTabs: undefined;
  /** Legacy landing (kept for backward-compatible deep links) */
  Landing: undefined;
  /** Full-screen chat detail pushed over tabs */
  ChatDetail: {
    interactionId: string;
    participantKey?: string;
    participantIds?: string[];
    entityId: string;
    entityName?: string;
  };
  CharacterProfileEdit: { profileId?: string };
  CreateAI: { prefillProfileId?: string };
  EntityConfig: undefined;
  EntityConfigEdit: { entityId?: string };
  Login: undefined;
  Register: undefined;
  ConnectionSetup: undefined;
  SyncSettings: undefined;
  ThemeSettings: undefined;
  ThemeEditor: { themeId?: string } | undefined;
  EmojiActionEditor: {
    entityId: string;
    entityName: string;
  };
  ProfileSettings: undefined;
  ModuleConfigEdit: {
    moduleType: string;
    configId?: string;
  };
  DatabaseTableViewer?: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

/**
 * Transparent navigation theme — lets the atmospheric background
 * aurora layer bleed through all screens.
 */
const transparentNavTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    primary: '#8f3ba7',
    background: 'transparent',
    card: 'transparent',
    text: '#e8e6f0',
    border: 'transparent',
    notification: '#8f3ba7',
  },
};

interface AppNavigatorProps {
  navigationRef?: React.RefObject<NavigationContainerRef<RootStackParamList> | null>;
}

export const AppNavigator: React.FC<AppNavigatorProps> = ({
  navigationRef,
}) => {
  return (
    <NavigationContainer ref={navigationRef} theme={transparentNavTheme}>
      <Stack.Navigator
        initialRouteName="MainTabs"
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: 'transparent' },
          animation: 'fade',
        }}
      >
        {/* ── Primary tab container (5-tab layout: Discover | Search | Chat | Characters | Settings) ── */}
        <Stack.Screen name="MainTabs" component={MainTabNavigator} />

        {/* ── Legacy landing (kept for backward-compatible deep links) ── */}
        <Stack.Screen name="Landing" component={LandingScreen} />

        {/* ── Full-screen detail routes pushed over the tabs ─────────── */}
        <Stack.Screen name="ChatDetail" component={ChatDetailScreen} />
        <Stack.Screen
          name="CharacterProfileEdit"
          component={CharacterProfileEditScreen}
        />
        <Stack.Screen name="CreateAI" component={CreateAIScreen} />
        <Stack.Screen name="EntityConfig" component={EntityConfigScreen} />
        <Stack.Screen
          name="EntityConfigEdit"
          component={EntityConfigEditScreen}
        />

        {/* ── Settings sub-pages (pushed over tabs from Settings tab) ── */}
        <Stack.Screen name="ConnectionSetup" component={ConnectionSetupScreen} />
        <Stack.Screen name="Login" component={LoginScreen} />
        <Stack.Screen name="Register" component={RegisterScreen} />
        <Stack.Screen name="SyncSettings" component={SyncSettingsScreen} />
        <Stack.Screen name="ThemeSettings" component={ThemeSettingsScreen} />
        <Stack.Screen name="ThemeEditor" component={ThemeEditorScreen} />
        <Stack.Screen
          name="EmojiActionEditor"
          component={EmojiActionEditorScreen}
        />
        <Stack.Screen
          name="ProfileSettings"
          component={ProfileSettingsScreen}
        />
        <Stack.Screen
          name="ModuleConfigEdit"
          component={ModuleConfigEditScreen}
        />

        {/* ── DEV-only screens ──────────────────────────────────────── */}
        {__DEV__ && (
          <Stack.Screen
            name="DatabaseTableViewer"
            component={DatabaseTableViewerScreen}
            options={{ headerShown: false }}
          />
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
};
