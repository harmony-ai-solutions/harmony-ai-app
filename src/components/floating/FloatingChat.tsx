/**
 * FloatingChat — renders the EXACT in-app conversation screen inside the
 * native floating overlay window.
 *
 * This surface is a second React root, so instead of re-implementing the chat
 * UI we mount the real `ChatDetailScreen` and give it a mocked `navigation`
 * (goBack → close the floating window only, the bubble stays) + the real
 * `route.params` from the bubble's conversation payload. The result is
 * pixel-identical to opening the chat in the app — same header, same message
 * stream, same background, and the real `ChatInputBar` that actually sends
 * messages.
 *
 * PROVIDER TREE — why this exact set:
 *   The overlay is a second React root sharing the same JS runtime as the main
 *   app. ChatDetailScreen and its children (ChatBubble, ChatInputBar, modals,
 *   the inline emoji picker) depend on:
 *     - ThemeProvider      → useAppTheme
 *     - I18nProvider       → useTranslation
 *     - EmojiProvider      → useEmojiPreferences / useEmojiRecents (picker)
 *     - PaperProvider      → react-native-paper components
 *     - AppToastProvider   → useToast
 *     - AppAlertProvider   → useAppAlert
 *     - BiometricLockProvider → useBiometricLock (ChatInputBar image/voice)
 *     - SyncConnectionProvider → useSyncConnection
 *     - EntitySessionProvider  → useEntitySession
 *     - NavigationContainer   → useNavigation (PersonaSwitcherModal throws
 *                                without it)
 *   The DatabaseProvider is deliberately NOT re-mounted here: the database is
 *   a module-level singleton already opened by the main root, and
 *   DatabaseProvider's unmount cleanup calls closeDatabase(), which would kill
 *   the shared DB when this overlay closes.
 *
 * THEME-READY GATE — critical:
 *   ChatDetailScreen uses unguarded `theme!` assertions throughout its JSX.
 *   In the main app, AppShell only renders after the theme finished loading.
 *   This overlay therefore waits for useAppTheme().loading === false before
 *   mounting ChatDetailScreen, otherwise the `theme!` crashes at first render
 *   and the whole window shows a render error.
 *
 * Initial props (set natively by ChatBubbleService):
 *   - conversation: JSON string of BubbleConversation
 */

import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer, NavigationContainerRef } from '@react-navigation/native';
import { PaperProvider } from 'react-native-paper';
import { ChatDetailScreen } from '../../screens/ChatDetailScreen';
import { RootStackParamList } from '../../navigation/AppNavigator';
import { ThemeProvider, useAppTheme } from '../../contexts/ThemeContext';
import { I18nProvider } from '../../contexts/I18nContext';
import { EmojiProvider } from '../../contexts/EmojiContext';
import { AppToastProvider } from '../../contexts/AppToastContext';
import { AppAlertProvider } from '../../contexts/AppAlertContext';
import { BiometricLockProvider } from '../../contexts/BiometricLockContext';
import { SyncConnectionProvider } from '../../contexts/SyncConnectionContext';
import { EntitySessionProvider } from '../../contexts/EntitySessionContext';
import { isDatabaseReady } from '../../database';
import { createLogger } from '../../utils/logger';
import { closeBubbleWindow } from '../../services/ChatBubbleService';
import { BubbleConversation } from '../../services/ChatBubbleService';

const log = createLogger('[FloatingChat]');

interface FloatingChatProps {
  conversation?: string | null;
  rootTag?: number;
}

function parseConversation(raw?: string | null): BubbleConversation | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as BubbleConversation;
  } catch (e) {
    log.error('Failed to parse conversation payload:', e);
    return null;
  }
}

/**
 * Inner content — rendered INSIDE ThemeProvider so useAppTheme() works.
 * Waits for the theme to finish loading before mounting ChatDetailScreen
 * (which asserts `theme!` unguarded in several spots).
 */
