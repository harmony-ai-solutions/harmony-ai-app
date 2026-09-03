/**
 * CharactersScreen — 4-3 tag + creator filtering tests.
 *
 * Verifies:
 *  - the TagChips filter row renders from distinct library tags
 *  - multi-select OR tag filtering (a profile matches if ANY of its tags is in
 *    the selected set)
 *  - creator filter via the card's attribution tap; combined with tag filters
 *  - clear filters restores the full list
 *  - reduced-motion renders the active-filter banner statically (no animation)
 */

import React from 'react';
import { act, cleanup, fireEvent, render, userEvent } from '@testing-library/react-native';
import { CharactersScreen } from '../CharactersScreen';
import type { CharacterProfile } from '../../database/models';

// Explicit cleanup — RNTL auto-cleanup plus multiple screen roots in one file.
afterEach(cleanup);
beforeEach(cleanup);

let user: ReturnType<typeof userEvent.setup>;
beforeEach(() => {
  user = userEvent.setup();
});

// ── Mutable reduced-motion flag (flipped per test) ─────────────────────────
let mockReduceMotion = false;
jest.mock('../../hooks/useReducedMotion', () => ({
  useReducedMotion: () => mockReduceMotion,
}));

const mockShowAlert = jest.fn();

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
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

// CharactersScreen shows themed toasts (favorites/categories feedback) —
// mock the toast context so renders don't require AppToastProvider.
jest.mock('../../contexts/AppToastContext', () => ({
  useToast: () => ({ showToast: jest.fn() }),
}));

// The screen reads the signed-in user (senju's creator/profile features) —
// mock auth so renders don't require AuthProvider (null user is handled).
jest.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: null }),
}));

// Stable navigation mock — the from-card test asserts the navigate call.
const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => {
  const React = require('react');
  return {
    useNavigation: () => ({ navigate: mockNavigate }),
    useFocusEffect: (cb: () => void) => React.useEffect(cb, [cb]),
  };
});

