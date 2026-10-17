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
import { ThemeSettingsScreen } from '../screens/settings/ThemeSettingsScreen';
import { ThemeEditorScreen } from '../screens/settings/ThemeEditorScreen';
import { ProfileSettingsScreen } from '../screens/settings/ProfileSettingsScreen';
import { EditProfileScreen } from '../screens/EditProfileScreen';
import { PersonaEditScreen } from '../screens/PersonaEditScreen';
import { BiometricLockSettingsScreen } from '../screens/settings/BiometricLockSettingsScreen';
import { ComingSoonScreen } from '../screens/settings/ComingSoonScreen';
import { LoginScreen } from '../screens/auth/LoginScreen';
import { PendingApprovalScreen } from '../screens/auth/PendingApprovalScreen';
import { BackgroundSettingsScreen } from '../screens/settings/BackgroundSettingsScreen';
import { ModuleConfigEditScreen } from '../screens/config/ModuleConfigEditScreen';
import { AccountSettingsScreen } from '../screens/settings/AccountSettingsScreen';
import { AppearanceSettingsScreen } from '../screens/settings/AppearanceSettingsScreen';
import { VoiceInputSettingsScreen } from '../screens/settings/VoiceInputSettingsScreen';
import { DesktopSyncScreen } from '../screens/settings/DesktopSyncScreen';
import { BackupSettingsScreen } from '../screens/settings/BackupSettingsScreen';
import { RestoreOnboardingScreen } from '../screens/setup/RestoreOnboardingScreen';
import { RestoreOfferScreen } from '../screens/setup/RestoreOfferScreen';
import type { RestoreOffer } from '../services/backup/restoreOnboarding';
import { IOSLifecycleInfoScreen } from '../screens/settings/IOSLifecycleInfoScreen';
import { HelpSupportSettingsScreen } from '../screens/settings/HelpSupportSettingsScreen';
import { EngineLogScreen } from '../screens/settings/EngineLogScreen';
import { EngineStatusScreen } from '../screens/settings/EngineStatusScreen';
import { NotificationSettingsScreen } from '../screens/settings/NotificationSettingsScreen';
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
import { AuthGate } from '../components/auth/AuthGate';

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
   *   - (create) prefillProfileId = LIVE LINK an existing character profile
   *     (the new AI entity references the SAME shared card — no fork; the old
   *     duplicateProfileId fork param is retired)
   *   - (edit)   editProfileId = edit an existing AI partner (profile + entity + settings)
   */
  CreateAI: {
    prefillProfileId?: string;
    editProfileId?: string;
  };
  Login: undefined;
  /** Portal sign-in waiting screen (Option B) — pushed by LoginScreen. */
  PendingApproval: undefined;
  BackgroundSettings: undefined;
  ThemeSettings: undefined;
  ThemeEditor: { themeId?: string } | undefined;
  BiometricLockSettings: undefined;
  ProfileSettings: undefined;
  EditProfile: undefined;
  /** PersonaEdit — the full persona editor (personaMode). entityId opens the
   *  editor in edit mode; absent = create mode. The from-card flow creates the
   *  full copy BEFORE navigating here (decision 7/12) — no prefill payload. */
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
  AccountSettings: undefined;
  AppearanceSettings: undefined;
  /** Voice input — the single global shared-persona STT config surface (2-1). */
  VoiceInputSettings: undefined;
  /** Desktop sync — the changeset-v1 desktop↔phone sync config + status
   *  surface (3-5), in the navigation slot the deleted rows-v1 SyncSettingsScreen
   *  occupied. */
  DesktopSync: undefined;
  /** Backup & restore — user-owned-storage backup config + status (2-6). */
  BackupSettings: undefined;
  /** Restore onboarding — fresh-install restore flow (2-6). */
  RestoreOnboarding: undefined;
  /** Restore offer — the skippable fresh-install interstitial (5-3). */
  RestoreOffer: { offer: RestoreOffer };
  /** Background presence — honest-limits info for the iOS blind-tick
   *  lifecycle (4-3). Informational only (the OS owns the wake policy). */
  IOSLifecycleInfo: undefined;
  HelpSupportSettings: undefined;
  /** Engine logs — the embedded engine's log viewer + diagnostics export (7-11). */
  EngineLog: undefined;
  /** Engine status — the embedded engine's live status, ports + diagnostics. */
  EngineStatus: undefined;
  /** Notification feed — pushed over the tabs from the header bell */
  Notifications: undefined;
  /** Notification delivery — outreach transport + lock-screen (plan 7-12 §4d) */
  NotificationSettings: undefined;
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
    <AuthGate>
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

          {/* ── Notifications feed (pushed over tabs from the header bell) ── */}
          <Stack.Screen name="Notifications" component={NotificationsScreen} />

          {/* ── Settings (pushed over tabs from the header hamburger menu) ── */}
          <Stack.Screen name="Settings" component={SettingsScreen} />

          {/* ── Settings sub-pages (pushed over tabs from Settings) ── */}
          <Stack.Screen name="Login" component={LoginScreen} />
          <Stack.Screen name="PendingApproval" component={PendingApprovalScreen} />
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
          <Stack.Screen name="VoiceInputSettings" component={VoiceInputSettingsScreen} />
          <Stack.Screen name="DesktopSync" component={DesktopSyncScreen} />
          <Stack.Screen name="BackupSettings" component={BackupSettingsScreen} />
          <Stack.Screen name="RestoreOnboarding" component={RestoreOnboardingScreen} />
          <Stack.Screen name="RestoreOffer" component={RestoreOfferScreen} />
          <Stack.Screen name="IOSLifecycleInfo" component={IOSLifecycleInfoScreen} />
          <Stack.Screen name="HelpSupportSettings" component={HelpSupportSettingsScreen} />
          <Stack.Screen name="EngineLog" component={EngineLogScreen} />
          <Stack.Screen name="EngineStatus" component={EngineStatusScreen} />
          <Stack.Screen name="NotificationSettings" component={NotificationSettingsScreen} />
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
        </Stack.Navigator>
      </NavigationContainer>
    </AuthGate>
  );
};
