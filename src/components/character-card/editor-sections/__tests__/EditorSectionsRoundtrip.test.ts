/**
 * Editor-suite round-trip test (Phase 8 verification gate).
 *
 * Loads the shared V3 card fixture (`utils/charactercard/__tests__/fixtures/
 * v3-card.json`), maps it to a profile, derives the editor-suite form state
 * (`profileToEditorState` — the exact mapping the CreateAI edit-mode load
 * uses), applies an edit to EVERY section (greeting, alternate greetings,
 * lorebook, tags, attribution, lifecycle, scenario, prompts, images-adjacent
 * columns), rebuilds the profile fields (`editorStateToProfileFields` — the
 * exact mapping the save path uses), exports via `exportProfileToCardV3` and
 * re-parses → field-by-field parity with the expected edited card.
 *
 * Known mutations excluded from parity (documented exporter behaviour):
 *   - `modification_date` is bumped to now on export (SPEC_V3:205-207)
 *   - `_future_extension` is dropped on import (no-unknown-fields policy)
 */

import { parseCharacterCard } from '../../../../utils/charactercard/jsonParser';
import { mapCardToProfile } from '../../../../utils/charactercard/mapper';
import {
  exportProfileToCardV3,
  exportToJSON,
} from '../../../../utils/charactercard/exporter';
import type { CharacterBook } from '../../../../utils/charactercard/types';
import {
  editorStateToProfileFields,
  profileToEditorState,
} from '../editorState';

import fixture from '../../../../utils/charactercard/__tests__/fixtures/v3-card.json';

type FixtureData = {
  name: string;
  description: string;
  personality: string;
  scenario: string;
  first_mes: string;
  mes_example: string;
  creator_notes: string;
  system_prompt: string;
  post_history_instructions: string;
  alternate_greetings: string[];
  character_book?: CharacterBook;
  tags: string[];
  creator: string;
  character_version: string;
  extensions: Record<string, unknown>;
  assets: unknown[];
  nickname: string;
  creator_notes_multilingual: Record<string, string>;
  source: string[];
  group_only_greetings: string[];
  creation_date: number;
  modification_date: number;
};

/** Deep-clone the fixture data so edits never mutate the shared module cache. */
function cloneFixtureData(): FixtureData {
  return JSON.parse(JSON.stringify((fixture as { data: FixtureData }).data));
}

