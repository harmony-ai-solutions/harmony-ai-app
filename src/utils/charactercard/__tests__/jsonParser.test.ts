import { parseCharacterCard } from '../jsonParser';
import { CharacterCardParseError } from '../types';
import type { TavernCardV2 } from '../types';

describe('parseCharacterCard', () => {
  it('parses a V2 card (spec = chara_card_v2)', () => {
    const json = JSON.stringify({
      spec: 'chara_card_v2',
      spec_version: '2.0',
      data: {
        name: 'Aria',
        description: 'A singer',
        personality: 'kind',
        system_prompt: 'You are Aria.',
        first_mes: 'Hello!',
      },
    });

    const card = parseCharacterCard(json);

    expect(card.spec).toBe('chara_card_v2');
    expect(card.data.name).toBe('Aria');
    expect(card.data.description).toBe('A singer');
    expect(card.data.system_prompt).toBe('You are Aria.');
    expect(card.data.first_mes).toBe('Hello!');
    // Missing optional fields normalize to empty defaults
    expect(card.data.alternate_greetings).toEqual([]);
    expect(card.data.character_book).toBeNull();
  });

  it('parses a V3 card (spec = chara_card_v3) as V2-compatible', () => {
    const json = JSON.stringify({
      spec: 'chara_card_v3',
      spec_version: '3.0',
      data: { name: 'V3 Char' },
    });

    const card = parseCharacterCard(json);

    expect(card.spec).toBe('chara_card_v3');
    expect(card.data.name).toBe('V3 Char');
  });

  it('coerces a V1 card (top-level name) into a V2 shape', () => {
    const json = JSON.stringify({
      // No `spec` → V1 fallback path
      name: 'Legacy',
      description: 'old desc',
      personality: 'stoic',
      scenario: 'a tavern',
      first_mes: 'Greetings.',
      mes_example: 'User: hi\nChar: hey',
    });

    const card: TavernCardV2 = parseCharacterCard(json);

    expect(card.spec).toBe('chara_card_v2');
    expect(card.spec_version).toBe('2.0');
    expect(card.data.name).toBe('Legacy');
    expect(card.data.description).toBe('old desc');
    expect(card.data.personality).toBe('stoic');
    expect(card.data.scenario).toBe('a tavern');
    expect(card.data.first_mes).toBe('Greetings.');
    expect(card.data.mes_example).toBe('User: hi\nChar: hey');
    // Coerced defaults
    expect(card.data.system_prompt).toBe('');
    expect(card.data.alternate_greetings).toEqual([]);
  });

  it('throws CharacterCardParseError on invalid JSON', () => {
    expect(() => parseCharacterCard('{ not valid json')).toThrow(
      CharacterCardParseError,
    );
  });

  it('throws when the JSON is not an object', () => {
    expect(() => parseCharacterCard('"just a string"')).toThrow(
      CharacterCardParseError,
    );
    expect(() => parseCharacterCard('null')).toThrow(CharacterCardParseError);
  });

  it('throws for a V2 card missing the data field', () => {
    const json = JSON.stringify({ spec: 'chara_card_v2', spec_version: '2.0' });
    expect(() => parseCharacterCard(json)).toThrow(CharacterCardParseError);
  });

  it('throws "unable to detect" when there is no spec and no name', () => {
    expect(() =>
      parseCharacterCard(JSON.stringify({ description: 'no name, no spec' })),
    ).toThrow(/unable to detect/);
  });
});
