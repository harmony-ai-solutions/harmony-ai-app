module.exports = {
  preset: '@react-native/jest-preset',
  setupFiles: ['./jest.setup.js'],
  transformIgnorePatterns: [
    'node_modules/(?!(react-native|@react-native|@react-navigation|react-native-fs|react-native-keychain|react-native-sqlite-storage|@react-native-documents|react-native-vector-icons|react-native-linear-gradient|react-native-safe-area-context|react-native-screens|react-native-paper|react-native-config|uuid|react-native-track-player|@invertase|@react-native-google-signin|@react-native-community)/)',
  ],
  moduleNameMapper: {
    '^@test-utils/database$': '<rootDir>/src/database/__test_utils__/testDatabase',
  },
};
