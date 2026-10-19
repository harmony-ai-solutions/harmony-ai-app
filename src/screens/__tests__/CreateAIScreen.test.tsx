/**
 * CreateAIScreen — reserved-name guard (D33) + 1:1 Edit AI Partner rework.
 *
 * Verifies:
 *  - a partner named `user` / `deleted` (trim + case-insensitive) shows the
 *    INLINE field error and the submit is blocked — the mint seam is never
 *    reached
 *  - the typed `ReservedEntityNameError` from `mintEntityId` (belt-and-braces)
 *    maps to the SAME inline error — never the generic createFailed alert
 *  - a normal name still saves via the mint seam (happy-path control)
 *  - (4-1) translated section titles (no raw `GREETINGSECTION` keys), the
 *    Edit-mode Name + Nickname row, and the Export trigger in the header
 *  - (4-2) `countLorebookEntries` / `buildCardSectionBadges` and the single
 *    Character Card Sections accordion (every preserved toggle testID)
 *  - (4-3) module-wiring group subheaders, provider · model subtitles, and the
 *    selected-config wiring that gates the label-row edit link
 */

import React from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react-native';
import {
  CreateAIScreen,
  buildCardSectionBadges,
  countLorebookEntries,
} from '../CreateAIScreen';
import { formatModuleConfigSubtitle } from '../../components/entities/EntityModuleSelector';

afterEach(cleanup);
beforeEach(cleanup);

// Stable mock references — the screen's effects depend on `t`; the real app
// provides stable values, so the test mocks must too.
//
// Namespace-qualified keys resolve to their bare key (`characters:nickname` →
// `nickname`) and the i18n fallback argument (when a string) is returned, so
// assertions can pin the human-readable label. This mirrors what a correct
// `nsMode: 'fallback'` setup renders — never a raw `GREETINGSECTION` key.
const mockT = (key: string, options?: unknown) => {
  const bare = key.includes(':') ? key.slice(key.lastIndexOf(':') + 1) : key;
  return typeof options === 'string' ? options : bare;
};
const mockGoBack = jest.fn();
const mockNavigation = { navigate: jest.fn(), goBack: mockGoBack };

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

jest.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: null }),
}));

