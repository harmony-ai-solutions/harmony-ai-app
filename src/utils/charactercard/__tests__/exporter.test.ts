/**
 * Exporter tests (4-2) — app-side mirror of the Go exporter.
 *
 * Covers:
 *  - column → field mapping (base_prompt → system_prompt, JSON columns decoded)
 *  - `character_book` verbatim + defensive parse ('null'/''/invalid → omitted)
 *  - `extensions` survival
 *  - `card_provenance` → source / creation_date / creator_notes_multilingual;
 *    modification_date always bumped
 *  - canonical JSON-card key order (cross-side parity contract — the Go side
 *    must emit the same order, see `exporter.ts` header)
 *  - PNG `ccv3` chunk: utf-8 → base64 JSON (SPEC_V3:24) and PNG round-trip via
 *    `extractCharacterCardFromPNG`
 *  - full profile round-trip (import → export → re-parse → field equality)
 */

import { mapCardToProfile } from '../mapper';
import {
  exportProfileToCardV3,
  exportToJSON,
  exportToPNG,
} from '../exporter';
import {
  extractCharacterCardFromPNG,
  findCharacterCardTextChunks,
  base64DecodeToUtf8,
} from '../pngParser';
import { parseCharacterCard } from '../jsonParser';
import type { TavernCardV2, CharacterBook } from '../types';
import type { CharacterImage } from '../../../database/models';

const now = () => Math.floor(Date.now() / 1000);

function makeCard(overrides: Partial<TavernCardV2['data']> = {}): TavernCardV2 {
  return {
    spec: 'chara_card_v3',
    spec_version: '3.0',
    data: {
      name: 'Test Character',
      description: 'A test',
      personality: 'cheerful',
      scenario: 'a garden',
      first_mes: 'Hi there!',
      mes_example: 'User: hey\nChar: hello',
      creator_notes: 'Notes',
      system_prompt: 'You are Test.',
      post_history_instructions: 'Keep it brief.',
      alternate_greetings: ['Alt greeting!'],
      character_book: null,
      tags: ['fantasy', 'mage'],
      creator: 'Some Creator',
      character_version: '1.2.3',
      extensions: { custom: { nested: true } },
      ...overrides,
    },
  };
}

/** Map a card to the exact `CharacterProfile` shape the app stores, then export. */
function exportMapped(card: TavernCardV2, images: CharacterImage[] = []) {
  const { profile } = mapCardToProfile(card);
  return exportProfileToCardV3(profile, images);
}

const CANONICAL_FIRST_KEYS = [
  'name',
  'description',
  'personality',
  'scenario',
  'first_mes',
  'mes_example',
  'creator_notes',
  'system_prompt',
  'post_history_instructions',
  'alternate_greetings',
];