jest.mock('../../contexts/ThemeContext', () => ({
  useAppTheme: () => ({
    theme: {
      colors: {
        accent: { primary: '#7c3aed', secondary: '#a78bfa' },
        background: { base: '#0f0f1a', surface: '#151d30', elevated: '#1e1e2e' },
        border: { default: '#333333' },
        text: { primary: '#ffffff', secondary: '#cccccc', muted: '#aaaaaa', disabled: '#555555' },
        status: { success: '#22c55e', warning: '#f59e0b', error: '#ef4444' },
        gradients: {
          primary: 'linear-gradient(135deg, #7c3aed 0%, #a78bfa 100%)',
          secondary: 'linear-gradient(135deg, #33334d 0%, #4a4a6a 100%)',
          surface: 'linear-gradient(135deg, rgba(124, 58, 237, 0.05) 0%, rgba(167, 139, 250, 0.05) 100%)',
        },
        glass: {
          cardOpacity: 0.5,
          glowOpacity: 0.08,
          glowRadius: 14,
          borderGradientStart: '#fff',
          borderGradientEnd: '#a78bfa',
        },
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

jest.mock('../../components/navigation/GlassTabBar', () => ({
  TAB_BAR_CONTENT_PAD: 120,
  TAB_BAR_FAB_OFFSET: 116,
}));

jest.mock('../../utils/colorUtils', () => ({
  hexToRgba: (hex: string, alpha: number) => hex,
}));

jest.mock('../../database/repositories/characters', () => ({
  getAllCharacterProfiles: jest.fn(),
  getCharacterImages: jest.fn(),
  getDistinctTags: jest.fn(),
  deleteCharacterProfile: jest.fn(),
  createCharacterProfile: jest.fn(),
  createCharacterImage: jest.fn(),
  updateCharacterProfile: jest.fn(),
  // Senju's load-path additions — empty results so loadFavoritesAndCategories
  // completes without favorites/category data.
  getFavoriteCharacterProfileIds: jest.fn().mockResolvedValue([]),
}));

// O6: custom categories persist in AsyncStorage via CategoryPreferencesService
// (the old DB categories sidecar is gone). Tests start with no custom
// categories; the filter chips then derive purely from profile tags.
jest.mock('../../services/CategoryPreferencesService', () => ({
  __esModule: true,
  default: {
    getCategories: jest.fn().mockResolvedValue([]),
    createCategory: jest.fn(),
    renameCategory: jest.fn(),
    deleteCategory: jest.fn(),
  },
}));

// The screen fetches the blocked-user id set from the SocialService stub and
// passes it to the PURE utils filter (which no-ops on an empty set). Mock the
// service so the block list starts clean in tests.
jest.mock('../../services/social/SocialService', () => ({
  getBlockedUserIds: jest.fn().mockResolvedValue(new Set()),
}));

jest.mock('../../database/repositories/entities', () => ({
  getAllEntities: jest.fn().mockResolvedValue([]),
  createEntity: jest.fn(),
  createEntityModuleMapping: jest.fn(),
  getEntityByCharacterProfileId: jest.fn().mockResolvedValue(null),
}));

jest.mock('../../database/repositories/interactions', () => ({
  deriveParticipantKey: jest.fn().mockReturnValue('pk'),
  deriveScopeFromParticipants: jest.fn().mockReturnValue('one_on_one'),
}));

jest.mock('../../database/repositories/userEntities', () => ({
  resolvePersonaId: jest.fn().mockResolvedValue('user'),
  createUserPersonaFromCard: jest.fn(),
}));

jest.mock('../../services/ChatPreferencesService', () => ({
  __esModule: true,
  default: {
    getGlobalImpersonatedEntity: jest.fn().mockResolvedValue(null),
  },
}));

// Captured `sync:data-applied` handler so tests can drive the reload triggers
// (4-1 / 3-4) from the mocked SyncService.
let syncDataAppliedHandler: ((payload: { tables: string[] }) => void) | null = null;

jest.mock('../../services/SyncService', () => ({
  __esModule: true,
  default: {
    syncAndWait: jest.fn().mockResolvedValue(undefined),
    initiateSync: jest.fn().mockResolvedValue(undefined),
    // 4-1: CharactersScreen subscribes to sync:data-applied for live favorites.
    // 3-4: entity / character_image applies also reload the profile list.
    on: (event: string, handler: any) => {
      if (event === 'sync:data-applied') syncDataAppliedHandler = handler;
    },
    off: jest.fn(),
  },
}));

jest.mock('../../services/CharacterCardImportService', () => ({
  CharacterCardImportError: class CharacterCardImportError extends Error {
    code?: string;
  },
}));

jest.mock('../../components/character-card/editor-sections/ImportReviewSheet', () => ({
  __esModule: true,
  ImportReviewSheet: () => null,
  buildImportDetectionSummary: () => ({}),
}));

// TagChips filter-mode mock: mirrors the real dual-use behaviour — suggestions
// add to the selected set, tapping a selected chip removes it. Plain View +
// onPress so RNTL fireEvent.press reaches the handler (proven pattern).
jest.mock('../../components/character-card/TagChips', () => {
  const React = require('react');
  const { View, Text } = require('react-native');
  return {
    __esModule: true,
    TagChips: ({ tags, onChange, suggestions }: any) => {
      const visibleSuggestions = suggestions.filter(
        (s: string) => !tags.some((t: string) => t.toLowerCase() === s.toLowerCase()),
      );
      return React.createElement(
        View,
        { testID: 'tag-chips-filter' },
        visibleSuggestions.map((s: string) =>
          React.createElement(
            View,
            {
              key: s,
              testID: `filter-tag-${s}`,
              onPress: () => onChange([...tags, s]),
              accessibilityRole: 'button',
            },
            React.createElement(Text, null, s),
          ),
        ),
        tags.map((t: string) =>
          React.createElement(
            View,
            {
              key: t,
              testID: `filter-tag-selected-${t}`,
              onPress: () => onChange(tags.filter((x: string) => x !== t)),
              accessibilityRole: 'button',
            },
            React.createElement(Text, null, `selected:${t}`),
          ),
        ),
      );
    },
  };
});

// CharacterProfileCard mock: a card shell + a tappable creator attribution
// (drives the screen's creator filter — the wiring under test) + a long-press
// target (drives the context menu).
jest.mock('../../components/characters/CharacterProfileCard', () => {
  const React = require('react');
  const { View, Text } = require('react-native');
  return {
    __esModule: true,
    CharacterProfileCard: ({ profile, onCreatorPress, onLongPress }: any) =>
      React.createElement(
        View,
        { testID: `card-${profile.id}` },
        React.createElement(Text, null, profile.name),
        React.createElement(
          View,
          {
            testID: `longpress-${profile.id}`,
            onPress: () => onLongPress?.(profile),
            accessibilityRole: 'button',
          },
        ),
        React.createElement(
          View,
          {
            testID: `creator-attribution-${profile.id}`,
            onPress: () => onCreatorPress?.(profile.creator),
            accessibilityRole: 'button',
          },
          React.createElement(Text, null, `by ${profile.creator}`),
        ),
      ),
  };
});

// "New AI partner?" bottom sheet: expose the two routing intents the screen
// wires — fresh create + "From an Existing One" (live-link picker).
jest.mock('../../components/characters/CreatePartnerModal', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    CreatePartnerModal: ({ visible, onNewPartner, onFromExisting }: any) =>
      visible
        ? React.createElement(
            View,
            { testID: 'create-partner-modal' },
            React.createElement(View, {
              testID: 'partner-new',
              onPress: onNewPartner,
              accessibilityRole: 'button',
            }),
            React.createElement(View, {
              testID: 'partner-from-existing',
              onPress: onFromExisting,
              accessibilityRole: 'button',
            }),
          )
        : null,
  };
});

// Card picker: loads profiles from the (mocked) repo when visible and exposes
// one tappable row per profile driving `onSelect` — the routing seam under test.
jest.mock('../../components/characters/AICardPickerModal', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    AICardPickerModal: ({ visible, onSelect }: any) => {
      const [profiles, setProfiles] = React.useState([]);
      React.useEffect(() => {
        if (!visible) return;
        let cancelled = false;
        require('../../database/repositories/characters')
          .getAllCharacterProfiles()
          .then((rows: any[]) => {
            if (!cancelled) setProfiles(rows);
          });
        return () => {
          cancelled = true;
        };
      }, [visible]);
      if (!visible) return null;
      return React.createElement(
        View,
        { testID: 'ai-card-picker-modal' },
        profiles.map((p: any) =>
          React.createElement(View, {
            key: p.id,
            testID: `picker-select-${p.id}`,
            onPress: () => onSelect(p),
            accessibilityRole: 'button',
          }),
        ),
      );
    },
  };
});

// Long-press context menu: expose the "Create persona from this card" action
// (decision 4/7/12 — immediate full-copy → editor).
jest.mock('../../components/characters/CharacterCardMenuModal', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    CharacterCardMenuModal: ({ visible, onCreatePersonaFromCard }: any) =>
      visible
        ? React.createElement(
            View,
            { testID: 'card-menu-modal' },
            React.createElement(View, {
              testID: 'menu-create-persona',
              onPress: () => onCreatePersonaFromCard(),
              accessibilityRole: 'button',
            }),
          )
        : null,
  };
});

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

jest.mock('../../components/themed/ThemedButton', () => {
  const React = require('react');
  const { View, Text } = require('react-native');
  return {
    __esModule: true,
    ThemedButton: ({ label, onPress, testID, ...props }: any) =>
      React.createElement(
        View,
        { onPress: () => onPress(), testID, accessibilityRole: 'button', ...props },
        React.createElement(Text, { testID: `${testID}-label` }, label),
      ),
  };
});

jest.mock('../../components/themed/ThemedFab', () => {
  const React = require('react');
  const { View } = require('react-native');
  return { __esModule: true, ThemedFab: (props: any) => React.createElement(View, { ...props }) };
});

jest.mock('../../components/themed/ScreenHeader', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    ScreenHeader: ({ children, ...props }: any) =>
      React.createElement(View, { testID: 'screen-header-mock', ...props }, children),
  };
});

