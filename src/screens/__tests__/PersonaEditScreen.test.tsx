/**
 * PersonaEditScreen — personaMode full-editor tests (3-2-B).
 *
 * Verifies:
 *  - create mode: full-field save via createUserPersona; lifecycle_config is
 *    NEVER written (personaMode — decision 2)
 *  - reserved-name `user` block (trim + case-insensitive — decision 14)
 *  - edit mode: save via updateUserPersona (id frozen — RN rename semantics)
 *  - built-in `user`: rename + delete locked; pre-seed empty state until the
 *    engine seeder syncs a linked profile (decision 8)
 *  - personaMode hidden-sections: lifecycle + advanced never render; greeting
 *    TEST is disabled (decision 13)
 *  - active-persona delete gate (review 2a)
 *  - persona export fires the RNFS write + Share (2-4 parity)
 */

import React from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react-native';
import { Share } from 'react-native';
import { PersonaEditScreen } from '../PersonaEditScreen';

afterEach(cleanup);
beforeEach(cleanup);

// Stable mock references — the screen's load effect lists `t`/`navigation` in
// its deps; the real app provides stable values, so the test mocks must too
// (otherwise the effect re-runs on every render → infinite reload loop).
const mockT = (key: string) => key;
const mockNavigation = { navigate: jest.fn(), goBack: jest.fn() };

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: mockT }),
}));

jest.mock('../../utils/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

jest.mock('react-native-linear-gradient', () => {
  const React = require('react');
  const { View } = require('react-native');
  return ({ children, style, ...props }: any) =>
    React.createElement(View, { style, ...props }, children);
});

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('react-native-image-picker', () => ({
  launchImageLibrary: jest.fn(),
}));

jest.mock('react-native-vector-icons/MaterialCommunityIcons', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return ({ name, ...props }: any) => React.createElement(Text, { ...props }, name);
});

jest.mock('uuid', () => ({ v4: () => 'test-uuid' }));

jest.mock('react-native-fs', () => ({
  CachesDirectoryPath: '/cache',
  writeFile: jest.fn().mockResolvedValue(undefined),
}));

const mockShowAlert = jest.fn();

jest.mock('../../contexts/ThemeContext', () => ({
  useAppTheme: () => ({
    theme: {
      colors: {
        accent: { primary: '#7c3aed', secondary: '#a78bfa' },
        background: { base: '#0f0f1a', surface: '#151d30', elevated: '#1e1e2e' },
        border: { default: '#333333' },
        text: { primary: '#ffffff', secondary: '#cccccc', muted: '#aaaaaa', disabled: '#555555' },
        status: { success: '#22c55e', warning: '#f59e0b', error: '#ef4444' },
      },
    },
  }),
}));

jest.mock('../../contexts/AppAlertContext', () => ({
  useAppAlert: () => ({ showAlert: mockShowAlert }),
}));

jest.mock('../../contexts/BiometricLockContext', () => ({
  useBiometricLock: () => ({ withExternalFlow: (fn: any) => fn() }),
}));

let mockRouteParams: any = {};

jest.mock('@react-navigation/native', () => {
  const React = require('react');
  return {
    useNavigation: () => mockNavigation,
    useRoute: () => ({ params: mockRouteParams }),
  };
});

// Themed components — plain primitives.
jest.mock('../../components/themed/ThemedView', () => {
  const React = require('react');
  const { View } = require('react-native');
  return { __esModule: true, ThemedView: ({ children, style, ...props }: any) =>
    React.createElement(View, { style, ...props }, children) };
});
jest.mock('../../components/themed/ThemedText', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return { __esModule: true, ThemedText: ({ children, style, ...props }: any) =>
    React.createElement(Text, { style, ...props }, children) };
});
jest.mock('../../components/themed/ThemedCard', () => {
  const React = require('react');
  const { View } = require('react-native');
  return { __esModule: true, ThemedCard: ({ children, style, ...props }: any) =>
    React.createElement(View, { style, ...props }, children) };
});
jest.mock('../../components/themed/ThemedButton', () => {
  const React = require('react');
  const { View, Text } = require('react-native');
  return {
    __esModule: true,
    ThemedButton: ({ label, onPress, disabled, testID, ...props }: any) =>
      React.createElement(
        View,
        {
          onPress: () => onPress(),
          accessibilityState: { disabled: !!disabled },
          testID,
          accessibilityRole: 'button',
          ...props,
        },
        React.createElement(Text, { testID: testID ? `${testID}-label` : undefined }, label),
      ),
  };
});
jest.mock('../../components/themed/ScreenHeader', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    ScreenHeader: ({ children, right, ...props }: any) =>
      React.createElement(View, { testID: 'screen-header-mock', ...props }, children, right),
  };
});
jest.mock('../../components/themed/SectionHeader', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return { __esModule: true, SectionHeader: ({ title, ...props }: any) =>
    React.createElement(Text, { ...props }, title) };
});
jest.mock('../../components/profile/ProfileAvatar', () => {
  const React = require('react');
  const { View, Text } = require('react-native');
  return { __esModule: true, ProfileAvatar: ({ name, uri }: any) =>
    React.createElement(View, null,
      React.createElement(Text, null, `avatar:${name}`),
      uri ? React.createElement(Text, null, `dataurl:${uri}`) : null) };
});

