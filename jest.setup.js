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

// Mock react-native-vector-icons
jest.mock('react-native-vector-icons/MaterialCommunityIcons', () => 'Icon');

// Suppress console warnings in tests
global.console = {
  ...console,
  warn: jest.fn(),
  error: jest.fn(),
};
