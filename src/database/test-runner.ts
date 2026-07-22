/**
 * Database Test Runner (for in-app testing)
 *
 * Re-exports the test runner from __tests__ for use in the app bundle.
 * This file exists outside __tests__ because Metro bundler excludes __tests__ directories by default.
 */

import runAllTests from './__tests__/run-all-tests';
export default runAllTests;
