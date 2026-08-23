/**
 * CharacterProfileEditScreen — 3-5/3-6 editor-section tests.
 *
 * Verifies:
 *  - load: snake_case DB fields → camelCase local state (round-trip down).
 *  - save: camelCase local state → snake_case DB fields, JSON columns encoded
 *    with the mapper convention (`JSON.stringify(x ?? null)`), character_book
 *    passed through raw.
 *  - [Preview opening] resolves macros ({{char}} → nickname||name,
 *    {{user}} → own entity) via the GreetingBubble preview.
 *  - [Test scenario generation] dispatches GENERATE_GREETING with the expected
 *    payload shape (entityId, targetEntityId, interactionId, mode) and only
 *    "use this" promotes the generated greeting (no auto-save).
 */

import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { CharacterProfileEditScreen } from '../../../screens/CharacterProfileEditScreen';
import type { CharacterProfile } from '../../../database/models';

const mockGoBack = jest.fn();
const mockNavigate = jest.fn();
const mockShowAlert = jest.fn();

const THEME = {
  colors: {
    accent: { primary: '#7c3aed', secondary: '#a78bfa' },
    background: { base: '#0f0f1a', surface: '#151d30', elevated: '#1e1e2e' },
    border: { default: '#333333' },
    text: { primary: '#ffffff', secondary: '#cccccc', muted: '#aaaaaa' },
    status: { error: '#ef4444', success: '#22c55e', warning: '#f59e0b' },
  },
} as any;

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('../../../utils/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ goBack: mockGoBack, navigate: mockNavigate }),
  useRoute: () => ({ params: { profileId: 'p1' } }),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('react-native-image-picker', () => ({
  launchImageLibrary: jest.fn().mockResolvedValue({ assets: [] }),
}));

jest.mock('../../../contexts/ThemeContext', () => ({
  useAppTheme: () => ({ theme: THEME }),
}));

jest.mock('../../../contexts/AppAlertContext', () => ({
  useAppAlert: () => ({ showAlert: mockShowAlert }),
}));

// The screen records the creating user on save (senju's creator badge) —
// mock auth so renders don't require AuthProvider (null user skips the write).
jest.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: null }),
}));

jest.mock('../../../contexts/BiometricLockContext', () => ({
  useBiometricLock: () => ({ withExternalFlow: (fn: any) => fn() }),
}));

jest.mock('react-native-linear-gradient', () => {
  const React = require('react');
  const { View } = require('react-native');
  return ({ children, style, ...props }: any) =>
    React.createElement(View, { style, ...props }, children);
});

// jest.setup.js mocks react-native-paper without Modal/Portal — override it here.
jest.mock('react-native-paper', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    Provider: ({ children }: any) => children,
    Portal: ({ children }: any) => React.createElement(View, null, children),
    Modal: ({ children, ...props }: any) =>
      props.visible ? React.createElement(View, { ...props }, children) : null,
  };
});

jest.mock('../../themed/ThemedView', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    ThemedView: ({ children, style, ...props }: any) =>
      React.createElement(View, { style, ...props }, children),
  };
});

jest.mock('../../themed/ThemedCard', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    ThemedCard: ({ children, style, ...props }: any) =>
      React.createElement(View, { style, ...props }, children),
  };
});

jest.mock('../../themed/ThemedText', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    __esModule: true,
    ThemedText: ({ children, style, ...props }: any) =>
      React.createElement(Text, { style, ...props }, children),
  };
});

jest.mock('../../themed/ThemedButton', () => {
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
        React.createElement(Text, { testID: `${testID}-label` }, label),
      ),
  };
});

jest.mock('../../themed/ScreenHeader', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    ScreenHeader: ({ children, right, ...props }: any) =>
      React.createElement(View, { testID: 'screen-header-mock', ...props }, children, right),
  };
});

jest.mock('../../themed/SectionHeader', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    __esModule: true,
    SectionHeader: ({ title, ...props }: any) => React.createElement(Text, { ...props }, title),
  };
});

jest.mock('../../characters/ProfileImagePicker', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    ProfileImagePicker: () => React.createElement(View, { testID: 'profile-image-picker' }),
  };
});

// GreetingBubble mock resolves macros so the screen's preview assertions can
// verify the charName/userName wiring end-to-end.
jest.mock('../../chat/GreetingBubble', () => {
  const React = require('react');
  const { Text } = require('react-native');
  const { resolveMacros } = require('../../../utils/macros');
  return {
    __esModule: true,
    GreetingBubble: ({ text, charName, userName, ...props }: any) =>
      React.createElement(
        Text,
        { testID: 'greeting-bubble-text', ...props },
        resolveMacros(text ?? '', charName, userName),
      ),
  };
});

// Character-card components: keep them as prop-passing hosts so the test can
// read what the screen wires (value, onChange, charName, …).
jest.mock('../GreetingEditor', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    GreetingEditor: (props: any) => React.createElement(View, { testID: 'greeting-editor', ...props }),
  };
});

