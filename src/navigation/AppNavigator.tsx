import React from 'react';
import {
  NavigationContainer,
  NavigationContainerRef,
  DefaultTheme,
  NavigatorScreenParams,
} from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { MainTabNavigator, MainTabParamList } from './MainTabNavigator';
import { LandingScreen } from '../screens/LandingScreen';
import { ChatDetailScreen } from '../screens/ChatDetailScreen';
import { AIProfileScreen } from '../screens/AIProfileScreen';
import { UserProfileScreen } from '../screens/UserProfileScreen';
import { CreateAIScreen } from '../screens/CreateAIScreen';
import { CharacterProfileEditScreen } from '../screens/CharacterProfileEditScreen';
import { ThemeSettingsScreen } from '../screens/settings/ThemeSettingsScreen';
import { ThemeEditorScreen } from '../screens/settings/ThemeEditorScreen';
import { ProfileSettingsScreen } from '../screens/settings/ProfileSettingsScreen';
import { EditProfileScreen } from '../screens/EditProfileScreen';
import { PersonaEditScreen } from '../screens/PersonaEditScreen';
import { BiometricLockSettingsScreen } from '../screens/settings/BiometricLockSettingsScreen';
import { ComingSoonScreen } from '../screens/settings/ComingSoonScreen';
import { DatabaseTableViewerScreen } from '../screens/development/DatabaseTableViewerScreen';
import { ConnectionSetupScreen } from '../screens/setup/ConnectionSetupScreen';
import { LoginScreen } from '../screens/auth/LoginScreen';
import { RegisterScreen } from '../screens/auth/RegisterScreen';
import { SyncSettingsScreen } from '../screens/settings/SyncSettingsScreen';
import { BackgroundSettingsScreen } from '../screens/settings/BackgroundSettingsScreen';
import { ModuleConfigEditScreen } from '../screens/config/ModuleConfigEditScreen';
import { AccountSettingsScreen } from '../screens/settings/AccountSettingsScreen';
import { AppearanceSettingsScreen } from '../screens/settings/AppearanceSettingsScreen';
import { HelpSupportSettingsScreen } from '../screens/settings/HelpSupportSettingsScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { NotificationsScreen } from '../screens/NotificationsScreen';
import { DisabledAIsScreen } from '../screens/settings/DisabledAIsScreen';
import { BlockedUsersScreen } from '../screens/settings/BlockedUsersScreen';
import { ArchivedChatsScreen } from '../screens/settings/ArchivedChatsScreen';
import { MarketplacePublishScreen } from '../screens/MarketplacePublishScreen';
import { MarketplaceItemDetailScreen } from '../screens/MarketplaceItemDetailScreen';
import { MyLibraryScreen } from '../screens/MyLibraryScreen';
import { MyListingsScreen } from '../screens/MyListingsScreen';
import { ContentAssetScreen } from '../screens/ContentAssetScreen';

