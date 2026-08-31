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
} from '../../repositories/userEntities';
import {getEntity, getAllEntities, createEntity} from '../../repositories/entities';
import {getCharacterProfile, getPrimaryImage} from '../../repositories/characters';

describe('user entities repository', () => {
  const {getDb} = useFreshDatabase();

  describe('createUserPersona', () => {
    it('creates a persona with a profile, a user entity (id = name), and returns a Persona', async () => {
      const persona = await createUserPersona({
        name: '  Mystic Mara  ',
        description: 'A mystic healer',
        personality: 'Calm, wise',
      });

      expect(persona.id).toBe('Mystic Mara'); // trimmed + id = name
      expect(persona.name).toBe('Mystic Mara');
      expect(persona.description).toBe('A mystic healer');
      expect(persona.personality).toBe('Calm, wise');
      expect(persona.avatarUri).toBeNull();

      const entity = await getEntity(persona.id);
      expect(entity).not.toBeNull();
      expect(entity!.entity_type).toBe('user');
      expect(entity!.alias).toBe('Mystic Mara');
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

    it('unique-checks the entity id via the copy-suffix convention when the name is taken', async () => {
      await createUserPersona({name: 'Aria'});
      const second = await createUserPersona({name: 'Aria'});
      expect(second.id).toBe('Aria 2');
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
