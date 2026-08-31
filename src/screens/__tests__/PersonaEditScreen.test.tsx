/**
 * PersonaEditScreen — 5-4 §1/§2 create/edit/built-in mode tests.
 *
 * Verifies:
 *  - built-in `user` mode (entityId='user') loads the built-in persona and
 *    HIDES the delete button (A1 — never deletable)
 *  - create mode prefills from the route's prefill payload ("create persona
 *    from this card", 5-4 §3) and saves via createUserPersona
 *  - edit mode loads the existing persona and saves via updateUserPersona
 */

import React from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react-native';
import { PersonaEditScreen } from '../PersonaEditScreen';

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

jest.mock('react-native-image-picker', () => ({
  launchImageLibrary: jest.fn(),
}));

jest.mock('react-native-vector-icons/MaterialCommunityIcons', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return ({ name, ...props }: any) => React.createElement(Text, { ...props }, name);
});

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
    useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn() }),
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
    ThemedButton: ({ label, onPress, testID, ...props }: any) =>
      React.createElement(
        View,
        { onPress: () => onPress(), testID, accessibilityRole: 'button', ...props },
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
jest.mock('../../components/profile/ProfileAvatar', () => {
  const React = require('react');
  const { View, Text } = require('react-native');
  return { __esModule: true, ProfileAvatar: ({ name, uri }: any) =>
    React.createElement(View, null,
      React.createElement(Text, null, `avatar:${name}`),
      uri ? React.createElement(Text, null, `dataurl:${uri}`) : null) };
});

jest.mock('../../database/repositories/userEntities', () => ({
  createUserPersona: jest.fn(),
  updateUserPersona: jest.fn(),
  getUserPersona: jest.fn(),
  deleteUserPersona: jest.fn(),
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

import {
  createUserPersona,
  updateUserPersona,
  getUserPersona,
} from '../../database/repositories/userEntities';

const mockCreate = createUserPersona as jest.Mock;
const mockUpdate = updateUserPersona as jest.Mock;
const mockGet = getUserPersona as jest.Mock;

async function flush() {
  for (let i = 0; i < 8; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

beforeEach(() => {
  jest.clearAllMocks();
  mockRouteParams = {};
  mockCreate.mockResolvedValue({ id: 'Mara', name: 'Mara', description: 'd', personality: 'p', avatarUri: null });
  mockUpdate.mockResolvedValue(undefined);
  mockGet.mockResolvedValue(null);
});

describe('PersonaEditScreen — built-in user mode (A1)', () => {
  it('loads the built-in "user" persona and HIDES the delete button', async () => {
    mockRouteParams = { entityId: 'user' };
    mockGet.mockResolvedValue({
      id: 'user',
      name: 'You',
      description: 'Your default persona',
      personality: 'Calm',
      avatarUri: null,
    });

    const utils = await render(<PersonaEditScreen />);
    await flush();

    // Delete button is hidden for the built-in identity.
    expect(utils.queryByTestId('delete-persona-button')).toBeNull();
    // The built-in persona's name is loaded into the editable name field.
    expect(utils.getByDisplayValue('You')).toBeTruthy();
  });

  it('loads a regular persona in edit mode with the delete button visible', async () => {
    mockRouteParams = { entityId: 'Mystic Mara' };
    mockGet.mockResolvedValue({
      id: 'Mystic Mara',
      name: 'Mystic Mara',
      description: 'A mystic healer',
      personality: 'Calm, wise',
      avatarUri: null,
    });

    const utils = await render(<PersonaEditScreen />);
    await flush();

    expect(utils.getByTestId('delete-persona-button')).toBeTruthy();
    expect(utils.getByDisplayValue('Mystic Mara')).toBeTruthy();
  });
});

describe('PersonaEditScreen — create mode with prefill (5-4 §3)', () => {
  it('prefills the form from the route prefill and saves via createUserPersona', async () => {
    mockRouteParams = {
      prefill: { name: 'Mara', description: 'A mystic healer', personality: 'Calm, wise', avatarUri: null },
    };

    const utils = await render(<PersonaEditScreen />);
    await flush();

    // Form is prefilled with the source card's identity fields.
    expect(utils.getByDisplayValue('Mara')).toBeTruthy();
    expect(utils.getByDisplayValue('A mystic healer')).toBeTruthy();
    expect(utils.getByDisplayValue('Calm, wise')).toBeTruthy();

    await fireEvent.press(utils.getByTestId('save-persona-button'));
    await flush();

    expect(mockCreate).toHaveBeenCalledWith({
      name: 'Mara',
      description: 'A mystic healer',
      personality: 'Calm, wise',
      avatar: null,
    });
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});

describe('PersonaEditScreen — edit mode save (5-4 §2)', () => {
  it('saves via updateUserPersona when editing an existing persona', async () => {
    mockRouteParams = { entityId: 'Mystic Mara' };
    mockGet.mockResolvedValue({
      id: 'Mystic Mara',
      name: 'Mystic Mara',
      description: 'A mystic healer',
      personality: 'Calm, wise',
      avatarUri: null,
    });

    const utils = await render(<PersonaEditScreen />);
    await flush();

    await fireEvent.press(utils.getByTestId('save-persona-button'));
    await flush();

    expect(mockUpdate).toHaveBeenCalledWith('Mystic Mara', {
      name: 'Mystic Mara',
      description: 'A mystic healer',
      personality: 'Calm, wise',
      avatar: null,
    });
    expect(mockCreate).not.toHaveBeenCalled();
  });
});
