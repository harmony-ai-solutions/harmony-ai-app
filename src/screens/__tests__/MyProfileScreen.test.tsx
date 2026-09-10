/**
 * MyProfileScreen — 5-4 §2 personas-tab (getUserEntities) test.
 *
 * Verifies the Personas tab lists the user entities repo's output (via
 * getUserEntities), which INCLUDES the built-in `user` entity as a
 * persona cell — and renders with the existing grid/badging unchanged.
 */

import React from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react-native';
import { MyProfileScreen } from '../MyProfileScreen';
import type { Persona } from '../../database/repositories/userEntities';

afterEach(cleanup);
beforeEach(cleanup);

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

jest.mock('react-native-vector-icons/MaterialCommunityIcons', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return ({ name, ...props }: any) => React.createElement(Text, { ...props }, name);
});

jest.mock('../../utils/haptics', () => ({
  hapticLightPress: jest.fn(),
}));

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

const mockShowAlert = jest.fn();
jest.mock('../../contexts/AppAlertContext', () => ({
  useAppAlert: () => ({ showAlert: mockShowAlert }),
}));
jest.mock('../../contexts/AppToastContext', () => ({
  useToast: () => ({ showToast: jest.fn() }),
}));

jest.mock('../../contexts/AuthContext', () => ({
  useAuth: jest.fn(),
}));

// Stable identity so the focus-effect loaders (depends on `user`) don't loop.
const MOCK_USER = {
  id: 'u1',
  display_name: 'Senju',
  email: 'senju@example.com',
  avatar_url: null,
};

jest.mock('@react-navigation/native', () => {
  const React = require('react');
  return {
    useNavigation: () => ({ navigate: jest.fn() }),
    useFocusEffect: (cb: () => void) => React.useEffect(cb, [cb]),
  };
});

// Themed primitives.
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
  return { __esModule: true, ThemedButton: ({ label, onPress, testID, ...props }: any) =>
    React.createElement(View, { onPress: () => onPress(), testID, accessibilityRole: 'button', ...props },
      React.createElement(Text, null, label)) };
});
jest.mock('../../components/themed/ThemedEmptyState', () => {
  const React = require('react');
  const { View } = require('react-native');
  return { __esModule: true, ThemedEmptyState: ({ style, ...props }: any) =>
    React.createElement(View, { style, ...props }) };
});
jest.mock('../../components/themed/ScreenHeader', () => {
  const React = require('react');
  const { View } = require('react-native');
  return { __esModule: true, ScreenHeader: ({ children, right, ...props }: any) =>
    React.createElement(View, { testID: 'screen-header-mock', ...props }, children, right) };
});
jest.mock('../../components/navigation/HeaderMenuButton', () => {
  const React = require('react');
  const { View } = require('react-native');
  return { __esModule: true, HeaderMenuButton: () => React.createElement(View, { testID: 'header-menu-button' }) };
});
jest.mock('../../components/navigation/HeaderNotificationButton', () => {
  const React = require('react');
  const { View } = require('react-native');
  return { __esModule: true, HeaderNotificationButton: () => React.createElement(View, { testID: 'header-notification-button' }) };
});
jest.mock('../../components/profile/ProfileAvatar', () => {
  const React = require('react');
  const { View, Text } = require('react-native');
  return { __esModule: true, ProfileAvatar: ({ name, uri }: any) =>
    React.createElement(View, null,
      React.createElement(Text, null, `avatar:${name}`),
      uri ? React.createElement(Text, null, `dataurl:${uri}`) : null) };
});
jest.mock('../../components/navigation/GlassTabBar', () => ({
  TAB_BAR_CONTENT_PAD: 120,
}));

// Screen-local modal/feed components — not exercised by the personas tab.
jest.mock('../../components/social/CreatePostModal', () => {
  const React = require('react');
  const { View } = require('react-native');
  return { __esModule: true, CreatePostModal: () => React.createElement(View, null) };
});
jest.mock('../../components/social/PostCommentModal', () => {
  const React = require('react');
  const { View } = require('react-native');
  return { __esModule: true, PostCommentModal: () => React.createElement(View, null) };
});
jest.mock('../../components/social/PostCard', () => {
  const React = require('react');
  const { View } = require('react-native');
  return { __esModule: true, PostCard: () => React.createElement(View, null) };
});

