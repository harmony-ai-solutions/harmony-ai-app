/**
 * Persona Repository Tests
 *
 * Personas are the identities the user chats AS. They are stored in the
 * client-only `personas` table with ONLY identity fields (name, description,
 * personality, avatar) — no character profile, no AI module configs. Each
 * persona creates a backing entity (alias = name, no profile) so chat
 * INIT_ENTITY resolves it as the "chatting as" identity.
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
import {getAllEntities, createEntity} from '../../repositories/entities';
import {createCharacterProfile} from '../../repositories/characters';

describe('personas repository', () => {
  const {getDb} = useFreshDatabase();

  describe('createPersona', () => {
    it('creates a persona with identity fields only', async () => {
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

      // Backing entity exists with alias = name and NO character profile
      const entity = await getAllEntities();
      const backing = entity.find(e => e.id === persona.id);
      expect(backing).toBeDefined();
      expect(backing!.alias).toBe('Mystic Mara');
      expect(backing!.character_profile_id).toBeNull();
    });

    it('stores an avatar as image data + mime and exposes a data URL', async () => {
      const persona = await createPersona({
        name: 'Avatar Persona',
        avatar_image_data: 'aGVsbG8=',
        avatar_mime_type: 'image/png',
      });
      expect(persona.avatarUri).toBe('data:image/png;base64,aGVsbG8=');

      // Round-trip through the DB
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

      const entity = await getAllEntities();
      const backing = entity.find(e => e.id === persona.id);
      expect(backing!.alias).toBe('New Name');
    });
  });

  describe('deletePersona', () => {
    it('removes the persona and its backing entity', async () => {
      const persona = await createPersona({name: 'To Delete'});

      await deletePersona(persona.id);

      expect(await getPersona(persona.id)).toBeNull();
      const entity = await getAllEntities();
      expect(entity.some(e => e.id === persona.id)).toBe(false);
    });
  });

  describe('resolvePersonaId', () => {
    it('returns the stored persona id when it is a valid persona', async () => {
      const persona = await createPersona({name: 'Valid Persona'});
      const resolved = await resolvePersonaId(persona.id);
      expect(resolved).toBe(persona.id);
    });

    it('falls back to "user" when the stored id is not a persona', async () => {
      const resolved = await resolvePersonaId('some-ai-character-id');
      expect(resolved).toBe('user');
    });

    it('falls back to "user" when no stored id', async () => {
      expect(await resolvePersonaId(null)).toBe('user');
    });
  });

  describe('AI characters are NEVER personas (defense-in-depth)', () => {
    it('excludes a persona row whose backing entity links a character profile', async () => {
      // Simulate a leaked row: an entity with a character_profile_id that was
      // backfilled into personas by an earlier dev migration.
      const db = getDb();
      await createCharacterProfile({
        id: 'some-profile-id',
        name: 'My AI Partner',
        description: '',
        personality: '',
        appearance: '',
        backstory: '',
        voice_characteristics: '',
        base_prompt: null,
        scenario: null,
        example_dialogues: null,
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
      });
      await db.executeSql(
        `INSERT INTO personas (id, name, description, personality, avatar_image_data, avatar_mime_type, created_at, updated_at)
         VALUES ('leaked-ai-character', 'My AI Partner', '', '', NULL, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      );

      const personas = await getAllPersonas();
      expect(personas.some(p => p.id === 'leaked-ai-character')).toBe(false);
      expect(await getPersona('leaked-ai-character')).toBeNull();
      expect(await resolvePersonaId('leaked-ai-character')).toBe('user');
    });

    it('keeps genuine personas (backing entity has no character profile)', async () => {
      const persona = await createPersona({name: 'Genuine Persona'});
      const personas = await getAllPersonas();
      expect(personas.some(p => p.id === persona.id)).toBe(true);
    });
  });
});
