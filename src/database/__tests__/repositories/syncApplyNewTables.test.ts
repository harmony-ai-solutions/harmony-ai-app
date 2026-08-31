/**
 * Sync apply for the newly-registered table (4-1, Q5).
 *
 * `applySyncRecord` resolves each table's PK through the centralized registry
 * (`getPkField`). `chat_conversation_settings` keys rows by `participant_key` —
 * it has no `id` column, so the pre-registry `getPrimaryKeyField` fallback
 * (`id`) made the existence-check / LWW WHERE clause throw. This suite pins the
 * corrected behavior end-to-end through the real transaction-wrapped apply.
 * (The favorites table used to be registered here too but was replaced by the
 * `is_favorite` column on character_profiles in migration 000044.)
 */

import {useFreshDatabase} from '../repositoryFixtures';
import {applySyncRecord, getChangedRecords} from '../../sync';
import {withTransaction} from '../../transaction';
import {getDatabase} from '../../connection';

describe('sync apply for the newly registered table (4-1)', () => {
  const {getDb} = useFreshDatabase();

  async function apply(
    table: string,
    operation: 'insert' | 'update' | 'delete',
    record: Record<string, unknown>,
  ): Promise<void> {
    const db = getDatabase();
    await withTransaction(db, async (tx) => {
      await applySyncRecord(table, operation, record, tx);
    });
  }

  describe('chat_conversation_settings (PK = participant_key)', () => {
    it('inserts a settings row keyed by participant_key', async () => {
      await apply('chat_conversation_settings', 'insert', {
        participant_key: 'pk-1',
        entity_id: 'entity-1',
        pinned: 0,
        archived: 1,
        reply_mode: 'realistic',
        created_at: '2026-08-31T00:00:00.000Z',
        updated_at: '2026-08-31T00:00:00.000Z',
        deleted_at: null,
      });

      const [res] = await getDb().executeSql(
        'SELECT participant_key FROM chat_conversation_settings WHERE participant_key = ?',
        ['pk-1'],
      );
      expect(res.rows.length).toBe(1);
      expect(res.rows.item(0).participant_key).toBe('pk-1');
    });

    it('LWW-updates a settings row keyed by participant_key', async () => {
      await apply('chat_conversation_settings', 'insert', {
        participant_key: 'pk-1',
        entity_id: 'entity-1',
        pinned: 0,
        archived: 0,
        reply_mode: 'realistic',
        created_at: '2026-08-31T00:00:00.000Z',
        updated_at: '2026-08-31T00:00:00.000Z',
        deleted_at: null,
      });

      await apply('chat_conversation_settings', 'update', {
        participant_key: 'pk-1',
        entity_id: 'entity-1',
        pinned: 1,
        archived: 0,
        reply_mode: 'instant',
        created_at: '2026-08-31T00:00:00.000Z',
        updated_at: '2026-08-31T00:00:02.000Z',
        deleted_at: null,
      });

      const [res] = await getDb().executeSql(
        'SELECT pinned, archived, reply_mode FROM chat_conversation_settings WHERE participant_key = ?',
        ['pk-1'],
      );
      const row = res.rows.item(0);
      expect(row.pinned).toBe(1);
      expect(row.archived).toBe(0);
      expect(row.reply_mode).toBe('instant');
    });

    it('rides pinned/archived as JSON numbers (0/1) through getChangedRecords (4-1 contract)', async () => {
      await apply('chat_conversation_settings', 'insert', {
        participant_key: 'pk-wire',
        entity_id: 'entity-1',
        pinned: 1,
        archived: 0,
        reply_mode: 'realistic',
        created_at: '2026-08-31T00:00:00.000Z',
        updated_at: '2026-08-31T00:00:00.000Z',
        deleted_at: null,
      });

      const records = await getChangedRecords('chat_conversation_settings', 0);
      const match = records.find(r => r.participant_key === 'pk-wire');
      expect(match).toBeDefined();
      // Pre-decided shape contract: NO boolean normalization for
      // chat_conversation_settings — pinned/archived ride as 0/1 JSON numbers
      // (Go int64), NOT booleans.
      expect(typeof match.pinned).toBe('number');
      expect(match.pinned).toBe(1);
      expect(typeof match.archived).toBe('number');
      expect(match.archived).toBe(0);
    });
  });
});
