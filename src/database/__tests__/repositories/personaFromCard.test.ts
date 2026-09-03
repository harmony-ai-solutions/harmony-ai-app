/**
 * Persona-from-card copy helper tests (3-2-A, decisions 4/6/7/9).
 *
 * `createUserPersonaFromCard` is the RN equivalent of the engine 1-3 duplicate
 * endpoint, but persona-targeted: it FULL-copies a character card (all V3
 * spec fields + Soulbits fields, card_provenance AS-IS, all images with the
 * primary flag preserved) into a fresh `user` entity + profile. `is_favorite`
 * and `lifecycle_config` are reset; the name is deduped via the copy-suffix
 * convention.
 */

import {useFreshDatabase} from '../repositoryFixtures';
import {createUserPersona, createUserPersonaFromCard} from '../../repositories/userEntities';
import {
  createCharacterProfile,
  getCharacterProfile,
  getCharacterImages,
  getPrimaryImage,
  createCharacterImage,
} from '../../repositories/characters';
import {getEntity, getAllEntities, createEntity, deleteEntity} from '../../repositories/entities';
import type {CharacterProfile} from '../../models';

describe('persona from card (createUserPersonaFromCard)', () => {
  const {getDb} = useFreshDatabase();

  /** Full-featured source card: every V3 + Soulbits field + 2 images. */
  async function seedSourceCard(id: string): Promise<CharacterProfile> {
    await createCharacterProfile({
      id,
      name: 'Source Card',
      description: 'Full desc',
      personality: 'Bold',
      voice_characteristics: 'deep',
      base_prompt: 'You are a source card.',
      scenario: 'In a library.',
      typing_speed_wpm: 55,
      audio_response_chance_percent: 33,
      vision_config_id: null,
      lifecycle_config: '{"state":"archived"}',
      first_mes: 'Hello from source.',
      mes_example: '<START>\n{{user}}: Hi\n{{char}}: Hello.',
      alternate_greetings: '["One", "Two"]',
      post_history_instructions: 'Instructions',
      creator_notes: 'Notes',
      creator: 'someone',
      character_version: '3.1',
      nickname: 'Src',
      tags: '["source"]',
      group_only_greetings: '["Group"]',
      extensions: '{"ext": 1}',
      assets: '["a1"]',
      card_provenance: '{"origin": "github", "id": "abc"}',
      character_book: '{"lore": []}',
      is_favorite: 1,
    });

    await createCharacterImage({
      character_profile_id: id,
      image_data: 'cHJpbWFyeQ==',
      mime_type: 'image/png',
      description: 'avatar',
      is_primary: true,
      display_order: 0,
      vl_model_interpretation: 'a cat',
      vl_model: 'gemini',
      updated_at: new Date(),
    });
    await createCharacterImage({
      character_profile_id: id,
      image_data: 'Z2FsbGVyeQ==',
      mime_type: 'image/jpeg',
      description: 'gallery',
      is_primary: false,
      display_order: 1,
      vl_model_interpretation: '',
      vl_model: '',
      updated_at: new Date(),
    });

    return (await getCharacterProfile(id))!;
  }

  it('copies ALL profile fields, resets is_favorite + lifecycle_config, keeps card_provenance as-is (3-2-A)', async () => {
    await seedSourceCard('src-1');
    const persona = await createUserPersonaFromCard('src-1');

    // Fresh user entity, id = deduped name.
    expect(persona.id).toBe('Source Card');
    const entity = await getEntity(persona.id);
    expect(entity).not.toBeNull();
    expect(entity!.entity_type).toBe('user');
    expect(entity!.alias).toBe('Source Card');

    // Full copy with resets.
    const copy = await getCharacterProfile(entity!.character_profile_id!);
    expect(copy).toMatchObject({
      name: 'Source Card',
      description: 'Full desc',
      personality: 'Bold',
      voice_characteristics: 'deep',
      base_prompt: 'You are a source card.',
      scenario: 'In a library.',
      typing_speed_wpm: 55,
      audio_response_chance_percent: 33,
      first_mes: 'Hello from source.',
      mes_example: '<START>\n{{user}}: Hi\n{{char}}: Hello.',
      alternate_greetings: '["One", "Two"]',
      post_history_instructions: 'Instructions',
      creator_notes: 'Notes',
      creator: 'someone',
      character_version: '3.1',
      nickname: 'Src',
      tags: '["source"]',
      group_only_greetings: '["Group"]',
      extensions: '{"ext": 1}',
      assets: '["a1"]',
      // decision 6: card_provenance copied AS-IS.
      card_provenance: '{"origin": "github", "id": "abc"}',
      character_book: '{"lore": []}',
    });
    // decision 2 (engine field matrix): is_favorite reset 0, lifecycle_config reset {}.
    expect(copy!.is_favorite).toBe(0);
    expect(copy!.lifecycle_config).toBe('{}');
    expect(copy!.id).not.toBe('src-1');
  });

  it('copies ALL images with the primary flag preserved and fresh ids (decision 9)', async () => {
    await seedSourceCard('src-2');
    const sourceImages = await getCharacterImages('src-2');
    expect(sourceImages.length).toBe(2);

    const persona = await createUserPersonaFromCard('src-2');
    const entity = await getEntity(persona.id);
    const copiedImages = await getCharacterImages(entity!.character_profile_id!);

    expect(copiedImages.length).toBe(2);
    const primary = copiedImages.find(i => i.is_primary);
    const gallery = copiedImages.find(i => !i.is_primary);
    expect(primary).toBeDefined();
    expect(gallery).toBeDefined();
    expect(primary!.image_data).toBe('cHJpbWFyeQ==');
    expect(gallery!.image_data).toBe('Z2FsbGVyeQ==');
    expect(primary!.display_order).toBe(0);
    expect(gallery!.display_order).toBe(1);
    expect(primary!.vl_model_interpretation).toBe('a cat');

    // Fresh ids — never reuse the source image rows.
    const sourceIds = sourceImages.map(i => i.id);
    for (const img of copiedImages) {
      expect(sourceIds).not.toContain(img.id);
    }

    // avatarUri reflects the copied primary.
    expect(persona.avatarUri).toBe('data:image/png;base64,cHJpbWFyeQ==');
  });

  it('dedupes the persona name via getNextEntityAliasCopy when the name is taken', async () => {
    await seedSourceCard('src-3');
    await createUserPersona({name: 'Source Card'});

    const persona = await createUserPersonaFromCard('src-3');
    expect(persona.id).toBe('Source Card 2');

    // Only one entity named 'Source Card' + one copy.
    const entities = await getAllEntities();
    const ids = entities.map(e => e.id);
    expect(ids).toContain('Source Card');
    expect(ids).toContain('Source Card 2');
  });

  it('uses an explicit name option as the copy base name', async () => {
    await seedSourceCard('src-4');
    await createUserPersona({name: 'Custom'});

    const persona = await createUserPersonaFromCard('src-4', {name: 'Custom'});
    expect(persona.id).toBe('Custom 2');
    const entity = await getEntity(persona.id);
    const copy = await getCharacterProfile(entity!.character_profile_id!);
    expect(copy!.name).toBe('Custom 2');
    // Full fields still copied under the renamed identity.
    expect(copy!.scenario).toBe('In a library.');
  });

  it('leaves the source card and its images untouched', async () => {
    await seedSourceCard('src-5');
    const sourceBefore = await getCharacterProfile('src-5');
    const sourceImagesBefore = await getCharacterImages('src-5');

    await createUserPersonaFromCard('src-5');

    const sourceAfter = await getCharacterProfile('src-5');
    const sourceImagesAfter = await getCharacterImages('src-5');
    expect(sourceAfter).toMatchObject({
      name: sourceBefore!.name,
      scenario: sourceBefore!.scenario,
      card_provenance: sourceBefore!.card_provenance,
      lifecycle_config: sourceBefore!.lifecycle_config,
      is_favorite: sourceBefore!.is_favorite,
    });
    expect(sourceImagesAfter.map(i => i.id)).toEqual(sourceImagesBefore.map(i => i.id));
    expect(sourceImagesAfter.map(i => i.is_primary)).toEqual(
      sourceImagesBefore.map(i => i.is_primary),
    );
  });

  it('throws when the source card does not exist', async () => {
    await expect(createUserPersonaFromCard('missing-card')).rejects.toThrow(
      /not found/i,
    );
  });

  it('rejects a persona-owned source card (1:1 — personas never copy personas, 3-3)', async () => {
    await seedSourceCard('src-persona-owned');
    // A persona (user entity) owns the source card.
    await createEntity(
      {
        id: 'src-persona-owner',
        character_profile_id: 'src-persona-owned',
        alias: 'src-persona-owner',
        lifecycle_config: '{}',
        rag_reindex_required: 1,
      },
      {entity_type: 'user'},
    );

    await expect(createUserPersonaFromCard('src-persona-owned')).rejects.toThrow(
      /owned by a persona/i,
    );

    // Nothing was copied — no new user entity appeared.
    const entities = await getAllEntities();
    expect(entities.some(e => e.id === 'src-persona-owner')).toBe(true);
    expect(entities.filter(e => e.entity_type === 'user').length).toBe(1);
  });

  it('allows copying a card whose owner is a SOFT-DELETED persona (mirrors the engine deleted_at IS NULL filter)', async () => {
    await seedSourceCard('src-freed-card');
    await createEntity(
      {
        id: 'src-freed-owner',
        character_profile_id: 'src-freed-card',
        alias: 'src-freed-owner',
        lifecycle_config: '{}',
        rag_reindex_required: 1,
      },
      {entity_type: 'user'},
    );
    await deleteEntity('src-freed-owner');

    const persona = await createUserPersonaFromCard('src-freed-card');
    expect(persona.id).toBe('Source Card');
  });

  it('copies a card with NO images into a persona with a null avatar', async () => {
    await createCharacterProfile({
      id: 'src-noimg',
      name: 'No Image Card',
      description: '',
      personality: '',
      voice_characteristics: '',
      base_prompt: '',
      scenario: '',
      typing_speed_wpm: 60,
      audio_response_chance_percent: 50,
      vision_config_id: null,
      lifecycle_config: '{}',
      first_mes: 'Hi',
      card_provenance: '{"source":"x"}',
    });

    const persona = await createUserPersonaFromCard('src-noimg');
    expect(persona.avatarUri).toBeNull();
    const entity = await getEntity(persona.id);
    expect(await getCharacterImages(entity!.character_profile_id!)).toEqual([]);
    const primary = await getPrimaryImage(entity!.character_profile_id!);
    expect(primary).toBeNull();
  });
});