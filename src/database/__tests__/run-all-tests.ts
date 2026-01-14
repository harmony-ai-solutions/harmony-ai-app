/**
 * Comprehensive Database Test Runner
 * 
 * Runs all database repository tests in sequence
 */

import {closeDatabase} from '../connection';
import {runEntityTests} from './entities.test';
import {runCharacterTests} from './characters.test';
import {runModuleTests} from './modules.test';
import {runProviderTests} from './providers.test';

/**
 * Main test runner
 */
async function runAllTests() {
  console.log('\n');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('     HARMONY AI APP - DATABASE COMPREHENSIVE TEST SUITE');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('\n');
  
  const results = {
    entities: false,
    characters: false,
    modules: false,
    providers: false,
  };
  
  try {
    // Run Entity Tests
    console.log('┌─────────────────────────────────────────────────────────┐');
    console.log('│ Phase 1: Entity Repository Tests                       │');
    console.log('└─────────────────────────────────────────────────────────┘');
    results.entities = await runEntityTests();
    
    // Run Character Tests
    console.log('\n┌─────────────────────────────────────────────────────────┐');
    console.log('│ Phase 2: Character Repository Tests                    │');
    console.log('└─────────────────────────────────────────────────────────┘');
    results.characters = await runCharacterTests();
    
    // Run Module Tests
    console.log('\n┌─────────────────────────────────────────────────────────┐');
    console.log('│ Phase 3: Module Repository Tests                       │');
    console.log('└─────────────────────────────────────────────────────────┘');
    results.modules = await runModuleTests();
    
    // Run Provider Tests
    console.log('\n┌─────────────────────────────────────────────────────────┐');
    console.log('│ Phase 4: Provider Repository Tests                     │');
    console.log('└─────────────────────────────────────────────────────────┘');
    results.providers = await runProviderTests();
    
  } catch (error) {
    console.error('\n❌ Test suite failed with critical error:', error);
  } finally {
    // Close database connection
    try {
      await closeDatabase();
      console.log('\n[Cleanup] Database connection closed');
    } catch (error) {
      console.error('[Cleanup] Failed to close database:', error);
    }
  }
  
  // Print Summary
  console.log('\n');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('                     TEST SUMMARY');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`  Entity Tests:     ${results.entities ? '✅ PASSED' : '❌ FAILED'}`);
  console.log(`  Character Tests:  ${results.characters ? '✅ PASSED' : '❌ FAILED'}`);
  console.log(`  Module Tests:     ${results.modules ? '✅ PASSED' : '❌ FAILED'}`);
  console.log(`  Provider Tests:   ${results.providers ? '✅ PASSED' : '❌ FAILED'}`);
  console.log('═══════════════════════════════════════════════════════════');
  
  const allPassed = Object.values(results).every(result => result === true);
  
  if (allPassed) {
    console.log('\n🎉 All tests PASSED! Database implementation complete.\n');
  } else {
    console.log('\n⚠️  Some tests FAILED. Please review the output above.\n');
  }
  
  return allPassed;
}

// Export for use
export default runAllTests;