export type RootStackParamList = {
  /** Tab container — the primary navigation surface (5-tab layout) */
  MainTabs: NavigatorScreenParams<MainTabParamList> | undefined;
  /** Legacy landing (kept for backward-compatible deep links) */
  Landing: undefined;
  /** Tab destinations reachable from the stack navigator (delegated to nested tab nav) */
  ChatList: undefined;
  Characters: undefined;
  Market: undefined;
  /** Full settings screen — pushed over the tabs from the header hamburger menu */
  Settings: undefined;
  /** Full-screen chat detail pushed over tabs */
  ChatDetail: {
    interactionId: string;
    participantKey?: string;
    participantIds?: string[];
    entityId: string;
    entityName?: string;
  };
  /** AI Profile — the AI character's own profile page (mirrors My Profile). */
  AIProfile: { profileId: string };
  /**
   * UserProfile — a generic profile page for any cloud user (e.g. an AI
   * character's creator). Pushed from the creator badge on AI profiles.
   * When the target user is the current user this mirrors My Profile without
   * switching tabs (so "back" returns to the AI profile).
   */
  UserProfile: {
    userId: string;
    /** Fallback display name + avatar shown while local records load (e.g.
     *  the creator's recorded name/avatar from the AI profile badge). */
    displayName?: string;
    avatarUrl?: string | null;
  };
  /**
   * CreateAI — the single create AND edit surface for AI partners.
   *   - (create) prefillProfileId = link an existing profile; duplicateProfileId = full fork
   *   - (edit)   editProfileId = edit an existing AI partner (profile + entity + settings)
   */
  CreateAI: {
    prefillProfileId?: string;
    duplicateProfileId?: string;
    editProfileId?: string;
  };
  // D4: comparison-only, unlinked from primary UX
  CharacterProfileEdit: { profileId?: string };
  Login: undefined;
  Register: undefined;
  ConnectionSetup: undefined;
  SyncSettings: undefined;
  BackgroundSettings: undefined;
  ThemeSettings: undefined;
  ThemeEditor: { themeId?: string } | undefined;
  BiometricLockSettings: undefined;
  ProfileSettings: undefined;
  EditProfile: undefined;
  PersonaEdit: { entityId?: string } | undefined;
  ComingSoon: {
    titleKey: string;
    icon: string;
    descriptionKey: string;
  };
  ModuleConfigEdit: {
    moduleType: string;
    configId?: string;
  };
  DatabaseTableViewer?: undefined;
  AccountSettings: undefined;
  AppearanceSettings: undefined;
  HelpSupportSettings: undefined;
  /** Notification feed — pushed over the tabs from the header bell */
  Notifications: undefined;
  /** Disabled AIs — settings sub-screen listing disabled conversations */
  DisabledAIs: undefined;
  /** Blocked Users — settings sub-screen listing blocked cloud users */
  BlockedUsers: undefined;
  /** Archived chats — dedicated list of archived conversations */
  ArchivedChats: undefined;
  /** Marketplace — publish any content (price or free) */
  MarketplacePublish: { profileId?: string; listingId?: string } | undefined;
  /** Marketplace — item detail + acquire */
  MarketplaceItemDetail: { listingId: string };
  /** Marketplace — everything the user collected (cross-device) */
  MyLibrary: undefined;
  /** Marketplace — the user's published items */
  MyListings: undefined;
  /** Content asset viewer (read / copy / apply / remove) */
  ContentAsset: { entryId: string };
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
        {/* ── Primary tab container (5-tab layout: Characters | Chat | Discover | Market | My Profile) ── */}
        <Stack.Screen name="MainTabs" component={MainTabNavigator} />

        {/* ── Legacy landing (kept for backward-compatible deep links) ── */}
        <Stack.Screen name="Landing" component={LandingScreen} />

        {/* ── Full-screen detail routes pushed over the tabs ─────────── */}
        <Stack.Screen name="ChatDetail" component={ChatDetailScreen} />
        <Stack.Screen name="AIProfile" component={AIProfileScreen} />
        <Stack.Screen name="UserProfile" component={UserProfileScreen} />
        <Stack.Screen name="CreateAI" component={CreateAIScreen} />
        {/* D4: comparison-only, unlinked from primary UX */}
        <Stack.Screen
          name="CharacterProfileEdit"
          component={CharacterProfileEditScreen}
        />

        {/* ── Notifications feed (pushed over tabs from the header bell) ── */}
        <Stack.Screen name="Notifications" component={NotificationsScreen} />

        {/* ── Settings (pushed over tabs from the header hamburger menu) ── */}
        <Stack.Screen name="Settings" component={SettingsScreen} />

        {/* ── Settings sub-pages (pushed over tabs from Settings) ── */}
        <Stack.Screen name="ConnectionSetup" component={ConnectionSetupScreen} />
        <Stack.Screen name="Login" component={LoginScreen} />
        <Stack.Screen name="Register" component={RegisterScreen} />
        <Stack.Screen name="SyncSettings" component={SyncSettingsScreen} />
        <Stack.Screen name="BackgroundSettings" component={BackgroundSettingsScreen} />
        <Stack.Screen name="ThemeSettings" component={ThemeSettingsScreen} />
        <Stack.Screen name="ThemeEditor" component={ThemeEditorScreen} />
        <Stack.Screen
          name="BiometricLockSettings"
          component={BiometricLockSettingsScreen}
        />
        <Stack.Screen
          name="ProfileSettings"
          component={ProfileSettingsScreen}
        />
        <Stack.Screen name="EditProfile" component={EditProfileScreen} />
        <Stack.Screen name="PersonaEdit" component={PersonaEditScreen} />
        <Stack.Screen name="AccountSettings" component={AccountSettingsScreen} />
        <Stack.Screen name="AppearanceSettings" component={AppearanceSettingsScreen} />
        <Stack.Screen name="HelpSupportSettings" component={HelpSupportSettingsScreen} />
        <Stack.Screen name="DisabledAIs" component={DisabledAIsScreen} />
        <Stack.Screen name="BlockedUsers" component={BlockedUsersScreen} />
        <Stack.Screen name="ArchivedChats" component={ArchivedChatsScreen} />
        <Stack.Screen name="MarketplacePublish" component={MarketplacePublishScreen} />
        <Stack.Screen name="MarketplaceItemDetail" component={MarketplaceItemDetailScreen} />
        <Stack.Screen name="MyLibrary" component={MyLibraryScreen} />
        <Stack.Screen name="MyListings" component={MyListingsScreen} />
        <Stack.Screen name="ContentAsset" component={ContentAssetScreen} />
        <Stack.Screen
          name="ComingSoon"
          component={ComingSoonScreen}
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
