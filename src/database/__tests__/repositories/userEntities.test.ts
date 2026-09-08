/**
 * User Entities Repository Tests (personas → user entities, Q10 / §9-A10)
 */

import {useFreshDatabase} from '../repositoryFixtures';
import {
  getUserEntities,
  createUserPersona,
  updateUserPersona,
  deleteUserPersona,
  resolvePersonaId,
  PersonaAliasConflictError,
} from '../../repositories/userEntities';
import {getEntity, getAllEntities, createEntity} from '../../repositories/entities';
import {
  getCharacterProfile,
  getPrimaryImage,
  createCharacterImage,
  getCharacterImages,
} from '../../repositories/characters';

// 3-2-A: deleteUserPersona fires a non-blocking sync trigger (decision 15).
// Stub the SyncService singleton so unit tests never touch the real sync
// stack (its logger transport leaves timers that fail fast suites).
jest.mock('../../../services/SyncService', () => {
  const initiateSync = jest.fn(() => Promise.resolve());
  return {
    SyncService: {
      getInstance: () => ({initiateSync}),
    },
  };
});

describe('user entities repository', () => {
  const {getDb} = useFreshDatabase();

  describe('createUserPersona', () => {
    // Pinned to the 6-1 fixed instant so derived ids are fully deterministic.
    const TS = '20260905123514';

    beforeEach(() => {
      jest.useFakeTimers({now: new Date('2026-09-05T12:35:14Z')});
    });
    afterEach(() => {
      jest.useRealTimers();
    });

    it('creates a persona with a profile, a user entity (id = DERIVED, alias = display name), and returns a Persona', async () => {
      const persona = await createUserPersona({
        name: '  Mystic Mara  ',
        description: 'A mystic healer',
        personality: 'Calm, wise',
      });

      expect(persona.id).toBe(`Mystic-Mara-${TS}`); // D2 derived, never the raw name
      expect(persona.name).toBe('Mystic Mara'); // profile keeps the human name
      expect(persona.description).toBe('A mystic healer');
      expect(persona.personality).toBe('Calm, wise');
      expect(persona.avatarUri).toBeNull();

      const entity = await getEntity(persona.id);
      expect(entity).not.toBeNull();
      expect(entity!.entity_type).toBe('user');
      expect(entity!.alias).toBe('Mystic Mara'); // D3/D56: alias carries the name
      expect(entity!.character_profile_id).not.toBeNull();

      const profile = await getCharacterProfile(entity!.character_profile_id!);
      expect(profile?.name).toBe('Mystic Mara');
      expect(profile?.tags).toBe('[]');
    });

    it('stores an avatar as a primary character_image and exposes a data URL', async () => {
      const persona = await createUserPersona({
        name: 'Avatar Persona',
        avatar: {image_data: 'aGVsbG8=', mime_type: 'image/png'},
      });
      expect(persona.avatarUri).toBe('data:image/png;base64,aGVsbG8=');

      const entity = await getEntity(persona.id);
      const image = await getPrimaryImage(entity!.character_profile_id!);
      expect(image).not.toBeNull();
      expect(image!.is_primary).toBe(true);
    });

    it('derives a -N-suffixed id and DEDUPED alias when the display name is taken (D56)', async () => {
      await createUserPersona({name: 'Aria'});
      const second = await createUserPersona({name: 'Aria'});
      // Same pinned second → id "-2" on the FULL derived id; alias "Aria 2".
      expect(second.id).toBe(`Aria-${TS}-2`);
      expect(second.name).toBe('Aria');
      const entity = await getEntity(second.id);
      expect(entity!.alias).toBe('Aria 2');
    });

    it('recreate-after-delete succeeds: a soft-deleted (ghost) id is resolved, leaving no residue (ghost-id bug)', async () => {
      const first = await createUserPersona({name: 'Max'});
      expect(first.id).toBe(`Max-${TS}`);
      await deleteUserPersona(first.id);

      // Old code path: getEntity('Max') misses the ghost → id = 'Max' → the
      // entity INSERT hits the TEXT PRIMARY KEY → generic failure + an orphaned
      // profile (phantom card). New path must resolve the ghost via the
      // ghost-aware backstop.
      const recreated = await createUserPersona({name: 'Max'});
      expect(recreated.id).toBe(`Max-${TS}-2`);

      // The ghost still reserves the PK; the new persona is a live row. The
      // ALIAS is live-only deduped (D56): the ghost's alias does not block,
      // so the recreated persona's alias is the plain display name again.
      const ghost = await getEntity(`Max-${TS}`, true);
      expect(ghost).not.toBeNull();
      expect(ghost!.deleted_at).not.toBeNull();
      const live = await getEntity(recreated.id);
      expect(live).not.toBeNull();
      expect(live!.entity_type).toBe('user');
      expect(live!.alias).toBe('Max');

      // Exactly ONE live persona named "Max" — no phantom card.
      const liveProfiles = await getCharacterProfile(live!.character_profile_id!);
      expect(liveProfiles?.name).toBe('Max');
    });

    it('dedupes the alias onto a LIVE alias-twin instead of throwing (D56 — the old compensation trigger is gone)', async () => {
      // A live AI entity whose ALIAS (not id) is 'Max'. The persona's derived
      // id is free, but the alias 'Max' is taken — D56 dedupes to 'Max 2'
      // instead of throwing on idx_entities_alias_unique.
      await getDb().executeSql(
        `INSERT INTO entities (id, alias, character_profile_id, lifecycle_config, rag_reindex_required, entity_type, created_at, updated_at)
         VALUES ('renamed-owner', 'Max', NULL, '{}', 1, 'ai', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      );

      const persona = await createUserPersona({name: 'Max'});
      expect(persona.id).toBe(`Max-${TS}`);
      const entity = await getEntity(persona.id);
      expect(entity!.alias).toBe('Max 2');
      // No live OR orphaned ghost profile was created for the failed attempt —
      // the create SUCCEEDED (dedupe, not collision).
      const [liveResult] = await getDb().executeSql(
        `SELECT COUNT(*) AS count FROM character_profiles WHERE name = 'Max' AND deleted_at IS NULL`,
      );
      expect(liveResult.rows.item(0).count).toBe(1); // the persona's profile
    });

    it('accepts the full V3 + Soulbits field set and persists it on the profile (3-2-A)', async () => {
      // character_profiles.vision_config_id has an FK to vision_configs — seed
      // a config row so the non-null vision_config_id round-trips.
      await getDb().executeSql(
        `INSERT INTO vision_configs (id, name, provider, provider_config_id)
         VALUES (?, ?, ?, ?)`,
        ['vision-1', 'Test Vision', 'soulbitscloud', 'prov-1'],
      );
      const persona = await createUserPersona({
        name: 'Full Profile',
        description: 'A desc',
        personality: 'Warm',
        scenario: 'A moonlit garden',
        first_mes: 'Hello, traveler.',
        mes_example: '<START>\n{{user}}: Hi\n{{char}}: Welcome.',
        alternate_greetings: '["Hi there!", "Greetings."]',
        post_history_instructions: 'Stay in character.',
        creator_notes: 'Notes',
        creator: 'test-suite',
        character_version: '2.0',
        nickname: 'Mara',
        tags: '["fantasy", "healer"]',
        group_only_greetings: '["Together we stand."]',
        extensions: '{"world": "Eldoria"}',
        assets: '["asset://1"]',
        card_provenance: '{"source": "import", "importedAt": 1}',
        character_book: '{"entries": []}',
        voice_characteristics: 'soft, warm',
        base_prompt: 'You are Mara.',
        typing_speed_wpm: 42,
        audio_response_chance_percent: 37,
        vision_config_id: 'vision-1',
        lifecycle_config: '{"state": "idle"}',
      });

      const entity = await getEntity(persona.id);
      const profile = await getCharacterProfile(entity!.character_profile_id!);
      expect(profile).toMatchObject({
        name: 'Full Profile',
        description: 'A desc',
        personality: 'Warm',
        scenario: 'A moonlit garden',
        first_mes: 'Hello, traveler.',
        mes_example: '<START>\n{{user}}: Hi\n{{char}}: Welcome.',
        alternate_greetings: '["Hi there!", "Greetings."]',
        post_history_instructions: 'Stay in character.',
        creator_notes: 'Notes',
        creator: 'test-suite',
        character_version: '2.0',
        nickname: 'Mara',
        tags: '["fantasy", "healer"]',
        group_only_greetings: '["Together we stand."]',
        extensions: '{"world": "Eldoria"}',
        assets: '["asset://1"]',
        card_provenance: '{"source": "import", "importedAt": 1}',
        character_book: '{"entries": []}',
        voice_characteristics: 'soft, warm',
        base_prompt: 'You are Mara.',
        typing_speed_wpm: 42,
        audio_response_chance_percent: 37,
        vision_config_id: 'vision-1',
        lifecycle_config: '{"state": "idle"}',
      });
    });
  });

  describe('getUserEntities', () => {
    it('lists non-deleted user entities with profile name + primary avatar, including built-in user', async () => {
      // Built-in 'user' (no profile) — raw id until the Phase-5 seeder lands.
      await getDb().executeSql(
        `INSERT INTO entities (id, alias, character_profile_id, lifecycle_config, rag_reindex_required, entity_type, created_at, updated_at)
         VALUES ('user', 'user', NULL, '{}', 1, 'user', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      );
      const persona = await createUserPersona({name: 'Zoe'});
      await createUserPersona({name: 'Anna'});

      const list = await getUserEntities();
      const names = list.map(p => p.name);
      expect(names).toContain('user');
      expect(names).toContain('Zoe');
      expect(names).toContain('Anna');
      // The created persona is found by its entity id.
      expect(list.some(p => p.id === persona.id)).toBe(true);
    });
  });

  describe('updateUserPersona', () => {
    it('renames (profile + alias) but keeps the entity id FROZEN', async () => {
      const persona = await createUserPersona({name: 'Old Name', description: 'Old desc'});
      await updateUserPersona(persona.id, {name: 'New Name', description: 'Updated desc'});

      const fetched = await getEntity(persona.id);
      expect(fetched!.id).toBe(persona.id); // frozen
      expect(fetched!.alias).toBe('New Name');
      const profile = await getCharacterProfile(fetched!.character_profile_id!);
      expect(profile!.name).toBe('New Name');
      expect(profile!.description).toBe('Updated desc');
    });

    it('round-trips untouched full fields on a partial update (3-2-A)', async () => {
      const persona = await createUserPersona({
        name: 'Round Trip',
        description: 'original desc',
        first_mes: 'Original greeting.',
        scenario: 'Original scenario',
        tags: '["a"]',
        card_provenance: '{"source": "x"}',
        typing_speed_wpm: 41,
        lifecycle_config: '{"keep": true}',
      });

      // Update ONLY name/description — every other field must survive verbatim.
      await updateUserPersona(persona.id, {
        name: 'Round Trip Renamed',
        description: 'updated desc',
      });

      const fetched = await getEntity(persona.id);
      const profile = await getCharacterProfile(fetched!.character_profile_id!);
      expect(profile!.name).toBe('Round Trip Renamed');
      expect(profile!.description).toBe('updated desc');
      expect(profile!.first_mes).toBe('Original greeting.');
      expect(profile!.scenario).toBe('Original scenario');
      expect(profile!.tags).toBe('["a"]');
      expect(profile!.card_provenance).toBe('{"source": "x"}');
      expect(profile!.typing_speed_wpm).toBe(41);
      expect(profile!.lifecycle_config).toBe('{"keep": true}');
    });

    it('accepts full-field updates explicitly (3-2-A)', async () => {
      const persona = await createUserPersona({name: 'Field Update'});
      await updateUserPersona(persona.id, {
        name: 'Field Update',
        scenario: 'New scenario',
        first_mes: 'New greeting.',
        card_provenance: '{"source": "updated"}',
        voice_characteristics: 'deep',
        typing_speed_wpm: 60,
      });

      const fetched = await getEntity(persona.id);
      const profile = await getCharacterProfile(fetched!.character_profile_id!);
      expect(profile!.scenario).toBe('New scenario');
      expect(profile!.first_mes).toBe('New greeting.');
      expect(profile!.card_provenance).toBe('{"source": "updated"}');
      expect(profile!.voice_characteristics).toBe('deep');
      expect(profile!.typing_speed_wpm).toBe(60);
    });

    it('throws a TYPED friendly error when the edit renames onto a LIVE alias (residual race — never raw SQLite, D86)', async () => {
      const twin = await createUserPersona({name: 'Twin One'});
      const other = await createUserPersona({name: 'Other'});

      // Renaming "Other" onto the live alias "Twin One" hits
      // idx_entities_alias_unique → mapped to a typed friendly error.
      await expect(
        updateUserPersona(other.id, {name: 'Twin One'}),
      ).rejects.toBeInstanceOf(PersonaAliasConflictError);

      // The error carries a friendly message, never a raw SQLite constraint
      // string.
      await expect(
        updateUserPersona(other.id, {name: 'Twin One'}),
      ).rejects.toThrow(/already exists/i);

      // The twin is untouched.
      expect((await getEntity(twin.id))!.alias).toBe('Twin One');
    });
  });

  describe('deleteUserPersona', () => {
    it('soft-deletes the entity and profile', async () => {
      const persona = await createUserPersona({name: 'To Delete'});
      await deleteUserPersona(persona.id);

      const entity = await getEntity(persona.id, true);
      expect(entity).not.toBeNull();
      expect(entity!.deleted_at).not.toBeNull();
      // Profile is soft-deleted too.
      const profile = await getCharacterProfile(entity!.character_profile_id!, true);
      expect(profile!.deleted_at).not.toBeNull();
    });

    it('soft-deletes the persona character_image rows too (3-2-A cascade parity)', async () => {
      const persona = await createUserPersona({
        name: 'Img Delete',
        avatar: {image_data: 'aGVsbG8=', mime_type: 'image/png'},
      });
      const entity = await getEntity(persona.id);
      const profileId = entity!.character_profile_id!;
      // Add a non-primary gallery image.
      await createCharacterImage({
        character_profile_id: profileId,
        image_data: 'Z2FsbGVyeQ==',
        mime_type: 'image/jpeg',
        description: 'gallery',
        is_primary: false,
        display_order: 1,
        vl_model_interpretation: '',
        vl_model: '',
        updated_at: new Date(),
      });
      const before = await getCharacterImages(profileId);
      expect(before.length).toBe(2);

      await deleteUserPersona(persona.id);

      // Every image row is tombstoned (visible only with includeDeleted).
      const images = await getCharacterImages(profileId, true);
      expect(images.length).toBe(2);
      for (const image of images) {
        expect(image.deleted_at).not.toBeNull();
      }
      expect(await getCharacterImages(profileId)).toEqual([]);
    });

    it('throws when deleting the built-in "user" (A1)', async () => {
      await expect(deleteUserPersona('user')).rejects.toThrow();
    });

    it('throws when deleting an AI entity (non-user persona)', async () => {
      await createEntity({
        id: 'ai-partner',
        character_profile_id: null,
        alias: 'AI Partner',
        lifecycle_config: '{}',
        rag_reindex_required: 1,
      }, {entity_type: 'ai'});
      await expect(deleteUserPersona('ai-partner')).rejects.toThrow();
    });

    it('fires a non-blocking initiateSync after delete (decision 15)', async () => {
      const {SyncService} = require('../../../services/SyncService');
      const initiateSync = SyncService.getInstance().initiateSync as jest.Mock;
      initiateSync.mockClear();

      const persona = await createUserPersona({name: 'Sync Trigger'});
      await deleteUserPersona(persona.id);

      expect(initiateSync).toHaveBeenCalledTimes(1);
    });

    it('does not fire a sync when deleting the protected built-in "user"', async () => {
      const {SyncService} = require('../../../services/SyncService');
      const initiateSync = SyncService.getInstance().initiateSync as jest.Mock;
      initiateSync.mockClear();

      await expect(deleteUserPersona('user')).rejects.toThrow();
      expect(initiateSync).not.toHaveBeenCalled();
    });
  });

  describe('resolvePersonaId', () => {
    it('returns the stored id when it is a valid non-deleted user entity', async () => {
      const persona = await createUserPersona({name: 'Valid Persona'});
      expect(await resolvePersonaId(persona.id)).toBe(persona.id);
    });

    it('falls back to "user" when the stored id is an AI entity', async () => {
      expect(await resolvePersonaId('some-ai-character-id')).toBe('user');
    });

    it('falls back to "user" when the stored id belongs to a deleted user entity', async () => {
      const persona = await createUserPersona({name: 'Deleted Persona'});
      await deleteUserPersona(persona.id);
      expect(await resolvePersonaId(persona.id)).toBe('user');
    });

    it('falls back to "user" when no stored id', async () => {
      expect(await resolvePersonaId(null)).toBe('user');
    });
  });
});
