/**
 * Memory Cleanup Tests
 * Tests for orphaned memory cleanup functionality
 */

import {initializeDatabase, clearDatabaseData, getDatabase} from '../connection';
import * as MemoryRepository from '../repositories/memories';
import * as ConversationMessageRepository from '../repositories/conversation_messages';
import * as Entities from '../repositories/entities';
import {cleanupOrphanedMemories} from '../sync';
import {runTestWithCleanup, TestResult} from './test-utils';
import {Memory, ConversationMessage} from '../models';

/**
 * Run all memory cleanup tests
 */
export async function runMemoryCleanupTests(): Promise<TestResult[]> {
  const results: TestResult[] = [];

  try {
    console.log('[Test Setup] Initializing database...');
    await initializeDatabase(true);
    await clearDatabaseData(true);

    // Test 1: Delete orphaned memories
    results.push(
      await runTestWithCleanup('Delete orphaned memories', async () => {
        const db = getDatabase();
        const now = new Date();

        // Create entity
        const entityId = 'test-entity-orphan-' + Date.now();
        await Entities.createEntity({
          id: entityId,
          alias: 'Test Entity',
          character_profile_id: null,
          lifecycle_config: null,
        });

        // Create orphaned memory (no messages)
        const orphanedMemory: Memory = {
          id: 'orphaned-mem-' + Date.now(),
          entity_id: entityId,
          compaction_level: 1,
          content: 'Orphaned memory',
          emotional_state_bits: 0,
          start_date: now,
          end_date: new Date(now.getTime() + 3600000),
          created_at: now,
          updated_at: now,
          deleted_at: null,
        };
        await MemoryRepository.insertMemory(orphanedMemory);

        // Verify memory exists
        const memoriesBefore = await MemoryRepository.getMemoriesForEntity(entityId);
        if (memoriesBefore.length !== 1) {
          throw new Error('Expected 1 memory before cleanup');
        }

        // Run cleanup
        const deletedCount = await cleanupOrphanedMemories();
        if (deletedCount !== 1) {
          throw new Error(`Expected to delete 1 orphaned memory, but deleted ${deletedCount}`);
        }

        // Verify memory is deleted
        const memoriesAfter = await MemoryRepository.getMemoriesForEntity(entityId);
        if (memoriesAfter.length !== 0) {
          throw new Error('Expected 0 memories after cleanup');
        }
      })
    );

    // Test 2: Keep memories with messages
    results.push(
      await runTestWithCleanup('Keep memories with messages', async () => {
        const db = getDatabase();
        const now = new Date();

        // Create entity
        const entityId = 'test-entity-linked-' + Date.now();
        await Entities.createEntity({
          id: entityId,
          alias: 'Test Entity',
          character_profile_id: null,
          lifecycle_config: null,
        });

        // Create memory with message
        const linkedMemory: Memory = {
          id: 'linked-mem-' + Date.now(),
          entity_id: entityId,
          compaction_level: 1,
          content: 'Linked memory',
          emotional_state_bits: 0,
          start_date: now,
          end_date: new Date(now.getTime() + 3600000),
          created_at: now,
          updated_at: now,
          deleted_at: null,
        };
        await MemoryRepository.insertMemory(linkedMemory);

        // Create conversation message linking to the memory
        await ConversationMessageRepository.createConversationMessage({
          id: 'msg-' + Date.now(),
          entity_id: entityId,
          sender_entity_id: entityId,
          session_id: 'session-' + Date.now(),
          content: 'Test message',
          memory_id: linkedMemory.id,
          audio_duration: null,
          message_type: 'text',
          emotional_state_bits: 0,
          is_recon_followup: false,
          is_edited: false,
        });

        // Run cleanup
        const deletedCount = await cleanupOrphanedMemories();
        if (deletedCount !== 0) {
          throw new Error(`Expected to delete 0 memories, but deleted ${deletedCount}`);
        }

        // Verify memory still exists
        const memoriesAfter = await MemoryRepository.getMemoriesForEntity(entityId);
        if (memoriesAfter.length !== 1) {
          throw new Error('Expected 1 memory to remain after cleanup');
        }
      })
    );

    // Test 3: Mixed orphaned and linked memories
    results.push(
      await runTestWithCleanup('Mixed orphaned and linked memories', async () => {
        const db = getDatabase();
        const now = new Date();

        // Create entity
        const entityId = 'test-entity-mixed-' + Date.now();
        await Entities.createEntity({
          id: entityId,
          alias: 'Test Entity',
          character_profile_id: null,
          lifecycle_config: null,
        });

        // Create orphaned memory
        const orphanedMemory: Memory = {
          id: 'orphaned-mem-mixed-' + Date.now(),
          entity_id: entityId,
          compaction_level: 1,
          content: 'Orphaned memory',
          emotional_state_bits: 0,
          start_date: now,
          end_date: new Date(now.getTime() + 3600000),
          created_at: now,
          updated_at: now,
          deleted_at: null,
        };
        await MemoryRepository.insertMemory(orphanedMemory);

        // Create linked memory
        const linkedMemory: Memory = {
          id: 'linked-mem-mixed-' + Date.now(),
          entity_id: entityId,
          compaction_level: 1,
          content: 'Linked memory',
          emotional_state_bits: 0,
          start_date: now,
          end_date: new Date(now.getTime() + 3600000),
          created_at: now,
          updated_at: now,
          deleted_at: null,
        };
        await MemoryRepository.insertMemory(linkedMemory);

        // Create message linking to linked memory
        await ConversationMessageRepository.createConversationMessage({
          id: 'msg-mixed-' + Date.now(),
          entity_id: entityId,
          sender_entity_id: entityId,
          session_id: 'session-' + Date.now(),
          content: 'Test message',
          memory_id: linkedMemory.id,
          audio_duration: null,
          message_type: 'text',
          emotional_state_bits: 0,
          is_recon_followup: false,
          is_edited: false,
        });

        // Run cleanup
        const deletedCount = await cleanupOrphanedMemories();
        if (deletedCount !== 1) {
          throw new Error(`Expected to delete 1 orphaned memory, but deleted ${deletedCount}`);
        }

        // Verify only linked memory remains
        const memoriesAfter = await MemoryRepository.getMemoriesForEntity(entityId);
        if (memoriesAfter.length !== 1) {
          throw new Error('Expected 1 memory to remain after cleanup');
        }
        if (memoriesAfter[0].id !== linkedMemory.id) {
          throw new Error('Expected linked memory to remain, not orphaned');
        }
      })
    );

    // Test 4: Empty database
    results.push(
      await runTestWithCleanup('Empty database cleanup', async () => {
        // Run cleanup on empty database
        const deletedCount = await cleanupOrphanedMemories();
        if (deletedCount !== 0) {
          throw new Error(`Expected to delete 0 memories from empty database, but deleted ${deletedCount}`);
        }
      })
    );

    console.log('[Test Cleanup] Clearing database...');
    await clearDatabaseData(true);

  } catch (error) {
    console.error('[Test Error]', error);
    results.push({
      name: 'Memory Cleanup Tests',
      passed: false,
      error: (error as Error).message || String(error),
    });
  }

  return results;
}