/**
 * VoiceInputSettingsScreen — 2-1 shared-persona STT surface tests.
 *
 * Verifies the LWW-safe contract on the screen:
 *  - the master switch reflects the READ resolution (OFF for missing/null/
 *    'disabled' provider; ON for a live provider)
 *  - toggling OFF persists the engine 'disabled' sentinel into the stt config
 *    (the ONLY write path)
 *  - selecting a config writes the `user` mapping's stt_config_id (deliberate
 *    save, never a background ensure-create)
 *  - a fresh-install (no local `user` entity) renders the pre-sync empty state
 */

import React from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react-native';
import { VoiceInputSettingsScreen } from '../settings/VoiceInputSettingsScreen';

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

jest.mock('../../utils/haptics', () => ({ hapticLightPress: jest.fn() }));

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

jest.mock('@react-navigation/native', () => {
  const React = require('react');
  const { View, Text, Switch } = require('react-native');
  return {
    useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn() }),
    useFocusEffect: (cb: () => void) => React.useEffect(cb, [cb]),
    __mock_components: { View, Text, Switch },
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
jest.mock('../../components/themed/ThemedCard', () => {
  const React = require('react');
  const { View } = require('react-native');
  return { __esModule: true, ThemedCard: ({ children, style, ...props }: any) =>
    React.createElement(View, { style, ...props }, children) };
});
jest.mock('../../components/themed/SectionHeader', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return { __esModule: true, SectionHeader: ({ title }: any) =>
    React.createElement(Text, null, title) };
});
jest.mock('../../components/themed/ScreenHeader', () => {
  const React = require('react');
  const { View } = require('react-native');
  return { __esModule: true, ScreenHeader: ({ children, ...props }: any) =>
    React.createElement(View, { testID: 'screen-header-mock', ...props }, children) };
});

// SettingsToggleRow — render a real RN Switch so fireEvent.valueChange drives onValueChange.
jest.mock('../../components/settings/SettingsRows', () => {
  const React = require('react');
  const { Switch, View } = require('react-native');
  return {
    __esModule: true,
    SettingsToggleRow: ({ icon, label, value, onValueChange }: any) =>
      React.createElement(View, null,
        React.createElement(Switch, { testID: 'voice-input-switch', value, onValueChange }),
      ),
    SettingsLinkRow: () => React.createElement(View, null),
    SettingsDetailRow: () => React.createElement(View, null),
  };
});

// EntityModuleSelectorWithActions — render a button that invokes onChange with the next config id.
jest.mock('../../components/entities/EntityModuleSelectorWithActions', () => {
  const React = require('react');
  const { View, Text, TouchableOpacity } = require('react-native');
  return {
    __esModule: true,
    EntityModuleSelectorWithActions: ({ selectedId, onChange }: any) =>
      React.createElement(View, null,
        React.createElement(Text, null, `selected:${selectedId}`),
        React.createElement(TouchableOpacity, {
          testID: 'voice-input-config-selector',
          onPress: () => onChange(selectedId === 'stt-1' ? 'stt-2' : 'stt-1'),
          accessibilityRole: 'button',
        }, React.createElement(Text, null, 'pick')),
      ),
  };
});

// SttTestPanel — the screen just delegates; it is exercised by its own suite.
jest.mock('../../components/config/SttTestPanel', () => {
  const React = require('react');
  const { View } = require('react-native');
  return { __esModule: true, SttTestPanel: () => React.createElement(View, { testID: 'stt-test-panel' }) };
});

jest.mock('../../database/repositories/entities', () => ({
  getEntity: jest.fn(),
  getEntityModuleMapping: jest.fn(),
  createOrUpdateEntityModuleMapping: jest.fn(),
}));
jest.mock('../../database/repositories/modules', () => ({
  getSTTConfig: jest.fn(),
  getAllSTTConfigs: jest.fn(),
  updateSTTConfig: jest.fn(),
}));

import {
  getEntity,
  getEntityModuleMapping,
  createOrUpdateEntityModuleMapping,
} from '../../database/repositories/entities';
import {
  getSTTConfig,
  getAllSTTConfigs,
  updateSTTConfig,
} from '../../database/repositories/modules';

const mockGetEntity = getEntity as jest.Mock;
const mockGetMapping = getEntityModuleMapping as jest.Mock;
const mockCreateOrUpdateMapping = createOrUpdateEntityModuleMapping as jest.Mock;
const mockGetSttConfig = getSTTConfig as jest.Mock;
const mockGetAllSttConfigs = getAllSTTConfigs as jest.Mock;
const mockUpdateSttConfig = updateSTTConfig as jest.Mock;