jest.mock('../AlternateGreetingsManager', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    AlternateGreetingsManager: (props: any) =>
      React.createElement(View, { testID: 'alternate-greetings-manager', ...props }),
  };
});

jest.mock('../LorebookViewerSheet', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    LorebookViewerSheet: (props: any) =>
      React.createElement(View, { testID: 'lorebook-viewer-sheet', ...props }),
  };
});

jest.mock('../CreatorAttributionBadge', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    CreatorAttributionBadge: (props: any) =>
      React.createElement(View, { testID: 'creator-badge', ...props }),
  };
});

jest.mock('../TagChips', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    TagChips: (props: any) => React.createElement(View, { testID: 'tag-chips', ...props }),
  };
});

jest.mock('../MacroHighlighter', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    MacroHighlighter: (props: any) =>
      React.createElement(View, { testID: 'macro-highlighter', ...props }),
  };
});

jest.mock('../SheetModal', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    SheetModal: ({ children, ...props }: any) =>
      React.createElement(View, { testID: 'sheet-modal', ...props }, children),
  };
});

// ── Repositories / services ───────────────────────────────────────────────────
jest.mock('../../../database/repositories/characters', () => ({
  getCharacterProfile: jest.fn(),
  createCharacterProfile: jest.fn().mockResolvedValue({}),
  updateCharacterProfile: jest.fn().mockResolvedValue({}),
  getCharacterImages: jest.fn().mockResolvedValue([]),
  createCharacterImage: jest.fn().mockResolvedValue({}),
  deleteCharacterImage: jest.fn().mockResolvedValue(undefined),
  setPrimaryImage: jest.fn().mockResolvedValue(undefined),
  getAllCharacterProfiles: jest.fn().mockResolvedValue([]),
}));

jest.mock('../../../database/repositories/entities', () => ({
  getAllEntities: jest.fn().mockResolvedValue([{ id: 'user', alias: 'Alex' }]),
  getEntityByCharacterProfileId: jest.fn().mockResolvedValue({ id: 'char-entity' }),
}));

jest.mock('../../../database/repositories/interactions', () => ({
  getActiveInteractionsByEntity: jest.fn().mockResolvedValue([{ id: 'ix-1' }]),
}));

jest.mock('../../../services/ChatPreferencesService', () => ({
  __esModule: true,
  default: {
    getGlobalImpersonatedEntity: jest.fn().mockResolvedValue('user'),
  },
}));

jest.mock('../../../services/EntitySessionService', () => ({
  __esModule: true,
  default: {
    generateGreeting: jest.fn().mockResolvedValue({
      greeting: 'Generated {{user}}!',
      interactionId: 'ix-1',
    }),
  },
}));

const { getCharacterProfile } = require('../../../database/repositories/characters');
const { updateCharacterProfile } = require('../../../database/repositories/characters');
const { getActiveInteractionsByEntity } = require('../../../database/repositories/interactions');
const EntitySessionService = require('../../../services/EntitySessionService').default;

const PROFILE = {
  id: 'p1',
  name: 'Aria',
  description: 'desc',
  personality: 'personality',
  voice_characteristics: 'voice',
  base_prompt: 'base prompt',
  scenario: 'scenario',
  typing_speed_wpm: 60,
  audio_response_chance_percent: 50,
  vision_config_id: null,
  lifecycle_config: '{}',
  first_mes: 'Original {{char}} opening',
  mes_example: 'Example dialogue',
  alternate_greetings: JSON.stringify(['Alt A', 'Alt B']),
  post_history_instructions: 'UJB text',
  creator_notes: 'notes',
  creator: 'Someone',
  character_version: '1.0',
  nickname: 'Nix',
  tags: JSON.stringify(['fantasy']),
  group_only_greetings: null,
  extensions: '{}',
  assets: '[]',
  card_provenance: JSON.stringify({ spec: 'chara_card_v3', spec_version: '1.0' }),
  character_book: '{"entries":[{"keys":["k"],"content":"c","extensions":{},"enabled":true,"insertion_order":10}]}',
  created_at: new Date(),
  updated_at: new Date(),
  deleted_at: null,
} as unknown as CharacterProfile;

async function renderScreen() {
  const result = await render(<CharacterProfileEditScreen />);
  // Flush the async load + entity/library-tag effects.
  await act(async () => {});
  return result;
}