jest.mock('../../contexts/BiometricLockContext', () => ({
  useBiometricLock: () => ({ withExternalFlow: (fn: any) => fn() }),
}));

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
jest.mock('../../components/themed/ThemedGradient', () => {
  const React = require('react');
  const { View } = require('react-native');
  return { __esModule: true, ThemedGradient: ({ children, ...props }: any) =>
    React.createElement(View, props, children) };
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

jest.mock('../../utils/colorUtils', () => ({
  hexToRgba: (hex: string, _alpha: number) => hex,
}));

jest.mock('../../utils/haptics', () => ({
  hapticLightPress: jest.fn(),
}));

// Heavy editor components — shells (the wiring under test is the save path).
// The module selector is rendered as a light probe so the screen's config
// wiring (subtitle + selectedId) is observable without the real bottom sheet.
jest.mock('../../components/entities/EntityModuleSelectorWithActions', () => {
  const React = require('react');
  const { View, Text, TouchableOpacity } = require('react-native');
  return {
    __esModule: true,
    EntityModuleSelectorWithActions: ({
      label,
      moduleType,
      configs,
      selectedId,
    }: any) =>
      React.createElement(
        View,
        { testID: `module-selector-${moduleType}` },
        React.createElement(Text, null, label),
        React.createElement(Text, { testID: `module-selected-${moduleType}` }, `selected:${selectedId}`),
        ...(configs ?? []).map((c: any) =>
          React.createElement(
            Text,
            { key: c.id, testID: `module-option-${moduleType}-${c.id}` },
            c.subtitle ? `${c.name} — ${c.subtitle}` : c.name,
          ),
        ),
        selectedId
          ? React.createElement(TouchableOpacity, { testID: `edit-module-config-${moduleType}` })
          : null,
      ),
  };
});
jest.mock('../../components/characters/ProfileImagePicker', () => {
  const React = require('react');
  const { View } = require('react-native');
  return { __esModule: true, ProfileImagePicker: () =>
    React.createElement(View, { testID: 'profile-image-picker-mock' }) };
});
jest.mock('../../components/character-card/MacroHighlighter', () => ({
  __esModule: true,
  MacroHighlighter: () => null,
}));

jest.mock('../../components/character-card/editor-sections', () => {
  const React = require('react');
  const { View, TouchableOpacity } = require('react-native');
  return {
    GreetingEditorSection: () => React.createElement(View, { testID: 'greeting-editor-section-mock' }),
    AlternateGreetingsSection: () => React.createElement(View, { testID: 'alternate-greetings-section-mock' }),
    LorebookSection: () => React.createElement(View, { testID: 'lorebook-section-mock' }),
    TagsSection: () => React.createElement(View, { testID: 'tags-section-mock' }),
    AttributionSection: () => React.createElement(View, { testID: 'attribution-section-mock' }),
    ExportSection: ({ onExport, compact }: any) =>
      React.createElement(TouchableOpacity, {
        testID: compact ? 'export-header-button' : 'export-card-button',
        onPress: () => onExport('json'),
      }),
    LifecycleSection: () => React.createElement(View, { testID: 'lifecycle-section-mock' }),
    GreetingSection: () => React.createElement(View, { testID: 'greeting-section-mock' }),
    computeImageDeltas: jest.fn().mockReturnValue({ create: [], update: [], remove: [] }),
    editorStateToProfileFields: (state: any) => ({
      name: state.name,
      description: state.description,
      personality: state.personality,
    }),
    profileToEditorState: (profile: any) => ({
      name: profile.name ?? '',
      description: profile.description ?? '',
      personality: profile.personality ?? '',
      nickname: profile.nickname ?? '',
      firstMes: profile.first_mes ?? '',
      alternateGreetings: [],
      postHistoryInstructions: '',
      creator: profile.creator ?? '',
      creatorNotes: '',
      characterVersion: '',
      tags: [],
      groupOnlyGreetings: [],
      extensions: {},
      assets: null,
      cardProvenance: null,
      characterBook: profile.character_book ?? null,
      lifecycleConfig: {},
    }),
    validateLifecycleConfig: jest.fn().mockReturnValue(true),
  };
});

// ── Repos / services ───────────────────────────────────────────────────────
jest.mock('../../services/engine/repositories/characters', () => ({
  // The engine mints the profile id — the mock returns a profile carrying one.
  createCharacterProfile: jest.fn().mockResolvedValue({ id: 'profile-1', name: 'Mystery' }),
  createCharacterImage: jest.fn().mockResolvedValue(undefined),
  deleteCharacterImage: jest.fn().mockResolvedValue(undefined),
  deleteCharacterProfileCascade: jest.fn().mockResolvedValue(undefined),
  getCharacterProfile: jest.fn().mockResolvedValue(null),
  getCharacterImages: jest.fn().mockResolvedValue([]),
  getAllCharacterProfiles: jest.fn().mockResolvedValue([]),
  updateCharacterImage: jest.fn().mockResolvedValue(undefined),
  updateCharacterProfile: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../services/engine/repositories/entities', () => ({
  // Create-then-use-response: the engine mints the id + alias and echoes them.
  createEntity: jest.fn().mockResolvedValue({
    id: 'Mystery-20260905123514',
    alias: 'Mystery',
    entity_type: 'ai',
    character_profile_id: 'profile-1',
  }),
  createEntityModuleMapping: jest.fn().mockResolvedValue(undefined),
  createOrUpdateEntityModuleMapping: jest.fn().mockResolvedValue(undefined),
  getAllEntities: jest.fn().mockResolvedValue([]),
  getEntityByCharacterProfileId: jest.fn().mockResolvedValue(null),
  getEntityModuleMapping: jest.fn().mockResolvedValue(null),
  isProfilePersonaOwned: jest.fn().mockResolvedValue(false),
  updateEntityFields: jest.fn().mockResolvedValue(undefined),
  // Typed error class mirrored from the real repo module (D33 instanceof).
  ReservedEntityNameError: class ReservedEntityNameError extends Error {
    constructor(name: string) {
      super(`"${name}" is a reserved name — rename the card and retry`);
      this.name = 'ReservedEntityNameError';
    }
  },
}));

jest.mock('../../services/engine/repositories/userEntities', () => ({
  getUserPersona: jest.fn().mockResolvedValue(null),
}));

jest.mock('../../services/engine/repositories/interactions', () => ({
  getActiveInteractionsByEntity: jest.fn().mockResolvedValue([]),
}));

jest.mock('../../services/engine/repositories/modules', () => ({
  getAllCognitionConfigs: jest.fn().mockResolvedValue([]),
  getAllTTSConfigs: jest.fn().mockResolvedValue([]),
  getAllSTTConfigs: jest.fn().mockResolvedValue([]),
  getAllVisionConfigs: jest.fn().mockResolvedValue([]),
  getAllRAGConfigs: jest.fn().mockResolvedValue([]),
  getAllImaginationConfigs: jest.fn().mockResolvedValue([]),
  getAllMovementConfigs: jest.fn().mockResolvedValue([]),
  getAllBackendConfigs: jest.fn().mockResolvedValue([]),
}));

jest.mock('../../services/ChatPreferencesService', () => ({
  __esModule: true,
  default: {
    getGlobalImpersonatedEntity: jest.fn().mockResolvedValue(null),
    setGlobalImpersonatedEntity: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock('../../services/EntitySessionService', () => ({
  __esModule: true,
  default: { generateGreeting: jest.fn() },
}));

jest.mock('../../services/social/SocialService', () => ({
  setCharacterCreator: jest.fn().mockResolvedValue(undefined),
}));

import { createEntity } from '../../services/engine/repositories/entities';
import {
  createCharacterProfile,
  getCharacterProfile,
} from '../../services/engine/repositories/characters';
import {
  getEntityByCharacterProfileId,
  getEntityModuleMapping,
} from '../../services/engine/repositories/entities';
import { getAllBackendConfigs } from '../../services/engine/repositories/modules';

const mockCreateEntity = createEntity as jest.Mock;
const mockCreateProfile = createCharacterProfile as jest.Mock;
const mockGetCharacterProfile = getCharacterProfile as jest.Mock;
const mockGetEntityByProfile = getEntityByCharacterProfileId as jest.Mock;
const mockGetMapping = getEntityModuleMapping as jest.Mock;
const mockGetBackendConfigs = getAllBackendConfigs as jest.Mock;

let mockRouteParams: any = {};

async function flush() {
  // Drain the async chains: the module-config load (Promise.all of 8) plus the
  // createPartner save path (mint → profile → entity → mapping → goBack).
  for (let i = 0; i < 12; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function renderScreen() {
  // RNTL render is async (React 19) — await it like the existing screen tests.
  return await render(
    <CreateAIScreen
      route={{ params: mockRouteParams } as any}
      navigation={mockNavigation as any}
    />,
  );
}

describe('CreateAIScreen — reserved-name guard (D33)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRouteParams = {};
    mockCreateEntity.mockResolvedValue({
      id: 'Mystery-20260905123514',
      alias: 'Mystery',
      entity_type: 'ai',
      character_profile_id: 'profile-1',
    });
    mockGetCharacterProfile.mockResolvedValue(null);
    mockGetEntityByProfile.mockResolvedValue(null);
    mockGetMapping.mockResolvedValue(null);
  });

  it('shows the inline error and blocks submit for "deleted" (mint seam never reached)', async () => {
    const utils = await renderScreen();
    await flush();

    await fireEvent.changeText(utils.getByPlaceholderText('namePlaceholder'), 'deleted');
    await fireEvent.press(utils.getByText('save'));
    await flush();

    // D33: inline field error under the partner-name field — never an alert.
    expect(utils.getByTestId('create-ai-name-error')).toBeTruthy();
    expect(utils.getByText('nameReserved')).toBeTruthy();
    expect(mockCreateEntity).not.toHaveBeenCalled();
    expect(mockCreateProfile).not.toHaveBeenCalled();
    expect(mockGoBack).not.toHaveBeenCalled();
    expect(mockShowAlert).not.toHaveBeenCalled();
  });

  it('blocks "USER" case-insensitively (trim + case-insensitive predicate)', async () => {
    const utils = await renderScreen();
    await flush();

    await fireEvent.changeText(utils.getByPlaceholderText('namePlaceholder'), '  USER ');
    await fireEvent.press(utils.getByText('save'));
    await flush();

    expect(utils.getByTestId('create-ai-name-error')).toBeTruthy();
    expect(mockCreateEntity).not.toHaveBeenCalled();
    expect(mockGoBack).not.toHaveBeenCalled();
    expect(mockShowAlert).not.toHaveBeenCalled();
  });

  it('typed ReservedEntityNameError from the mint seam maps to the SAME inline error (belt-and-braces, never createFailed)', async () => {
    // The live pre-check passes (non-reserved name) but the seam rejects —
    // the residual-race / predicate-drift path.
    mockCreateEntity.mockRejectedValue(
      new (require('../../services/engine/repositories/entities').ReservedEntityNameError)('Mystery'),
    );

    const utils = await renderScreen();
    await flush();

    await fireEvent.changeText(utils.getByPlaceholderText('namePlaceholder'), 'Mystery');
    await fireEvent.press(utils.getByText('save'));
    await flush();

    expect(mockCreateEntity).toHaveBeenCalledTimes(1);
    expect(utils.getByTestId('create-ai-name-error')).toBeTruthy();
    expect(utils.getByText('nameReserved')).toBeTruthy();
    // Create-then-use-response: the profile is created first; the entity
    // rejection rolls it back so no orphan lingers.
    expect(mockCreateProfile).toHaveBeenCalled();
    expect(mockGoBack).not.toHaveBeenCalled();
    expect(mockShowAlert).not.toHaveBeenCalled();
  });

  it('happy-path control: a normal name saves via the mint seam', async () => {
    const utils = await renderScreen();
    await flush();

    await fireEvent.changeText(utils.getByPlaceholderText('namePlaceholder'), 'Mystery');
    await fireEvent.press(utils.getByText('save'));
    await flush();

    expect(mockCreateEntity).toHaveBeenCalledWith(expect.objectContaining({ name: 'Mystery' }));
    expect(mockCreateProfile).toHaveBeenCalled();
    expect(utils.queryByTestId('create-ai-name-error')).toBeNull();
    expect(mockGoBack).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4-1 / 4-2 — i18n, identity card, header export, consolidated accordion
// ─────────────────────────────────────────────────────────────────────────────

describe('CreateAIScreen — identity card & header export (4-1)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRouteParams = {};
    mockGetCharacterProfile.mockResolvedValue(null);
    mockGetEntityByProfile.mockResolvedValue(null);
    mockGetMapping.mockResolvedValue(null);
    mockGetBackendConfigs.mockResolvedValue([]);
  });

  it('renders translated section titles instead of raw i18n keys', async () => {
    mockRouteParams = { editProfileId: 'profile-1' };
    mockGetCharacterProfile.mockResolvedValue({ id: 'profile-1', name: 'Claire' });

    const utils = await renderScreen();
    await flush();

    expect(utils.getByText('Identity')).toBeTruthy();
    expect(utils.getByText('Character Card Sections')).toBeTruthy();
    expect(utils.getByText('Persona & Prompts')).toBeTruthy();
    expect(utils.getByText('Greetings')).toBeTruthy();
    expect(utils.getByText('Lorebook')).toBeTruthy();
    expect(utils.getByText('Gallery & Tags')).toBeTruthy();
    expect(utils.getByText('AI Lifecycle & Attribution')).toBeTruthy();

    // Regression: the pre-fix screen rendered raw keys (=> 'GREETINGSECTION').
    expect(utils.queryByText('GREETINGSECTION')).toBeNull();
    expect(utils.queryByText('nicknamePlaceholder')).toBeNull();
  });

  it('places Name and Nickname side-by-side in edit mode', async () => {
    mockRouteParams = { editProfileId: 'profile-1' };
    mockGetCharacterProfile.mockResolvedValue({ id: 'profile-1', name: 'Claire' });

    const utils = await renderScreen();
    await flush();

    expect(utils.getByTestId('nickname-field')).toBeTruthy();
    expect(utils.getByTestId('nickname-input')).toBeTruthy();
    // One combined label row above the two-column grid.
    expect(utils.getByText('Name * · Nickname')).toBeTruthy();
    expect(utils.queryByText('Nickname')).toBeNull();
  });

  it('moves the Export trigger into the header and drops the mid-form card', async () => {
    mockRouteParams = { editProfileId: 'profile-1' };
    mockGetCharacterProfile.mockResolvedValue({ id: 'profile-1', name: 'Claire' });

    const utils = await renderScreen();
    await flush();

    expect(utils.getByTestId('export-header-button')).toBeTruthy();
    // The old standalone EXPORTCARD block is gone from the scroll body.
    expect(utils.queryByTestId('export-card-button')).toBeNull();
  });

  it('does not render a header Export trigger in create mode', async () => {
    const utils = await renderScreen();
    await flush();

    expect(utils.queryByTestId('export-header-button')).toBeNull();
  });
});

describe('CreateAIScreen — Character Card Sections accordion (4-2)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRouteParams = { editProfileId: 'profile-1' };
    mockGetCharacterProfile.mockResolvedValue({ id: 'profile-1', name: 'Claire' });
    mockGetEntityByProfile.mockResolvedValue(null);
    mockGetMapping.mockResolvedValue(null);
    mockGetBackendConfigs.mockResolvedValue([]);
  });

  it('opens every section through its preserved toggle testID', async () => {
    const utils = await renderScreen();
    await flush();

    // Persona & Prompts — starts collapsed (legacy alias also works).
    expect(utils.queryByPlaceholderText('personalityPlaceholder')).toBeNull();
    await fireEvent.press(utils.getByTestId('details-section-toggle'));
    expect(utils.getByPlaceholderText('personalityPlaceholder')).toBeTruthy();

    await fireEvent.press(utils.getByTestId('greeting-section-toggle'));
    expect(utils.getByTestId('greeting-editor-section-mock')).toBeTruthy();
    expect(utils.getByTestId('alternate-greetings-section-mock')).toBeTruthy();

    await fireEvent.press(utils.getByTestId('lorebook-section-toggle'));
    expect(utils.getByTestId('lorebook-section-mock')).toBeTruthy();

    // Gallery & Tags is ONE combined section: the legacy tags toggle opens it
    // too, showing the image picker followed by the tag editor.
    await fireEvent.press(utils.getByTestId('tags-section-toggle'));
    expect(utils.getByTestId('profile-image-picker-mock')).toBeTruthy();
    expect(utils.getByTestId('tags-section-mock')).toBeTruthy();
    // The combined header closes it again.
    await fireEvent.press(utils.getByTestId('images-section-toggle'));
    expect(utils.queryByTestId('profile-image-picker-mock')).toBeNull();
    expect(utils.queryByTestId('tags-section-mock')).toBeNull();

    // AI Lifecycle & Attribution is ONE combined section.
    await fireEvent.press(utils.getByTestId('lifecycle-section-toggle'));
    expect(utils.getByTestId('lifecycle-section-mock')).toBeTruthy();
    expect(utils.getByTestId('attribution-section-mock')).toBeTruthy();
    await fireEvent.press(utils.getByTestId('attribution-section-toggle'));
    expect(utils.queryByTestId('lifecycle-section-mock')).toBeNull();
    expect(utils.queryByTestId('attribution-section-mock')).toBeNull();
  });

  it('shows live summary pills for the collapsed rows', async () => {
    const utils = await renderScreen();
    await flush();

    expect(utils.getByTestId('details-section-toggle-badge')).toBeTruthy();
    expect(utils.getByTestId('greeting-section-toggle-badge')).toBeTruthy();
    expect(utils.getByTestId('lorebook-section-toggle-badge')).toBeTruthy();
    expect(utils.getByTestId('images-section-toggle-badge')).toBeTruthy();
    expect(utils.getByTestId('lifecycle-section-toggle-badge')).toBeTruthy();

    // Empty edit state → default/zero pills (no phantom counts). The chevron
    // lives INSIDE each pill, so it is part of the text node.
    expect(utils.getAllByText('Default ▾').length).toBe(2);
    expect(utils.getByText('0 opening ▾')).toBeTruthy();
    expect(utils.getByText('0 entries ▾')).toBeTruthy();
    expect(utils.getByText('0 images · 0 tags ▾')).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4-3 — module wiring
// ─────────────────────────────────────────────────────────────────────────────

describe('CreateAIScreen — module wiring (4-3)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRouteParams = {};
    mockGetCharacterProfile.mockResolvedValue(null);
    mockGetEntityByProfile.mockResolvedValue(null);
    mockGetMapping.mockResolvedValue(null);
    mockGetBackendConfigs.mockResolvedValue([]);
  });

  it('renders the eight module selectors in one clean stack (expanded by default)', async () => {
    const utils = await renderScreen();
    await flush();

    expect(utils.getByText('MODULE WIRING')).toBeTruthy();
    // No noisy uppercase sub-group headers.
    expect(utils.queryByText('CONVERSATION & COGNITION')).toBeNull();
    expect(utils.queryByText('VOICE & SPEECH')).toBeNull();
    expect(utils.queryByText('MEMORY, VISION & WORLD')).toBeNull();

    for (const moduleType of [
      'backend',
      'cognition',
      'tts',
      'stt',
      'rag',
      'movement',
      'vision',
      'imagination',
    ]) {
      expect(utils.getByTestId(`module-selector-${moduleType}`)).toBeTruthy();
    }
  });

  it('passes provider · model subtitles into the module config options', async () => {
    mockGetBackendConfigs.mockResolvedValue([
      {
        id: 'b1',
        name: 'Soulbits',
        provider: 'soulbitscloud',
        capability_json: '{"model":"qwen-35-9b"}',
      },
    ]);

    const utils = await renderScreen();
    await flush();

    expect(
      utils.getByText('Soulbits — Soulbits Cloud · qwen-35-9b'),
    ).toBeTruthy();
  });

  it('wires the selected config so the label-row edit link is available', async () => {
    mockRouteParams = { editProfileId: 'profile-1' };
    mockGetCharacterProfile.mockResolvedValue({ id: 'profile-1', name: 'Claire' });
    mockGetEntityByProfile.mockResolvedValue({ id: 'entity-1' });
    mockGetMapping.mockResolvedValue({ backend_config_id: 'b1' });
    mockGetBackendConfigs.mockResolvedValue([
      {
        id: 'b1',
        name: 'Soulbits',
        provider: 'soulbitscloud',
        capability_json: '{"model":"qwen-35-9b"}',
      },
    ]);

    const utils = await renderScreen();
    await flush();

    expect(utils.getByTestId('module-selected-backend')).toBeTruthy();
    expect(utils.getByText('selected:b1')).toBeTruthy();
    expect(utils.getByTestId('edit-module-config-backend')).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Pure helpers
// ─────────────────────────────────────────────────────────────────────────────

describe('countLorebookEntries', () => {
  it('returns 0 for null / empty / invalid JSON', () => {
    expect(countLorebookEntries(null)).toBe(0);
    expect(countLorebookEntries('')).toBe(0);
    expect(countLorebookEntries('null')).toBe(0);
    expect(countLorebookEntries('{not json')).toBe(0);
  });

  it('counts the entries array (and tolerates a missing array)', () => {
    expect(countLorebookEntries(JSON.stringify({ entries: [] }))).toBe(0);
    expect(
      countLorebookEntries(JSON.stringify({ entries: [{ content: 'a' }, { content: 'b' }] })),
    ).toBe(2);
    expect(countLorebookEntries(JSON.stringify({ extensions: {} }))).toBe(0);
  });
});

describe('buildCardSectionBadges', () => {
  const emptyState = {
    personality: '',
    voiceCharacteristics: '',
    basePrompt: '',
    scenario: '',
    exampleDialogues: '',
    postHistoryInstructions: '',
    firstMes: '',
    alternateGreetings: [] as string[],
    characterBook: null as string | null,
    imageCount: 0,
    tags: [] as string[],
    lifecycleConfig: {},
    creatorName: '',
  };

  it('reports Default/zero pills for an empty card', () => {
    expect(buildCardSectionBadges(emptyState)).toEqual({
      persona: 'Default',
      greetings: '0 opening',
      lorebook: '0 entries',
      galleryTags: '0 images · 0 tags',
      lifecycleAttribution: 'Default',
      images: '0 img',
      tagsRow: '0 tags',
      lifecycle: 'Default',
      attribution: 'Default',
    });
  });

  it('summarises a configured card', () => {
    const badges = buildCardSectionBadges({
      ...emptyState,
      personality: 'Warm',
      firstMes: 'Hi there',
      alternateGreetings: ['Hello', 'Hey'],
      characterBook: JSON.stringify({ entries: [{}, {}, {}] }),
      imageCount: 2,
      tags: ['fantasy', 'mentor', 'calm', 'kind'],
      lifecycleConfig: { beat_interval: 1800 },
      creatorName: 'Ada',
    });

    expect(badges.persona).toBe('Configured');
    expect(badges.greetings).toBe('1 opening · 2 alt');
    expect(badges.lorebook).toBe('3 entries');
    expect(badges.galleryTags).toBe('2 images · 4 tags');
    expect(badges.lifecycleAttribution).toBe('Custom');
    expect(badges.images).toBe('2 img');
    expect(badges.tagsRow).toBe('4 tags');
    expect(badges.lifecycle).toBe('Custom');
    expect(badges.attribution).toBe('Custom');
  });

  it('singularises a single lorebook entry and only counts non-empty values', () => {
    const badges = buildCardSectionBadges({
      ...emptyState,
      characterBook: JSON.stringify({ entries: [{}] }),
      lifecycleConfig: { autonomy_level: 0, beat_interval: 1800 },
      creatorName: '   ',
    });

    expect(badges.lorebook).toBe('1 entry');
    expect(badges.lifecycle).toBe('Custom');
    expect(badges.attribution).toBe('Default');
  });
});

describe('formatModuleConfigSubtitle', () => {
  it('formats provider · model from a JSON-string capability overlay', () => {
    expect(
      formatModuleConfigSubtitle({
        provider: 'soulbitscloud',
        capability_json: '{"model":"qwen-35-9b"}',
      }),
    ).toBe('Soulbits Cloud · qwen-35-9b');
  });

  it('falls back to the provider label when no model is configured', () => {
    expect(formatModuleConfigSubtitle({ provider: 'openai', capability_json: '{}' })).toBe(
      'OpenAI',
    );
    expect(formatModuleConfigSubtitle({ provider: 'custom-provider' })).toBe('custom-provider');
  });

  it('formats both STT slots (transcription + VAD)', () => {
    expect(
      formatModuleConfigSubtitle({
        transcription_provider: 'openai',
        vad_provider: 'soulbitscloud',
      }),
    ).toBe('OpenAI + VAD: Soulbits Cloud');
    expect(
      formatModuleConfigSubtitle({ transcription_provider: 'openai', vad_provider: '' }),
    ).toBe('OpenAI');
  });

  it('returns undefined when nothing is wired', () => {
    expect(formatModuleConfigSubtitle({})).toBeUndefined();
    expect(formatModuleConfigSubtitle({ provider: 'disabled' })).toBeUndefined();
    expect(formatModuleConfigSubtitle({ capability_json: '{}' })).toBeUndefined();
  });
});
