/**
 * EditorState mapping tests (Phase 8) — the extracted
 * `profileToEditorState` / `editorStateToProfileFields` mapping that drives the
 * CreateAI edit-mode save path and the V3 round-trip test.
 *
 * Verifies:
 *  - profileToEditorState: snake_case DB fields → camelCase state (JSON
 *    columns decoded defensively; defaults for absent columns).
 *  - editorStateToProfileFields: camelCase state → snake_case columns with the
 *    mapper JSON conventions (`JSON.stringify(x ?? null)`), trimmed text with
 *    '' fallback, numeric fallbacks.
 *  - state → fields → state round-trips losslessly for every V3 column.
 */

import type { CharacterProfile } from '../../../../database/models';
import {
  editorStateToProfileFields,
  profileToEditorState,
} from '../editorState';

const PROFILE = {
  id: 'p1',
  name: 'Aria',
  description: 'A wandering fire-mage',
  personality: 'Warm, playful',
  voice_characteristics: 'low and warm',
  base_prompt: 'You are Aria.',
  scenario: 'By a campfire',
  typing_speed_wpm: 75,
  audio_response_chance_percent: 40,
  vision_config_id: null,
  lifecycle_config: '{"autonomy_level":2}',
  first_mes: 'Oh! You startled me.',
  mes_example: '<START>\n{{user}}: Hi',
  alternate_greetings: '["Alt A","Alt B"]',
  post_history_instructions: 'Never break character.',
  creator_notes: 'Homebrew original.',
  creator: 'Emberforge Studio',
  character_version: '1.4.2',
  nickname: 'Aria',
  tags: '["fantasy","mage"]',
  group_only_greetings: '["Greetings, travellers!"]',
  extensions: '{"harmony":{"appearance":"copper hair"}}',
  assets: '[{"type":"icon","uri":"ccdefault:"}]',
  card_provenance: '{"spec":"chara_card_v3","spec_version":"3.0","source":["https://example.com/a"]}',
  character_book: '{"name":"Codex","entries":[{"keys":["k"],"content":"c","enabled":true}]}',
  created_at: new Date(),
  updated_at: new Date(),
  deleted_at: null,
} as unknown as CharacterProfile;

describe('editorState — profileToEditorState (snake_case DB → camelCase state)', () => {
  it('decodes JSON-string columns defensively', () => {
    const state = profileToEditorState(PROFILE);
    expect(state.alternateGreetings).toEqual(['Alt A', 'Alt B']);
    expect(state.tags).toEqual(['fantasy', 'mage']);
    expect(state.groupOnlyGreetings).toEqual(['Greetings, travellers!']);
    expect(state.extensions).toEqual({ harmony: { appearance: 'copper hair' } });
    expect(state.assets).toEqual([{ type: 'icon', uri: 'ccdefault:' }]);
    expect(state.cardProvenance).toEqual({
      spec: 'chara_card_v3',
      spec_version: '3.0',
      source: ['https://example.com/a'],
    });
    expect(state.characterBook).toBe(PROFILE.character_book);
    expect(state.lifecycleConfig).toEqual({ autonomy_level: 2 });
  });

  it('maps text columns to camelCase state', () => {
    const state = profileToEditorState(PROFILE);
    expect(state.name).toBe('Aria');
    expect(state.firstMes).toBe('Oh! You startled me.');
    expect(state.mesExample).toBe('<START>\n{{user}}: Hi');
    expect(state.postHistoryInstructions).toBe('Never break character.');
    expect(state.creatorNotes).toBe('Homebrew original.');
    expect(state.creator).toBe('Emberforge Studio');
    expect(state.characterVersion).toBe('1.4.2');
    expect(state.nickname).toBe('Aria');
    expect(state.typingSpeedWpm).toBe('75');
    expect(state.audioResponseChance).toBe('40');
  });

  it("defaults absent/empty columns (engine may sync 'null'/''/invalid JSON)", () => {
    const state = profileToEditorState({
      ...PROFILE,
      alternate_greetings: 'null',
      tags: '',
      extensions: '{not-json',
      assets: 'null',
      card_provenance: 'null',
      character_book: 'null',
      lifecycle_config: 'null',
    } as CharacterProfile);
    expect(state.alternateGreetings).toEqual([]);
    expect(state.tags).toEqual([]);
    expect(state.extensions).toEqual({});
    expect(state.assets).toBeNull();
    expect(state.cardProvenance).toBeNull();
    // character_book is a raw JSON pass-through ('null' stays 'null'; the
    // lorebook parser normalizes it at render time).
    expect(state.characterBook).toBe('null');
    expect(state.lifecycleConfig).toEqual({});
  });
});

