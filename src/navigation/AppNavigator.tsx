import React from 'react';
import { NavigationContainer, NavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { BottomNavigator } from './BottomNavigator';
import { ThemeSettingsScreen } from '../screens/settings/ThemeSettingsScreen';
import { ThemeEditorScreen } from '../screens/settings/ThemeEditorScreen';
import { ProfileSettingsScreen } from '../screens/settings/ProfileSettingsScreen';
import { DatabaseTestScreen } from '../screens/development/DatabaseTestScreen';
import { DatabaseTableViewerScreen } from '../screens/development/DatabaseTableViewerScreen';
import { ConnectionSetupScreen } from '../screens/setup/ConnectionSetupScreen';
import { SyncSettingsScreen } from '../screens/settings/SyncSettingsScreen';

export type RootStackParamList = {
  Main: undefined;
  ThemeSettings: undefined;
  ThemeEditor: { themeId?: string } | undefined;
  ProfileSettings: undefined;
  ConnectionSetup: undefined;
  SyncSettings: undefined;
  DatabaseTests?: undefined; // DEV only
  DatabaseTableViewer?: undefined; // DEV only
};

const Stack = createNativeStackNavigator<RootStackParamList>();

interface AppNavigatorProps {
  navigationRef?: React.RefObject<NavigationContainerRef<RootStackParamList> | null>;
}

export const AppNavigator: React.FC<AppNavigatorProps> = ({ navigationRef }) => {
  return (
    <NavigationContainer ref={navigationRef}>
      <Stack.Navigator
        initialRouteName="Main"
        screenOptions={{
          headerShown: false,
        }}
      >
        <Stack.Screen name="Main" component={BottomNavigator} />
        <Stack.Screen name="ThemeSettings" component={ThemeSettingsScreen} />
        <Stack.Screen name="ThemeEditor" component={ThemeEditorScreen} />
        <Stack.Screen name="ProfileSettings" component={ProfileSettingsScreen} />
        <Stack.Screen name="ConnectionSetup" component={ConnectionSetupScreen} />
        <Stack.Screen name="SyncSettings" component={SyncSettingsScreen} />
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
