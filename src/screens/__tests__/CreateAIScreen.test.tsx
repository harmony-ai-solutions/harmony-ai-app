/**
 * CreateAIScreen — reserved-name guard at the partner-name seam (2-2 UI / D33).
 *
 * Verifies:
 *  - a partner named `user` / `deleted` (trim + case-insensitive) shows the
 *    INLINE field error and the submit is blocked — the mint seam is never
 *    reached
 *  - the typed `ReservedEntityNameError` from `mintEntityId` (belt-and-braces)
 *    maps to the SAME inline error — never the generic createFailed alert
 *  - a normal name still saves via the mint seam (happy-path control)
 */

import React from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react-native';
import { CreateAIScreen } from '../CreateAIScreen';

afterEach(cleanup);
beforeEach(cleanup);

// Stable mock references — the screen's effects depend on `t`; the real app
// provides stable values, so the test mocks must too.
const mockT = (key: string) => key;
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
  hexToRgba: (hex: string, alpha: number) => hex,
}));

jest.mock('../../utils/haptics', () => ({
  hapticLightPress: jest.fn(),
}));

// Heavy editor components — shells (the wiring under test is the save path).
jest.mock('../../components/entities/EntityModuleSelectorWithActions', () => ({
  __esModule: true,
  EntityModuleSelectorWithActions: () => null,
}));
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
    ExportSection: ({ onExport }: any) =>
      React.createElement(
        TouchableOpacity,
        { testID: 'export-card-button', onPress: () => onExport('json') },
      ),
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
    }),
    validateLifecycleConfig: jest.fn().mockReturnValue(true),
  };
});

// ── Repos / services ───────────────────────────────────────────────────────
jest.mock('../../database/repositories/characters', () => ({
  createCharacterProfile: jest.fn().mockResolvedValue(undefined),
  createCharacterImage: jest.fn().mockResolvedValue(undefined),
  deleteCharacterImage: jest.fn().mockResolvedValue(undefined),
  deleteCharacterProfileCascade: jest.fn().mockResolvedValue(undefined),
  getCharacterProfile: jest.fn().mockResolvedValue(null),
  getCharacterImages: jest.fn().mockResolvedValue([]),
  getAllCharacterProfiles: jest.fn().mockResolvedValue([]),
  updateCharacterImage: jest.fn().mockResolvedValue(undefined),
  updateCharacterProfile: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../database/repositories/entities', () => ({
  createEntity: jest.fn().mockResolvedValue(undefined),
  createEntityModuleMapping: jest.fn().mockResolvedValue(undefined),
  createOrUpdateEntityModuleMapping: jest.fn().mockResolvedValue(undefined),
  getAllEntities: jest.fn().mockResolvedValue([]),
  getEntityByCharacterProfileId: jest.fn().mockResolvedValue(null),
  getEntityModuleMapping: jest.fn().mockResolvedValue(null),
  isProfilePersonaOwned: jest.fn().mockResolvedValue(false),
  mintEntityId: jest.fn().mockResolvedValue('Mystery-20260905123514'),
  updateEntityFields: jest.fn().mockResolvedValue(undefined),
  // Typed error class mirrored from the real repo module (D33 instanceof).
  ReservedEntityNameError: class ReservedEntityNameError extends Error {
    constructor(name: string) {
      super(`"${name}" is a reserved name — rename the card and retry`);
      this.name = 'ReservedEntityNameError';
    }
  },
}));

jest.mock('../../database/repositories/userEntities', () => ({
  getUserPersona: jest.fn().mockResolvedValue(null),
}));

jest.mock('../../database/repositories/interactions', () => ({
  getActiveInteractionsByEntity: jest.fn().mockResolvedValue([]),
}));

jest.mock('../../database/repositories/modules', () => ({
  getAllCognitionConfigs: jest.fn().mockResolvedValue([]),
  getAllTTSConfigs: jest.fn().mockResolvedValue([]),
  getAllSTTConfigs: jest.fn().mockResolvedValue([]),
  getAllVisionConfigs: jest.fn().mockResolvedValue([]),
  getAllRAGConfigs: jest.fn().mockResolvedValue([]),
  getAllImaginationConfigs: jest.fn().mockResolvedValue([]),
  getAllMovementConfigs: jest.fn().mockResolvedValue([]),
  getAllBackendConfigs: jest.fn().mockResolvedValue([]),
}));

jest.mock('../../services/SyncService', () => ({
  __esModule: true,
  default: { initiateSync: jest.fn().mockResolvedValue(undefined), syncAndWait: jest.fn().mockResolvedValue(undefined) },
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

import { mintEntityId } from '../../database/repositories/entities';
import { createCharacterProfile } from '../../database/repositories/characters';

const mockMint = mintEntityId as jest.Mock;
const mockCreateProfile = createCharacterProfile as jest.Mock;

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
    mockMint.mockResolvedValue('Mystery-20260905123514');
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
    expect(mockMint).not.toHaveBeenCalled();
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
    expect(mockMint).not.toHaveBeenCalled();
    expect(mockGoBack).not.toHaveBeenCalled();
    expect(mockShowAlert).not.toHaveBeenCalled();
  });

  it('typed ReservedEntityNameError from the mint seam maps to the SAME inline error (belt-and-braces, never createFailed)', async () => {
    // The live pre-check passes (non-reserved name) but the seam rejects —
    // the residual-race / predicate-drift path.
    mockMint.mockRejectedValue(
      new (require('../../database/repositories/entities').ReservedEntityNameError)('Mystery'),
    );

    const utils = await renderScreen();
    await flush();

    await fireEvent.changeText(utils.getByPlaceholderText('namePlaceholder'), 'Mystery');
    await fireEvent.press(utils.getByText('save'));
    await flush();

    expect(mockMint).toHaveBeenCalledTimes(1);
    expect(utils.getByTestId('create-ai-name-error')).toBeTruthy();
    expect(utils.getByText('nameReserved')).toBeTruthy();
    expect(mockCreateProfile).not.toHaveBeenCalled();
    expect(mockGoBack).not.toHaveBeenCalled();
    expect(mockShowAlert).not.toHaveBeenCalled();
  });

  it('happy-path control: a normal name saves via the mint seam', async () => {
    const utils = await renderScreen();
    await flush();

    await fireEvent.changeText(utils.getByPlaceholderText('namePlaceholder'), 'Mystery');
    await fireEvent.press(utils.getByText('save'));
    await flush();

    expect(mockMint).toHaveBeenCalledWith('Mystery');
    expect(mockCreateProfile).toHaveBeenCalled();
    expect(utils.queryByTestId('create-ai-name-error')).toBeNull();
    expect(mockGoBack).toHaveBeenCalledTimes(1);
  });
});
