/**
 * Harmony AI App
 * Open Source Android AI Chat Application
 *
 * @format
 */

import React, { useState, useEffect, useRef } from 'react';
import { StatusBar, View, StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { PaperProvider } from 'react-native-paper';
import { NavigationContainerRef } from '@react-navigation/native';
import { AppNavigator, RootStackParamList } from './src/navigation/AppNavigator';
import { ThemeProvider, usePaperTheme, useAppTheme } from './src/contexts/ThemeContext';
import { DatabaseProvider, useDatabase } from './src/contexts/DatabaseContext';
import { SyncConnectionProvider, useSyncConnection } from './src/contexts/SyncConnectionContext';
import { EntitySessionProvider } from './src/contexts/EntitySessionContext';
import { EmojiProvider } from './src/contexts/EmojiContext';
import { I18nProvider } from './src/contexts/I18nContext';
import { DatabaseLoadingScreen } from './src/components/database/DatabaseLoadingScreen';
import { InitialPairingModal } from './src/components/modals/InitialPairingModal';
import { ErrorBoundary } from './src/components/ErrorBoundary';
import { DynamicAtmosphericBackground } from './src/components/background/DynamicAtmosphericBackground';
import { StardustParticles } from './src/components/background/StardustParticles';
import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * App content with theme, database, and connection
 */
function AppContent() {
  const paperTheme = usePaperTheme();
  const { theme, loading: themeLoading } = useAppTheme();
  const { isReady, isLoading } = useDatabase();
  const { isPaired } = useSyncConnection();
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

  // Show loading screen while database OR theme initializes.
  // themeLoading guards against the race where DB finishes init before
  // ThemeContext.loadTheme() resolves — without it, every screen in the
  // navigator returns null (if (!theme) return null) → blank white page.
  if (isLoading || !isReady || themeLoading) {
    return <DatabaseLoadingScreen />;
  }

  // Database is ready, show main app
  return (
    <PaperProvider theme={paperTheme}>
      <StatusBar
        barStyle="light-content"
        backgroundColor={theme?.colors.background.base || '#000000'}
        translucent
      />
      {/* Persistent atmospheric background layer — sits behind everything */}
      <View style={styles.backgroundLayer}>
        <DynamicAtmosphericBackground />
        <StardustParticles />
      </View>
      {/* Foreground app navigation — transparent backgrounds let the aurora show through */}
      <View style={styles.foregroundLayer}>
        <AppNavigator navigationRef={navigationRef} />
      </View>
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
    <ErrorBoundary>
      <SafeAreaProvider>
        <ThemeProvider>
          <I18nProvider>
            <DatabaseProvider>
              <SyncConnectionProvider>
                  <EntitySessionProvider>
                    <EmojiProvider>
                      <AppContent />
                    </EmojiProvider>
                  </EntitySessionProvider>
              </SyncConnectionProvider>
            </DatabaseProvider>
          </I18nProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  backgroundLayer: {
    ...StyleSheet.absoluteFill,
    zIndex: 0,
  },
  foregroundLayer: {
    flex: 1,
    zIndex: 1,
    // No backgroundColor — screens provide their own glass/transparent surfaces
  },
});

export default App;
