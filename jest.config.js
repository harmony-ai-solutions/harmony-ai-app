/**
 * Jest configuration (task 3-4: single project).
 *
 * After the TS sync/SQLite stack deletion there is one test project:
 *  - **unit**: Node environment, fast unit tests (src/**).
 *
 * The former `integration` project (the rows-v1 sync-protocol suites under
 * `__tests__/integration/`) is deleted with the sync stack. The
 * `@test-utils/database` mapper pointed at the deleted node SQLite shim.
 *
 * @see docs/TESTING.md for the full testing strategy and run commands.
 */

const transformIgnorePatterns = [
  'node_modules/(?!(react-native|@react-native|@react-navigation|react-native-fs|react-native-keychain|@react-native-documents|react-native-vector-icons|react-native-linear-gradient|react-native-safe-area-context|react-native-screens|react-native-paper|react-native-config|uuid|react-native-track-player|@invertase|@react-native-google-signin|@react-native-community)/)',
];

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
      testPathIgnorePatterns: ['/node_modules/'],
      transformIgnorePatterns,
      setupFiles: ['./jest.setup.js'],
    },
  ],
};
