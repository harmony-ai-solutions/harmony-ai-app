/**
 * @format
 */

// MUST be imported first to provide crypto.getRandomValues() polyfill for uuid
import 'react-native-get-random-values';

import { AppRegistry } from 'react-native';
import App from './App';
import FloatingChat from './src/components/floating/FloatingChat';
import { registerBackupHeadlessTask } from './src/services/backup/backupHeadlessTask';
import { registerIOSLifecycleBridge } from './src/services/engine/IOSLifecycleBridge';
import { attachNativePushTokenSource } from './src/services/notifications/PushTokenStore';
import { attachFirebaseMessaging } from './src/services/notifications/FirebaseMessaging';
import { name as appName } from './app.json';

// Firebase Cloud Messaging (plan 7-12 §3, step 7 — D1=b/D2/D4). Registered
// BEFORE the root component so its background message handler is installed
// early (Android Headless JS / iOS background launch). Fully guarded: with no
// Firebase config (or the committed placeholder) it no-ops and the native
// raw-APNs token seam below stays the fallback.
attachFirebaseMessaging();

AppRegistry.registerComponent(appName, () => App);

// Backup headless task (plan 2-6): lets WorkManager run an automatic backup
// while the app is backgrounded.
registerBackupHeadlessTask();

// iOS blind-tick lifecycle (plan 4-3): bridges OS wakes (silent keepalive push
// + the overnight BGProcessingTask) to the bounded batch / maintenance passes
// and registers the APNs device token with the backend.
registerIOSLifecycleBridge();

// Push-token store (plan 7-12 §5, step 6): feed the single source of truth from
// the native token seam so INIT_ENTITY can carry `push_token` to a directly
// paired engine. Step 7 (Firebase) writes an SDK token into the same store.
attachNativePushTokenSource();

// Floating chat bubble surface — rendered natively as a "display over other
// apps" overlay window when the user taps the chat bubble (see
// ChatBubbleService.FLOATING_CHAT_MODULE). Runs as a second React root sharing
// the same JS runtime + module singletons (EntitySessionService, SQLite, …).
AppRegistry.registerComponent('FloatingChat', () => FloatingChat);