jest.mock('../../utils/colorUtils', () => ({
  hexToRgba: (hex: string, alpha: number) => hex,
}));

// ── Repos ─────────────────────────────────────────────────────────────────
jest.mock('../../database/repositories/userEntities', () => ({
  createUserPersona: jest.fn(),
  updateUserPersona: jest.fn(),
  getUserPersona: jest.fn(),
  deleteUserPersona: jest.fn(),
  resolvePersonaId: jest.fn(),
}));

jest.mock('../../database/repositories/entities', () => ({
  getEntity: jest.fn(),
  getAllEntities: jest.fn().mockResolvedValue([]),
}));

jest.mock('../../database/repositories/characters', () => ({
  getCharacterProfile: jest.fn(),
  getCharacterImages: jest.fn().mockResolvedValue([]),
  createCharacterImage: jest.fn().mockResolvedValue(undefined),
  updateCharacterImage: jest.fn().mockResolvedValue(undefined),
  deleteCharacterImage: jest.fn().mockResolvedValue(undefined),
  getAllCharacterProfiles: jest.fn().mockResolvedValue([]),
}));

jest.mock('../../services/SyncService', () => ({
  __esModule: true,
  default: { syncAndWait: jest.fn().mockResolvedValue(undefined) },
}));

jest.mock('../../services/ChatPreferencesService', () => ({
  __esModule: true,
  default: {
    getGlobalImpersonatedEntity: jest.fn().mockResolvedValue(null),
    setGlobalImpersonatedEntity: jest.fn().mockResolvedValue(undefined),
  },
}));

// ── Shared editor-sections suite: section COMPONENTS mocked as shells (the
//    screen under test is the wiring — the sections themselves are covered by
//    ProfileEditorSections.test.tsx); the pure state helpers are re-implemented
//    inline so the save path can be asserted (lifecycle_config strip included).
jest.mock('../../components/character-card/editor-sections', () => {
  const React = require('react');
  const { View, Text, TouchableOpacity } = require('react-native');
  return {
    GreetingEditorSection: (props: any) =>
      React.createElement(
        View,
        { testID: 'greeting-editor-section-mock' },
        React.createElement(Text, null, `testDisabled:${props.testDisabled}`),
      ),
    AlternateGreetingsSection: () =>
      React.createElement(View, { testID: 'alternate-greetings-section-mock' }),
    LorebookSection: () => React.createElement(View, { testID: 'lorebook-section-mock' }),
    TagsSection: () => React.createElement(View, { testID: 'tags-section-mock' }),
    AttributionSection: () => React.createElement(View, { testID: 'attribution-section-mock' }),
    ExportSection: ({ onExport }: any) =>
      React.createElement(
        TouchableOpacity,
        { testID: 'export-card-button', onPress: () => onExport('json') },
      ),
    computeImageDeltas: jest.fn().mockReturnValue({ create: [], update: [], remove: [] }),
    editorStateToProfileFields: (state: any) => ({
      name: state.name,
      description: state.description,
      personality: state.personality,
      voice_characteristics: state.voiceCharacteristics,
      typing_speed_wpm: parseInt(state.typingSpeedWpm, 10) || 60,
      audio_response_chance_percent: parseInt(state.audioResponseChance, 10) || 50,
      base_prompt: state.basePrompt,
      scenario: state.scenario,
      first_mes: state.firstMes,
      mes_example: state.mesExample,
      alternate_greetings: JSON.stringify(state.alternateGreetings),
      post_history_instructions: state.postHistoryInstructions,
      creator_notes: state.creatorNotes,
      creator: state.creator,
      character_version: state.characterVersion,
      nickname: state.nickname,
      tags: JSON.stringify(state.tags),
      group_only_greetings: JSON.stringify(state.groupOnlyGreetings),
      extensions: JSON.stringify(state.extensions),
      assets: JSON.stringify(state.assets),
      card_provenance: state.cardProvenance ? JSON.stringify(state.cardProvenance) : '',
      character_book: state.characterBook ?? '',
      lifecycle_config: JSON.stringify(state.lifecycleConfig ?? {}),
    }),
    profileToEditorState: (profile: any) => ({
      name: profile.name ?? '',
      description: profile.description ?? '',
      personality: profile.personality ?? '',
      voiceCharacteristics: profile.voice_characteristics ?? '',
      typingSpeedWpm: String(profile.typing_speed_wpm ?? 60),
      audioResponseChance: String(profile.audio_response_chance_percent ?? 50),
      basePrompt: profile.base_prompt ?? '',
      scenario: profile.scenario ?? '',
      mesExample: profile.mes_example ?? '',
      nickname: profile.nickname ?? '',
      firstMes: profile.first_mes ?? '',
      alternateGreetings: [],
      postHistoryInstructions: profile.post_history_instructions ?? '',
      creatorNotes: profile.creator_notes ?? '',
      creator: profile.creator ?? '',
      characterVersion: profile.character_version ?? '',
      tags: [],
      groupOnlyGreetings: [],
      extensions: {},
      assets: null,
      cardProvenance: null,
      characterBook: profile.character_book ?? null,
      lifecycleConfig: {},
    }),
  };
});

