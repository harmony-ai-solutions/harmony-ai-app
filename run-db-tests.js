/**
 * Database Test Runner
 * Simple script to execute the database test suite
 */

// Import the test runner
const runAllTests = require('./src/database/__tests__/run-all-tests.ts').default;

// Execute tests
(async () => {
  try {
    const success = await runAllTests();
    process.exit(success ? 0 : 1);
  } catch (error) {
    console.error('Fatal error running tests:', error);
    process.exit(1);
  }
})();
