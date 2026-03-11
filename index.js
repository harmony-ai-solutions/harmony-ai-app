/**
 * @format
 */

// MUST be imported first to provide crypto.getRandomValues() polyfill for uuid
import 'react-native-get-random-values';

import { AppRegistry } from 'react-native';
import App from './App';
import { name as appName } from './app.json';

AppRegistry.registerComponent(appName, () => App);
