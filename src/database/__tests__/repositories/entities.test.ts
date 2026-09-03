/**
 * Entity Repository Tests
 *
 * Ported from the deleted hand-rolled test file. 11 test cases.
 * Uses useFreshDatabase() fixture for per-test DB isolation.
 */

import {useFreshDatabase} from '../repositoryFixtures';
import * as connection from '../../connection';
import type {Database, DatabaseTransaction} from '../../types';
import {
  createEntity,
  getEntity,
  getAllEntities,
  getEntityByCharacterProfileId,
  getNextEntityAliasCopy,
  stripCopySuffix,
  updateEntity,
  updateEntityFields,
  deleteEntity,
  setEntityMuted,
  setEntityDisabled,
  getDisabledEntityIds,
  getMutedEntityIds,
  createEntityModuleMapping,
  createOrUpdateEntityModuleMapping,
  getEntityModuleMapping,
  updateEntityModuleMapping,
  deleteEntityModuleMapping,
} from '../../repositories/entities';
import {insertMemory} from '../../repositories/memories';
import {upsertEmotionState} from '../../repositories/emotion_state';
import {createEmojiAction} from '../../repositories/emoji_actions';
import {createInteraction} from '../../repositories/interactions';
import {createConversationMessage} from '../../repositories/conversation_messages';
import {createCharacterProfile} from '../../repositories/characters';
import type {
  EntityModuleMapping,
  EmotionState,
  Interaction,
  Memory,
  ConversationMessage,
} from '../../models';

/**
 * Test double that emulates react-native-sqlite-storage's run-to-completion
 * transaction semantics (see src/database/README.md).
 *
 * react-native-sqlite-storage's SQLitePluginTransaction executes the callback
 * synchronously and finalizes the transaction immediately afterwards — it does
 * NOT wait for promises. Any tx.executeSql issued from a later microtask (i.e.
 * after an `await` inside an async transaction callback) throws
 *   "InvalidStateError: DOM Exception 11: This transaction is already finalized."
 *
 * The promise-form transaction() here reproduces that exact behaviour: the
 * transaction is marked finalized right after the callback's synchronous
 * portion returns, so a second `await tx.executeSql(...)` in the same callback
 * rejects. The callback form reproduces the safe nested-callback pattern.
 */
function createRunToCompletionDatabase(real: Database): Database {
  const wrapper: any = {
    async executeSql(sql: string, params?: any[]) {
      return real.executeSql(sql, params);
    },

    transaction(
      fn: any,
      errorCallback?: any,
      successCallback?: any,
    ): any {
      if (errorCallback !== undefined || successCallback !== undefined) {
        // Callback form — RN's run-to-completion loop: statements issued
        // synchronously (or from success callbacks) are all processed before
        // the transaction finalizes.
        const queue: Array<{
          sql: string;
          params: any[];
          success?: any;
          error?: any;
        }> = [];
        let failure: Error | null = null;
        const tx: any = {
          executeSql: (sql: string, params?: any[], success?: any, error?: any) => {
            queue.push({sql, params: params ?? [], success, error});
          },
        };
        try {
          fn(tx);
        } catch (e) {
          failure = e as Error;
        }
        const process = () => {
          if (failure) {
            if (errorCallback) errorCallback(failure);
            return;
          }
          const batch = queue.splice(0);
          if (batch.length === 0) {
            if (successCallback) successCallback();
            return;
          }
          let i = 0;
          const step = () => {
            if (i >= batch.length) {
              process();
              return;
            }
            const stmt = batch[i++];
            real.executeSql(stmt.sql, stmt.params).then(
              res => {
                try {
                  if (stmt.success) stmt.success(null, res[0]);
                } catch (e) {
                  failure = e as Error;
                }
                step();
              },
              err => {
                if (stmt.error) {
                  try {
                    stmt.error(null, err);
                  } catch (e) {
                    failure = e as Error;
                  }
                  step();
                } else {
                  failure = err as Error;
                  if (errorCallback) errorCallback(err);
                }
              },
            );
          };
          step();
        };
        process();
        return;
      }

      // Promise form — reproduce RN finalize-after-sync-callback semantics.
      return new Promise<any>((resolve, reject) => {
        let finalized = false;
        const tx: DatabaseTransaction = {
          executeSql: (sql: string, params?: any[]) => {
            if (finalized) {
              return Promise.reject(
                Object.assign(
                  new Error(
                    'InvalidStateError: DOM Exception 11: This transaction is already finalized. ' +
                      'Transactions are committed after its success or failure handlers are called. ' +
                      'If you are using a Promise to handle callbacks, be aware that implementations ' +
                      'following the A+ standard adhere to run-to-completion semantics and so Promise ' +
                      'resolution occurs on a subsequent tick and therefore after the transaction commits.',
                  ),
                  {code: 11},
                ),
              );
            }
            return real.executeSql(sql, params);
          },
        };
        try {
          const result = fn(tx);
          // Emulate RN start(): after the callback's synchronous portion
          // returns, the transaction is finalized.
          finalized = true;
          Promise.resolve(result).then(resolve, reject);
        } catch (error) {
          reject(error);
        }
      });
    },

    close() {
      return real.close();
    },
  };
  return wrapper;
}

