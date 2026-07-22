/**
 * Jest setup file for mocking React Native modules
 */

// Mock react-native-sqlite-storage
jest.mock('react-native-sqlite-storage', () => ({
  enablePromise: jest.fn(),
  DEBUG: jest.fn(),
  openDatabase: jest.fn(() => Promise.resolve({
    executeSql: jest.fn(() => Promise.resolve([{ rows: { length: 0, item: jest.fn() } }])),
    transaction: jest.fn(),
    close: jest.fn(() => Promise.resolve()),
  })),
}));

// Mock react-native-fs
jest.mock('react-native-fs', () => ({
  DocumentDirectoryPath: '/mock/documents',
  mkdir: jest.fn(() => Promise.resolve()),
  exists: jest.fn(() => Promise.resolve(false)),
  unlink: jest.fn(() => Promise.resolve()),
  readFile: jest.fn(() => Promise.resolve('')),
  writeFile: jest.fn(() => Promise.resolve()),
}));

// Mock react-native-keychain
jest.mock('react-native-keychain', () => ({
  ACCESSIBLE: {
    WHEN_UNLOCKED: 'WhenUnlocked',
  },
  getGenericPassword: jest.fn(() => Promise.resolve(false)),
  setGenericPassword: jest.fn(() => Promise.resolve()),
  resetGenericPassword: jest.fn(() => Promise.resolve()),
}));

// Mock AsyncStorage
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(() => Promise.resolve(null)),
  setItem: jest.fn(() => Promise.resolve()),
  removeItem: jest.fn(() => Promise.resolve()),
  clear: jest.fn(() => Promise.resolve()),
}));

// Mock DocumentPicker
jest.mock('@react-native-documents/picker', () => ({
  pick: jest.fn(() => Promise.resolve([{
    uri: 'file://mock/path/document.json',
    name: 'document.json',
    type: 'application/json',
  }])),
  pickSingle: jest.fn(() => Promise.resolve({
    uri: 'file://mock/path/document.json',
    name: 'document.json',
    type: 'application/json',
  })),
  isErrorWithCode: jest.fn(() => false),
  errorCodes: {
    CANCELED: 'CANCELED',
  },
}));

// Mock React Native Paper
jest.mock('react-native-paper', () => ({
  Provider: ({ children }) => children,
  DefaultTheme: {},
  Switch: 'Switch',
  Button: 'Button',
  Card: 'Card',
  Text: 'Text',
}));

// Mock @react-native-google-signin/google-signin
jest.mock('@react-native-google-signin/google-signin', () => ({
  GoogleSignin: {
    configure: jest.fn(),
    signIn: jest.fn(() => Promise.resolve({ idToken: 'mock-token' })),
    signOut: jest.fn(() => Promise.resolve()),
    hasPlayServices: jest.fn(() => Promise.resolve(true)),
    isSignedIn: jest.fn(() => Promise.resolve(false)),
    getCurrentUser: jest.fn(() => Promise.resolve(null)),
  },
  isSuccessResponse: jest.fn(() => true),
  statusCodes: {
    SIGN_IN_CANCELLED: 'SIGN_IN_CANCELLED',
    IN_PROGRESS: 'IN_PROGRESS',
    PLAY_SERVICES_NOT_AVAILABLE: 'PLAY_SERVICES_NOT_AVAILABLE',
  },
}));

// Mock @invertase/react-native-apple-authentication
jest.mock('@invertase/react-native-apple-authentication', () => ({
  AppleButton: 'AppleButton',
  appleAuth: {
    performRequest: jest.fn(() => Promise.resolve({})),
    getCredentialState: jest.fn(() => Promise.resolve(0)),
  },
}));

// Mock react-native-config
jest.mock('react-native-config', () => ({
  __esModule: true,
  default: {
    APP_ENV: 'test',
    API_BASE_URL: 'https://api.example.com',
  },
}));

// Mock react-native-device-info (prevents NativeEventEmitter error during import)
jest.mock('react-native-device-info', () => ({
  getUniqueId: jest.fn(() => Promise.resolve('test-device-001')),
  getDeviceName: jest.fn(() => Promise.resolve('Test Device')),
  getVersion: jest.fn(() => '1.0.0'),
  getBuildNumber: jest.fn(() => '1'),
}));

// Mock react-native-track-player
jest.mock('react-native-track-player', () => ({
  State: {
    None: 'none',
    Ready: 'ready',
    Playing: 'playing',
    Paused: 'paused',
    Stopped: 'stopped',
    Buffering: 'buffering',
    Connecting: 'connecting',
  },
  Capability: {
    Play: 'play',
    Pause: 'pause',
    Stop: 'stop',
    SeekTo: 'seekTo',
  },
  Track: class Track {},
  addEventListener: jest.fn(),
  setupPlayer: jest.fn(() => Promise.resolve()),
  registerPlaybackService: jest.fn(),
  add: jest.fn(() => Promise.resolve('track-1')),
  play: jest.fn(),
  pause: jest.fn(),
  stop: jest.fn(),
  seekTo: jest.fn(),
  reset: jest.fn(),
  destroy: jest.fn(),
  getQueue: jest.fn(() => Promise.resolve([])),
  skip: jest.fn(),
  skipToNext: jest.fn(),
  skipToPrevious: jest.fn(),
  remove: jest.fn(),
  setVolume: jest.fn(),
  getState: jest.fn(() => Promise.resolve('none')),
  getProgress: jest.fn(() => Promise.resolve({ position: 0, duration: 0, buffered: 0 })),
}));

// Mock music-metadata (ESM-only, can't be loaded by Jest; use virtual:true to bypass resolver)
jest.mock('music-metadata', () => ({
  parseBuffer: jest.fn(() => Promise.resolve({
    format: { duration: 0 },
    common: { title: '', artist: '', album: '' },
  })),
}), { virtual: true });

// Mock react-native-audio-record
jest.mock('react-native-audio-record', () => ({
  init: jest.fn(),
  start: jest.fn(),
  stop: jest.fn(() => Promise.resolve('')),
  on: jest.fn(),
}));

// Mock react-native-image-picker
jest.mock('react-native-image-picker', () => ({
  launchImageLibrary: jest.fn(() => Promise.resolve({ assets: [] })),
  launchCamera: jest.fn(() => Promise.resolve({ assets: [] })),
}));

// Mock @react-native-clipboard/clipboard
jest.mock('@react-native-clipboard/clipboard', () => ({
  getString: jest.fn(() => Promise.resolve('')),
  setString: jest.fn(),
}));

// Mock react-native-vector-icons
jest.mock('react-native-vector-icons/MaterialCommunityIcons', () => 'Icon');

// Mock react-native-websocket-self-signed
jest.mock('react-native-websocket-self-signed', () => ({
  __esModule: true,
  default: jest.fn(() => ({
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    send: jest.fn(),
    close: jest.fn(),
  })),
}));

// Mock react-native Platform (RN 0.86+ exports Platform as `.default` from this module)
jest.mock('react-native/Libraries/Utilities/Platform', () => ({
  __esModule: true,
  default: {
    OS: 'ios',
    select: jest.fn((obj) => obj.ios || obj.default),
  },
}));

// Suppress console warnings in tests
global.console = {
  ...console,
  warn: jest.fn(),
  error: jest.fn(),
};
