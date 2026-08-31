/**
 * Persona Repository (re-export shim) Tests
 *
 * Personas are now USER ENTITIES (entity_type='user') backed by a linked
 * profile. The `personas` table is gone; these tests exercise the
 * personas.ts → userEntities.ts shim to prove the export surface still
 * compiles and behaves (defense cases became entity_type cases, 5-4 §1).
 */
import {useFreshDatabase} from '../repositoryFixtures';
import {
  createPersona,
  getPersona,
  getAllPersonas,
  updatePersona,
  deletePersona,
  resolvePersonaId,
} from '../../repositories/personas';
import {getAllEntities, createEntity, getEntity} from '../../repositories/entities';
import {createCharacterProfile} from '../../repositories/characters';

describe('personas repository (shim)', () => {
  const {getDb} = useFreshDatabase();

  describe('createPersona', () => {
    it('creates a persona with identity fields only (user entity + profile)', async () => {
      const persona = await createPersona({
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
      const persona = await createPersona({
        name: 'Avatar Persona',
        avatar_image_data: 'aGVsbG8=',
        avatar_mime_type: 'image/png',
      });
      expect(persona.avatarUri).toBe('data:image/png;base64,aGVsbG8=');

      const fetched = await getPersona(persona.id);
      expect(fetched!.avatarUri).toBe('data:image/png;base64,aGVsbG8=');
    });
  });

  describe('getAllPersonas', () => {
    it('returns personas ordered by name', async () => {
      await createPersona({name: 'Zoe'});
      await createPersona({name: 'Anna'});
      await createPersona({name: 'Max'});

      const personas = await getAllPersonas();
      expect(personas.map(p => p.name)).toEqual(['Anna', 'Max', 'Zoe']);
    });
  });

  describe('updatePersona', () => {
    it('updates identity fields and keeps the backing entity alias in sync', async () => {
      const persona = await createPersona({name: 'Old Name'});

      await updatePersona(persona.id, {
        name: 'New Name',
        description: 'Updated desc',
        personality: 'Updated personality',
        avatar_image_data: 'bmV3',
        avatar_mime_type: 'image/jpeg',
      });

      const fetched = await getPersona(persona.id);
      expect(fetched!.name).toBe('New Name');
      expect(fetched!.description).toBe('Updated desc');
      expect(fetched!.personality).toBe('Updated personality');
      expect(fetched!.avatarUri).toBe('data:image/jpeg;base64,bmV3');

      const entity = await getEntity(persona.id);
      expect(entity!.alias).toBe('New Name');
    });
  });

  describe('deletePersona', () => {
    it('soft-deletes the persona entity and its profile', async () => {
      const persona = await createPersona({name: 'To Delete'});

      await deletePersona(persona.id);

      // resolvePersonaId sanitizes it away (soft-deleted user entity)
      expect(await resolvePersonaId(persona.id)).toBe('user');
      expect(await getPersona(persona.id)).toBeNull();
      const entity = await getEntity(persona.id, true);
      expect(entity!.deleted_at).not.toBeNull();
    });
  });

  describe('resolvePersonaId', () => {
    it('returns the stored persona id when it is a valid user entity', async () => {
      const persona = await createPersona({name: 'Valid Persona'});
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

      const personas = await getAllPersonas();
      expect(personas.some(p => p.id === 'leaked-ai-character')).toBe(false);
      expect(await getPersona('leaked-ai-character')).toBeNull();
      expect(await resolvePersonaId('leaked-ai-character')).toBe('user');
    });

    it('keeps genuine personas (entity_type = user)', async () => {
      const persona = await createPersona({name: 'Genuine Persona'});
      const personas = await getAllPersonas();
      expect(personas.some(p => p.id === persona.id)).toBe(true);
    });
  });
});