describe('editorState — editorStateToProfileFields (camelCase state → snake_case DB)', () => {
  it('encodes JSON columns with the mapper convention (`JSON.stringify(x ?? null)`)', () => {
    const fields = editorStateToProfileFields({
      name: 'Aria',
      description: 'd',
      personality: 'p',
      voiceCharacteristics: 'v',
      typingSpeedWpm: '60',
      audioResponseChance: '50',
      basePrompt: 'bp',
      scenario: 's',
      firstMes: 'fm',
      alternateGreetings: ['A', 'B'],
      mesExample: 'me',
      postHistoryInstructions: 'ujb',
      creatorNotes: 'cn',
      creator: 'c',
      characterVersion: '1.0',
      nickname: 'n',
      tags: ['fantasy'],
      groupOnlyGreetings: [],
      extensions: { harmony: {} },
      assets: null,
      cardProvenance: { spec: 'chara_card_v3' },
      characterBook: '{"entries":[]}',
      lifecycleConfig: { autonomy_level: 1 },
    });
    expect(fields.alternate_greetings).toBe(JSON.stringify(['A', 'B']));
    expect(fields.tags).toBe(JSON.stringify(['fantasy']));
    expect(fields.group_only_greetings).toBe(JSON.stringify(null));
    expect(fields.extensions).toBe(JSON.stringify({ harmony: {} }));
    expect(fields.assets).toBe(JSON.stringify(null));
    expect(fields.card_provenance).toBe(JSON.stringify({ spec: 'chara_card_v3' }));
    expect(fields.character_book).toBe('{"entries":[]}');
    expect(fields.lifecycle_config).toBe(JSON.stringify({ autonomy_level: 1 }));
  });

  it('trims text columns with \'\' fallback and falls back numerically', () => {
    const fields = editorStateToProfileFields({
      name: '  Aria  ',
      description: '  ',
      personality: '',
      voiceCharacteristics: '  v  ',
      typingSpeedWpm: 'not-a-number',
      audioResponseChance: '250',
      basePrompt: '',
      scenario: '  s  ',
      firstMes: '  fm  ',
      alternateGreetings: [],
      mesExample: '',
      postHistoryInstructions: '',
      creatorNotes: '',
      creator: '',
      characterVersion: '',
      nickname: '',
      tags: [],
      groupOnlyGreetings: [],
      extensions: {},
      assets: null,
      cardProvenance: null,
      characterBook: null,
      lifecycleConfig: {},
    });
    expect(fields.name).toBe('Aria');
    expect(fields.description).toBe('');
    expect(fields.voice_characteristics).toBe('v');
    expect(fields.typing_speed_wpm).toBe(60); // invalid → fallback
    // No silent clamping in the serializer: out-of-range values pass through
    // and the screen's save path raises a validation alert instead.
    expect(fields.audio_response_chance_percent).toBe(250);
    expect(fields.scenario).toBe('s');
    expect(fields.first_mes).toBe('fm');
    expect(fields.card_provenance).toBe('');
    expect(fields.character_book).toBe('');
    expect(fields.alternate_greetings).toBe(JSON.stringify(null));
  });
});

describe('editorState — round-trip fidelity (profile → state → fields)', () => {
  it('preserves every V3 column through the mapping', () => {
    const state = profileToEditorState(PROFILE);
    const fields = editorStateToProfileFields(state);

    expect(fields.name).toBe(PROFILE.name);
    expect(fields.description).toBe(PROFILE.description);
    expect(fields.personality).toBe(PROFILE.personality);
    expect(fields.voice_characteristics).toBe(PROFILE.voice_characteristics);
    expect(fields.typing_speed_wpm).toBe(PROFILE.typing_speed_wpm);
    expect(fields.audio_response_chance_percent).toBe(PROFILE.audio_response_chance_percent);
    expect(fields.base_prompt).toBe(PROFILE.base_prompt);
    expect(fields.scenario).toBe(PROFILE.scenario);
    expect(fields.first_mes).toBe(PROFILE.first_mes);
    expect(fields.mes_example).toBe(PROFILE.mes_example);
    expect(fields.alternate_greetings).toBe(PROFILE.alternate_greetings);
    expect(fields.post_history_instructions).toBe(PROFILE.post_history_instructions);
    expect(fields.creator_notes).toBe(PROFILE.creator_notes);
    expect(fields.creator).toBe(PROFILE.creator);
    expect(fields.character_version).toBe(PROFILE.character_version);
    expect(fields.nickname).toBe(PROFILE.nickname);
    expect(fields.tags).toBe(PROFILE.tags);
    expect(fields.group_only_greetings).toBe(PROFILE.group_only_greetings);
    expect(fields.extensions).toBe(PROFILE.extensions);
    expect(fields.assets).toBe(PROFILE.assets);
    expect(fields.card_provenance).toBe(PROFILE.card_provenance);
    expect(fields.character_book).toBe(PROFILE.character_book);
    expect(fields.lifecycle_config).toBe(PROFILE.lifecycle_config);
  });
});