/**
 * Persona Repository Tests (personas → user entities, Q10 / §9-A10)
 *
 * The `personas` table is GONE and the `personas.ts` shim was DELETED in 5-4.
 * A "persona" IS a user entity (`entity_type='user'`) backed by a linked
 * `character_profiles` row. These tests exercise the canonical
 * `userEntities.ts` repo directly (create/get/update/delete/resolve) and
 * re-assert the entity_type defense cases from Phase 1 (AI characters are
 * NEVER personas, A7).
 */
import {useFreshDatabase} from '../repositoryFixtures';
import {
  createUserPersona,
  getUserPersona,
  getUserEntities,
  updateUserPersona,
  deleteUserPersona,
  resolvePersonaId,
} from '../../repositories/userEntities';
import {getAllEntities, createEntity, getEntity} from '../../repositories/entities';
import {createCharacterProfile} from '../../repositories/characters';

describe('personas repository (user entities)', () => {
  const {getDb} = useFreshDatabase();

  describe('createUserPersona', () => {
    it('creates a persona with identity fields only (user entity + profile)', async () => {
      const persona = await createUserPersona({
        name: '  Mystic Mara  ',
        description: 'A mystic healer',
        personality: 'Calm, wise',
      });

      expect(persona.id).toBeTruthy();
      expect(persona.name).toBe('Mystic Mara'); // trimmed
      expect(persona.description).toBe('A mystic healer');
      expect(persona.personality).toBe('Calm, wise');
      expect(persona.avatarUri).toBeNull();

      const entities = await getAllEntities();
      const backing = entities.find(e => e.id === persona.id);
      expect(backing).toBeDefined();
      expect(backing!.alias).toBe('Mystic Mara');
      expect(backing!.entity_type).toBe('user');
      expect(backing!.character_profile_id).not.toBeNull();
    });

    it('stores an avatar as image data + mime and exposes a data URL', async () => {
      const persona = await createUserPersona({
        name: 'Avatar Persona',
        avatar: {image_data: 'aGVsbG8=', mime_type: 'image/png'},
      });
      expect(persona.avatarUri).toBe('data:image/png;base64,aGVsbG8=');

      const fetched = await getUserPersona(persona.id);
      expect(fetched!.avatarUri).toBe('data:image/png;base64,aGVsbG8=');
    });
  });

  describe('getUserEntities', () => {
    it('returns user entities ordered by name, including the built-in user', async () => {
      await createUserPersona({name: 'Zoe'});
      await createUserPersona({name: 'Anna'});
      await createUserPersona({name: 'Max'});

      const personas = await getUserEntities();
      expect(personas.map(p => p.name)).toEqual(['Anna', 'Max', 'Zoe']);
    });
  });

  describe('updateUserPersona', () => {
    it('updates identity fields and keeps the backing entity alias in sync', async () => {
      const persona = await createUserPersona({name: 'Old Name'});

      await updateUserPersona(persona.id, {
        name: 'New Name',
        description: 'Updated desc',
        personality: 'Updated personality',
        avatar: {image_data: 'bmV3', mime_type: 'image/jpeg'},
      });

      const fetched = await getUserPersona(persona.id);
      expect(fetched!.name).toBe('New Name');
      expect(fetched!.description).toBe('Updated desc');
      expect(fetched!.personality).toBe('Updated personality');
      expect(fetched!.avatarUri).toBe('data:image/jpeg;base64,bmV3');

      const entity = await getEntity(persona.id);
      expect(entity!.alias).toBe('New Name');
    });
  });

  describe('deleteUserPersona', () => {
    it('soft-deletes the persona entity and its profile', async () => {
      const persona = await createUserPersona({name: 'To Delete'});

      await deleteUserPersona(persona.id);

      // resolvePersonaId sanitizes it away (soft-deleted user entity)
      expect(await resolvePersonaId(persona.id)).toBe('user');
      expect(await getUserPersona(persona.id)).toBeNull();
      const entity = await getEntity(persona.id, true);
      expect(entity!.deleted_at).not.toBeNull();
    });

    it('throws when deleting the built-in "user" (A1)', async () => {
      await expect(deleteUserPersona('user')).rejects.toThrow();
    });
  });

  describe('resolvePersonaId', () => {
    it('returns the stored persona id when it is a valid user entity', async () => {
      const persona = await createUserPersona({name: 'Valid Persona'});
      const resolved = await resolvePersonaId(persona.id);
      expect(resolved).toBe(persona.id);
    });

    it('falls back to "user" when the stored id is not a user entity', async () => {
      const resolved = await resolvePersonaId('some-ai-character-id');
      expect(resolved).toBe('user');
    });

    it('falls back to "user" when no stored id', async () => {
      expect(await resolvePersonaId(null)).toBe('user');
    });
  });

  describe('AI characters are NEVER personas (entity_type defense)', () => {
    it('excludes an AI entity even if a leaked profile link exists', async () => {
      await createCharacterProfile({
        id: 'some-profile-id',
        name: 'My AI Partner',
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
      await createEntity({
        id: 'leaked-ai-character',
        alias: 'My AI Partner',
        character_profile_id: 'some-profile-id',
        lifecycle_config: '{}',
        rag_reindex_required: 1,
      }, {entity_type: 'ai'});

      const personas = await getUserEntities();
      expect(personas.some(p => p.id === 'leaked-ai-character')).toBe(false);
      expect(await getUserPersona('leaked-ai-character')).toBeNull();
      expect(await resolvePersonaId('leaked-ai-character')).toBe('user');
    });

    it('keeps genuine personas (entity_type = user)', async () => {
      const persona = await createUserPersona({name: 'Genuine Persona'});
      const personas = await getUserEntities();
      expect(personas.some(p => p.id === persona.id)).toBe(true);
    });
  });
});
