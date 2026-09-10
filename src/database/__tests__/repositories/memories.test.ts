/**
 * Memory Cleanup Tests
 *
 * Ported from the deleted hand-rolled test file. 4 test cases.
 * Tests the cleanupOrphanedMemories function from src/database/sync.ts which
 * deletes memories that have no interactions linked to them (via interactions.memory_id).
 *
 * Uses useFreshDatabase() fixture for per-test DB isolation.
 */

import {useFreshDatabase} from '../repositoryFixtures';
import {createEntity} from '../../repositories/entities';
import {insertMemory, getMemoriesForEntity} from '../../repositories/memories';
import {cleanupOrphanedMemories} from '../../sync';
import type {NodeDatabase} from '../../__test_utils__/nodeDatabase';

describe('memory cleanup', () => {
  const {getDb} = useFreshDatabase();

  it('Delete orphaned memories', async () => {
    const entityId = 'entity-orphan-1';
    await createEntity({id: entityId, character_profile_id: null, alias: '', lifecycle_config: '{}', rag_reindex_required: 1});

    // Insert a memory with NO linked interaction
    await insertMemory({
      id: 'mem-orphan-1',
      entity_id: entityId,
      compaction_level: 1,
      content: 'Orphaned memory content',
      emotional_state_bits: 0,
      start_date: null,
      end_date: null,
      created_at: new Date(),
      updated_at: new Date(),
      deleted_at: null,
    });

    const cleaned = await cleanupOrphanedMemories();
    expect(cleaned).toBe(1);

    const remaining = await getMemoriesForEntity(entityId);
    expect(remaining).toHaveLength(0);
  });

  it('Keep memories with linked interactions', async () => {
    const entityId = 'entity-linked-1';
    await createEntity({id: entityId, character_profile_id: null, alias: '', lifecycle_config: '{}', rag_reindex_required: 1});

    await insertMemory({
      id: 'mem-linked-1',
      entity_id: entityId,
      compaction_level: 1,
      content: 'Linked memory content',
      emotional_state_bits: 0,
      start_date: null,
      end_date: null,
      created_at: new Date(),
      updated_at: new Date(),
      deleted_at: null,
    });

    // Create an interaction linked to the memory (interactions.memory_id)
    const db = getDb();
    await db.executeSql(
      `INSERT INTO interactions (id, entity_id, interaction_scope, participant_ids, status, started_at, last_activity_at, memory_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ['int-linked-1', entityId, 'phone', entityId, 'active', new Date().toISOString(), new Date().toISOString(), 'mem-linked-1', new Date().toISOString(), new Date().toISOString()],
    );

    const cleaned = await cleanupOrphanedMemories();
    expect(cleaned).toBe(0);

    const remaining = await getMemoriesForEntity(entityId);
    expect(remaining).toHaveLength(1);
  });

  it('Mixed orphaned and linked memories', async () => {
    const entityId = 'entity-mixed-1';
    await createEntity({id: entityId, character_profile_id: null, alias: '', lifecycle_config: '{}', rag_reindex_required: 1});

    // Create an orphaned memory (no linked interaction)
    await insertMemory({
      id: 'mem-mixed-orphan',
      entity_id: entityId,
      compaction_level: 1,
      content: 'Orphaned memory',
      emotional_state_bits: 0,
      start_date: null,
      end_date: null,
      created_at: new Date(),
      updated_at: new Date(),
      deleted_at: null,
    });

    // Create a linked memory (with interaction linking via memory_id)
    await insertMemory({
      id: 'mem-mixed-linked',
      entity_id: entityId,
      compaction_level: 1,
      content: 'Linked memory',
      emotional_state_bits: 0,
      start_date: null,
      end_date: null,
      created_at: new Date(),
      updated_at: new Date(),
      deleted_at: null,
    });

    const db = getDb();
    await db.executeSql(
      `INSERT INTO interactions (id, entity_id, interaction_scope, participant_ids, status, started_at, last_activity_at, memory_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ['int-mixed-linked', entityId, 'phone', entityId, 'active', new Date().toISOString(), new Date().toISOString(), 'mem-mixed-linked', new Date().toISOString(), new Date().toISOString()],
    );

    const cleaned = await cleanupOrphanedMemories();
    expect(cleaned).toBe(1);

    const remaining = await getMemoriesForEntity(entityId);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].id).toBe('mem-mixed-linked');
  });

  it('Empty database cleanup', async () => {
    // Run cleanup on a fresh empty DB (no entities, no memories)
    const cleaned = await cleanupOrphanedMemories();
    expect(cleaned).toBe(0);
  });
});
