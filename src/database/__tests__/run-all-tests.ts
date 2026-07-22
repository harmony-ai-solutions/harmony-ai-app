/**
 * Comprehensive Database Test Runner
 */

import {
  closeDatabase,
  initializeDatabase,
  clearDatabaseData,
} from '../connection';
import {runEntityTests} from './entities.test';
import {runCharacterTests} from './characters.test';
import {runModuleTests} from './modules.test';
import {runProviderTests} from './providers.test';
import {TestResult} from './test-utils';

/**
 * Main test runner
 */
async function runAllTests() {
  console.log('\n');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('     HARMONY AI APP - DATABASE COMPREHENSIVE TEST SUITE');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('\n');

  try {
    await initializeDatabase(true);
    await clearDatabaseData(true);
    console.log('[Test Setup] Initialized and cleaned database');
  } catch (error) {
    console.error('[Test Setup] Failed to initialize database:', error);
    return false;
  }
  
  const results: Record<string, TestResult[]> = {
    entities: [],
    characters: [],
    modules: [],
    providers: [],
  };
  
  try {
    console.log('┌─────────────────────────────────────────────────────────┐');
    console.log('│ Phase 1: Entity Repository Tests                       │');
    console.log('└─────────────────────────────────────────────────────────┘');
    results.entities = await runEntityTests();
    
    console.log('\n┌─────────────────────────────────────────────────────────┐');
    console.log('│ Phase 2: Character Repository Tests                    │');
    console.log('└─────────────────────────────────────────────────────────┘');
    results.characters = await runCharacterTests();
    
    console.log('\n┌─────────────────────────────────────────────────────────┐');
    console.log('│ Phase 3: Module Repository Tests                       │');
    console.log('└─────────────────────────────────────────────────────────┘');
    results.modules = await runModuleTests();
    
    console.log('\n┌─────────────────────────────────────────────────────────┐');
    console.log('│ Phase 4: Provider Repository Tests                     │');
    console.log('└─────────────────────────────────────────────────────────┘');
    results.providers = await runProviderTests();
    
  } catch (error) {
    console.error('\n❌ Test suite failed with critical error:', error);
  } finally {
    try {
      await closeDatabase();
      console.log('\n[Cleanup] Database connection closed');
    } catch (error) {
      console.error('[Cleanup] Failed to close database:', error);
    }
  }
  
  // Print Detailed Summary
  console.log('\n');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('                     DETAILED TEST SUMMARY');
  console.log('═══════════════════════════════════════════════════════════');
  
  let totalTests = 0;
  let totalPassed = 0;
  let totalFailed = 0;

  for (const [phase, phaseResults] of Object.entries(results)) {
    const phasePassed = phaseResults.filter(r => r.passed).length;
    const phaseFailed = phaseResults.filter(r => !r.passed).length;
    const phaseTotal = phaseResults.length;
    
    totalTests += phaseTotal;
    totalPassed += phasePassed;
    totalFailed += phaseFailed;

    console.log(`\n[${phase.toUpperCase()}] (${phasePassed}/${phaseTotal} Passed)`);
    
    phaseResults.forEach(res => {
      const icon = res.passed ? '✅' : '❌';
      const duration = res.duration ? ` (${res.duration}ms)` : '';
      console.log(`  ${icon} ${res.name}${duration}`);
      if (!res.passed && res.error) {
        console.log(`     └─ Error: ${res.error}`);
      }
    });
  }

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log(` TOTAL: ${totalTests} tests | ${totalPassed} passed | ${totalFailed} failed`);
  console.log('═══════════════════════════════════════════════════════════');
  
  if (totalFailed === 0 && totalTests > 0) {
    console.log('\n🎉 All tests PASSED! Database implementation complete.\n');
    return true;
  } else {
    console.log('\n⚠️  Some tests FAILED. Please review the output above.\n');
    return false;
  }
}

export default runAllTests;
