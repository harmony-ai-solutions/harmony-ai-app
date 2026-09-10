import { mapCardToProfile } from '../mapper';
import { CharacterCardParseError } from '../types';
import type { TavernCardV2, CharacterBook } from '../types';

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
    expect(profile.voice_characteristics).toBe('');
    expect(profile.vision_config_id).toBeNull();
    expect(profile.lifecycle_config).toBe('{}');
  });

  it('applies the default typing speed and audio chance', () => {
    const { profile } = mapCardToProfile(makeCard());
    expect(profile.typing_speed_wpm).toBe(60);
    expect(profile.audio_response_chance_percent).toBe(50);
  });


  it('stores character_book spec fields only — non-spec keys stripped (no-unknown-fields policy)', () => {
    const book: CharacterBook = {
      name: 'Lore Book',
      description: 'Book description',
      scan_depth: 50,
      token_budget: 1000,
      recursive_scanning: false,
      extensions: { custom: 1 },
      entries: [
        {
          keys: ['castle', 'home'],
          content: 'Lives in a castle.',
          extensions: {},
          enabled: true,
          insertion_order: 0,
          case_sensitive: true,
          use_regex: false,
          constant: true,
          name: 'home',
          priority: 5,
          id: 42,
          comment: 'A comment',
          selective: true,
          secondary_keys: ['keep'],
          position: 'after_char',
          vendor_key: 'preserved',
        },
        {
          keys: ['secret'],
          content: 'Has a secret.',
          extensions: {},
          enabled: false,
          insertion_order: 1,
        },
      ],
    };

    const { profile } = mapCardToProfile(makeCard({ character_book: book }));

    // The stored book has all spec-modeled fields; unknown keys are dropped
    // (no-unknown-fields policy).
    const stored = JSON.parse(profile.character_book!);
    expect(stored.name).toBe(book.name);
    expect(stored.description).toBe(book.description);
    expect(stored.scan_depth).toBe(book.scan_depth);
    expect(stored.token_budget).toBe(book.token_budget);
    expect(stored.recursive_scanning).toBe(book.recursive_scanning);
    expect(stored.extensions).toEqual(book.extensions);
    expect(stored.entries).toHaveLength(2);
    // All modeled entry fields preserved.
    expect(stored.entries[0].keys).toEqual(['castle', 'home']);
    expect(stored.entries[0].position).toBe('after_char');
    expect(stored.entries[0].case_sensitive).toBe(true);
    // Unknown entry key is dropped on store.
    expect(stored.entries[0]).not.toHaveProperty('vendor_key');
    expect(stored.entries[1].enabled).toBe(false);
  });

  it('stores null JSON for character_book when the card has no lorebook', () => {
    const { profile } = mapCardToProfile(makeCard({ character_book: null }));
    expect(profile.character_book).toBe('null');
  });

  it('maps all 14 V3 standard fields 1:1', () => {
    const card = makeCard({
      first_mes: 'Hello there!',
      mes_example: '<START>\nUser: hi\nChar: hello',
      alternate_greetings: ['Alt one', 'Alt two'],
      post_history_instructions: 'Keep it brief.',
      creator_notes: 'Creator notes',
      creator: 'Some Creator',
      character_version: '1.2.3',
      nickname: 'Nick',
      tags: ['fantasy', 'mage'],
      group_only_greetings: ['Group hello'],
      extensions: { custom: { nested: true } },
      assets: [{ type: 'icon', uri: 'ccdefault:', name: 'main', ext: 'png' }],
      source: ['https://example.com/card.json'],
      creation_date: 1700000000,
      modification_date: 1700000001,
      creator_notes_multilingual: { en: 'English notes', ja: 'Japanese notes' },
    });
    card.spec = 'chara_card_v3';
    card.spec_version = '3.0';

    const { profile } = mapCardToProfile(card);

    expect(profile.first_mes).toBe(card.data.first_mes);
    expect(profile.mes_example).toBe(card.data.mes_example);
    expect(JSON.parse(profile.alternate_greetings!)).toEqual(['Alt one', 'Alt two']);
    expect(profile.post_history_instructions).toBe('Keep it brief.');
    expect(profile.creator_notes).toBe('Creator notes');
    expect(profile.creator).toBe('Some Creator');
    expect(profile.character_version).toBe('1.2.3');
    expect(profile.nickname).toBe('Nick');
    expect(JSON.parse(profile.tags!)).toEqual(['fantasy', 'mage']);
    expect(JSON.parse(profile.group_only_greetings!)).toEqual(['Group hello']);
    expect(JSON.parse(profile.extensions!)).toEqual({ custom: { nested: true } });
    expect(JSON.parse(profile.assets!)).toEqual([
      { type: 'icon', uri: 'ccdefault:', name: 'main', ext: 'png' },
    ]);
  });

  it('round-trips card_provenance from the V3 provenance fields', () => {
    const card = makeCard({
      source: ['https://example.com/card.json'],
      creation_date: 1700000000,
      modification_date: 1700000001,
      creator_notes_multilingual: { en: 'English notes', ja: 'Japanese notes' },
    });
    card.spec = 'chara_card_v3';
    card.spec_version = '3.0';

    const { profile } = mapCardToProfile(card);

    expect(JSON.parse(profile.card_provenance!)).toEqual({
      spec: 'chara_card_v3',
      spec_version: '3.0',
      source: ['https://example.com/card.json'],
      creation_date: 1700000000,
      modification_date: 1700000001,
      creator_notes_multilingual: { en: 'English notes', ja: 'Japanese notes' },
    });
  });

  it('fills card_provenance with nulls when V3 provenance fields are absent (V2 card)', () => {
    const { profile } = mapCardToProfile(makeCard());

    expect(JSON.parse(profile.card_provenance!)).toEqual({
      spec: 'chara_card_v2',
      spec_version: '2.0',
      source: null,
      creation_date: null,
      modification_date: null,
      creator_notes_multilingual: null,
    });
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