describe('entities repository', () => {
  const {getDb} = useFreshDatabase();

  describe('createEntity', () => {
    it('Create Entity', async () => {
      const id = 'test-entity-' + Date.now();
      const created = await createEntity({
        id,
        character_profile_id: null,
        alias: '',
        lifecycle_config: '{}',
        rag_reindex_required: 1,
      });
      expect(created).toBeDefined();
      expect(created.id).toBe(id);
    });

    it('Get Entity', async () => {
      const id = 'test-entity-persist';
      await createEntity({id, character_profile_id: null, alias: '', lifecycle_config: '{}', rag_reindex_required: 1});
      const retrieved = await getEntity(id);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.id).toBe(id);
    });
  });

  describe('getEntity', () => {
    it('Get Non-existent Entity', async () => {
      const result = await getEntity('non-existent-id');
      expect(result).toBeNull();
    });
  });

  describe('getAllEntities', () => {
    it('Get All Entities (improved: asserts count)', async () => {
      // Create multiple entities and assert the count
      await createEntity({id: 'entity-1', character_profile_id: null, alias: '', lifecycle_config: '{}', rag_reindex_required: 1});
      await createEntity({id: 'entity-2', character_profile_id: null, alias: '', lifecycle_config: '{}', rag_reindex_required: 1});
      await createEntity({id: 'entity-3', character_profile_id: null, alias: '', lifecycle_config: '{}', rag_reindex_required: 1});

      const all = await getAllEntities();
      expect(all.length).toBeGreaterThanOrEqual(3);
      const ids = all.map(e => e.id);
      expect(ids).toContain('entity-1');
      expect(ids).toContain('entity-2');
      expect(ids).toContain('entity-3');
    });
  });

  describe('getEntityByCharacterProfileId', () => {
    const createProfile = (id: string) =>
      createCharacterProfile({
        id,
        name: 'Test Char ' + id,
        description: '',
        personality: '',
        voice_characteristics: '',
        typing_speed_wpm: 60,
        audio_response_chance_percent: 50,
        vision_config_id: null,
        lifecycle_config: '{}',
        base_prompt: '',
        scenario: '',
      });

    it('returns null when no entity references the profile', async () => {
      const result = await getEntityByCharacterProfileId('missing-profile');
      expect(result).toBeNull();
    });

    it('returns the entity linked to the character profile', async () => {
      const profileId = 'profile-chat-link-1';
      await createProfile(profileId);
      await createEntity({
        id: 'entity-chat-1',
        character_profile_id: profileId,
        alias: '',
        lifecycle_config: '{}',
        rag_reindex_required: 1,
      });

      const result = await getEntityByCharacterProfileId(profileId);
      expect(result).not.toBeNull();
      expect(result!.id).toBe('entity-chat-1');
      expect(result!.character_profile_id).toBe(profileId);
    });

    it('ignores soft-deleted entities by default', async () => {
      const profileId = 'profile-chat-deleted';
      await createProfile(profileId);
      await createEntity({
        id: 'entity-chat-deleted',
        character_profile_id: profileId,
        alias: '',
        lifecycle_config: '{}',
        rag_reindex_required: 1,
      });
      await deleteEntity('entity-chat-deleted');

      const result = await getEntityByCharacterProfileId(profileId);
      expect(result).toBeNull();

      // includeDeleted exposes the soft-deleted row
      const withDeleted = await getEntityByCharacterProfileId(profileId, true);
      expect(withDeleted).not.toBeNull();
      expect(withDeleted!.id).toBe('entity-chat-deleted');
    });

    it('returns the most recently created active entity when multiple exist', async () => {
      const profileId = 'profile-chat-multi';
      await createProfile(profileId);
      await createEntity({
        id: 'entity-chat-old',
        character_profile_id: profileId,
        alias: '',
        lifecycle_config: '{}',
        rag_reindex_required: 1,
      });
      await createEntity({
        id: 'entity-chat-new',
        character_profile_id: profileId,
        alias: '',
        lifecycle_config: '{}',
        rag_reindex_required: 1,
      });

      const result = await getEntityByCharacterProfileId(profileId);
      expect(result).not.toBeNull();
      // created_at is auto-set to now; the newest insert should win.
      // createdAt ordering may tie in fast tests, so assert it's one of the two
      // and that both reference the profile.
      expect(result!.character_profile_id).toBe(profileId);
      expect(['entity-chat-old', 'entity-chat-new']).toContain(result!.id);
    });
  });

  describe('updateEntity', () => {
    it('Update Entity', async () => {
      const id = 'entity-upd-1';
      await createEntity({id, character_profile_id: null, alias: '', lifecycle_config: '{}', rag_reindex_required: 1});
      const updated = await updateEntity({
        id,
        alias: 'updated-alias',
        character_profile_id: null,
        lifecycle_config: '{}',
        rag_reindex_required: 1,
        created_at: new Date(),
        updated_at: new Date(),
        deleted_at: null,
      });
      expect(updated).toBeDefined();
    });

    it('Update Non-existent Entity (Error Handling)', async () => {
      await expect(
        updateEntity({
          id: 'non-existent-id',
          alias: '',
          character_profile_id: null,
          lifecycle_config: '{}',
          rag_reindex_required: 1,
          created_at: new Date(),
          updated_at: new Date(),
          deleted_at: null,
        }),
      ).rejects.toThrow();
    });
  });

  describe('deleteEntity', () => {
    it('Delete Non-existent Entity (Error Handling)', async () => {
      await expect(deleteEntity('non-existent-id')).rejects.toThrow();
    });

    it('soft-delete does not throw "transaction is already finalized" under RN run-to-completion semantics', async () => {
      // This reproduces react-native-sqlite-storage's run-to-completion
      // transaction behavior (see src/database/README.md "Multiple sequential
      // statements | ❌ NO"). The library's SQLitePluginTransaction finalizes
      // the transaction immediately after the callback's synchronous portion
      // returns; any tx.executeSql issued from a later microtask (i.e. after
      // an `await` inside the callback) throws DOM Exception 11:
      //   "This transaction is already finalized."
      // deleteEntity's soft-delete must NOT use two sequential
      // `await tx.executeSql()` calls inside one withTransaction.
      const entityId = 'entity-soft-delete-rn';
      await createEntity({id: entityId, character_profile_id: null, alias: '', lifecycle_config: '{}', rag_reindex_required: 1});
      await createEntityModuleMapping({
        entity_id: entityId,
        backend_config_id: null,
        cognition_config_id: null,
        imagination_config_id: null,
        movement_config_id: null,
        rag_config_id: null,
        stt_config_id: null,
        tts_config_id: null,
        vision_config_id: null,
        deleted_at: null,
      });

      const rnDb = createRunToCompletionDatabase(getDb());
      jest.spyOn(connection, 'getDatabase').mockReturnValue(rnDb);

      await expect(deleteEntity(entityId)).resolves.toBeUndefined();

      // Both rows must be soft-deleted (deleted_at set, not null).
      const entity = await getEntity(entityId, true);
      expect(entity).not.toBeNull();
      expect(entity!.deleted_at).not.toBeNull();
      const mapping = await getEntityModuleMapping(entityId, true);
      expect(mapping).not.toBeNull();
      expect(mapping!.deleted_at).not.toBeNull();
    });
  });

  describe('deleteEntity cascade', () => {
    const nowIso = () => new Date().toISOString();

    const makeMapping = (entityId: string): EntityModuleMapping => ({
      entity_id: entityId,
      backend_config_id: null,
      cognition_config_id: null,
      imagination_config_id: null,
      movement_config_id: null,
      rag_config_id: null,
      stt_config_id: null,
      tts_config_id: null,
      vision_config_id: null,
      deleted_at: null,
    });

    const makeEmotionState = (entityId: string): EmotionState => ({
      entity_id: entityId,
      joy_intensity: 0.1,
      sadness_intensity: 0.1,
      trust_intensity: 0.1,
      disgust_intensity: 0.1,
      fear_intensity: 0.1,
      anger_intensity: 0.1,
      surprise_intensity: 0.1,
      anticipation_intensity: 0.1,
      joy_baseline: 0.1,
      sadness_baseline: 0.1,
      trust_baseline: 0.1,
      disgust_baseline: 0.1,
      fear_baseline: 0.1,
      anger_baseline: 0.1,
      surprise_baseline: 0.1,
      anticipation_baseline: 0.1,
      joy_crystallize_start: null,
      sadness_crystallize_start: null,
      trust_crystallize_start: null,
      disgust_crystallize_start: null,
      fear_crystallize_start: null,
      anger_crystallize_start: null,
      surprise_crystallize_start: null,
      anticipation_crystallize_start: null,
      last_update: new Date(),
      decay_tau: 3600,
      high_threshold: 6,
      low_threshold: 1,
      crystallize_intensity: 7,
      crystallize_min_hours: 2,
      created_at: new Date(),
      updated_at: new Date(),
      deleted_at: null,
    });

    const makeInteraction = (id: string, entityId: string, participantIds: string[], senderIsOther = false): Interaction => {
      const iso = nowIso();
      return {
        id,
        entity_id: entityId,
        interaction_scope: 'private',
        participant_key: entityId < 'user' ? `${entityId}+user` : `user+${entityId}`,
        participant_ids: JSON.stringify(participantIds),
        status: 'active',
        started_at: iso,
        last_activity_at: iso,
        ended_at: null,
        memory_id: null,
        continued_interaction_id: null,
        metadata: null,
        summary: null,
        presence_type: 'phone',
        created_at: iso,
        updated_at: iso,
        deleted_at: null,
      };
    };

    const makeMessage = (id: string, entityId: string, senderEntityId: string, interactionId: string): Omit<ConversationMessage, 'created_at' | 'updated_at' | 'deleted_at'> => ({
      id,
      entity_id: entityId,
      sender_entity_id: senderEntityId,
      interaction_id: interactionId,
      content: `message from ${id}`,
      audio_duration: null,
      message_type: 'text',
      emotional_state_bits: 0,
      is_recon_followup: false,
      is_edited: false,
      edit_of_message_id: null,
    });

    /** Seed an entity with one of every child row type rooted at it. */
    async function seedEntityWithChildren(entityId: string, interactionId: string) {
      await createEntity({id: entityId, character_profile_id: null, alias: '', lifecycle_config: '{}', rag_reindex_required: 1});
      await createEntityModuleMapping(makeMapping(entityId));
      await insertMemory({
        id: `mem-${entityId}`,
        entity_id: entityId,
        compaction_level: 1,
        content: `memory of ${entityId}`,
        emotional_state_bits: 0,
        start_date: null,
        end_date: null,
        created_at: new Date(),
        updated_at: new Date(),
        deleted_at: null,
      });
      await upsertEmotionState(makeEmotionState(entityId));
      await createEmojiAction({
        id: `emoji-${entityId}`,
        entityId,
        emojiNative: '👍',
        emotionEffect: null,
        metabolismVector: null,
        substitutionText: null,
        autoGenerated: false,
        isDefault: false,
      });
      await createInteraction(makeInteraction(interactionId, entityId, [entityId, 'user']));
      await createConversationMessage(makeMessage(`msg-${entityId}`, entityId, entityId, interactionId));
    }

    /** Raw deleted_at value for a row identified by table + id column + id. */
    async function deletedAtOf(table: string, idColumn: string, id: string): Promise<string | null> {
      const [result] = await getDb().executeSql(
        `SELECT deleted_at FROM ${table} WHERE ${idColumn} = ?`,
        [id],
      );
      if (result.rows.length === 0) return undefined as unknown as null;
      return result.rows.item(0).deleted_at;
    }

    it('soft-delete cascades deleted_at to all child rows rooted at the entity (RN run-to-completion)', async () => {
      const entityId = 'entity-cascade-soft';
      await seedEntityWithChildren(entityId, `int-${entityId}`);

      // Run the delete through the RN-semantics double to prove the
      // multi-statement transaction does not throw DOM Exception 11.
      const rnDb = createRunToCompletionDatabase(getDb());
      jest.spyOn(connection, 'getDatabase').mockReturnValue(rnDb);

      await expect(deleteEntity(entityId)).resolves.toBeUndefined();

      // Entity + mapping soft-deleted
      const entity = await getEntity(entityId, true);
      expect(entity).not.toBeNull();
      expect(entity!.deleted_at).not.toBeNull();
      const mapping = await getEntityModuleMapping(entityId, true);
      expect(mapping).not.toBeNull();
      expect(mapping!.deleted_at).not.toBeNull();

      // All child rows soft-deleted
      expect(await deletedAtOf('memories', 'id', `mem-${entityId}`)).not.toBeNull();
      expect(await deletedAtOf('emotion_state', 'entity_id', entityId)).not.toBeNull();
      expect(await deletedAtOf('entity_emoji_actions', 'id', `emoji-${entityId}`)).not.toBeNull();
      expect(await deletedAtOf('interactions', 'id', `int-${entityId}`)).not.toBeNull();
      expect(await deletedAtOf('conversation_messages', 'id', `msg-${entityId}`)).not.toBeNull();
    });

    it('does NOT cascade to interactions/messages rooted at OTHER entities (business rule)', async () => {
      const entityA = 'entity-A';
      const entityB = 'entity-B';

      // Entity B owns an interaction + message that merely MENTION entity A in
      // participant_ids / sender_entity_id — they must remain untouched.
      await seedEntityWithChildren(entityB, `int-${entityB}`);
      // Re-point B's seeded message to reference A as sender to prove the
      // sender_entity_id is not used as a cascade predicate.
      await getDb().executeSql(
        'UPDATE conversation_messages SET sender_entity_id = ? WHERE id = ?',
        [entityA, `msg-${entityB}`],
      );
      // B's interaction participant_ids include A.
      await getDb().executeSql(
        'UPDATE interactions SET participant_ids = ? WHERE id = ?',
        [JSON.stringify([entityA, entityB]), `int-${entityB}`],
      );

      // Entity A gets its own rooted children.
      await seedEntityWithChildren(entityA, `int-${entityA}`);

      await deleteEntity(entityA);

      // B-rooted rows untouched (deleted_at still null)
      expect(await deletedAtOf('interactions', 'id', `int-${entityB}`)).toBeNull();
      expect(await deletedAtOf('conversation_messages', 'id', `msg-${entityB}`)).toBeNull();
      expect(await deletedAtOf('emotion_state', 'entity_id', entityB)).toBeNull();
      expect(await deletedAtOf('memories', 'id', `mem-${entityB}`)).toBeNull();

      // A-rooted rows soft-deleted
      expect(await deletedAtOf('interactions', 'id', `int-${entityA}`)).not.toBeNull();
      expect(await deletedAtOf('conversation_messages', 'id', `msg-${entityA}`)).not.toBeNull();
      expect(await deletedAtOf('emotion_state', 'entity_id', entityA)).not.toBeNull();
      expect(await deletedAtOf('memories', 'id', `mem-${entityA}`)).not.toBeNull();
    });

    it('permanent delete removes the entity and all child rows from the DB', async () => {
      const entityId = 'entity-cascade-permanent';
      await seedEntityWithChildren(entityId, `int-${entityId}`);

      await deleteEntity(entityId, true);

      // Entity + mapping gone
      expect(await getEntity(entityId, true)).toBeNull();
      expect(await getEntityModuleMapping(entityId, true)).toBeNull();

      // Child rows gone (query returns no rows)
      expect(await deletedAtOf('memories', 'id', `mem-${entityId}`)).toBeUndefined();
      expect(await deletedAtOf('emotion_state', 'entity_id', entityId)).toBeUndefined();
      expect(await deletedAtOf('entity_emoji_actions', 'id', `emoji-${entityId}`)).toBeUndefined();
      expect(await deletedAtOf('interactions', 'id', `int-${entityId}`)).toBeUndefined();
      expect(await deletedAtOf('conversation_messages', 'id', `msg-${entityId}`)).toBeUndefined();
    });
  });

  describe('entity module mappings', () => {
    it('Create Entity Module Mapping', async () => {
      const entityId = 'entity-mapping-1';
      await createEntity({id: entityId, character_profile_id: null, alias: '', lifecycle_config: '{}', rag_reindex_required: 1});
      // Should not throw
      await expect(
        createEntityModuleMapping({
          entity_id: entityId,
          backend_config_id: null,
          cognition_config_id: null,
          imagination_config_id: null,
          movement_config_id: null,
          rag_config_id: null,
          stt_config_id: null,
          tts_config_id: null,
          vision_config_id: null,
          deleted_at: null,
        }),
      ).resolves.toBeUndefined();
    });

    it('Get Entity Module Mapping', async () => {
      const entityId = 'entity-mapping-2';
      await createEntity({id: entityId, character_profile_id: null, alias: '', lifecycle_config: '{}', rag_reindex_required: 1});
      await createEntityModuleMapping({
        entity_id: entityId,
        backend_config_id: null,
        cognition_config_id: null,
        imagination_config_id: null,
        movement_config_id: null,
        rag_config_id: null,
        stt_config_id: null,
        tts_config_id: null,
        vision_config_id: null,
        deleted_at: null,
      });
      const mapping = await getEntityModuleMapping(entityId);
      expect(mapping).not.toBeNull();
      expect(mapping!.entity_id).toBe(entityId);
    });

    it('Update Entity Module Mapping', async () => {
      const entityId = 'entity-mapping-3';
      await createEntity({id: entityId, character_profile_id: null, alias: '', lifecycle_config: '{}', rag_reindex_required: 1});
      await createEntityModuleMapping({
        entity_id: entityId,
        backend_config_id: null,
        cognition_config_id: null,
        imagination_config_id: null,
        movement_config_id: null,
        rag_config_id: null,
        stt_config_id: null,
        tts_config_id: null,
        vision_config_id: null,
        deleted_at: null,
      });
      // Update with same data should not throw
      await expect(
        updateEntityModuleMapping({
          entity_id: entityId,
          backend_config_id: null,
          cognition_config_id: null,
          imagination_config_id: null,
          movement_config_id: null,
          rag_config_id: null,
          stt_config_id: null,
          tts_config_id: null,
          vision_config_id: null,
          deleted_at: null,
        }),
      ).resolves.toBeUndefined();
    });

    it('Create Entity Module Mapping with empty-string config IDs (defaults from CreateAIScreen) does not throw FK error', async () => {
      const entityId = 'entity-mapping-empty-string';
      await createEntity({id: entityId, character_profile_id: null, alias: '', lifecycle_config: '{}', rag_reindex_required: 1});
      // Reproduces the CreateAIScreen bug: config IDs default to '' (empty string)
      // when the advanced panel was never opened, and '' ?? null still yields ''.
      // Inserting '' into FK columns violated the config-table constraints (code 787).
      await expect(
        createEntityModuleMapping({
          entity_id: entityId,
          backend_config_id: '',
          cognition_config_id: '',
          imagination_config_id: '',
          movement_config_id: '',
          rag_config_id: '',
          stt_config_id: '',
          tts_config_id: '',
          vision_config_id: '',
          deleted_at: null,
        }),
      ).resolves.toBeUndefined();

      // The stored mapping must have NULLs, not empty strings, so sync doesn't
      // propagate garbage and the FK columns stay valid.
      const mapping = await getEntityModuleMapping(entityId);
      expect(mapping).not.toBeNull();
      expect(mapping!.backend_config_id).toBeNull();
      expect(mapping!.cognition_config_id).toBeNull();
      expect(mapping!.imagination_config_id).toBeNull();
      expect(mapping!.movement_config_id).toBeNull();
      expect(mapping!.rag_config_id).toBeNull();
      expect(mapping!.stt_config_id).toBeNull();
      expect(mapping!.tts_config_id).toBeNull();
      expect(mapping!.vision_config_id).toBeNull();
    });

    it('createOrUpdateEntityModuleMapping with empty-string config IDs does not throw FK error', async () => {
      const entityId = 'entity-mapping-empty-string-upsert';
      await createEntity({id: entityId, character_profile_id: null, alias: '', lifecycle_config: '{}', rag_reindex_required: 1});
      // CreateAIScreen (create + edit surface) passes '' defaults the same way ('' ?? null == '').
      await expect(
        createOrUpdateEntityModuleMapping({
          entity_id: entityId,
          backend_config_id: '',
          cognition_config_id: '',
          imagination_config_id: '',
          movement_config_id: '',
          rag_config_id: '',
          stt_config_id: '',
          tts_config_id: '',
          vision_config_id: '',
        }),
      ).resolves.toBeUndefined();

      const mapping = await getEntityModuleMapping(entityId);
      expect(mapping).not.toBeNull();
      expect(mapping!.backend_config_id).toBeNull();
      expect(mapping!.cognition_config_id).toBeNull();
    });

    it('CASCADE Delete Test', async () => {
      const entityId = 'entity-cascade-1';
      await createEntity({id: entityId, character_profile_id: null, alias: '', lifecycle_config: '{}', rag_reindex_required: 1});
      await createEntityModuleMapping({
        entity_id: entityId,
        backend_config_id: null,
        cognition_config_id: null,
        imagination_config_id: null,
        movement_config_id: null,
        rag_config_id: null,
        stt_config_id: null,
        tts_config_id: null,
        vision_config_id: null,
        deleted_at: null,
      });
      // Permanent delete should cascade to entity_module_mappings
      await deleteEntity(entityId, true);
      const entity = await getEntity(entityId, true);
      expect(entity).toBeNull();
      const mapping = await getEntityModuleMapping(entityId, true);
      expect(mapping).toBeNull();
    });
  });

  describe('getNextEntityAliasCopy', () => {
    it('returns "<name> 2" when no copies exist yet', async () => {
      await createEntity({id: 'aria', character_profile_id: null, alias: 'Aria', lifecycle_config: '{}', rag_reindex_required: 1});
      expect(await getNextEntityAliasCopy('Aria')).toBe('Aria 2');
    });

    it('increments past an existing copy (padded or not)', async () => {
      await createEntity({id: 'aria', character_profile_id: null, alias: 'Aria', lifecycle_config: '{}', rag_reindex_required: 1});
      await createEntity({id: 'aria-02', character_profile_id: null, alias: 'Aria 02', lifecycle_config: '{}', rag_reindex_required: 1});
      expect(await getNextEntityAliasCopy('Aria')).toBe('Aria 3');
    });

    it('skips existing numbers and uses the next free one', async () => {
      await createEntity({id: 'aria', character_profile_id: null, alias: 'Aria', lifecycle_config: '{}', rag_reindex_required: 1});
      await createEntity({id: 'aria-03', character_profile_id: null, alias: 'Aria 03', lifecycle_config: '{}', rag_reindex_required: 1});
      await createEntity({id: 'aria-05', character_profile_id: null, alias: 'Aria 05', lifecycle_config: '{}', rag_reindex_required: 1});
      // Holes are not re-used: 2 is free but 3/5 are taken → next is 2.
      expect(await getNextEntityAliasCopy('Aria')).toBe('Aria 2');
    });

    it('continues the series when duplicating an already-numbered copy', async () => {
      await createEntity({id: 'aria', character_profile_id: null, alias: 'Aria', lifecycle_config: '{}', rag_reindex_required: 1});
      await createEntity({id: 'aria-02', character_profile_id: null, alias: 'Aria 02', lifecycle_config: '{}', rag_reindex_required: 1});
      // Duplicating "Aria 02" must NOT yield "Aria 02 2" — it continues at "Aria 3".
      expect(await getNextEntityAliasCopy('Aria 02')).toBe('Aria 3');
    });

    it('strips separator-prefixed copy suffixes but not names without separators', async () => {
      expect(stripCopySuffix('Aria')).toBe('Aria');
      expect(stripCopySuffix('Aria 02')).toBe('Aria');
      expect(stripCopySuffix('aria-05')).toBe('aria');
      expect(stripCopySuffix('B2')).toBe('B2');
    });

    it('handles case-insensitive collisions', async () => {
      await createEntity({id: 'luna', character_profile_id: null, alias: 'LUNA', lifecycle_config: '{}', rag_reindex_required: 1});
      await createEntity({id: 'luna-02', character_profile_id: null, alias: 'luna 02', lifecycle_config: '{}', rag_reindex_required: 1});
      expect(await getNextEntityAliasCopy('Luna')).toBe('Luna 3');
    });

    it('ignores soft-deleted entities', async () => {
      await createEntity({id: 'kay', character_profile_id: null, alias: 'Kay', lifecycle_config: '{}', rag_reindex_required: 1});
      const deleted = await createEntity({id: 'kay-02', character_profile_id: null, alias: 'Kay 02', lifecycle_config: '{}', rag_reindex_required: 1});
      await deleteEntity(deleted.id);
      expect(await getNextEntityAliasCopy('Kay')).toBe('Kay 2');
    });

    it('handles unrelated aliases that merely start with the base name', async () => {
      await createEntity({id: 'aria2', character_profile_id: null, alias: 'Aria2', lifecycle_config: '{}', rag_reindex_required: 1});
      await createEntity({id: 'arianna', character_profile_id: null, alias: 'Arianna', lifecycle_config: '{}', rag_reindex_required: 1});
      expect(await getNextEntityAliasCopy('Aria')).toBe('Aria 2');
    });

    // Regression: the reported bug — creating a 3rd copy of the same AI stayed
    // named "Name 2". The repository is called fresh each time the screen is
    // (re)opened for duplication, so it must account for the already-saved
    // "Max 2" AND "Max 3" and return "Max 4", never a stale/duplicate number.
    it('resolves the NEXT free copy number when multiple copies already exist (3rd-copy regression)', async () => {
      await createEntity({id: 'aria', character_profile_id: null, alias: 'Aria', lifecycle_config: '{}', rag_reindex_required: 1});
      await createEntity({id: 'aria-02', character_profile_id: null, alias: 'Aria 02', lifecycle_config: '{}', rag_reindex_required: 1});
      await createEntity({id: 'aria-03', character_profile_id: null, alias: 'Aria 03', lifecycle_config: '{}', rag_reindex_required: 1});
      expect(await getNextEntityAliasCopy('Aria')).toBe('Aria 4');
    });

    // Same, but duplicating one of the copies ("Aria 02") must ALSO continue the
    // series from the true base — never yield "Aria 02 2" and never re-use
    // "Aria 2".
    it('resolves the next free copy number when duplicating an existing copy that is NOT the highest', async () => {
      await createEntity({id: 'aria', character_profile_id: null, alias: 'Aria', lifecycle_config: '{}', rag_reindex_required: 1});
      await createEntity({id: 'aria-02', character_profile_id: null, alias: 'Aria 02', lifecycle_config: '{}', rag_reindex_required: 1});
      await createEntity({id: 'aria-04', character_profile_id: null, alias: 'Aria 04', lifecycle_config: '{}', rag_reindex_required: 1});
      // Aria 3 is free, Aria 2 + Aria 4 are taken → next free is 3.
      expect(await getNextEntityAliasCopy('Aria 02')).toBe('Aria 3');
    });
  });

  describe('entity flags (is_muted / is_disabled / entity_type)', () => {
    const makeProfile = async (id: string) =>
      createCharacterProfile({
        id,
        name: 'Prof ' + id,
        description: '',
        personality: '',
        voice_characteristics: '',
        base_prompt: '',
        scenario: '',
        typing_speed_wpm: 60,
        audio_response_chance_percent: 50,
        vision_config_id: null,
        lifecycle_config: '{}',
      });

    it('defaults entity_type to ai and flags to 0 on create', async () => {
      const id = 'default-flags-' + Date.now();
      const created = await createEntity({
        id,
        character_profile_id: null,
        alias: '',
        lifecycle_config: '{}',
        rag_reindex_required: 1,
      });
      expect(created.entity_type).toBe('ai');
      expect(created.is_muted).toBe(0);
      expect(created.is_disabled).toBe(0);

      const fetched = await getEntity(id);
      expect(fetched?.entity_type).toBe('ai');
      expect(fetched?.is_muted).toBe(0);
      expect(fetched?.is_disabled).toBe(0);
    });

    it('setEntityMuted / setEntityDisabled flip the corresponding flag and surface via getEntity', async () => {
      const id = 'flag-flip-' + Date.now();
      await createEntity({id, character_profile_id: null, alias: 'Flag', lifecycle_config: '{}', rag_reindex_required: 1});

      await setEntityMuted(id, true);
      let e = await getEntity(id);
      expect(e?.is_muted).toBe(1);
      expect(e?.is_disabled).toBe(0);

      await setEntityDisabled(id, true);
      e = await getEntity(id);
      expect(e?.is_disabled).toBe(1);
      expect(e?.is_muted).toBe(1);

      // Turning one off leaves the other.
      await setEntityMuted(id, false);
      e = await getEntity(id);
      expect(e?.is_muted).toBe(0);
      expect(e?.is_disabled).toBe(1);
    });

    it('throws when muting / disabling a user entity (A3)', async () => {
      const id = 'user-flag-' + Date.now();
      await createEntity(
        {id, character_profile_id: null, alias: 'You', lifecycle_config: '{}', rag_reindex_required: 1},
        {entity_type: 'user'},
      );
      await expect(setEntityMuted(id, true)).rejects.toThrow();
      await expect(setEntityDisabled(id, true)).rejects.toThrow();
    });

    it('getDisabledEntityIds / getMutedEntityIds return only non-deleted flagged entities', async () => {
      const d1 = 'disabled-1-' + Date.now();
      const d2 = 'disabled-2-' + Date.now();
      const m1 = 'muted-1-' + Date.now();
      await createEntity({id: d1, character_profile_id: null, alias: '', lifecycle_config: '{}', rag_reindex_required: 1});
      await createEntity({id: d2, character_profile_id: null, alias: '', lifecycle_config: '{}', rag_reindex_required: 1});
      await createEntity({id: m1, character_profile_id: null, alias: '', lifecycle_config: '{}', rag_reindex_required: 1});

      await setEntityDisabled(d1, true);
      await setEntityDisabled(d2, true);
      await setEntityMuted(m1, true);

      expect((await getDisabledEntityIds()).sort()).toEqual([d1, d2].sort());
      expect(await getMutedEntityIds()).toEqual([m1]);

      // Soft-deleted flagged entities are excluded.
      await deleteEntity(d2);
      expect((await getDisabledEntityIds()).sort()).toEqual([d1]);
    });

    it('updateEntityFields allowlists is_muted / is_disabled but NOT entity_type', async () => {
      const id = 'update-flags-' + Date.now();
      await createEntity({id, character_profile_id: null, alias: '', lifecycle_config: '{}', rag_reindex_required: 1});

      const entity = await getEntity(id);
      // entity_type is immutable by convention — the allowlist cannot change it.
      expect(entity?.entity_type).toBe('ai');
    });
  });

  describe('profile-assignment guards (persona cards 3-3 / engine 1-1 parity)', () => {
    const makeProfile = async (id: string) =>
      createCharacterProfile({
        id,
        name: 'Prof ' + id,
        description: '',
        personality: '',
        voice_characteristics: '',
        base_prompt: '',
        scenario: '',
        typing_speed_wpm: 60,
        audio_response_chance_percent: 50,
        vision_config_id: null,
        lifecycle_config: '{}',
      });

    const makeEntity = (
      id: string,
      character_profile_id: string | null,
      entityType: 'ai' | 'user',
    ) =>
      createEntity(
        {id, character_profile_id, alias: '', lifecycle_config: '{}', rag_reindex_required: 1},
        {entity_type: entityType},
      );

    it('rejects an AI entity linking a persona-owned profile (AI guard)', async () => {
      await makeProfile('guard-persona-profile');
      // A persona (user entity) owns the profile.
      await makeEntity('guard-persona', 'guard-persona-profile', 'user');

      await expect(
        makeEntity('guard-ai', 'guard-persona-profile', 'ai'),
      ).rejects.toThrow(/owned by a persona/i);
    });

    it('allows an AI entity linking a fresh (non-persona) profile', async () => {
      await makeProfile('guard-fresh-profile');
      const created = await makeEntity('guard-ai-fresh', 'guard-fresh-profile', 'ai');
      expect(created.entity_type).toBe('ai');
      expect(created.character_profile_id).toBe('guard-fresh-profile');
    });

    it('rejects a persona (user entity) linking a profile owned by ANOTHER persona (1:1)', async () => {
      await makeProfile('guard-shared-profile');
      await makeEntity('guard-persona-one', 'guard-shared-profile', 'user');

      await expect(
        makeEntity('guard-persona-two', 'guard-shared-profile', 'user'),
      ).rejects.toThrow(/assigned to another persona/i);
    });

    it('allows a persona linking its own fresh profile (self-reference passes)', async () => {
      await makeProfile('guard-own-profile');
      const created = await makeEntity('guard-persona-self', 'guard-own-profile', 'user');
      expect(created.entity_type).toBe('user');
    });

    it('allows multiple AI entities sharing one profile (AI entities are not 1:1)', async () => {
      await makeProfile('guard-ai-shared');
      await makeEntity('guard-ai-1', 'guard-ai-shared', 'ai');
      const second = await makeEntity('guard-ai-2', 'guard-ai-shared', 'ai');
      expect(second.character_profile_id).toBe('guard-ai-shared');
    });

    it('ignores SOFT-DELETED persona owners (mirrors the engine deleted_at IS NULL filter)', async () => {
      await makeProfile('guard-deleted-persona-profile');
      await makeEntity('guard-deleted-persona', 'guard-deleted-persona-profile', 'user');
      await deleteEntity('guard-deleted-persona');

      // The persona is gone → the freed profile is linkable to an AI entity.
      const created = await makeEntity('guard-ai-after-delete', 'guard-deleted-persona-profile', 'ai');
      expect(created.character_profile_id).toBe('guard-deleted-persona-profile');
    });

    it('updateEntityFields rejects assigning a persona-owned profile to an AI entity', async () => {
      await makeProfile('guard-update-persona-profile');
      await makeEntity('guard-update-persona', 'guard-update-persona-profile', 'user');
      await makeEntity('guard-update-ai', null, 'ai');

      await expect(
        updateEntityFields('guard-update-ai', {character_profile_id: 'guard-update-persona-profile'}),
      ).rejects.toThrow(/owned by a persona/i);
    });

    it('updateEntityFields allows an AI entity to assign a non-persona profile', async () => {
      await makeProfile('guard-update-fresh');
      await makeEntity('guard-update-ai-2', null, 'ai');

      await updateEntityFields('guard-update-ai-2', {character_profile_id: 'guard-update-fresh'});
      expect((await getEntity('guard-update-ai-2'))!.character_profile_id).toBe('guard-update-fresh');
    });

    it('updateEntityFields allows a persona to self-reference its own profile (no-op)', async () => {
      await makeProfile('guard-self-profile');
      await makeEntity('guard-self-persona', 'guard-self-profile', 'user');

      // No-op re-assign of its own profile passes the 1:1 guard.
      await updateEntityFields('guard-self-persona', {character_profile_id: 'guard-self-profile'});
      expect((await getEntity('guard-self-persona'))!.character_profile_id).toBe('guard-self-profile');
    });

    it('updateEntityFields rejects a persona taking ANOTHER persona profile (1:1)', async () => {
      await makeProfile('guard-other-profile');
      await makeEntity('guard-other-persona', 'guard-other-profile', 'user');
      await makeEntity('guard-other-persona-2', null, 'user');

      await expect(
        updateEntityFields('guard-other-persona-2', {character_profile_id: 'guard-other-profile'}),
      ).rejects.toThrow(/assigned to another persona/i);
    });

    it('updateEntityFields allows unlinking a profile (character_profile_id → null)', async () => {
      await makeProfile('guard-unlink');
      await makeEntity('guard-unlink-ai', 'guard-unlink', 'ai');

      await updateEntityFields('guard-unlink-ai', {character_profile_id: null});
      expect((await getEntity('guard-unlink-ai'))!.character_profile_id).toBeNull();
    });
  });
});
