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

/**
 * App content with theme
 */
function AppContent() {
  const paperTheme = usePaperTheme();
  const { theme } = useAppTheme();

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
        <AppContent />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

export default App;
