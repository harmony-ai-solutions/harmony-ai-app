import React from 'react';
import {
  NavigationContainer,
  NavigationContainerRef,
} from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { LandingScreen } from '../screens/LandingScreen';
import { ChatListScreen } from '../screens/ChatListScreen';
import { ChatDetailScreen } from '../screens/ChatDetailScreen';
import { CharactersScreen } from '../screens/CharactersScreen';
import { CharacterProfileEditScreen } from '../screens/CharacterProfileEditScreen';
import { CreateAIScreen } from '../screens/CreateAIScreen';
import { EntityConfigScreen } from '../screens/EntityConfigScreen';
import { EntityConfigEditScreen } from '../screens/EntityConfigEditScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { ThemeSettingsScreen } from '../screens/settings/ThemeSettingsScreen';
import { ThemeEditorScreen } from '../screens/settings/ThemeEditorScreen';
import { EmojiActionEditorScreen } from '../screens/settings/EmojiActionEditorScreen';
import { ProfileSettingsScreen } from '../screens/settings/ProfileSettingsScreen';
import { DatabaseTestScreen } from '../screens/development/DatabaseTestScreen';
import { DatabaseTableViewerScreen } from '../screens/development/DatabaseTableViewerScreen';
import { ConnectionSetupScreen } from '../screens/setup/ConnectionSetupScreen';
import { SyncSettingsScreen } from '../screens/settings/SyncSettingsScreen';
import { ModuleConfigEditScreen } from '../screens/config/ModuleConfigEditScreen';

export type RootStackParamList = {
  Landing: undefined;
  ChatList: undefined;
  ChatDetail: {
    interactionId: string;           // existing interaction or temp UUIDv7
    participantKey?: string;         // for temp UUIDv7 path
    participantIds?: string[];       // ALL participants including own entity
    entityId: string;                // impersonated entity (ownEntityId)
    // Display info for header (derived from participants)
    entityName?: string;             // display name for header (private: partner name; group: comma-joined names)
  };
  Characters: undefined;
  CharacterProfileEdit: { profileId?: string };
  CreateAI: { prefillProfileId?: string };
  EntityConfig: undefined;
  EntityConfigEdit: { entityId?: string };
  Settings: undefined;
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
    configId?: number;
  };
  DatabaseTests?: undefined;
  DatabaseTableViewer?: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

interface AppNavigatorProps {
  navigationRef?: React.RefObject<NavigationContainerRef<RootStackParamList> | null>;
}

export const AppNavigator: React.FC<AppNavigatorProps> = ({
  navigationRef,
}) => {
  return (
    <NavigationContainer ref={navigationRef}>
      <Stack.Navigator
        initialRouteName="Landing"
        screenOptions={{
          headerShown: false,
        }}
      >
        <Stack.Screen name="Landing" component={LandingScreen} />
        <Stack.Screen name="ChatList" component={ChatListScreen} />
        <Stack.Screen name="ChatDetail" component={ChatDetailScreen} />
        <Stack.Screen name="Characters" component={CharactersScreen} />
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
        <Stack.Screen name="Settings" component={SettingsScreen} />
        <Stack.Screen
          name="ConnectionSetup"
          component={ConnectionSetupScreen}
        />
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
        {__DEV__ && (
          <>
            <Stack.Screen
              name="DatabaseTests"
              component={DatabaseTestScreen}
              options={{ headerShown: false }}
            />
            <Stack.Screen
              name="DatabaseTableViewer"
              component={DatabaseTableViewerScreen}
              options={{ headerShown: false }}
            />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
};