import {
  getAllCharacterProfiles,
  getCharacterImages,
  getDistinctTags,
} from '../../database/repositories/characters';

const mockGetAll = getAllCharacterProfiles as jest.Mock;
const mockGetImages = getCharacterImages as jest.Mock;
const mockGetDistinctTags = getDistinctTags as jest.Mock;

function makeProfile(id: string, name: string, tags: string[], creator: string): CharacterProfile {
  return {
    id,
    name,
    description: `${name} description`,
    personality: '',
    voice_characteristics: '',
    base_prompt: '',
    scenario: '',
    typing_speed_wpm: 60,
    audio_response_chance_percent: 50,
    vision_config_id: null,
    lifecycle_config: '{}',
    first_mes: '',
    mes_example: '',
    alternate_greetings: '',
    post_history_instructions: '',
    creator_notes: '',
    creator,
    character_version: '1.0',
    nickname: '',
    tags: JSON.stringify(tags),
    group_only_greetings: '',
    extensions: '',
    assets: '',
    card_provenance: '',
    character_book: 'null',
    created_at: new Date(),
    updated_at: new Date(),
    deleted_at: null,
  };
}

const PROFILES = [
  makeProfile('p1', 'Aria', ['fantasy', 'mage'], 'Emberforge'),
  makeProfile('p2', 'Bryn', ['fantasy', 'rogue'], 'Other Co'),
  makeProfile('p3', 'Cara', ['music'], 'Emberforge'),
];