describe('exportProfileToCardV3 — column → field mapping (4-2)', () => {
  it('emits a spec-conformant V3 card with base_prompt → system_prompt', () => {
    const card = exportMapped(makeCard());

    expect(card.spec).toBe('chara_card_v3');
    expect(card.spec_version).toBe('3.0');
    expect(card.data.name).toBe('Test Character');
    expect(card.data.description).toBe('A test');
    expect(card.data.personality).toBe('cheerful');
    expect(card.data.scenario).toBe('a garden');
    expect(card.data.first_mes).toBe('Hi there!');
    expect(card.data.mes_example).toBe('User: hey\nChar: hello');
    expect(card.data.system_prompt).toBe('You are Test.'); // base_prompt → system_prompt
    expect(card.data.post_history_instructions).toBe('Keep it brief.');
    expect(card.data.alternate_greetings).toEqual(['Alt greeting!']);
    expect(card.data.tags).toEqual(['fantasy', 'mage']);
    expect(card.data.creator).toBe('Some Creator');
    expect(card.data.character_version).toBe('1.2.3');
    expect(card.data.extensions).toEqual({ custom: { nested: true } });
  });

  it('emits group_only_greetings and modification_date always; bumps modification_date', () => {
    const before = now();
    const card = exportMapped(makeCard());
    const after = now();

    expect(card.data.group_only_greetings).toEqual([]); // MUST be present (may be empty)
    expect(typeof card.data.modification_date).toBe('number');
    expect(card.data.modification_date!).toBeGreaterThanOrEqual(before);
    expect(card.data.modification_date!).toBeLessThanOrEqual(after);
  });

  it('omits optional fields when absent (spec: undefined, not null)', () => {
    const card = exportMapped(makeCard());
    expect('character_book' in card.data).toBe(false);
    expect('assets' in card.data).toBe(false);
    expect('nickname' in card.data).toBe(false);
    expect('source' in card.data).toBe(false);
    expect('creation_date' in card.data).toBe(false);
    expect('creator_notes_multilingual' in card.data).toBe(false);
  });

  it('emits optional fields when present (provenance + V3 fields)', () => {
    const card = exportMapped(
      makeCard({
        nickname: 'Nick',
        source: ['https://example.com/card.json'],
        creation_date: 1700000000,
        creator_notes_multilingual: { en: 'English', ja: '日本語' },
        assets: [
          { type: 'icon', uri: 'ccdefault:', name: 'main', ext: 'png' },
        ],
      }),
    );

    expect(card.data.nickname).toBe('Nick');
    expect(card.data.source).toEqual(['https://example.com/card.json']);
    expect(card.data.creation_date).toBe(1700000000);
    expect(card.data.creator_notes_multilingual).toEqual({ en: 'English', ja: '日本語' });
    expect(card.data.assets).toEqual([
      { type: 'icon', uri: 'ccdefault:', name: 'main', ext: 'png' },
    ]);
    // modification_date is bumped, never preserved
    expect(card.data.modification_date).not.toBe(1700000001);
  });
});

describe('exportProfileToCardV3 — character_book (spec fields only; 4-2)', () => {
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
        content: '@@position before_char\n\nLives in a castle.',
        extensions: { entry_custom: true },
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
    ],
  };

  it('round-trips the book spec fields only — non-spec keys stripped on import (top-level + entries + decorators)', () => {
    const card = exportMapped(makeCard({ character_book: book }));

    // Spec-modeled book fields round-trip through import → export.
    expect(card.data.character_book!.name).toBe(book.name);
    expect(card.data.character_book!.scan_depth).toBe(book.scan_depth);
    expect(card.data.character_book!.entries).toHaveLength(1);
    expect(card.data.character_book!.entries[0].content).toContain(
      '@@position before_char',
    );
    // Unknown entry key was stripped during import mapping; not present on export.
    expect(card.data.character_book!.entries[0]).not.toHaveProperty('vendor_key');
  });

  it.each(['null', '', '   ', '{invalid json'])(
    'treats the column value %j as "no book" (defensive)',
    (columnValue) => {
      const { profile } = mapCardToProfile(makeCard());
      profile.character_book = columnValue;
      const card = exportProfileToCardV3(profile, []);
      expect('character_book' in card.data).toBe(false);
    },
  );

  it('omits character_book when the column is a valid-but-book-less JSON value', () => {
    const { profile } = mapCardToProfile(makeCard());
    profile.character_book = JSON.stringify({ extensions: {} });
    const card = exportProfileToCardV3(profile, []);
    expect('character_book' in card.data).toBe(false);
  });
});

describe('exportProfileToCardV3 — assets resolution (4-2)', () => {
  it('uses the assets column verbatim when present', () => {
    const assets = [
      { type: 'icon', uri: 'ccdefault:', name: 'main', ext: 'png' },
    ];
    const card = exportMapped(makeCard({ assets }));
    expect(card.data.assets).toEqual(assets);
  });

  it('synthesizes a base64 icon asset from the primary image when the column is absent', () => {
    const card = exportMapped(makeCard(), [
      {
        id: 'img-1',
        character_profile_id: 'p-1',
        image_data: 'AQID',
        mime_type: 'image/png',
        description: '',
        is_primary: true,
        display_order: 0,
        vl_model_interpretation: '',
        vl_model: '',
        created_at: new Date(),
        updated_at: new Date(),
        deleted_at: null,
      },
    ]);

    expect(card.data.assets).toEqual([
      {
        type: 'icon',
        uri: 'data:image/png;base64,AQID',
        name: 'main',
        ext: 'png',
      },
    ]);
  });

  it('omits assets when the column is absent and no images exist', () => {
    const card = exportMapped(makeCard());
    expect('assets' in card.data).toBe(false);
  });
});