// Repos + services.
jest.mock('../../database/repositories/characters', () => ({
  getUserCharacterProfiles: jest.fn().mockResolvedValue([]),
}));
jest.mock('../../database/repositories/userEntities', () => ({
  getUserEntities: jest.fn(),
}));
jest.mock('../../services/ChatPreferencesService', () => ({
  __esModule: true,
  default: {
    getGlobalImpersonatedEntity: jest.fn().mockResolvedValue(null),
    setGlobalImpersonatedEntity: jest.fn().mockResolvedValue(undefined),
  },
}));
jest.mock('../../services/profile/ProfileExtrasService', () => ({
  __esModule: true,
  default: {
    getExtras: jest.fn().mockResolvedValue({ username: 'senju', bio: 'hi', avatarDataUrl: null }),
  },
}));
jest.mock('../../services/social/SocialService', () => ({
  LOCAL_USER_ID: 'local',
  getFollowedUsers: jest.fn().mockResolvedValue([]),
  getSavedCharacterEntries: jest.fn().mockResolvedValue([]),
  getPosts: jest.fn().mockResolvedValue([]),
  deletePost: jest.fn(),
  togglePostLike: jest.fn(),
  getPostComments: jest.fn().mockResolvedValue([]),
}));

import { getUserEntities } from '../../database/repositories/userEntities';
import { useAuth } from '../../contexts/AuthContext';

const mockGetUserEntities = getUserEntities as jest.Mock;
const mockUseAuth = useAuth as jest.Mock;

const USER_ENTITY: Persona = {
  id: 'user',
  name: 'You',
  description: 'Your default persona',
  personality: '',
  avatarUri: 'data:image/png;base64,YWJj',
  isActive: true,
};
const MARA: Persona = {
  id: 'Mystic Mara',
  name: 'Mystic Mara',
  description: 'A mystic healer',
  personality: 'Calm, wise',
  avatarUri: null,
  isActive: false,
};

async function flush() {
  for (let i = 0; i < 10; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

describe('MyProfileScreen — unauthenticated local mode + personas tab (5-4 §2)', () => {
  beforeEach(() => {
    // Default every test to authenticated; unauthenticated tests override.
    mockUseAuth.mockReturnValue({ user: MOCK_USER, status: 'authenticated' });
  });

  it('lists user entities (including the built-in user) as Persona rows', async () => {
    mockGetUserEntities.mockResolvedValue([USER_ENTITY, MARA]);

    const utils = await render(<MyProfileScreen />);
    await flush();

    // Switch to the Personas tab.
    await fireEvent.press(utils.getByTestId('profile-tab-personas'));
    await flush();

    // Both the built-in user and the authored persona render as rows.
    const rows = utils.getAllByTestId('persona-row');
    expect(rows).toHaveLength(2);
    expect(utils.getByText('You')).toBeTruthy();
    expect(utils.getByText('Mystic Mara')).toBeTruthy();
  });

  it('renders the full screen (tab bar) when unauthenticated instead of the old whole-screen sign-in gate', async () => {
    mockUseAuth.mockReturnValue({ user: null, status: 'unauthenticated' });

    const utils = await render(<MyProfileScreen />);
    await flush();

    // The tab bar is always rendered (local mode — personas / Saved / etc.).
    expect(utils.getByTestId('profile-tab-posts')).toBeTruthy();
    expect(utils.getByTestId('profile-tab-saved')).toBeTruthy();
    expect(utils.getByTestId('profile-tab-personas')).toBeTruthy();
    // The local fallback identity still shows.
    expect(utils.getByText('User')).toBeTruthy();
  });

  it('shows the sign-in empty state in the Posts tab when unauthenticated', async () => {
    mockUseAuth.mockReturnValue({ user: null, status: 'unauthenticated' });

    const utils = await render(<MyProfileScreen />);
    await flush();

    // Default (focused) tab is Posts — should show the sign-in state.
    expect(utils.getByTestId('profile-not-signed-in')).toBeTruthy();
    // Cloud-bound affordances are greyed with hints, never hidden.
    expect(utils.getByText('editProfileSignInHint')).toBeTruthy();
    expect(utils.getByText('statsSignInHint')).toBeTruthy();
  });

  it('still renders persona rows when unauthenticated (personas are purely local)', async () => {
    mockUseAuth.mockReturnValue({ user: null, status: 'unauthenticated' });
    mockGetUserEntities.mockResolvedValue([USER_ENTITY, MARA]);

    const utils = await render(<MyProfileScreen />);
    await flush();

    await fireEvent.press(utils.getByTestId('profile-tab-personas'));
    await flush();

    const rows = utils.getAllByTestId('persona-row');
    expect(rows).toHaveLength(2);
    expect(utils.getByText('You')).toBeTruthy();
    expect(utils.getByText('Mystic Mara')).toBeTruthy();
  });
});
