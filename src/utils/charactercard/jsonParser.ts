/**
 * Character Card JSON Parser
 *
 * Faithful port of harmony-link-private/utils/charactercard/png_parser.go
 * function ParseCharacterCard.
 *
 * Detects V2/V3 via top-level "spec" field, falls back to V1 by checking
 * for a non-empty "name" field, then coerces V1 into V2 structure.
 */

import { CharacterCardParseError, TavernCardV2, TavernCardV2Data, TavernCardV1 } from './types';

/**
 * Normalize an optional string to '' if null/undefined, or the string itself.
 */
function normalizeString(val: unknown): string {
  if (typeof val === 'string') return val;
  return '';
}

/**
 * Normalize an optional array to [] if null/undefined, or the array itself.
 */
function normalizeArray<T>(val: unknown): T[] {
  if (Array.isArray(val)) return val as T[];
  return [];
}

/**
 * Normalize TavernCardV2Data fields to handle missing/null JSON fields
 * (Go would zero-value them; TS needs explicit defaults).
 *
 * Unknown top-level keys are PRESERVED: we spread the incoming `data` and
 * override only the known/normalized fields, so spec-mandated unknown-key
 * round-tripping (SPEC_V3:115 — P4 export depends on it) is retained.
 * `extensions` stays opaque.
 */
function normalizeData(data: Partial<TavernCardV2Data>): TavernCardV2Data {
  return {
    ...data,
    name: normalizeString(data.name),
    description: normalizeString(data.description),
    personality: normalizeString(data.personality),
    scenario: normalizeString(data.scenario),
    first_mes: normalizeString(data.first_mes),
    mes_example: normalizeString(data.mes_example),
    creator_notes: normalizeString(data.creator_notes),
    system_prompt: normalizeString(data.system_prompt),
    post_history_instructions: normalizeString(data.post_history_instructions),
    alternate_greetings: normalizeArray<string>(data.alternate_greetings),
    character_book: data.character_book ?? null,
    tags: normalizeArray<string>(data.tags),
    creator: normalizeString(data.creator),
    character_version: normalizeString(data.character_version),
    extensions: (data.extensions && typeof data.extensions === 'object' ? data.extensions : {}) as Record<string, unknown>,
  };
}

/**
 * Parse a JSON string into a TavernCardV2.
 *
 * Detection order (mirrors Go):
 * 1. If JSON has top-level "spec" == "chara_card_v2" or "chara_card_v3" → parse as V2
 * 2. Otherwise try V1: if it has a non-empty "name" → coerce to V2
 * 3. Otherwise throw CharacterCardParseError
 */
export function parseCharacterCard(json: string): TavernCardV2 {
  let parsed: unknown;

  try {
    parsed = JSON.parse(json);
  } catch {
    throw new CharacterCardParseError('failed to parse JSON: invalid JSON');
  }

  if (typeof parsed !== 'object' || parsed === null) {
    throw new CharacterCardParseError('failed to parse JSON: not an object');
  }

  // --- V2/V3 detection ---
  const maybeV2 = parsed as Record<string, unknown>;
  const spec = maybeV2.spec;

  if (spec === 'chara_card_v2' || spec === 'chara_card_v3') {
    // Parse as V2 (mirrors Go: unmarshal into TavernCardV2 after spec check)
    const v2 = parsed as TavernCardV2;
    // Go would re-unmarshal the full JSON; in TS the parsed object is the same,
    // but we validate by checking required fields exist
    if (!v2.data || typeof v2.data !== 'object') {
      throw new CharacterCardParseError('failed to parse V2/V3 card: missing data field');
    }
    v2.data = normalizeData(v2.data);
    return v2;
  }

  // --- V1 fallback ---
  const v1 = parsed as TavernCardV1;

  if (typeof v1.name === 'string' && v1.name !== '') {
    return {
      spec: 'chara_card_v2',
      spec_version: '2.0',
      data: {
        name: normalizeString(v1.name),
        description: normalizeString(v1.description),
        personality: normalizeString(v1.personality),
        scenario: normalizeString(v1.scenario),
        first_mes: normalizeString(v1.first_mes),
        mes_example: normalizeString(v1.mes_example),
        creator_notes: '',
        system_prompt: '',
        post_history_instructions: '',
        alternate_greetings: [],
        character_book: null,
        tags: [],
        creator: '',
        character_version: '',
        extensions: {},
      },
    };
  }

  throw new CharacterCardParseError('unable to detect or parse character card format');
}
