/**
 * @format
 */

// MUST be imported first to provide crypto.getRandomValues() polyfill for uuid
import 'react-native-get-random-values';

import { AppRegistry } from 'react-native';
import App from './App';
import FloatingChat from './src/components/floating/FloatingChat';
import { name as appName } from './app.json';

AppRegistry.registerComponent(appName, () => App);

// Floating chat bubble surface — rendered natively as a "display over other
// apps" overlay window when the user taps the chat bubble (see
// ChatBubbleService.FLOATING_CHAT_MODULE). Runs as a second React root sharing
// the same JS runtime + module singletons (EntitySessionService, SQLite, …).
AppRegistry.registerComponent('FloatingChat', () => FloatingChat);
