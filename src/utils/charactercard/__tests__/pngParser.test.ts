import {
  extractCharacterCardFromPNG,
  findCharacterCardTextChunks,
  base64DecodeToUtf8,
} from '../pngParser';
import { CharacterCardParseError } from '../types';

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

/** Build a minimal PNG whose only meaningful chunk is a tEXt chara/ccv3 chunk. */
function buildPngWithCharaText(keyword: string, text: string): Uint8Array {
  const data: number[] = [...PNG_SIGNATURE];
  // A throwaway IHDR-like chunk (type 'IHDR') so the file looks like a PNG.
  data.push(...makeChunk('IHDR', [0, 0, 0, 1, 0, 0, 0, 1, 8, 0, 0, 0]));
  // The tEXt chunk: keyword + NUL + text
  const textData: number[] = [
    ...[...keyword].map(c => c.charCodeAt(0)),
    0, // NUL terminator
    ...[...text].map(c => c.charCodeAt(0)),
  ];
  data.push(...makeChunk('tEXt', textData));
  // IEND terminator
  data.push(...makeChunk('IEND', []));
  return new Uint8Array(data);
}

describe('base64DecodeToUtf8', () => {
  it('decodes a standard base64 string', () => {
    // 'Hello' -> base64
    expect(base64DecodeToUtf8('SGVsbG8=')).toBe('Hello');
  });

  it('decodes ASCII matching Node Buffer', () => {
    const original = '{"name":"Test"}';
    const encoded = Buffer.from(original).toString('base64');
    expect(base64DecodeToUtf8(encoded)).toBe(original);
  });

  it('returns null for empty input', () => {
    expect(base64DecodeToUtf8('')).toBeNull();
  });
});

describe('findCharacterCardTextChunks', () => {
  it('returns chara/ccv3 tEXt chunks', () => {
    const png = buildPngWithCharaText('chara', 'SGVsbG8=');
    const chunks = findCharacterCardTextChunks(png);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].keyword).toBe('chara');
    expect(chunks[0].text).toBe('SGVsbG8=');
  });

  it('throws on an invalid PNG signature', () => {
    expect(() =>
      findCharacterCardTextChunks(new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7])),
    ).toThrow(CharacterCardParseError);
  });
});

describe('extractCharacterCardFromPNG', () => {
  it('extracts and parses a card embedded as base64 JSON in a tEXt/chara chunk', () => {
    const cardJson = JSON.stringify({
      spec: 'chara_card_v2',
      spec_version: '2.0',
      data: { name: 'Pixel', description: 'from a png' },
    });
    const encoded = Buffer.from(cardJson).toString('base64');
    const png = buildPngWithCharaText('chara', encoded);

    const { card, imageBytes } = extractCharacterCardFromPNG(png);

    expect(card.spec).toBe('chara_card_v2');
    expect(card.data.name).toBe('Pixel');
    expect(card.data.description).toBe('from a png');
    // imageBytes is the original PNG buffer
    expect(imageBytes).toBe(png);
  });

  it('also recognises the ccv3 keyword', () => {
    const cardJson = JSON.stringify({
      spec: 'chara_card_v3',
      spec_version: '3.0',
      data: { name: 'V3Png' },
    });
    const encoded = Buffer.from(cardJson).toString('base64');
    const png = buildPngWithCharaText('ccv3', encoded);

    const { card } = extractCharacterCardFromPNG(png);
    expect(card.data.name).toBe('V3Png');
  });

  it('throws on a non-PNG file', () => {
    expect(() =>
      extractCharacterCardFromPNG(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])),
    ).toThrow(/not a valid PNG/);
  });

  it('throws when no character card chunk is present', () => {
    const png = buildPngWithCharaText('comment', 'not a card');
    expect(() => extractCharacterCardFromPNG(png)).toThrow(
      /no character card data found/,
    );
  });
});
