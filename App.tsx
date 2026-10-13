/**
 * Harmony AI App
 * Open Source Android AI Chat Application
 *
 * @format
 */

import React, { useEffect, useRef } from 'react';
import { StatusBar, View, StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { PaperProvider } from 'react-native-paper';
import { NavigationContainerRef } from '@react-navigation/native';
import { AppNavigator, RootStackParamList } from './src/navigation/AppNavigator';
import { ThemeProvider, usePaperTheme, useAppTheme } from './src/contexts/ThemeContext';
import { DatabaseProvider, useDatabase } from './src/contexts/DatabaseContext';
import { AuthProvider, useAuth } from './src/contexts/AuthContext';
import { BiometricLockProvider, useBiometricLock } from './src/contexts/BiometricLockContext';
import { SyncConnectionProvider } from './src/contexts/SyncConnectionContext';
import { EntitySessionProvider } from './src/contexts/EntitySessionContext';
import { EmojiProvider } from './src/contexts/EmojiContext';
import { I18nProvider } from './src/contexts/I18nContext';
import { AppAlertProvider } from './src/contexts/AppAlertContext';
import { AppToastProvider } from './src/contexts/AppToastContext';
import { DatabaseLoadingScreen } from './src/components/database/DatabaseLoadingScreen';
import { LockScreen } from './src/components/lock/LockScreen';
import { ErrorBoundary } from './src/components/ErrorBoundary';
import { DynamicBackground } from './src/components/background/DynamicBackground';
import { UpdateBanner } from './src/components/updates/UpdateBanner';
import { EngineContractGate } from './src/components/engine/EngineContractGate';
import { loadHapticPreference } from './src/utils/haptics';
import { probeRestoreOfferOnce } from './src/services/backup/restoreOnboarding';
import { onBubbleOpen } from './src/services/ChatBubbleService';
import ChatPreferencesService from './src/services/ChatPreferencesService';
import type { BubbleConversation } from './src/services/ChatBubbleService';

/**
 * Inner app shell — has access to BiometricLockContext for lock screen overlay.
 */
function AppShell() {
  const paperTheme = usePaperTheme();
  const { theme, loading: themeLoading } = useAppTheme();
  const { isReady, isLoading } = useDatabase();
  const { isLocked } = useBiometricLock();
  const { signInVersion } = useAuth();

  const navigationRef = useRef<NavigationContainerRef<RootStackParamList> | null>(null);
  // Skip the first render (signInVersion starts at 0) — only react to a real
  // explicit sign-in. Returns early so the app-start bootstrap (persisted
  // token) never triggers a redirect to the profile.
  const prevSignInVersionRef = useRef(signInVersion);

  useEffect(() => {
    if (prevSignInVersionRef.current === signInVersion) return;
    prevSignInVersionRef.current = signInVersion;
    if (signInVersion <= 0) return;

    // 5-3: fresh-install restore gate. After an explicit sign-in, probe for a
    // restorable backup; if one is found, surface the skippable restore offer
    // instead of jumping straight to the profile. Bounded so a slow probe never
    // blocks the post-sign-in navigation (the "start fresh" path is unchanged).
    let cancelled = false;
    (async () => {
      const offer = await Promise.race([
        probeRestoreOfferOnce(),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 4000)),
      ]).catch(() => null);
      if (cancelled) return;
      setTimeout(() => {
        if (offer) {
          navigationRef.current?.navigate('RestoreOffer', { offer });
        } else {
          // Fresh sign-in → send the user straight to their profile page.
          navigationRef.current?.navigate('MainTabs', { screen: 'MyProfile' });
        }
      }, 100);
    })();

    return () => {
      cancelled = true;
    };
  }, [signInVersion]);

  useEffect(() => {
    // Apply the persisted "Haptic feedback" Settings toggle once at startup
    // so the very first button press respects the user's preference.
    loadHapticPreference();
    // One-time sweep of dead legacy `chat_entity_pref_*` AsyncStorage keys
    // (Q14) — best-effort, fire-and-forget. Chosen here (app bootstrap) rather
    // than the chat-list seam so it runs exactly once per launch regardless of
    // which screen first touches the preference service.
    ChatPreferencesService.sweepLegacyEntityPrefs().catch(() => {});
  }, []);

  // Floating chat bubble → when the user taps the bubble, bring the app to
  // the foreground and navigate straight into that conversation.
  useEffect(() => {
    const handleBubbleOpen = (conversation: BubbleConversation | null) => {
      if (!conversation) return;
      setTimeout(() => {
        if (navigationRef.current?.isReady()) {
          navigationRef.current.navigate('ChatDetail', {
            interactionId: conversation.interactionId,
            participantKey: conversation.participantKey,
            participantIds:
              conversation.participantIds ?? [
                conversation.ownEntityId ?? '',
                conversation.entityId,
              ],
            // ChatDetail's `entityId` param is the OWN (impersonated) entity.
            entityId: conversation.ownEntityId ?? conversation.entityId,
            entityName: conversation.entityName,
          });
        }
      }, 150);
    };
    return onBubbleOpen(handleBubbleOpen);
  }, []);

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
        {/* Non-blocking update banner + blocking too-old gate (plan 7-10 §3/§4). */}
        <UpdateBanner />
        <EngineContractGate />
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
                  <AppToastProvider>
                    <SyncConnectionProvider>
                      <EntitySessionProvider>
                        <EmojiProvider>
                          <BiometricLockProvider>
                            <AppShell />
                          </BiometricLockProvider>
                        </EmojiProvider>
                      </EntitySessionProvider>
                    </SyncConnectionProvider>
                  </AppToastProvider>
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