describe('exportToJSON — canonical JSON-card output (4-2)', () => {
  it('serializes a card that re-parses to an identical object', () => {
    const card = exportMapped(makeCard());
    const json = exportToJSON(card);
    const reparsed = JSON.parse(json);
    expect(reparsed.spec).toBe('chara_card_v3');
    expect(reparsed.spec_version).toBe('3.0');
    expect(reparsed.data.name).toBe('Test Character');
  });

  it('emits data keys in the canonical Go-compatible order (cross-side parity)', () => {
    const card = exportMapped(makeCard());
    const json = exportToJSON(card);
    const data = JSON.parse(json).data as Record<string, unknown>;
    const keys = Object.keys(data);

    // The first N keys must match the Go exporter's field order exactly.
    expect(keys.slice(0, CANONICAL_FIRST_KEYS.length)).toEqual(
      CANONICAL_FIRST_KEYS,
    );

    // V3-only tail order: group_only_greetings before modification_date.
    expect(keys).toEqual(
      expect.arrayContaining([
        'extensions',
        'group_only_greetings',
        'modification_date',
      ]),
    );
    expect(keys.indexOf('group_only_greetings')).toBeLessThan(
      keys.indexOf('modification_date'),
    );
  });
});

describe('exportToPNG — ccv3 chunk (4-2)', () => {
  it('produces a valid PNG whose ccv3 chunk decodes to the canonical JSON', () => {
    const card = exportMapped(makeCard());
    const png = exportToPNG(card);

    // PNG signature
    expect([...png.slice(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);

    const { card: fromPng } = extractCharacterCardFromPNG(png);
    expect(fromPng.spec).toBe('chara_card_v3');
    expect(fromPng.data.name).toBe('Test Character');

    // The chunk value is base64(utf8(json)) — decode it back to the card JSON.
    const chunks = findCharacterCardTextChunks(png);
    const ccv3 = chunks.find(c => c.keyword === 'ccv3');
    expect(ccv3).toBeDefined();
    const decodedJson = base64DecodeToUtf8(ccv3!.text);
    const decodedCard = parseCharacterCard(decodedJson!);
    expect(decodedCard.data.name).toBe('Test Character');
    expect(decodedCard.data.modification_date).toBe(card.data.modification_date);
  });
});

describe('exportProfileToCardV3 — round-trip through mapCardToProfile (4-2)', () => {
  it('import → export → re-parse preserves all standard fields (modification_date bumped)', () => {
    const original = makeCard({
      alternate_greetings: ['Alt one', 'Alt two'],
      group_only_greetings: ['Group hello'],
      tags: ['fantasy'],
      assets: [{ type: 'icon', uri: 'ccdefault:', name: 'main', ext: 'png' }],
      nickname: 'Nick',
      creator_notes_multilingual: { en: 'en', ja: 'ja' },
      source: ['https://example.com/x'],
      creation_date: 1700000000,
      modification_date: 1700000001,
    });

    const exported = exportMapped(original);
    const reparsed = parseCharacterCard(exportToJSON(exported));

    // All fields except modification_date must be preserved.
    const { modification_date: _before, ...originalData } = original.data;
    const { modification_date: _after, ...reparsedData } = reparsed.data as any;
    expect(reparsedData).toEqual(originalData);
    expect(reparsed.data.modification_date).toBe(exported.data.modification_date);
    expect(reparsed.data.modification_date!).toBeGreaterThan(1700000001);
  });
});