describe('CharacterProfileEditScreen — 3-5/3-6 sections', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getCharacterProfile.mockResolvedValue(PROFILE);
    getActiveInteractionsByEntity.mockResolvedValue([{ id: 'ix-1' }]);
    EntitySessionService.generateGreeting.mockResolvedValue({
      greeting: 'Generated {{user}}!',
      interactionId: 'ix-1',
    });
  });

  it('loads new fields (snake_case DB → camelCase state)', async () => {
    const { getByTestId } = await renderScreen();

    expect(getByTestId('greeting-editor').props.value).toBe('Original {{char}} opening');
    expect(getByTestId('alternate-greetings-manager').props.alternateGreetings).toEqual(['Alt A', 'Alt B']);
    expect(getByTestId('greeting-editor').props.charName).toBe('Nix'); // nickname priority
    expect(getByTestId('greeting-editor').props.userName).toBe('Alex'); // own entity alias
    expect(getByTestId('nickname-input').props.value).toBe('Nix');
    expect(getByTestId('mes-example-input').props.value).toBe('Example dialogue');
    expect(getByTestId('profile-tag-chips').props.tags).toEqual(['fantasy']);
    expect(getByTestId('creator-badge').props.creator).toBe('Someone');
    expect(getByTestId('creator-badge').props.characterVersion).toBe('1.0');
    expect(getByTestId('lorebook-viewer-sheet').props.characterBook).toBe(PROFILE.character_book);

    // Advanced is collapsed by default — expand it to reach UJB/base_prompt.
    await fireEvent.press(getByTestId('advanced-toggle'));
    expect(getByTestId('post-history-input').props.value).toBe('UJB text');
    expect(getByTestId('base-prompt-input').props.value).toBe('base prompt');
  });

  it('saves new fields (camelCase state → snake_case DB, JSON columns encoded)', async () => {
    const { getByTestId } = await renderScreen();

    // Edit some of the new fields through the wired controls.
    await act(async () => {
      getByTestId('greeting-editor').props.onChange('A brand new opening');
    });
    await act(async () => {
      getByTestId('alternate-greetings-manager').props.onEdit(0, 'Edited Alt A');
    });
    await fireEvent.changeText(getByTestId('nickname-input'), 'Nyx');
    await fireEvent.press(getByTestId('advanced-toggle'));
    await fireEvent.changeText(getByTestId('post-history-input'), 'New UJB');
    await act(async () => {
      getByTestId('profile-tag-chips').props.onChange(['fantasy', 'rogue']);
    });

    await fireEvent.press(getByTestId('save-profile-button'));

    expect(updateCharacterProfile).toHaveBeenCalledTimes(1);
    const saved = updateCharacterProfile.mock.calls[0][0];
    expect(saved.first_mes).toBe('A brand new opening');
    expect(saved.nickname).toBe('Nyx');
    expect(saved.post_history_instructions).toBe('New UJB');
    expect(saved.mes_example).toBe('Example dialogue');
    expect(saved.creator).toBe('Someone');
    expect(saved.character_version).toBe('1.0');
    // JSON columns: mapper convention (`JSON.stringify(x ?? null)`).
    expect(saved.alternate_greetings).toBe(JSON.stringify(['Edited Alt A', 'Alt B']));
    expect(saved.tags).toBe(JSON.stringify(['fantasy', 'rogue']));
    expect(saved.extensions).toBe('{}');
    expect(saved.assets).toBe('[]');
    // character_book passed through raw (lossless).
    expect(saved.character_book).toBe(PROFILE.character_book);
    // Unchanged fields preserved.
    expect(saved.name).toBe('Aria');
    expect(saved.scenario).toBe('scenario');
    expect(saved.base_prompt).toBe('base prompt');
  });

  it('[Preview opening] resolves macros ({{char}}→nickname, {{user}}→own entity)', async () => {
    const { getByTestId, getByText } = await renderScreen();

    await act(async () => {
      getByTestId('greeting-editor').props.onChange('Hi {{char}}, I am {{user}}.');
    });
    await fireEvent.press(getByTestId('preview-opening-button'));

    expect(getByText('Hi Nix, I am Alex.')).toBeTruthy();
    expect(getByTestId('opening-preview')).toBeTruthy();
  });

  it('[Test scenario generation] dispatches GENERATE_GREETING with the expected payload shape', async () => {
    const { getByTestId, getByText } = await renderScreen();

    await fireEvent.press(getByTestId('test-scenario-button'));

    expect(EntitySessionService.generateGreeting).toHaveBeenCalledTimes(1);
    expect(EntitySessionService.generateGreeting.mock.calls[0][0]).toEqual({
      entityId: 'char-entity',
      targetEntityId: 'user',
      interactionId: 'ix-1',
      mode: 'directed',
    });

    // Generated greeting is ephemeral — only "use this" promotes it.
    expect(getByTestId('greeting-editor').props.value).toBe('Original {{char}} opening');
    expect(getByText('Generated Alex!')).toBeTruthy();

    await fireEvent.press(getByTestId('test-scenario-use'));
    expect(getByTestId('greeting-editor').props.value).toBe('Generated {{user}}!');
    // No DB write from the test flow itself.
    expect(updateCharacterProfile).not.toHaveBeenCalled();
  });
});