const ALL_TAGS = ['fantasy', 'mage', 'music', 'rogue'];

async function flush() {
  // Drain the full async load chain: loadProfiles has multiple sequential
  // awaits (getAll → filterBlocked → getDistinctTags → image loop) plus the
  // concurrent favorites/categories load — a single tick is not enough.
  for (let i = 0; i < 10; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function renderScreen() {
  mockGetAll.mockResolvedValue(PROFILES);
  mockGetImages.mockResolvedValue([]);
  mockGetDistinctTags.mockResolvedValue(ALL_TAGS);
  // RNTL v14 `render` is async here (React 19) — await it like the existing
  // screen tests do (`await render(...)` in chatDetailScenarioGenerate.test).
  const utils = await render(<CharactersScreen />);
  await flush();
  return utils;
}

type RenderUtils = Awaited<ReturnType<typeof render>>;

function cardIds(utils: RenderUtils): string[] {
  return utils
    .getAllByTestId(/^card-/)
    .map(node => node.props.testID as string)
    .sort();
}

describe('CharactersScreen — tag filtering (4-3)', () => {
  it('renders the TagChips filter row sourced from distinct library tags', async () => {
    const utils = await renderScreen();

    expect(utils.getByTestId('tag-filter-row')).toBeTruthy();
    expect(utils.getByTestId('filter-tag-fantasy')).toBeTruthy();
    expect(utils.getByTestId('filter-tag-music')).toBeTruthy();
    expect(cardIds(utils)).toEqual(['card-p1', 'card-p2', 'card-p3']);
  });

  it('filters by multi-select OR: any tag in the selected set matches', async () => {
    const utils = await renderScreen();

    // Select "fantasy" → Aria + Bryn (both fantasy), Cara hidden.
    await user.press(utils.getByTestId('filter-tag-fantasy'));
    expect(cardIds(utils)).toEqual(['card-p1', 'card-p2']);
    expect(utils.queryByTestId('card-p3')).toBeNull();

    // Add "music" → Cara matches too (OR), all three visible again.
    await user.press(utils.getByTestId('filter-tag-music'));
    expect(cardIds(utils)).toEqual(['card-p1', 'card-p2', 'card-p3']);
  });

  it('narrows the tag filter when a selected tag is de-selected', async () => {
    const utils = await renderScreen();

    // Select "fantasy" AND "music" → OR: all three match.
    await user.press(utils.getByTestId('filter-tag-fantasy'));
    await user.press(utils.getByTestId('filter-tag-music'));
    expect(cardIds(utils)).toEqual(['card-p1', 'card-p2', 'card-p3']);

    // De-select "music" → only fantasy-tagged profiles remain (p1 + p2).
    await user.press(utils.getByTestId('filter-tag-selected-music'));
    expect(cardIds(utils)).toEqual(['card-p1', 'card-p2']);
  });
});

describe('CharactersScreen — creator filtering (4-3)', () => {
  it('tapping a card creator filters the list to that creator', async () => {
    const utils = await renderScreen();

    await user.press(utils.getByTestId('creator-attribution-p1')); // Emberforge

    expect(utils.getByText('filterByCreator')).toBeTruthy();
    expect(cardIds(utils)).toEqual(['card-p1', 'card-p3']);
    expect(utils.queryByTestId('card-p2')).toBeNull();
  });

  it('clear filters restores the full list (creator + tags)', async () => {
    const utils = await renderScreen();

    await user.press(utils.getByTestId('creator-attribution-p1')); // Emberforge
    expect(cardIds(utils)).toEqual(['card-p1', 'card-p3']);

    await user.press(utils.getByTestId('filter-tag-fantasy')); // + fantasy
    expect(cardIds(utils)).toEqual(['card-p1']);

    // "Clear filters" lives inside the banner, which animates in (opacity 0
    // until the timing runs) — userEvent skips hidden elements, so use
    // fireEvent here (it dispatches regardless of visibility).
    await fireEvent.press(utils.getByTestId('clear-filters'));
    expect(cardIds(utils)).toEqual(['card-p1', 'card-p2', 'card-p3']);
  });
});

describe('CharactersScreen — reduced motion (4-3)', () => {
  afterEach(() => {
    mockReduceMotion = false;
  });

  it('animates the active-filter banner when reduced motion is off', async () => {
    mockReduceMotion = false;
    const utils = await renderScreen();

    await user.press(utils.getByTestId('creator-attribution-p1'));
    expect(utils.getByTestId('active-filter-banner-animated')).toBeTruthy();
    expect(utils.queryByTestId('active-filter-banner-static')).toBeNull();
  });

  it('renders the banner statically when reduced motion is on', async () => {
    mockReduceMotion = true;
    const utils = await renderScreen();

    await user.press(utils.getByTestId('creator-attribution-p1'));
    expect(utils.getByTestId('active-filter-banner-static')).toBeTruthy();
    expect(utils.queryByTestId('active-filter-banner-animated')).toBeNull();
  });
});

describe('CharactersScreen — create persona from card (decision 4/7/12)', () => {
  beforeEach(() => {
    mockNavigate.mockClear();
    const { createUserPersonaFromCard } =
      require('../../database/repositories/userEntities');
    (createUserPersonaFromCard as jest.Mock).mockResolvedValue({
      id: 'Aria 2',
      name: 'Aria 2',
      description: 'Aria description',
      personality: 'Aria personality',
      avatarUri: null,
    });
  });

  it('immediately full-copies the card and opens the persona editor on the new persona', async () => {
    const { createUserPersonaFromCard } =
      require('../../database/repositories/userEntities');
    const utils = await renderScreen();

    // Long-press a card → context menu.
    await fireEvent.press(utils.getByTestId('longpress-p1'));
    expect(utils.getByTestId('card-menu-modal')).toBeTruthy();

    // "Create persona from this card" → immediate full copy + editor opens.
    await fireEvent.press(utils.getByTestId('menu-create-persona'));
    await flush();

    expect(createUserPersonaFromCard).toHaveBeenCalledWith('p1');
    expect(mockNavigate).toHaveBeenCalledWith('PersonaEdit', { entityId: 'Aria 2' });
    // The editor opens on the NEW persona (id) — the identity-only prefill
    // path is retired.
    expect(mockNavigate).not.toHaveBeenCalledWith(
      'PersonaEdit',
      expect.objectContaining({ prefill: expect.anything() }),
    );
  });
});

describe('CharactersScreen — new-partner picker routing (live link)', () => {
  beforeEach(() => {
    mockNavigate.mockClear();
  });

  it('routes "From an Existing One" to the LIVE-LINK param (prefillProfileId, no fork)', async () => {
    const utils = await renderScreen();

    // FAB → "From an Existing One" → card picker opens.
    await fireEvent.press(utils.getByTestId('add-ai-partner'));
    await fireEvent.press(utils.getByTestId('partner-from-existing'));
    expect(utils.getByTestId('ai-card-picker-modal')).toBeTruthy();

    // Pick a card → CreateAI with the LIVE-LINK param (the new AI entity
    // references the SAME character profile — the fork param is retired).
    await fireEvent.press(utils.getByTestId('picker-select-p1'));
    await flush();

    expect(mockNavigate).toHaveBeenCalledWith('CreateAI', {
      prefillProfileId: 'p1',
    });
    expect(mockNavigate).not.toHaveBeenCalledWith(
      'CreateAI',
      expect.objectContaining({ duplicateProfileId: expect.anything() }),
    );
  });

  it('routes "New partner" to a bare CreateAI (fresh-profile mode unchanged)', async () => {
    const utils = await renderScreen();

    await fireEvent.press(utils.getByTestId('add-ai-partner'));
    await fireEvent.press(utils.getByTestId('partner-new'));

    expect(mockNavigate).toHaveBeenCalledWith('CreateAI', {});
    expect(mockNavigate).not.toHaveBeenCalledWith(
      'CreateAI',
      expect.objectContaining({
        prefillProfileId: expect.anything(),
        duplicateProfileId: expect.anything(),
      }),
    );
  });
});

describe('CharactersScreen — sync:data-applied reload triggers (4-1 / 3-4)', () => {
  const { getFavoriteCharacterProfileIds } =
    require('../../database/repositories/characters');

  beforeEach(() => {
    syncDataAppliedHandler = null;
    mockGetAll.mockClear();
    (getFavoriteCharacterProfileIds as jest.Mock).mockClear();
  });

  it('reloads the profile list when entities was applied (persona-cascade tombstones)', async () => {
    await renderScreen();
    expect(mockGetAll).toHaveBeenCalled(); // initial load

    mockGetAll.mockClear();
    await act(async () => {
      syncDataAppliedHandler?.({ tables: ['entities'] });
    });
    await flush();
    // Persona delete over sync touches `entities` — the list must re-read so
    // freed persona-owned cards and avatar state refresh while focused (3-4).
    expect(mockGetAll).toHaveBeenCalled();
  });

  it('reloads the profile list when character_image was applied (avatar churn)', async () => {
    await renderScreen();
    mockGetAll.mockClear();
    await act(async () => {
      syncDataAppliedHandler?.({ tables: ['character_image'] });
    });
    await flush();
    expect(mockGetAll).toHaveBeenCalled();
  });

  it('does NOT reload the profile list when only unrelated tables were applied', async () => {
    await renderScreen();
    mockGetAll.mockClear();
    await act(async () => {
      syncDataAppliedHandler?.({ tables: ['conversation_messages', 'interactions'] });
    });
    await flush();
    expect(mockGetAll).not.toHaveBeenCalled();
  });

  it('still reloads favorites/categories when character_profiles was applied (4-1)', async () => {
    await renderScreen();
    (getFavoriteCharacterProfileIds as jest.Mock).mockClear();
    await act(async () => {
      syncDataAppliedHandler?.({ tables: ['character_profiles'] });
    });
    await flush();
    expect(getFavoriteCharacterProfileIds).toHaveBeenCalled();
  });

  it('fires BOTH reloads when a persona-cascade batch applied (entity + profile + images)', async () => {
    await renderScreen();
    mockGetAll.mockClear();
    (getFavoriteCharacterProfileIds as jest.Mock).mockClear();
    await act(async () => {
      syncDataAppliedHandler?.({
        tables: ['entities', 'character_profiles', 'character_image'],
      });
    });
    await flush();
    expect(mockGetAll).toHaveBeenCalled();
    expect(getFavoriteCharacterProfileIds).toHaveBeenCalled();
  });
});
