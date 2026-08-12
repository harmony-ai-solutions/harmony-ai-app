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
import { AuthProvider, useAuth } from './src/contexts/AuthContext';
import { BiometricLockProvider, useBiometricLock } from './src/contexts/BiometricLockContext';
import { SyncConnectionProvider, useSyncConnection } from './src/contexts/SyncConnectionContext';
import { EntitySessionProvider } from './src/contexts/EntitySessionContext';
import { EmojiProvider } from './src/contexts/EmojiContext';
import { I18nProvider } from './src/contexts/I18nContext';
import { AppAlertProvider } from './src/contexts/AppAlertContext';
import { DatabaseLoadingScreen } from './src/components/database/DatabaseLoadingScreen';
import { InitialPairingModal } from './src/components/modals/InitialPairingModal';
import { LockScreen } from './src/components/lock/LockScreen';
import { ErrorBoundary } from './src/components/ErrorBoundary';
import { DynamicBackground } from './src/components/background/DynamicBackground';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { loadHapticPreference } from './src/utils/haptics';

/**
 * Inner app shell — has access to BiometricLockContext for lock screen overlay.
 */
function AppShell() {
  const paperTheme = usePaperTheme();
  const { theme, loading: themeLoading } = useAppTheme();
  const { isReady, isLoading } = useDatabase();
  const { isPaired } = useSyncConnection();
  const { isLocked } = useBiometricLock();
  const { signInVersion } = useAuth();
  const [showPairingModal, setShowPairingModal] = useState(false);
  const [pairingModalChecked, setPairingModalChecked] = useState(false);

  const navigationRef = useRef<NavigationContainerRef<RootStackParamList> | null>(null);
  // Skip the first render (signInVersion starts at 0) — only react to a real
  // explicit sign-in. Returns early so the app-start bootstrap (persisted
  // token) never triggers a redirect to the profile.
  const prevSignInVersionRef = useRef(signInVersion);

  useEffect(() => {
    if (prevSignInVersionRef.current === signInVersion) return;
    prevSignInVersionRef.current = signInVersion;
    if (signInVersion > 0) {
      // Fresh sign-in → send the user straight to their profile page.
      setTimeout(() => {
        navigationRef.current?.navigate('MainTabs', { screen: 'MyProfile' });
      }, 100);
    }
  }, [signInVersion]);

  useEffect(() => {
    // Apply the persisted "Haptic feedback" Settings toggle once at startup
    // so the very first button press respects the user's preference.
    loadHapticPreference();
  }, []);

  useEffect(() => {
    const checkFirstLaunch = async () => {
      const hasSeenPairingPrompt = await AsyncStorage.getItem('has_seen_pairing_prompt');

      if (!hasSeenPairingPrompt && !isPaired && isReady) {
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

  if (isLoading || !isReady || themeLoading) {
    return <DatabaseLoadingScreen />;
  }

  return (
    <PaperProvider theme={paperTheme}>
      <StatusBar
        barStyle="light-content"
        backgroundColor={theme?.colors.background.base || '#000000'}
        translucent
      />
      <View style={styles.backgroundLayer}>
        <DynamicBackground />
      </View>
      <View style={styles.foregroundLayer}>
        <AppNavigator navigationRef={navigationRef} />
        {pairingModalChecked && (
          <InitialPairingModal
            visible={showPairingModal}
            onPair={handlePairNow}
            onMaybeLater={handleMaybeLater}
          />
        )}
        {isLocked && <LockScreen />}
      </View>
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
              <AuthProvider>
                <AppAlertProvider>
                  <SyncConnectionProvider>
                    <EntitySessionProvider>
                      <EmojiProvider>
                        <BiometricLockProvider>
                          <AppShell />
                        </BiometricLockProvider>
                      </EmojiProvider>
                    </EntitySessionProvider>
                  </SyncConnectionProvider>
                </AppAlertProvider>
              </AuthProvider>
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
  },
});

export default App;
