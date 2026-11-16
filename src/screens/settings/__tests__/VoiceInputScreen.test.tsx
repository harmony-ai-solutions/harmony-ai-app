/**
 * VoiceInputScreen — the shared per-user STT config SELECT surface (4-4).
 *
 * Contract under test:
 *  - the resolved link state drives the status row and the selector's
 *    selectedId ('' renders as the sheet's "Disabled" when voice is OFF);
 *  - picking a config RE-LINKS the user entity (linkPersonaVoiceConfig) and
 *    never mutates the previously linked row;
 *  - picking "Disabled" routes through setPersonaVoiceDisabled (shared-row
 *    safe OFF);
 *  - "✎ Edit config" runs the ensure-repair first, then opens the pinned
 *    detail editor; "Create new config…" opens the editor without an id;
 *  - write failures surface the engine-unavailable toast and re-read state.
 */

import React from 'react';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react-native';
import { VoiceInputScreen } from '../VoiceInputScreen';

afterEach(cleanup);

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('../../../utils/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

jest.mock('../../../contexts/ThemeContext', () => ({
  useAppTheme: () => ({
    theme: {
      colors: {
        accent: { primary: '#7c3aed', secondary: '#a78bfa' },
        background: { base: '#0f0f1a', surface: '#151d30', elevated: '#1e1e2e' },
        border: { default: '#333333' },
        text: { primary: '#ffffff', secondary: '#cccccc', muted: '#aaaaaa', disabled: '#555555' },
        status: { success: '#22c55e', warning: '#f59e0b', error: '#ef4444' },
        typography: { headerOpacity: 1, subtextOpacity: 0.7, captionOpacity: 0.5 },
      },
    },
  }),
}));

jest.mock('react-native-vector-icons/MaterialCommunityIcons', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return ({ name, ...props }: any) => React.createElement(Text, { ...props }, name);
});

jest.mock('../../../utils/haptics', () => ({
  setHapticFeedbackEnabled: jest.fn(),
  hapticLightPress: jest.fn(),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate, goBack: jest.fn() }),
  useFocusEffect: (cb: () => void) => {
    const React = require('react');
    React.useEffect(() => {
      cb();
    }, []);
  },
}));

const mockShowToast = jest.fn();
jest.mock('../../../contexts/AppToastContext', () => ({
  useToast: () => ({ showToast: mockShowToast }),
}));

jest.mock('../../../components/themed/ThemedView', () => {
  const React = require('react');
  const { View } = require('react-native');
  return { __esModule: true, ThemedView: ({ children, style, ...p }: any) => React.createElement(View, { style, ...p }, children) };
});
jest.mock('../../../components/themed/ThemedCard', () => {
  const React = require('react');
  const { View } = require('react-native');
  return { __esModule: true, ThemedCard: ({ children, style, ...p }: any) => React.createElement(View, { style, ...p }, children) };
});
jest.mock('../../../components/themed/SectionHeader', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    __esModule: true,
    SectionHeader: ({ title }: any) =>
      React.createElement(Text, { testID: `section-${title}` }, title),
  };
});
jest.mock('../../../components/themed/ScreenHeader', () => {
  const React = require('react');
  const { View } = require('react-native');
  return { __esModule: true, ScreenHeader: (props: any) => React.createElement(View, props) };
});

// Selector stub: expose the wiring (selectedId + actions) without the sheet.
jest.mock('../../../components/entities/EntityModuleSelector', () => {
  const React = require('react');
  const { Text, TouchableOpacity, View } = require('react-native');
  return {
    __esModule: true,
    EntityModuleSelector: ({
      selectedId,
      onChange,
      onCreateNew,
      configs,
    }: any) =>
      React.createElement(
        View,
        { testID: 'voice-selector' },
        React.createElement(Text, { testID: 'voice-selected' }, `selected:${selectedId}`),
        React.createElement(TouchableOpacity, {
          testID: 'voice-pick-other',
          onPress: () => onChange('stt-2'),
        }),
        React.createElement(TouchableOpacity, {
          testID: 'voice-pick-same',
          onPress: () => onChange('stt-1'),
        }),
        React.createElement(TouchableOpacity, {
          testID: 'voice-pick-disabled',
          onPress: () => onChange(''),
        }),
        ...(configs ?? []).map((c: any) =>
          React.createElement(Text, { key: c.id, testID: `voice-option-${c.id}` }, c.name),
        ),
        onCreateNew
          ? React.createElement(TouchableOpacity, {
              testID: 'voice-create',
              onPress: onCreateNew,
            })
          : null,
      ),
    formatModuleConfigSubtitle: (c: any) => c?.subtitle,
  };
});

// Variant filter: identity (full variant) so option shaping stays visible.
jest.mock('../../../services/variant/providerAvailability', () => ({
  filterModuleConfigsForVariant: (_moduleType: string, configs: unknown[]) => configs,
}));

const mockGetAllStt = jest.fn();
jest.mock('../../../database/repositories', () => ({
  getAllSTTConfigs: (...args: unknown[]) => mockGetAllStt(...args),
}));