jest.mock('../../components/characters/ProfileImagePicker', () => {
  const React = require('react');
  const { View } = require('react-native');
  return { __esModule: true, ProfileImagePicker: (props: any) =>
    React.createElement(View, { testID: 'profile-image-picker-mock' }) };
});

import {
  createUserPersona,
  updateUserPersona,
  getUserPersona,
  resolvePersonaId,
} from '../../database/repositories/userEntities';
import { getEntity } from '../../database/repositories/entities';
import ChatPreferencesService from '../../services/ChatPreferencesService';
import RNFS from 'react-native-fs';

const mockCreate = createUserPersona as jest.Mock;
const mockUpdate = updateUserPersona as jest.Mock;
const mockGet = getUserPersona as jest.Mock;
const mockResolve = resolvePersonaId as jest.Mock;
const mockGetEntity = getEntity as jest.Mock;
const mockGetGlobalImpersonated = (
  ChatPreferencesService.getGlobalImpersonatedEntity as jest.Mock
);
const mockWriteFile = RNFS.writeFile as jest.Mock;

async function flush() {
  // Drain the full async load chain: the active-persona load, the impersonation
  // resolution, the library-tag load AND the persona load each have multiple
  // sequential awaits.
  for (let i = 0; i < 12; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

function profile(id: string, name: string) {
  return {
    id,
    name,
    description: `${name} description`,
    personality: `${name} personality`,
    voice_characteristics: '',
    base_prompt: '',
    scenario: '',
    typing_speed_wpm: 60,
    audio_response_chance_percent: 50,
    vision_config_id: null,
    lifecycle_config: '{}',
    first_mes: '',
    mes_example: '',
    alternate_greetings: '[]',
    post_history_instructions: '',
    creator_notes: '',
    creator: '',
    character_version: '1.0',
    nickname: '',
    tags: '[]',
    group_only_greetings: '[]',
    extensions: '{}',
    assets: '[]',
    card_provenance: '{}',
    character_book: '{}',
    is_favorite: 0,
    created_at: new Date(),
    updated_at: new Date(),
    deleted_at: null,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockRouteParams = {};
  mockCreate.mockResolvedValue({ id: 'Mara', name: 'Mara', description: 'd', personality: 'p', avatarUri: null });
  mockUpdate.mockResolvedValue(undefined);
  mockGet.mockResolvedValue(null);
  mockGetEntity.mockResolvedValue(null);
  // Default: no impersonation set → resolvePersonaId(null) === 'user'.
  mockGetGlobalImpersonated.mockResolvedValue(null);
  mockResolve.mockResolvedValue('user');
  mockWriteFile.mockClear();
});

describe('PersonaEditScreen — create mode (full editor)', () => {
  it('saves via createUserPersona and NEVER writes lifecycle_config (personaMode)', async () => {
    const utils = await render(<PersonaEditScreen />);
    await flush();

    // Fresh create — blank fields.
    await fireEvent.changeText(utils.getByTestId('persona-name-input'), 'Mara');
    await fireEvent.changeText(utils.getByTestId('persona-description-input'), 'A mystic healer');
    await fireEvent.changeText(utils.getByTestId('persona-personality-input'), 'Calm, wise');

    await fireEvent.press(utils.getByTestId('save-persona-button'));
    await flush();

    expect(mockCreate).toHaveBeenCalledTimes(1);
    const input = mockCreate.mock.calls[0][0];
    expect(input).toMatchObject({
      name: 'Mara',
      description: 'A mystic healer',
      personality: 'Calm, wise',
      avatar: null,
    });
    // personaMode: lifecycle hidden → never written (decision 2).
    expect(input.lifecycle_config).toBeUndefined();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('blocks a persona named "user" (trim + case-insensitive — decision 14)', async () => {
    const utils = await render(<PersonaEditScreen />);
    await flush();

    await fireEvent.changeText(utils.getByTestId('persona-name-input'), '  USER  ');
    await fireEvent.press(utils.getByTestId('save-persona-button'));
    await flush();

    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockShowAlert).toHaveBeenCalledWith('personaNameReserved');
  });
});

describe('PersonaEditScreen — edit mode (full editor)', () => {
  beforeEach(() => {
    mockRouteParams = { entityId: 'Mystic Mara' };
    mockGet.mockResolvedValue({
      id: 'Mystic Mara',
      name: 'Mystic Mara',
      description: 'A mystic healer',
      personality: 'Calm, wise',
      avatarUri: null,
    });
    mockGetEntity.mockResolvedValue({
      id: 'Mystic Mara',
      alias: 'Mystic Mara',
      character_profile_id: 'profile-1',
      entity_type: 'user',
    });
  });

  it('loads the full profile and saves via updateUserPersona (id frozen)', async () => {
    const { getCharacterProfile } = require('../../database/repositories/characters');
    (getCharacterProfile as jest.Mock).mockResolvedValue(profile('profile-1', 'Mystic Mara'));

    const utils = await render(<PersonaEditScreen />);
    await flush();

    expect(utils.getByDisplayValue('Mystic Mara')).toBeTruthy();
    // The full profile (not the persona summary) drives the editor fields.
    expect(utils.getByDisplayValue('Mystic Mara description')).toBeTruthy();
    expect(utils.getByDisplayValue('Mystic Mara personality')).toBeTruthy();

    await fireEvent.press(utils.getByTestId('save-persona-button'));
    await flush();

    expect(mockUpdate).toHaveBeenCalledWith('Mystic Mara', expect.objectContaining({ name: 'Mystic Mara' }));
    const input = mockUpdate.mock.calls[0][1];
    expect(input.lifecycle_config).toBeUndefined();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('exports the persona card (JSON) via RNFS write + Share (2-4 parity)', async () => {
    const { getCharacterProfile } = require('../../database/repositories/characters');
    (getCharacterProfile as jest.Mock).mockResolvedValue(profile('profile-1', 'Mystic Mara'));
    jest.spyOn(Share, 'share').mockResolvedValue({} as any);

    const utils = await render(<PersonaEditScreen />);
    await flush();

    await fireEvent.press(utils.getByTestId('export-card-button'));
    await flush();

    expect(mockWriteFile).toHaveBeenCalledTimes(1);
    const [path] = mockWriteFile.mock.calls[0];
    expect(path).toMatch(/\.json$/);
  });
});

describe('PersonaEditScreen — built-in user mode (A1 / decision 8)', () => {
  it('pre-seed: no linked profile → locked editor + save disabled + delete locked', async () => {
    mockRouteParams = { entityId: 'user' };
    mockGet.mockResolvedValue({
      id: 'user',
      name: 'You',
      description: '',
      personality: '',
      avatarUri: null,
    });
    mockGetEntity.mockResolvedValue({
      id: 'user',
      alias: 'You',
      character_profile_id: null,
      entity_type: 'user',
    });

    const utils = await render(<PersonaEditScreen />);
    await flush();

    // Pre-seed empty state hint + save locked.
    expect(utils.getByText('personaPreSeedHint')).toBeTruthy();
    expect(utils.getByTestId('save-persona-button').props.accessibilityState.disabled).toBe(true);
    // Rename locked.
    expect(utils.getByTestId('persona-name-input').props.editable).toBe(false);
    // Delete locked.
    const del = utils.getByTestId('delete-persona-button');
    expect(del.props.accessibilityState.disabled).toBe(true);
    expect(utils.getByText('persona:deleteProtected')).toBeTruthy();
  });

  it('seeded: full editor with rename + delete locked, other fields editable', async () => {
    mockRouteParams = { entityId: 'user' };
    mockGet.mockResolvedValue({
      id: 'user',
      name: 'You',
      description: 'Your default persona',
      personality: 'Calm',
      avatarUri: null,
    });
    mockGetEntity.mockResolvedValue({
      id: 'user',
      alias: 'You',
      character_profile_id: 'profile-user',
      entity_type: 'user',
    });
    const { getCharacterProfile } = require('../../database/repositories/characters');
    (getCharacterProfile as jest.Mock).mockResolvedValue(profile('profile-user', 'You'));

    const utils = await render(<PersonaEditScreen />);
    await flush();

    // Rename locked (built-in) — name input read-only, lock hint visible.
    expect(utils.getByTestId('persona-name-input').props.editable).toBe(false);
    expect(utils.getByTestId('persona-builtin-lock-hint')).toBeTruthy();
    // Delete locked.
    expect(utils.getByTestId('delete-persona-button').props.accessibilityState.disabled).toBe(true);
    // Description editable (full editor), save enabled.
    expect(utils.getByTestId('persona-description-input').props.editable).toBe(true);
    expect(utils.getByTestId('save-persona-button').props.accessibilityState.disabled).toBe(false);
  });
});

describe('PersonaEditScreen — personaMode hidden sections (decision 2/13)', () => {
  it('never renders lifecycle or advanced; greeting TEST is disabled', async () => {
    const utils = await render(<PersonaEditScreen />);
    await flush();

    // personaMode allow-list: lifecycle + advanced are not rendered at all.
    expect(utils.queryByTestId('lifecycle-section-toggle')).toBeNull();
    expect(utils.queryByTestId('advanced-toggle')).toBeNull();

    // Greeting section renders (allow-list) but the TEST affordance is off.
    await fireEvent.press(utils.getByTestId('persona-greeting-section-toggle'));
    expect(utils.getByText('testDisabled:true')).toBeTruthy();
    // Persona sections that stay are present.
    expect(utils.getByTestId('persona-lorebook-section-toggle')).toBeTruthy();
    expect(utils.getByTestId('persona-images-section-toggle')).toBeTruthy();
    expect(utils.getByTestId('persona-tags-section-toggle')).toBeTruthy();
    expect(utils.getByTestId('persona-attribution-section-toggle')).toBeTruthy();
  });
});

describe('PersonaEditScreen — active-persona delete gate (review 2a)', () => {
  beforeEach(() => {
    mockRouteParams = { entityId: 'Mystic Mara' };
    mockGet.mockResolvedValue({
      id: 'Mystic Mara',
      name: 'Mystic Mara',
      description: 'A mystic healer',
      personality: 'Calm, wise',
      avatarUri: null,
    });
    mockGetEntity.mockResolvedValue({
      id: 'Mystic Mara',
      alias: 'Mystic Mara',
      character_profile_id: 'profile-1',
      entity_type: 'user',
    });
    const { getCharacterProfile } = require('../../database/repositories/characters');
    (getCharacterProfile as jest.Mock).mockResolvedValue(profile('profile-1', 'Mystic Mara'));
  });

  it('blocks delete for the currently-active non-built-in persona', async () => {
    mockGetGlobalImpersonated.mockResolvedValue('Mystic Mara');
    mockResolve.mockResolvedValue('Mystic Mara');

    const utils = await render(<PersonaEditScreen />);
    await flush();

    const del = utils.getByTestId('delete-persona-button');
    expect(del.props.accessibilityState.disabled).toBe(true);
    expect(utils.getByText('persona:deleteActiveProtected')).toBeTruthy();
  });

  it('still allows delete for a persona that is NOT active', async () => {
    mockGetGlobalImpersonated.mockResolvedValue(null);
    mockResolve.mockResolvedValue('user');

    const utils = await render(<PersonaEditScreen />);
    await flush();

    const del = utils.getByTestId('delete-persona-button');
    expect(del.props.accessibilityState.disabled).toBe(false);
    expect(utils.queryByText('persona:deleteActiveProtected')).toBeNull();
  });
});