const USER = { id: 'user', alias: 'You', character_profile_id: null, lifecycle_config: null, rag_reindex_required: 0, entity_type: 'user', created_at: new Date(), updated_at: new Date(), deleted_at: null };

const liveMapping = {
  entity_id: 'user',
  backend_config_id: null,
  cognition_config_id: null,
  imagination_config_id: null,
  movement_config_id: null,
  rag_config_id: null,
  stt_config_id: 'stt-1',
  tts_config_id: null,
  vision_config_id: null,
  deleted_at: null,
};

const liveSttConfig = {
  id: 'stt-1',
  name: 'Voice input',
  main_stream_time_millis: 2000,
  transition_stream_time_millis: 1000,
  max_buffer_count: 5,
  transcription_provider: 'openai',
  transcription_provider_config_id: 'pc-1',
  vad_provider: 'openai',
  vad_provider_config_id: 'pc-2',
  deleted_at: null,
};

async function flush() {
  for (let i = 0; i < 8; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetEntity.mockResolvedValue(USER);
  mockGetMapping.mockResolvedValue(liveMapping);
  mockGetSttConfig.mockResolvedValue(liveSttConfig);
  mockGetAllSttConfigs.mockResolvedValue([liveSttConfig]);
  mockUpdateSttConfig.mockResolvedValue(undefined);
  mockCreateOrUpdateMapping.mockResolvedValue(undefined);
});

function switchValue(utils: any): boolean {
  return utils.getByTestId('voice-input-switch').props.value;
}

describe('VoiceInputSettingsScreen — LWW-safe read/write contract', () => {
  it('reflects OFF when the mapping is missing (pre-seed, no engine wire-up)', async () => {
    mockGetEntity.mockResolvedValue(USER);
    mockGetMapping.mockResolvedValue(null);

    const utils = await render(<VoiceInputSettingsScreen />);
    await flush();

    expect(switchValue(utils)).toBe(false);
    // No test block renders when disabled.
    expect(utils.queryByText('testSection')).toBeNull();
  });

  it('reflects OFF when the stt config provider is the "disabled" sentinel', async () => {
    mockGetEntity.mockResolvedValue(USER);
    mockGetMapping.mockResolvedValue(liveMapping);
    mockGetSttConfig.mockResolvedValue({
      ...liveSttConfig,
      transcription_provider: 'disabled',
      vad_provider: 'disabled',
    });

    const utils = await render(<VoiceInputSettingsScreen />);
    await flush();

    expect(switchValue(utils)).toBe(false);
  });

  it('reflects ON for a live provider and shows the test block', async () => {
    const utils = await render(<VoiceInputSettingsScreen />);
    await flush();

    expect(switchValue(utils)).toBe(true);
    // The test block header renders when enabled.
    expect(utils.getByText('testSection')).toBeTruthy();
  });

  it('persists the "disabled" sentinel to the stt config when toggled OFF', async () => {
    const utils = await render(<VoiceInputSettingsScreen />);
    await flush();

    await fireEvent(utils.getByTestId('voice-input-switch'), 'valueChange', false);
    await flush();

    expect(mockUpdateSttConfig).toHaveBeenCalledTimes(1);
    const updated = mockUpdateSttConfig.mock.calls[0][0];
    expect(updated.id).toBe('stt-1');
    expect(updated.transcription_provider).toBe('disabled');
    expect(updated.vad_provider).toBe('disabled');
    expect(updated.transcription_provider_config_id).toBeNull();
  });

  it('linking a config in the selector writes the user mapping (deliberate save)', async () => {
    const utils = await render(<VoiceInputSettingsScreen />);
    await flush();

    await fireEvent.press(utils.getByTestId('voice-input-config-selector'));
    await flush();

    expect(mockCreateOrUpdateMapping).toHaveBeenCalledTimes(1);
    const written = mockCreateOrUpdateMapping.mock.calls[0][0];
    // Only a real, non-null stt_config_id is ever written to the user mapping.
    expect(written.entity_id).toBe('user');
    expect(written.stt_config_id).not.toBeNull();
  });

  it('renders the pre-sync empty state when the user entity is not local yet', async () => {
    mockGetEntity.mockResolvedValue(null);

    const utils = await render(<VoiceInputSettingsScreen />);
    await flush();

    // Fresh-install empty state — "Connect to Harmony Link" guidance, no ensure-create.
    expect(utils.getByText('preSyncTitle')).toBeTruthy();
    expect(utils.getByText('preSyncHint')).toBeTruthy();
    // Never creates the user mapping row.
    expect(mockCreateOrUpdateMapping).not.toHaveBeenCalled();
  });
});