const FloatingChatContent: React.FC<FloatingChatProps> = ({ conversation }) => {
  const { theme, loading: themeLoading } = useAppTheme();
  const navigationContainerRef =
    useRef<NavigationContainerRef<RootStackParamList> | null>(null);

  // The overlay is a second React root sharing the same JS runtime. The
  // database is a module-level singleton opened by the main root — but the
  // main root may still be initializing it (or not yet mounted) when this
  // overlay mounts. Gate ChatDetailScreen on DB readiness so the "Database
  // not initialized" error never fires.
  //
  // IMPORTANT: never call initializeDatabase() here. The main root owns DB
  // initialization; the overlay calling it again while the main root is mid-
  // migration can deadlock on the SQLite lock and leave the window spinning
  // forever. Instead, poll the shared readiness flag and give up after a
  // short grace so the overlay can never hang.
  const [dbReady, setDbReady] = useState<boolean>(isDatabaseReady());
  useEffect(() => {
    if (isDatabaseReady()) {
      setDbReady(true);
      return;
    }
    let cancelled = false;
    let elapsed = 0;
    const poll = setInterval(() => {
      if (isDatabaseReady()) {
        setDbReady(true);
        clearInterval(poll);
        return;
      }
      elapsed += 300;
      if (elapsed >= 10000) {
        // The main root is still busy (or failed) — render anyway. The screen
        // will retry its queries or show its own error state; a stuck spinner
        // is worse than a brief flash.
        setDbReady(true);
        clearInterval(poll);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearInterval(poll);
    };
  }, []);

  const conv = parseConversation(conversation);
  const entityId = conv?.ownEntityId ?? conv?.entityId ?? '';
  const participantIds =
    conv?.participantIds ?? [entityId, conv?.entityId ?? ''].filter(Boolean);

  const route = {
    key: 'FloatingChat',
    name: 'ChatDetail' as const,
    params: {
      interactionId: conv?.interactionId ?? '',
      participantKey: conv?.participantKey ?? '',
      participantIds,
      entityId, // ChatDetail's entityId = OWN (impersonated) entity
      entityName: conv?.entityName ?? '',
    },
  } as unknown as React.ComponentProps<typeof ChatDetailScreen>['route'];

  const navigation = {
    goBack: () => {
      // Close ONLY the floating window — the bubble must stay visible so the
      // user can tap it again to reopen the window.
      closeBubbleWindow();
    },
    navigate: (..._args: any[]) => {
      // In the overlay there's no stack to navigate within — no-op.
    },
    replace: (..._args: any[]) => {
      // no-op
    },
    push: (..._args: any[]) => {
      // no-op
    },
    popToTop: () => {
      // no-op
    },
    addListener: () => () => {},
    canGoBack: () => false,
    isFocused: () => true,
    dispatch: () => {},
    setOptions: () => {},
    setParams: () => {},
    getState: () => null,
    reset: () => {},
    removeListener: () => {},
    navigateDeprecated: (..._args: any[]) => {},
  } as unknown as React.ComponentProps<typeof ChatDetailScreen>['navigation'];

  if (themeLoading || !theme || !dbReady) {
    // The screen asserts `theme!` and queries the database — do not mount
    // until the theme AND the shared database are ready.
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color="#7c3aed" />
      </View>
    );
  }

  return (
    <NavigationContainer ref={navigationContainerRef}>
      <View style={styles.container}>
        <ChatDetailScreen route={route} navigation={navigation} />
      </View>
    </NavigationContainer>
  );
};

/**
 * The floating surface renders the real ChatDetailScreen with the full
 * provider tree (second React root, same JS runtime as the main app).
 */
const FloatingChat: React.FC<FloatingChatProps> = (props) => {
  return (
    <ThemeProvider>
      <I18nProvider>
        <EmojiProvider>
          <PaperProvider>
            <AppToastProvider>
              <AppAlertProvider>
                <BiometricLockProvider>
                  <SyncConnectionProvider readOnly>
                    <EntitySessionProvider>
                      <SafeAreaProvider>
                        <FloatingChatContent {...props} />
                      </SafeAreaProvider>
                    </EntitySessionProvider>
                  </SyncConnectionProvider>
                </BiometricLockProvider>
              </AppAlertProvider>
            </AppToastProvider>
          </PaperProvider>
        </EmojiProvider>
      </I18nProvider>
    </ThemeProvider>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
});

export default FloatingChat;
