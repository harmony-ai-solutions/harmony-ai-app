import { parseCharacterCard } from '../jsonParser';
import { extractCharacterCardFromPNG } from '../pngParser';

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

/** Build a PNG chunk: 4-byte BE length + 4-byte type + data + 4-byte dummy CRC. */
function makeChunk(type: string, data: number[]): number[] {
  const len = data.length;
  return [
    (len >>> 24) & 0xff,
    (len >>> 16) & 0xff,
    (len >>> 8) & 0xff,
    len & 0xff,
    type.charCodeAt(0),
    type.charCodeAt(1),
    type.charCodeAt(2),
    type.charCodeAt(3),
    ...data,
    0,
    0,
    0,
    0, // CRC (not validated by the parser)
  ];
}

/** tEXt chunk data: keyword + NUL + text. */
function textChunkData(keyword: string, text: string): number[] {
  return [
    ...[...keyword].map((c) => c.charCodeAt(0)),
    0, // NUL terminator
    ...[...text].map((c) => c.charCodeAt(0)),
  ];
}

/** Build a minimal PNG with one or more tEXt chunks. */
function buildPngWithTextChunks(
  chunks: { keyword: string; text: string }[],
): Uint8Array {
  const data: number[] = [...PNG_SIGNATURE];
  // A throwaway IHDR-like chunk (type 'IHDR') so the file looks like a PNG.
  data.push(...makeChunk('IHDR', [0, 0, 0, 1, 0, 0, 0, 1, 8, 0, 0, 0]));
  for (const chunk of chunks) {
    data.push(...makeChunk('tEXt', textChunkData(chunk.keyword, chunk.text)));
  }
  data.push(...makeChunk('IEND', []));
  return new Uint8Array(data);
}

