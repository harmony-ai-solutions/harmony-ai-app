/**
 * SamplingPresetSelect — engine preset dropdown + preview chips (2-2).
 *
 * Covers the behaviours the phase doc calls out:
 *  - the dropdown renders the engine's `GET /api/presets` list (+ "Manual");
 *  - selecting a preset shows preview chips from `getPreset().params`;
 *  - an explicit local value is labelled as overriding the preset (§11 A3);
 *  - "Manual" clears the preset (onChange(''));
 * plus the no-presets free-text fallback.
 */

import React from 'react';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react-native';
import {
  SamplingPresetSelect,
  PRESET_FREE_TEXT_TESTID,
  presetChipTestId,
  presetOverrideTestId,
} from '../SamplingPresetSelect';
import { engineApiClient } from '../../../services/engine/EngineApiClient';
import { resetPresetsCache } from '../../../hooks/usePresets';

jest.mock('../../../services/engine/EngineApiClient', () => ({
  engineApiClient: { listPresets: jest.fn(), getPreset: jest.fn() },
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
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
      },
    },
  }),
}));

jest.mock('../../../utils/haptics', () => ({ hapticLightPress: jest.fn() }));

jest.mock('react-native-linear-gradient', () => {
  const React = require('react');
  const { View } = require('react-native');
  return ({ children, style, ...props }: any) =>
    React.createElement(View, { style, ...props }, children);
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

const listPresets = engineApiClient.listPresets as jest.Mock;
const getPreset = engineApiClient.getPreset as jest.Mock;

const PRESET_LIST = {
  presets: [
    { name: 'creative', source: 'bundled', param_count: 2, description: 'High temperature' },
    { name: 'precise', source: 'user', param_count: 1 },
  ],
};

beforeEach(() => {
  cleanup();
  resetPresetsCache();
  listPresets.mockReset();
  getPreset.mockReset();
});

async function renderSelect(
  overrides: Partial<React.ComponentProps<typeof SamplingPresetSelect>> = {},
) {
  const onChange = overrides.onChange ?? jest.fn();
  const utils = await render(
    <SamplingPresetSelect
      value=""
      onChange={onChange}
      localValues={{}}
      explicitKeys={{}}
      label="Sampling Preset"
      {...overrides}
    />,
  );
  return { utils, onChange };
}

describe('SamplingPresetSelect', () => {
  it('renders a dropdown of engine presets plus a Manual option', async () => {
    listPresets.mockResolvedValue(PRESET_LIST);
    const { utils } = await renderSelect();

    const row = await waitFor(() => utils.getByLabelText('Sampling Preset'));
    fireEvent.press(row);

    await waitFor(() => expect(utils.getByText('creative')).toBeTruthy());
    expect(utils.getByText('precise')).toBeTruthy();
  });

  it('shows preview chips from getPreset().params for the selected preset', async () => {
    listPresets.mockResolvedValue(PRESET_LIST);
    getPreset.mockResolvedValue({
      name: 'creative',
      source: 'bundled',
      params: { temperature: 0.7, top_p: 0.9 },
    });

    const { utils } = await renderSelect({ value: 'creative' });

    await waitFor(() => expect(utils.getByTestId(presetChipTestId('temperature'))).toBeTruthy());
    expect(utils.getByText(/temperature=0\.7/)).toBeTruthy();
    expect(utils.getByTestId(presetChipTestId('top_p'))).toBeTruthy();
    expect(getPreset).toHaveBeenCalledWith('creative');
  });

  it('labels an explicit local value as overriding the preset (locals win)', async () => {
    listPresets.mockResolvedValue(PRESET_LIST);
    getPreset.mockResolvedValue({
      name: 'creative',
      source: 'bundled',
      params: { temperature: 0.7 },
    });

    const { utils } = await renderSelect({
      value: 'creative',
      localValues: { temperature: 0.9 },
      explicitKeys: { temperature: true },
    });

    await waitFor(() =>
      expect(utils.getByTestId(presetOverrideTestId('temperature'))).toBeTruthy(),
    );
    // The chip still shows the preset value, plus the override annotation.
    expect(utils.getByText(/temperature=0\.7/)).toBeTruthy();
    expect(utils.getByText(/presetLocalWins/)).toBeTruthy();
  });

  it('does not annotate an override when the local value is not explicit', async () => {
    listPresets.mockResolvedValue(PRESET_LIST);
    getPreset.mockResolvedValue({
      name: 'creative',
      source: 'bundled',
      params: { temperature: 0.7 },
    });

    const { utils } = await renderSelect({
      value: 'creative',
      localValues: { temperature: 0.9 },
      explicitKeys: {},
    });

    await waitFor(() => expect(utils.getByTestId(presetChipTestId('temperature'))).toBeTruthy());
    expect(utils.queryByTestId(presetOverrideTestId('temperature'))).toBeNull();
  });

  it('clears the preset (onChange("")) when Manual is chosen', async () => {
    listPresets.mockResolvedValue(PRESET_LIST);
    getPreset.mockResolvedValue({ name: 'creative', source: 'bundled', params: {} });
    const onChange = jest.fn();

    const { utils } = await renderSelect({ value: 'creative', onChange });

    const row = await waitFor(() => utils.getByLabelText('Sampling Preset'));
    fireEvent.press(row);
    await waitFor(() => expect(utils.getByText('presetManual')).toBeTruthy());
    fireEvent.press(utils.getByText('presetManual'));

    expect(onChange).toHaveBeenCalledWith('');
  });

  it('falls back to free text when no presets are available', async () => {
    listPresets.mockResolvedValue({ presets: [] });

    const { utils } = await renderSelect();

    await waitFor(() => expect(utils.getByTestId(PRESET_FREE_TEXT_TESTID)).toBeTruthy());
    expect(utils.getByText('presetNone')).toBeTruthy();
  });
});
