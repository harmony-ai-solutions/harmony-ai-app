/**
 * Jest multi-project configuration.
 *
 * Two projects:
 *  - **unit**:  Node environment, fast unit tests (excludes integration tests)
 *  - **integration**: Node environment, mocks ConnectionManager for sync tests
 *
 * @see docs/TESTING.md for the full testing strategy and run commands.
 */

const transformIgnorePatterns = [
  'node_modules/(?!(react-native|@react-native|@react-navigation|react-native-fs|react-native-keychain|react-native-sqlite-storage|@react-native-documents|react-native-vector-icons|react-native-linear-gradient|react-native-safe-area-context|react-native-screens|react-native-paper|react-native-config|uuid|react-native-track-player|@invertase|@react-native-google-signin|@react-native-community)/)',
];

const moduleNameMapper = {
  '^@test-utils/database$': '<rootDir>/src/database/__test_utils__/testDatabase',
};

module.exports = {
  projects: [
    {
      displayName: 'unit',
      preset: '@react-native/jest-preset',
      testEnvironment: 'node',
      testMatch: [
        '<rootDir>/src/**/*.test.ts',
        '<rootDir>/src/**/*.test.tsx',
        '<rootDir>/__tests__/**/*.test.ts',
        '<rootDir>/__tests__/**/*.test.tsx',
      ],
      testPathIgnorePatterns: [
        '/node_modules/',
        '/__tests__/integration/',
      ],
      transformIgnorePatterns,
      setupFiles: ['./jest.setup.js'],
      moduleNameMapper,
    },
    {
      displayName: 'integration',
      preset: '@react-native/jest-preset',
      testEnvironment: 'node',
      testMatch: ['<rootDir>/__tests__/integration/**/*.test.ts'],
      testPathIgnorePatterns: ['/node_modules/'],
      transformIgnorePatterns,
      setupFiles: ['./jest.setup.js'],
      moduleNameMapper,
    },
  ],
};
