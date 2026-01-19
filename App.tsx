/**
 * Harmony AI App
 * Open Source Android AI Chat Application
 *
 * @format
 */

import React, { useState, useEffect, useRef } from 'react';
import { StatusBar } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { PaperProvider } from 'react-native-paper';
import { NavigationContainerRef } from '@react-navigation/native';
import { AppNavigator, RootStackParamList } from './src/navigation/AppNavigator';
import { ThemeProvider, usePaperTheme, useAppTheme } from './src/contexts/ThemeContext';
import { DatabaseProvider, useDatabase } from './src/contexts/DatabaseContext';
import { ConnectionProvider, useConnection } from './src/contexts/ConnectionContext';
import { DatabaseLoadingScreen } from './src/components/database/DatabaseLoadingScreen';
import { InitialPairingModal } from './src/components/modals/InitialPairingModal';
import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * App content with theme, database, and connection
 */
function AppContent() {
  const paperTheme = usePaperTheme();
  const { theme } = useAppTheme();
  const { isReady, isLoading } = useDatabase();
  const { isPaired } = useConnection();
  const [showPairingModal, setShowPairingModal] = useState(false);
  const [pairingModalChecked, setPairingModalChecked] = useState(false);
  
  // Create a ref that can be used for navigation
  const navigationRef = useRef<NavigationContainerRef<RootStackParamList>>(null);

  useEffect(() => {
    // Check if we should show the initial pairing modal
    const checkFirstLaunch = async () => {
      const hasSeenPairingPrompt = await AsyncStorage.getItem('has_seen_pairing_prompt');
      
      if (!hasSeenPairingPrompt && !isPaired && isReady) {
        // First launch and not paired - show modal after a short delay
        setTimeout(() => {
          setShowPairingModal(true);
          setPairingModalChecked(true);
        }, 1000);
      } else {
        setPairingModalChecked(true);
      }
    };

    if (isReady) {
      checkFirstLaunch();
    }
  }, [isReady, isPaired]);

  const handlePairNow = async () => {
    await AsyncStorage.setItem('has_seen_pairing_prompt', 'true');
    setShowPairingModal(false);
    
    // Navigate to ConnectionSetupScreen using the navigation ref
    setTimeout(() => {
      if (navigationRef.current?.isReady()) {
        navigationRef.current.navigate('ConnectionSetup');
      }
    }, 100);
  };

  const handleMaybeLater = async () => {
    await AsyncStorage.setItem('has_seen_pairing_prompt', 'true');
    setShowPairingModal(false);
  };

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
      <AppNavigator navigationRef={navigationRef} />
      {pairingModalChecked && (
        <InitialPairingModal
          visible={showPairingModal}
          onPair={handlePairNow}
          onMaybeLater={handleMaybeLater}
        />
      )}
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
          <ConnectionProvider>
            <AppContent />
          </ConnectionProvider>
        </DatabaseProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

export default App;
