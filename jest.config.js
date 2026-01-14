module.exports = {
  preset: 'react-native',
  transformIgnorePatterns: [
    'node_modules/(?!(react-native|@react-native|@react-navigation|react-native-fs|react-native-keychain|react-native-sqlite-storage|@react-native-documents|react-native-vector-icons|react-native-linear-gradient|react-native-safe-area-context|react-native-screens|react-native-paper)/)',
  ],
  setupFiles: ['./jest.setup.js'],
};