describe('Editor-suite round-trip (Phase 8 gate)', () => {
  it('imports the V3 fixture, edits every section, exports → field-by-field parity', () => {
    // 1. Import: fixture → parsed card → profile.
    const parsed = parseCharacterCard(JSON.stringify(fixture));
    const { profile } = mapCardToProfile(parsed);

    // 2. Derive editor state exactly as the edit-mode load path does.
    const state = profileToEditorState(profile);

    // Sanity: the state reflects the fixture (proves the derivation works).
    expect(state.name).toBe('Aria Sunweaver');
    expect(state.firstMes).toContain('Oh! You startled me.');
    expect(state.alternateGreetings).toHaveLength(2);
    expect(state.tags).toEqual(['fantasy', 'mage', 'music']);
    expect(state.creator).toBe('Emberforge Studio');
    expect(state.characterVersion).toBe('1.4.2');
    expect(state.nickname).toBe('Aria');
    expect(state.cardProvenance).toMatchObject({
      spec: 'chara_card_v3',
      spec_version: '3.0',
      source: ['https://example.com/cards/aria-sunweaver'],
      creation_date: 1700000000,
    });
    expect(state.characterBook).toBeTruthy();

    // 3. Apply an edit to EVERY section.
    const expected = cloneFixtureData();

    // Greeting + alternate greetings.
    state.firstMes = 'Oh! You found me by the fire. {{user}}.';
    expected.first_mes = state.firstMes;
    state.alternateGreetings = [...state.alternateGreetings, 'One more opening line.'];
    expected.alternate_greetings = [...state.alternateGreetings];

    // Lorebook: edit an entry, toggle flags, add a new entry.
    const book = JSON.parse(state.characterBook!) as CharacterBook;
    book.entries[0].content = 'Edited: Aria sings a new verse about the embers.';
    book.entries[0].constant = true;
    book.entries[1].enabled = false;
    book.entries.push({
      keys: ['lullaby'],
      content: 'A new lore entry for the edited card.',
      extensions: {},
      enabled: true,
      insertion_order: 30,
      constant: false,
    });
    state.characterBook = JSON.stringify(book);
    expected.character_book = book;

    // Tags.
    state.tags = [...state.tags, 'bard'];
    expected.tags = [...state.tags];

    // Attribution: creator / creator_notes / character_version / provenance.
    state.creator = 'Emberforge Studios (edited)';
    expected.creator = state.creator;
    state.creatorNotes = 'Remix-friendly, free to use.';
    expected.creator_notes = state.creatorNotes;
    state.characterVersion = '2.0.0';
    expected.character_version = state.characterVersion;
    state.cardProvenance = {
      ...state.cardProvenance,
      source: [...(state.cardProvenance?.source as string[] ?? []), 'https://example.com/cards/aria-v2'],
      creator_notes_multilingual: {
        ...((state.cardProvenance?.creator_notes_multilingual as Record<string, string>) ?? {}),
        en: 'Edited notes.',
      },
    };
    expected.source = state.cardProvenance!.source as string[];
    expected.creator_notes_multilingual = state.cardProvenance!
      .creator_notes_multilingual as Record<string, string>;

    // General / Details.
    state.name = 'Aria Sunweaver II';
    expected.name = state.name;
    state.description = 'A wandering fire-mage who sings the embers back to life. (edited)';
    expected.description = state.description;
    state.nickname = 'Aria Edit';
    expected.nickname = state.nickname;
    state.personality = 'Calm, curious, fiercely loyal.';
    expected.personality = state.personality;
    state.scenario = 'By a quiet river at dusk, the last light fading.';
    expected.scenario = state.scenario;
    state.basePrompt = 'You are Aria, revised. Keep responses vivid and sensory.';
    expected.system_prompt = state.basePrompt;
    state.postHistoryInstructions = 'Never break character. Describe heat, sound, smell.';
    expected.post_history_instructions = state.postHistoryInstructions;
    state.mesExample = '<START>\n{{user}}: The river is cold.\n{{char}}: Then let me warm it.';
    expected.mes_example = state.mesExample;
    state.voiceCharacteristics = 'soft and melodic';
    state.typingSpeedWpm = '72';
    state.audioResponseChance = '45';
    state.groupOnlyGreetings = [...state.groupOnlyGreetings, 'A second party greeting.'];
    expected.group_only_greetings = [...state.groupOnlyGreetings];
    state.extensions = {
      ...state.extensions,
      harmony: { ...(state.extensions.harmony as Record<string, unknown>), appearance: 'silver hair' },
    };
    expected.extensions = state.extensions;
    state.assets = [...(state.assets ?? []), { type: 'background', uri: 'https://example.com/bg2.webp', name: 'dusk', ext: 'webp' }];
    expected.assets = state.assets;

    // Lifecycle (local column, not a card field — but must serialize losslessly).
    state.lifecycleConfig = {
      autonomy_level: 2,
      beat_interval: 900,
      sleep_threshold: 0.7,
      core_memories_k: 5,
    };

    // 4. Rebuild the profile columns exactly as the save path does, export, re-parse.
    const fields = editorStateToProfileFields(state);
    const editedProfile = { ...profile, ...fields };
    const exported = exportProfileToCardV3(editedProfile, []);
    const reparsed = parseCharacterCard(exportToJSON(exported));
    const re = reparsed.data as unknown as FixtureData;

    // 5. Field-by-field parity (known mutations excluded).
    expect(exported.spec).toBe('chara_card_v3');
    expect(exported.spec_version).toBe('3.0');
    expect(reparsed.spec).toBe('chara_card_v3');
    expect(reparsed.spec_version).toBe('3.0');

    expect(re.name).toBe(expected.name);
    expect(re.description).toBe(expected.description);
    expect(re.personality).toBe(expected.personality);
    expect(re.scenario).toBe(expected.scenario);
    expect(re.first_mes).toBe(expected.first_mes);
    expect(re.mes_example).toBe(expected.mes_example);
    expect(re.creator_notes).toBe(expected.creator_notes);
    expect(re.system_prompt).toBe(expected.system_prompt);
    expect(re.post_history_instructions).toBe(expected.post_history_instructions);
    expect(re.alternate_greetings).toEqual(expected.alternate_greetings);
    expect(re.character_book).toEqual(expected.character_book);
    expect(re.tags).toEqual(expected.tags);
    expect(re.creator).toBe(expected.creator);
    expect(re.character_version).toBe(expected.character_version);
    expect(re.extensions).toEqual(expected.extensions);
    expect(re.assets).toEqual(expected.assets);
    expect(re.nickname).toBe(expected.nickname);
    expect(re.creator_notes_multilingual).toEqual(expected.creator_notes_multilingual);
    expect(re.source).toEqual(expected.source);
    expect(re.group_only_greetings).toEqual(expected.group_only_greetings);
    expect(re.creation_date).toBe(expected.creation_date);
    // modification_date bumped on export (SPEC_V3:205-207).
    expect(re.modification_date).toBe(exported.data.modification_date);
    expect(re.modification_date as number).toBeGreaterThan(expected.modification_date);
    // Unknown keys are dropped on import (no-unknown-fields policy).
    expect((re as unknown as Record<string, unknown>)._future_extension).toBeUndefined();

    // Lifecycle config survives the state → columns serialization losslessly.
    expect(JSON.parse(fields.lifecycle_config!)).toEqual(state.lifecycleConfig);
  });

  it('an untouched round-trip keeps the exact profile columns stable (no edit drift)', () => {
    const parsed = parseCharacterCard(JSON.stringify(fixture));
    const { profile } = mapCardToProfile(parsed);
    const state = profileToEditorState(profile);
    const fields = editorStateToProfileFields(state);

    for (const key of [
      'first_mes',
      'mes_example',
      'alternate_greetings',
      'post_history_instructions',
      'creator_notes',
      'creator',
      'character_version',
      'nickname',
      'tags',
      'group_only_greetings',
      'extensions',
      'assets',
      'card_provenance',
      'character_book',
    ] as const) {
      expect(fields[key as keyof typeof fields]).toBe(profile[key]);
    }
  });
});