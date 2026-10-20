/**
 * PersonaListScreen — Settings-tab persona list.
 *
 * Verifies the shared PersonaRow reuse (active highlight + pencil), row tap =
 * set-active through ChatPreferencesService, New Persona → PersonaEdit, and the
 * empty-state CTA. Themed primitives are reduced to plain RN nodes; the row
 * itself is real so its testIDs/active chip are exercised.
 */

import React from 'react';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react-native';

afterEach(cleanup);
beforeEach(() => {
  cleanup();
  jest.clearAllMocks();
  mockGetGlobal.mockResolvedValue(null);
  mockSetGlobal.mockResolvedValue(undefined);
  mockGetUserEntities.mockResolvedValue(PERSONAS);
});

const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
const mockShowAlert = jest.fn();
const mockGetGlobal = jest.fn();
const mockSetGlobal = jest.fn();
const mockGetUserEntities = jest.fn();

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('../../utils/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

jest.mock('../../utils/haptics', () => ({ hapticLightPress: jest.fn() }));

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

jest.mock('../../contexts/ThemeContext', () => ({
  useAppTheme: () => ({
    theme: {
      colors: {
        accent: { primary: '#7c3aed', secondary: '#a78bfa' },
        gradients: {
          primary: 'linear-gradient(135deg, #ec4899 0%, #a78bfa 100%)',
          secondary: 'linear-gradient(135deg, #a78bfa 0%, #7c3aed 100%)',
          surface: 'linear-gradient(135deg, #1e1e2e 0%, #151d30 100%)',
        },
        background: { base: '#0f0f1a', surface: '#151d30', elevated: '#1e1e2e' },
        border: { default: '#333333' },
        text: { primary: '#ffffff', secondary: '#cccccc', muted: '#aaaaaa', disabled: '#555555' },
        status: { success: '#22c55e', warning: '#f59e0b', error: '#ef4444' },
        typography: { headerOpacity: 1, subtextOpacity: 0.7, captionOpacity: 0.5 },
      },
    },
  }),
}));

jest.mock('../../contexts/AppAlertContext', () => ({
  useAppAlert: () => ({ showAlert: mockShowAlert }),
}));

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate, goBack: mockGoBack }),
  useFocusEffect: (cb: () => void) => {
    const React = require('react');
    React.useEffect(() => {
      cb();
    }, []);
  },
}));

jest.mock('../../database/repositories', () => ({
  getUserEntities: (...args: unknown[]) => mockGetUserEntities(...args),
}));

jest.mock('../../services/ChatPreferencesService', () => ({
  __esModule: true,
  default: {
    getGlobalImpersonatedEntity: (...args: unknown[]) => mockGetGlobal(...args),
    setGlobalImpersonatedEntity: (...args: unknown[]) => mockSetGlobal(...args),
  },
}));

jest.mock('../../components/themed/ThemedView', () => {
  const React = require('react');
  const { View } = require('react-native');
  return { __esModule: true, ThemedView: ({ children, style, ...p }: any) => React.createElement(View, { style, ...p }, children) };
});
jest.mock('../../components/themed/ThemedCard', () => {
  const React = require('react');
  const { View } = require('react-native');
  return { __esModule: true, ThemedCard: ({ children, style, ...p }: any) => React.createElement(View, { style, ...p }, children) };
});
jest.mock('../../components/themed/ScreenHeader', () => {
  const React = require('react');
  const { View, Text } = require('react-native');
  return {
    __esModule: true,
    ScreenHeader: ({ title, subtitle }: any) =>
      React.createElement(View, null,
        React.createElement(Text, { testID: 'screen-title' }, title),
        React.createElement(Text, { testID: 'screen-subtitle' }, subtitle),
      ),
  };
});
jest.mock('../../components/themed/ThemedEmptyState', () => {
  const React = require('react');
  const { View, Text } = require('react-native');
  return {
    __esModule: true,
    ThemedEmptyState: ({ title, subtitle, action, testID }: any) =>
      React.createElement(View, { testID },
        React.createElement(Text, null, title),
        React.createElement(Text, null, subtitle),
        action,
      ),
  };
});
jest.mock('../../components/themed/ThemedButton', () => {
  const React = require('react');
  const { TouchableOpacity, Text } = require('react-native');
  return {
    __esModule: true,
    ThemedButton: ({ label, onPress, testID }: any) =>
      React.createElement(TouchableOpacity, { onPress, testID },
        React.createElement(Text, null, label),
      ),
  };
});

import { PersonaListScreen } from '../settings/PersonaListScreen';

const PERSONAS = [
  { id: 'p1', name: 'Mara', description: 'Mystic', personality: '', avatarUri: null },
  { id: 'p2', name: 'Kai', description: 'Wanderer', personality: '', avatarUri: null },
];

async function renderScreen() {
  const utils = await render(<PersonaListScreen />);
  await waitFor(() => expect(utils.getByTestId('screen-title')).toBeTruthy());
  return utils;
}

describe('PersonaListScreen', () => {
  it('renders every persona row with the shared active highlight', async () => {
    mockGetGlobal.mockResolvedValue('p2');

    const utils = await renderScreen();

    await waitFor(() => expect(utils.getAllByTestId('persona-row')).toHaveLength(2));
    expect(utils.getByText('Mara')).toBeTruthy();
    expect(utils.getByText('Kai')).toBeTruthy();
    expect(utils.getByText('personaActiveChip')).toBeTruthy();
    // Header reuses the profile copy (title key + subtitle key).
    expect(utils.getByTestId('screen-title').props.children).toBe('personas');
    expect(utils.getByTestId('screen-subtitle').props.children).toBe('personasHint');
  });

  it('tapping a row sets the global impersonated persona', async () => {
    const utils = await renderScreen();
    await waitFor(() => expect(utils.getAllByTestId('persona-row')).toHaveLength(2));

    await act(async () => {
      fireEvent.press(utils.getAllByTestId('persona-row')[0]);
    });

    await waitFor(() =>
      expect(mockSetGlobal).toHaveBeenCalledWith('p1'),
    );
    expect(mockShowAlert).toHaveBeenCalledWith('personaSetActiveDone');
  });

  it('the pencil opens PersonaEdit for that persona', async () => {
    const utils = await renderScreen();
    await waitFor(() => expect(utils.getAllByTestId('persona-row-edit')).toHaveLength(2));

    fireEvent.press(utils.getAllByTestId('persona-row-edit')[1]);

    expect(mockNavigate).toHaveBeenCalledWith('PersonaEdit', { entityId: 'p2' });
  });

  it('New Persona opens PersonaEdit in create mode', async () => {
    const utils = await renderScreen();
    await waitFor(() => expect(utils.getByTestId('new-persona-button')).toBeTruthy());

    fireEvent.press(utils.getByTestId('new-persona-button'));

    expect(mockNavigate).toHaveBeenCalledWith('PersonaEdit', {});
  });

  it('renders the empty state with a New Persona action', async () => {
    mockGetUserEntities.mockResolvedValue([]);

    const utils = await renderScreen();

    await waitFor(() => expect(utils.getByTestId('persona-list-empty')).toBeTruthy());
    expect(utils.getByText('tabPersonasEmpty')).toBeTruthy();
    expect(utils.getByText('tabPersonasEmptyHint')).toBeTruthy();

    fireEvent.press(utils.getByTestId('new-persona-button'));
    expect(mockNavigate).toHaveBeenCalledWith('PersonaEdit', {});
  });
});
