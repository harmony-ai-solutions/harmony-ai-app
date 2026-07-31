/**
 * Character Card Mapper
 *
 * Faithful port of harmony-link-private/utils/charactercard/mapper.go
 *
 * Maps a TavernCardV2 to CharacterProfile + CharacterImage,
 * matching the database models exactly.
 */

import { CharacterCardParseError, TavernCardV2, TavernCardV2Data, CharacterBook } from './types';
import { generateId } from '../uuid';
import { uint8ArrayToBase64 } from '../../database/base64';
import type { CharacterProfile, CharacterImage } from '../../database/models';

/**
 * Convert character book entries to formatted backstory text.
 *
 * Mirrors Go mapCharacterBook exactly:
 * - Returns "" if book is nil or has no entries
 * - Prefixes with "CHARACTER LORE:\n\n"
 * - Skips disabled entries
 * - Each entry: "Keywords: <keys>\n<content>\n\n---\n\n"
 */
function mapCharacterBook(book: CharacterBook | null | undefined): string {
  if (!book || !book.entries || book.entries.length === 0) {
    return '';
  }

  let result = 'CHARACTER LORE:\n\n';

  for (const entry of book.entries) {
    if (entry.enabled === false) {
      continue;
    }
    result += `Keywords: ${(entry.keys || []).join(', ')}\n`;
    result += entry.content || '';
    result += '\n\n---\n\n';
  }

  return result;
}

/**
 * Convert first message, mes_example, and alternate greetings to formatted text.
 *
 * Mirrors Go mapExampleDialogues exactly:
 * - Prefixes with "EXAMPLE DIALOGUES:\n\n"
 * - Appends first_mes if non-empty + "\n\n---\n\n"
 * - Appends mes_example if non-empty + "\n\n---\n\n"
 * - Appends each alternate_greeting + "\n\n---\n\n"
 */
function mapExampleDialogues(data: TavernCardV2Data): string {
  let result = 'EXAMPLE DIALOGUES:\n\n';

  if (data.first_mes) {
    result += data.first_mes;
    result += '\n\n---\n\n';
  }

  if (data.mes_example) {
    result += data.mes_example;
    result += '\n\n---\n\n';
  }

  if (data.alternate_greetings && Array.isArray(data.alternate_greetings)) {
    for (const greeting of data.alternate_greetings) {
      result += greeting;
      result += '\n\n---\n\n';
    }
  }

  return result;
}

/**
 * Map a TavernCardV2 to a CharacterProfile and optional CharacterImage.
 *
 * Mirrors Go MapToCharacterProfile exactly, adapting for the TS type system:
 * - Generates a new UUID v7 id via generateId()
 * - Maps card fields to the CharacterProfile schema
 * - If imageBytes provided, creates a CharacterImage with base64-encoded PNG data
 *
 * @throws CharacterCardParseError if card.data.name is empty
 */
export function mapCardToProfile(
  card: TavernCardV2,
  imageBytes?: Uint8Array,
): {
  profile: Omit<CharacterProfile, 'created_at' | 'updated_at' | 'deleted_at'>;
  image: Omit<CharacterImage, 'id' | 'created_at' | 'deleted_at'> | null;
} {
  if (!card.data?.name) {
    throw new CharacterCardParseError('character card must have a name');
  }

  const profileId = generateId();

  const profile: Omit<CharacterProfile, 'created_at' | 'updated_at' | 'deleted_at'> = {
    id: profileId,
    name: card.data.name,
    description: card.data.description ?? '',
    personality: card.data.personality ?? '',
    appearance: '',
    backstory: mapCharacterBook(card.data.character_book),
    voice_characteristics: '',
    base_prompt: card.data.system_prompt ?? null,
    scenario: card.data.scenario ?? null,
    example_dialogues: mapExampleDialogues(card.data),
    typing_speed_wpm: 60,
    audio_response_chance_percent: 50,
    vision_config_id: null,
    lifecycle_config: '{}',
  };

  let image: Omit<CharacterImage, 'id' | 'created_at' | 'deleted_at'> | null = null;

  if (imageBytes && imageBytes.length > 0) {
    image = {
      character_profile_id: profileId,
      image_data: uint8ArrayToBase64(imageBytes),
      mime_type: 'image/png',
      description: '',
      is_primary: true,
      display_order: 0,
      vl_model_interpretation: '',
      vl_model: '',
      updated_at: new Date(),
    };
  }

  return { profile, image };
}
