import { mapCardToProfile } from '../mapper';
import { CharacterCardParseError } from '../types';
import type { TavernCardV2 } from '../types';

function makeCard(overrides: Partial<TavernCardV2['data']> = {}): TavernCardV2 {
  return {
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data: {
      name: 'Test Character',
      description: 'A test',
      personality: 'cheerful',
      scenario: '',
      first_mes: 'Hi there!',
      mes_example: 'User: hey\nChar: hello',
      creator_notes: '',
      system_prompt: 'You are Test.',
      post_history_instructions: '',
      alternate_greetings: ['Alt greeting!'],
      character_book: null,
      tags: [],
      creator: '',
      character_version: '',
      extensions: {},
      ...overrides,
    },
  };
}

describe('mapCardToProfile', () => {
  it('maps core fields and uses system_prompt as base_prompt', () => {
    const { profile } = mapCardToProfile(makeCard());

    expect(profile.name).toBe('Test Character');
    expect(profile.description).toBe('A test');
    expect(profile.personality).toBe('cheerful');
    expect(profile.base_prompt).toBe('You are Test.');
    expect(profile.scenario).toBe('');
    expect(profile.appearance).toBe('');
    expect(profile.voice_characteristics).toBe('');
    expect(profile.vision_config_id).toBeNull();
    expect(profile.lifecycle_config).toBe('{}');
  });

  it('applies the default typing speed and audio chance', () => {
    const { profile } = mapCardToProfile(makeCard());
    expect(profile.typing_speed_wpm).toBe(60);
    expect(profile.audio_response_chance_percent).toBe(50);
  });

  it('formats example_dialogues from first_mes, mes_example and alternate greetings', () => {
    const { profile } = mapCardToProfile(makeCard());

    // Each segment appends "\n\n---\n\n" (mirrors Go mapExampleDialogues).
    expect(profile.example_dialogues).toBe(
      'EXAMPLE DIALOGUES:\n\n' +
        'Hi there!\n\n---\n\n' +
        'User: hey\nChar: hello\n\n---\n\n' +
        'Alt greeting!\n\n---\n\n',
    );
  });

  it('formats backstory from an enabled character book entry and skips disabled ones', () => {
    const card = makeCard({
      character_book: {
        name: 'lore',
        extensions: {},
        entries: [
          { keys: ['castle', 'home'], content: 'Lives in a castle.', extensions: {}, enabled: true, insertion_order: 0 },
          { keys: ['secret'], content: 'Has a secret.', extensions: {}, enabled: false, insertion_order: 1 },
        ],
      },
    });

    const { profile } = mapCardToProfile(card);

    // Each enabled entry appends "Keywords: ...\n<content>\n\n---\n\n" (mirrors Go).
    expect(profile.backstory).toBe(
      'CHARACTER LORE:\n\n' +
        'Keywords: castle, home\n' +
        'Lives in a castle.\n\n---\n\n',
    );
  });

  it('returns an empty backstory when there is no character book', () => {
    const { profile } = mapCardToProfile(makeCard({ character_book: null }));
    expect(profile.backstory).toBe('');
  });

  it('throws CharacterCardParseError when the card has no name', () => {
    expect(() => mapCardToProfile(makeCard({ name: '' }))).toThrow(
      CharacterCardParseError,
    );
  });

  it('creates an image payload from PNG bytes', () => {
    const { profile, image } = mapCardToProfile(
      makeCard(),
      new Uint8Array([1, 2, 3]),
    );

    expect(image).not.toBeNull();
    expect(image!.character_profile_id).toBe(profile.id);
    // uint8ArrayToBase64([1,2,3]) === 'AQID'
    expect(image!.image_data).toBe('AQID');
    expect(image!.mime_type).toBe('image/png');
    expect(image!.is_primary).toBe(true);
    expect(image!.display_order).toBe(0);
  });

  it('returns a null image when no PNG bytes are provided', () => {
    const { image } = mapCardToProfile(makeCard());
    expect(image).toBeNull();
  });

  it('generates a UUID v7 profile id', () => {
    const { profile } = mapCardToProfile(makeCard());
    // UUID v7: 8-4-4-4-12 hex, version nibble = 7
    expect(profile.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});
