/**
 * itemSnapshots — snapshot builders for publishing marketplace items.
 *
 * A listing stores a FROZEN snapshot (`payload_json`) of the content at
 * publish time. These helpers build that snapshot from the user's existing
 * local data (characters, themes) or from scratch text.
 *
 * No I/O to the cloud here — only local repo reads + pure serialization.
 */

import {
  getCharacterProfile,
  getPrimaryImage,
} from '../../database/repositories/characters';
import { isCharacterCreator } from '../../database/repositories/characterSocial';
import type { MarketplaceItemType } from './marketplaceTypes';

export interface CharacterSnapshot {
  name: string;
  description: string | null;
  personality: string | null;
  appearance: string | null;
  backstory: string | null;
  base_prompt: string | null;
  scenario: string | null;
  example_dialogues: string | null;
  voice_characteristics: string | null;
  typing_speed_wpm: number | null;
  audio_response_chance_percent: number | null;
  image_data: string | null;
  image_mime: string | null;
}

/**
 * Build a character snapshot from a local character profile. Includes the
 * primary image (base64) when present. Throws if the profile is missing or
 * the caller isn't the recorded creator (you can't sell someone else's).
 */
export async function buildCharacterSnapshot(
  profileId: string,
  currentUserId?: string | null,
): Promise<CharacterSnapshot> {
  const profile = await getCharacterProfile(profileId);
  if (!profile) {
    throw new Error('character_profile_not_found');
  }

  // Owner guard — refuse to snapshot a character the caller doesn't own.
  if (currentUserId) {
    try {
      const creator = await isCharacterCreator(profileId, currentUserId);
      if (!creator) {
        throw new Error('not_your_character');
      }
    } catch (e) {
      if (e instanceof Error && e.message === 'not_your_character') throw e;
      // No creator recorded → treat as owned (local profiles)
    }
  }

  let imageData: string | null = null;
  let imageMime: string | null = null;
  try {
    const primary = await getPrimaryImage(profileId);
    if (primary) {
      imageData = primary.image_data;
      imageMime = primary.mime_type;
    }
  } catch {
    // image is optional
  }

  return {
    name: profile.name,
    description: profile.description,
    personality: profile.personality,
    appearance: profile.appearance,
    backstory: profile.backstory,
    base_prompt: profile.base_prompt,
    scenario: profile.scenario,
    example_dialogues: profile.example_dialogues,
    voice_characteristics: profile.voice_characteristics,
    typing_speed_wpm: profile.typing_speed_wpm,
    audio_response_chance_percent: profile.audio_response_chance_percent,
    image_data: imageData,
    image_mime: imageMime,
  };
}

/**
 * Extract a single text field from a character profile as a standalone
 * snapshot for text item types.
 */
export async function buildTextSnapshot(
  profileId: string,
  field: 'backstory' | 'description' | 'personality' | 'prompt' | 'dialogue',
): Promise<string> {
  const profile = await getCharacterProfile(profileId);
  if (!profile) {
    throw new Error('character_profile_not_found');
  }
  switch (field) {
    case 'backstory':
      return profile.backstory ?? '';
    case 'description':
      return profile.description ?? '';
    case 'personality':
      return profile.personality ?? '';
    case 'prompt':
      return profile.base_prompt ?? '';
    case 'dialogue':
      return profile.example_dialogues ?? '';
    default:
      return '';
  }
}

/** Build the publish payload for a character (card-like snapshot). */
export interface CraftedItem {
  itemType: MarketplaceItemType;
  title: string;
  summary: string | null;
  tags: string[];
  priceSouls: number;
  payloadJson: unknown;
  previewImageData: string | null;
  previewMimeType: string | null;
  previewText: string | null;
}

export function craftCharacterPublish(
  snapshot: CharacterSnapshot,
  opts: {
    title?: string;
    summary?: string;
    tags?: string[];
    priceSouls: number;
  },
): CraftedItem {
  return {
    itemType: 'character',
    title: opts.title?.trim() || snapshot.name,
    summary: opts.summary?.trim() ?? null,
    tags: opts.tags ?? [],
    priceSouls: opts.priceSouls,
    payloadJson: snapshot,
    previewImageData: snapshot.image_data,
    previewMimeType: snapshot.image_mime,
    previewText: snapshot.description?.slice(0, 200) ?? null,
  };
}

export function craftTextPublish(
  text: string,
  itemType: Extract<MarketplaceItemType, 'backstory' | 'description' | 'personality' | 'prompt' | 'dialogue'>,
  opts: {
    title?: string;
    summary?: string;
    tags?: string[];
    priceSouls: number;
  },
): CraftedItem {
  const clean = text.trim();
  const payload: { text: string } = { text: clean };
  return {
    itemType,
    title: opts.title?.trim() || defaultTextTitle(itemType),
    summary: opts.summary?.trim() ?? null,
    tags: opts.tags ?? [],
    priceSouls: opts.priceSouls,
    payloadJson: payload,
    previewImageData: null,
    previewMimeType: null,
    previewText: clean.slice(0, 200),
  };
}

function defaultTextTitle(type: MarketplaceItemType): string {
  switch (type) {
    case 'backstory':
      return 'Backstory';
    case 'description':
      return 'Description';
    case 'personality':
      return 'Personality';
    case 'prompt':
      return 'Prompt';
    case 'dialogue':
      return 'Example Dialogues';
    default:
      return 'Content';
  }
}