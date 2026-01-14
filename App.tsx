/**
 * Harmony AI App
 * Open Source Android AI Chat Application
 *
 * @format
 */

import React from 'react';
import { StatusBar } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { PaperProvider } from 'react-native-paper';
import { AppNavigator } from './src/navigation/AppNavigator';
import { ThemeProvider, usePaperTheme, useAppTheme } from './src/contexts/ThemeContext';
import { DatabaseProvider, useDatabase } from './src/contexts/DatabaseContext';
import { DatabaseLoadingScreen } from './src/components/database/DatabaseLoadingScreen';

/**
 * App content with theme and database
 */
function AppContent() {
  const paperTheme = usePaperTheme();
  const { theme } = useAppTheme();
  const { isReady, isLoading } = useDatabase();

  // Show loading screen while database initializes
  if (isLoading || !isReady) {
    return <DatabaseLoadingScreen />;
  }

  // Database is ready, show main app
  return (
    <PaperProvider theme={paperTheme}>
      <StatusBar
        barStyle="light-content"
        backgroundColor={theme?.colors.background.base || '#000000'}
      />
      <AppNavigator />
    </PaperProvider>
  );
}

/**
 * Root App component
 */
function App() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <DatabaseProvider>
          <AppContent />
        </DatabaseProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

export default App;