const mockResolveVoice = jest.fn();
const mockEnsureVoice = jest.fn();
const mockLinkVoice = jest.fn();
const mockSetDisabled = jest.fn();
jest.mock('../../../services/voiceInput/personaVoice', () => ({
  resolvePersonaVoice: (...args: unknown[]) => mockResolveVoice(...args),
  ensurePersonaVoiceConfig: (...args: unknown[]) => mockEnsureVoice(...args),
  linkPersonaVoiceConfig: (...args: unknown[]) => mockLinkVoice(...args),
  setPersonaVoiceDisabled: (...args: unknown[]) => mockSetDisabled(...args),
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockResolveVoice.mockResolvedValue({
    status: 'ok',
    configId: 'stt-1',
    providerType: 'elevenlabs',
    modelLabel: 'scribe_v3',
  });
  mockEnsureVoice.mockResolvedValue({ configId: 'stt-1', created: false });
  mockLinkVoice.mockResolvedValue(undefined);
  mockSetDisabled.mockResolvedValue('stt-1');
  mockGetAllStt.mockResolvedValue([
    {
      id: 'stt-1',
      name: 'Persona voice input',
      transcription_provider: 'elevenlabs',
      vad_provider: 'silero',
    },
    {
      id: 'stt-2',
      name: 'FasterWhisper Local',
      transcription_provider: 'fasterwhisper',
      vad_provider: 'silero',
    },
  ]);
});

describe('VoiceInputScreen — read state', () => {
  it('shows the ON status with the model label and selects the linked config', async () => {
    const { getByTestId } = await render(<VoiceInputScreen />);

    await waitFor(() =>
      expect(getByTestId('voice-input-status').props.children).toBe('on · scribe_v3'),
    );
    expect(getByTestId('voice-selected').props.children).toBe('selected:stt-1');
    expect(getByTestId('voice-option-stt-2')).toBeTruthy();
  });

  it('renders OFF as the sheet "Disabled" selection (linked config stays editable)', async () => {
    mockResolveVoice.mockResolvedValue({ status: 'off', configId: 'stt-1' });

    const { getByTestId } = await render(<VoiceInputScreen />);

    await waitFor(() =>
      expect(getByTestId('voice-input-status').props.children).toBe('off'),
    );
    expect(getByTestId('voice-selected').props.children).toBe('selected:');
    // The disabled-but-linked config can still be reopened in the editor.
    expect(getByTestId('voice-input-edit-config')).toBeTruthy();
  });
});

describe('VoiceInputScreen — switching the link', () => {
  it('re-links the user entity on pick and reloads the state', async () => {
    const { getByTestId } = await render(<VoiceInputScreen />);
    await waitFor(() => expect(getByTestId('voice-option-stt-2')).toBeTruthy());

    fireEvent.press(getByTestId('voice-pick-other'));

    await waitFor(() => expect(mockLinkVoice).toHaveBeenCalledWith('stt-2'));
    // Read-after-write so the status row reflects the new link.
    expect(mockResolveVoice).toHaveBeenCalledTimes(2);
  });

  it('routes "Disabled" through the shared-row-safe OFF write', async () => {
    const { getByTestId } = await render(<VoiceInputScreen />);
    await waitFor(() => expect(getByTestId('voice-option-stt-2')).toBeTruthy());

    fireEvent.press(getByTestId('voice-pick-disabled'));

    await waitFor(() => expect(mockSetDisabled).toHaveBeenCalledTimes(1));
    expect(mockLinkVoice).not.toHaveBeenCalled();
  });

  it('does not write when the already-linked config is re-picked', async () => {
    const { getByTestId } = await render(<VoiceInputScreen />);
    await waitFor(() => expect(getByTestId('voice-option-stt-2')).toBeTruthy());

    fireEvent.press(getByTestId('voice-pick-same'));

    // Same id → a pure reload, no LWW-sensitive write is issued.
    await waitFor(() => expect(mockResolveVoice).toHaveBeenCalledTimes(2));
    expect(mockLinkVoice).not.toHaveBeenCalled();
    expect(mockSetDisabled).not.toHaveBeenCalled();
  });

  it('surfaces the engine-unavailable toast when the write fails', async () => {
    mockLinkVoice.mockRejectedValue(new Error('no user entity'));

    const { getByTestId } = await render(<VoiceInputScreen />);
    await waitFor(() => expect(getByTestId('voice-option-stt-2')).toBeTruthy());

    fireEvent.press(getByTestId('voice-pick-other'));

    await waitFor(() =>
      expect(mockShowToast).toHaveBeenCalledWith('voiceInputUnavailable'),
    );
  });
});

describe('VoiceInputScreen — edit & create paths', () => {
  it('runs the ensure-repair, then opens the pinned detail editor', async () => {
    const { getByTestId } = await render(<VoiceInputScreen />);
    await waitFor(() => expect(getByTestId('voice-input-edit-config')).toBeTruthy());

    fireEvent.press(getByTestId('voice-input-edit-config'));

    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith('ModuleConfigEdit', {
        moduleType: 'stt',
        configId: 'stt-1',
      }),
    );
    expect(mockEnsureVoice).toHaveBeenCalledTimes(1);
  });

  it('opens the detail editor without an id from "Create new config…"', async () => {
    const { getByTestId } = await render(<VoiceInputScreen />);
    await waitFor(() => expect(getByTestId('voice-create')).toBeTruthy());

    fireEvent.press(getByTestId('voice-create'));

    expect(mockNavigate).toHaveBeenCalledWith('ModuleConfigEdit', {
      moduleType: 'stt',
    });
    expect(mockEnsureVoice).not.toHaveBeenCalled();
  });

  it('toasts instead of navigating when ensure fails (engine not seeded)', async () => {
    mockEnsureVoice.mockRejectedValue(new Error('no user entity'));

    const { getByTestId } = await render(<VoiceInputScreen />);
    await waitFor(() => expect(getByTestId('voice-input-edit-config')).toBeTruthy());

    fireEvent.press(getByTestId('voice-input-edit-config'));

    await waitFor(() =>
      expect(mockShowToast).toHaveBeenCalledWith('voiceInputUnavailable'),
    );
    expect(mockNavigate).not.toHaveBeenCalledWith(
      'ModuleConfigEdit',
      expect.anything(),
    );
  });
});