describe('Character Card V3 superset (1-5 TS)', () => {
  it('parses a V3 card with all V3-only fields populated', () => {
    const json = JSON.stringify({
      spec: 'chara_card_v3',
      spec_version: '3.0',
      data: {
        name: 'Aria',
        description: 'A singer',
        personality: 'kind',
        scenario: 'a stage',
        first_mes: 'Hello!',
        mes_example: '',
        creator_notes: 'notes',
        system_prompt: 'sys',
        post_history_instructions: 'phi',
        alternate_greetings: [],
        character_book: null,
        tags: ['singer'],
        creator: 'someone',
        character_version: '1.0',
        extensions: { custom: 1 },
        assets: [{ type: 'icon', uri: 'ccdefault:', name: 'main', ext: 'png' }],
        nickname: 'Aria Lee',
        creator_notes_multilingual: { en: 'english notes', ja: 'japanese notes' },
        source: ['https://example.com/card'],
        group_only_greetings: ['Group hello'],
        creation_date: 1700000000,
        modification_date: 1700000001,
      },
    });

    const card = parseCharacterCard(json);

    expect(card.data.name).toBe('Aria');
    expect(card.data.nickname).toBe('Aria Lee');
    expect(card.data.assets).toEqual([
      { type: 'icon', uri: 'ccdefault:', name: 'main', ext: 'png' },
    ]);
    expect(card.data.creator_notes_multilingual).toEqual({
      en: 'english notes',
      ja: 'japanese notes',
    });
    expect(card.data.source).toEqual(['https://example.com/card']);
    expect(card.data.group_only_greetings).toEqual(['Group hello']);
    expect(card.data.creation_date).toBe(1700000000);
    expect(card.data.modification_date).toBe(1700000001);
  });

  it('detects unknown top-level keys on parse (detection vessel for the import warning)', () => {
    const json = JSON.stringify({
      spec: 'chara_card_v3',
      spec_version: '3.0',
      data: {
        name: 'Aria',
        description: '',
        personality: '',
        scenario: '',
        first_mes: '',
        mes_example: '',
        creator_notes: '',
        system_prompt: '',
        post_history_instructions: '',
        alternate_greetings: [],
        character_book: null,
        tags: [],
        creator: '',
        character_version: '',
        extensions: { custom: 1 },
        some_future_field: { nested: [1, 2, 3] },
        another_vendor_key: 'value',
      },
    });

    const card = parseCharacterCard(json);
    const roundTripped = JSON.parse(JSON.stringify(card));

    expect(roundTripped.data.some_future_field).toEqual({ nested: [1, 2, 3] });
    expect(roundTripped.data.another_vendor_key).toBe('value');
  });

  it('parses CharacterBookEntry V3 fields and detects unknown entry keys', () => {
    const json = JSON.stringify({
      spec: 'chara_card_v2',
      spec_version: '2.0',
      data: {
        name: 'Aria',
        description: '',
        personality: '',
        scenario: '',
        first_mes: '',
        mes_example: '',
        creator_notes: '',
        system_prompt: '',
        post_history_instructions: '',
        alternate_greetings: [],
        character_book: {
          name: 'lorebook',
          description: 'desc',
          scan_depth: 50,
          token_budget: 1000,
          recursive_scanning: false,
          extensions: {},
          entries: [
            {
              keys: ['key1'],
              content: 'lore content',
              extensions: {},
              enabled: true,
              insertion_order: 10,
              case_sensitive: true,
              use_regex: false,
              constant: false,
              name: 'entry name',
              priority: 5,
              id: 'custom-id-1',
              comment: 'a comment',
              selective: true,
              secondary_keys: ['alt1'],
              position: 'after_char',
              vendor_entry_key: 'preserved',
            },
          ],
        },
        tags: [],
        creator: '',
        character_version: '',
        extensions: {},
      },
    });

    const card = parseCharacterCard(json);
    const entry = card.data.character_book!.entries[0];

    expect(entry.case_sensitive).toBe(true);
    expect(entry.use_regex).toBe(false);
    expect(entry.constant).toBe(false);
    expect(entry.name).toBe('entry name');
    expect(entry.priority).toBe(5);
    expect(entry.id).toBe('custom-id-1');
    expect(entry.comment).toBe('a comment');
    expect(entry.selective).toBe(true);
    expect(entry.secondary_keys).toEqual(['alt1']);
    expect(entry.position).toBe('after_char');
    // Unknown entry keys are detected on parse (dropped on store/export per
    // the no-unknown-fields policy).
    expect((entry as Record<string, unknown>).vendor_entry_key).toBe(
      'preserved',
    );
  });

  it('accepts a numeric entry id', () => {
    const json = JSON.stringify({
      spec: 'chara_card_v2',
      spec_version: '2.0',
      data: {
        name: 'Aria',
        description: '',
        personality: '',
        scenario: '',
        first_mes: '',
        mes_example: '',
        creator_notes: '',
        system_prompt: '',
        post_history_instructions: '',
        alternate_greetings: [],
        character_book: {
          extensions: {},
          entries: [
            {
              keys: ['k'],
              content: 'c',
              extensions: {},
              enabled: true,
              insertion_order: 0,
              id: 42,
            },
          ],
        },
        tags: [],
        creator: '',
        character_version: '',
        extensions: {},
      },
    });

    const card = parseCharacterCard(json);
    expect(card.data.character_book!.entries[0].id).toBe(42);
  });
});

describe('extractCharacterCardFromPNG ccv3 preference (1-5 TS)', () => {
  const v2Json = JSON.stringify({
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data: { name: 'V2Char' },
  });
  const v3Json = JSON.stringify({
    spec: 'chara_card_v3',
    spec_version: '3.0',
    data: { name: 'V3Char', nickname: 'V3Nick' },
  });

  it('prefers the ccv3 chunk over chara when both are present', () => {
    const png = buildPngWithTextChunks([
      { keyword: 'chara', text: Buffer.from(v2Json).toString('base64') },
      { keyword: 'ccv3', text: Buffer.from(v3Json).toString('base64') },
    ]);

    const { card } = extractCharacterCardFromPNG(png);

    expect(card.spec).toBe('chara_card_v3');
    expect(card.data.name).toBe('V3Char');
    expect(card.data.nickname).toBe('V3Nick');
  });

  it('prefers ccv3 regardless of chunk order', () => {
    const png = buildPngWithTextChunks([
      { keyword: 'ccv3', text: Buffer.from(v3Json).toString('base64') },
      { keyword: 'chara', text: Buffer.from(v2Json).toString('base64') },
    ]);

    const { card } = extractCharacterCardFromPNG(png);

    expect(card.spec).toBe('chara_card_v3');
    expect(card.data.name).toBe('V3Char');
  });

  it('falls back to the chara chunk when no ccv3 chunk exists', () => {
    const png = buildPngWithTextChunks([
      { keyword: 'chara', text: Buffer.from(v2Json).toString('base64') },
    ]);

    const { card } = extractCharacterCardFromPNG(png);

    expect(card.spec).toBe('chara_card_v2');
    expect(card.data.name).toBe('V2Char');
  });
});
