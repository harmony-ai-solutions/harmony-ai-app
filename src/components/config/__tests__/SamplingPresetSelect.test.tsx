/**
 * SamplingPresetSelect — persistent preset picker + Save-as-YAML modal (2-2).
 *
 * Covers the behaviours the phase doc calls out:
 *  - the picker is ALWAYS rendered (even with zero presets) with "None (Manual)";
 *  - selecting a preset shows preview chips from `getPreset().params`;
 *  - an explicit local value is labelled as overriding the preset (§11 A3);
 *  - "Save as…" pre-fills the YAML editor from the current capability and saves
 *    via `savePreset`, then activates the new preset;
 *  - delete confirms, calls `deletePreset` and resets to Manual.
 */

import React from 'react';
import { Alert } from 'react-native';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react-native';
import {
  SamplingPresetSelect,
  PRESET_SAVE_MODAL_TESTID,
  PRESET_DELETE_BUTTON_TESTID,
  PRESET_YAML_INPUT_TESTID,
  PRESET_NAME_INPUT_TESTID,
  presetChipTestId,
  presetOverrideTestId,
} from '../SamplingPresetSelect';
import { engineApiClient } from '../../../services/engine/EngineApiClient';
import { resetPresetsCache } from '../../../hooks/usePresets';

jest.mock('../../../services/engine/EngineApiClient', () => ({
  engineApiClient: {
    listPresets: jest.fn(),
    getPreset: jest.fn(),
    savePreset: jest.fn(),
    deletePreset: jest.fn(),
  },
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
const savePreset = engineApiClient.savePreset as jest.Mock;
const deletePreset = engineApiClient.deletePreset as jest.Mock;

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
  savePreset.mockReset();
  deletePreset.mockReset();
  savePreset.mockResolvedValue({ name: 'saved', status: 'ok' });
  deletePreset.mockResolvedValue({ name: 'creative', status: 'ok' });
});

afterEach(() => {
  jest.restoreAllMocks();
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
  it('always renders the persistent picker with the presets, even when empty', async () => {
    listPresets.mockResolvedValue({ presets: [] });
    const { utils } = await renderSelect();

    const row = await waitFor(() => utils.getByLabelText('Sampling Preset'));
    expect(row).toBeTruthy();
    await fireEvent.press(row);
    await waitFor(() => expect(utils.getAllByText('None (Manual)').length).toBeGreaterThan(0));
  });

  it('renders engine presets in the picker and selects one', async () => {
    listPresets.mockResolvedValue(PRESET_LIST);
    const onChange = jest.fn();
    const { utils } = await renderSelect({ onChange });

    const row = await waitFor(() => utils.getByLabelText('Sampling Preset'));
    await fireEvent.press(row);

    await waitFor(() => expect(utils.getByText('creative (2 params)')).toBeTruthy());
    expect(utils.getByText('precise (1 params)')).toBeTruthy();

    await fireEvent.press(utils.getByText('creative (2 params)'));
    expect(onChange).toHaveBeenCalledWith('creative');
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
    expect(utils.getByText(/temperature: 0\.7/)).toBeTruthy();
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
    // The chip shows the preset value, plus the override annotation.
    expect(utils.getByText(/temperature: 0\.7/)).toBeTruthy();
    expect(utils.getByText(/0\.9 \(local wins\)/)).toBeTruthy();
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

  it('pre-fills the YAML editor from the current capability when "Save as…" opens', async () => {
    listPresets.mockResolvedValue(PRESET_LIST);
    const { utils } = await renderSelect({
      localValues: { temperature: 0.7, top_p: 0.95 },
    });

    await waitFor(() => expect(utils.getByTestId(PRESET_SAVE_MODAL_TESTID)).toBeTruthy());
    await fireEvent.press(utils.getByTestId(PRESET_SAVE_MODAL_TESTID));

    const yaml = await waitFor(() => utils.getByTestId(PRESET_YAML_INPUT_TESTID));
    expect(yaml.props.value).toBe('temperature: 0.7\ntop_p: 0.95\n');
    expect(utils.getByTestId(PRESET_NAME_INPUT_TESTID)).toBeTruthy();
  });

  it('saves the named YAML preset and activates it', async () => {
    listPresets.mockResolvedValue(PRESET_LIST);
    const onChange = jest.fn();
    const { utils } = await renderSelect({
      onChange,
      localValues: { temperature: 0.7 },
    });

    await fireEvent.press(await waitFor(() => utils.getByTestId(PRESET_SAVE_MODAL_TESTID)));
    const nameInput = await waitFor(() => utils.getByTestId(PRESET_NAME_INPUT_TESTID));
    await fireEvent.changeText(nameInput, 'my-preset');
    expect(utils.getByTestId(PRESET_NAME_INPUT_TESTID).props.value).toBe('my-preset');
    await fireEvent.changeText(
      utils.getByTestId(PRESET_YAML_INPUT_TESTID),
      'temperature: 0.7\n',
    );
    await fireEvent.press(utils.getByTestId('preset-save-confirm'));

    await waitFor(() =>
      expect(savePreset).toHaveBeenCalledWith('my-preset', 'temperature: 0.7\n'),
    );
    await waitFor(() => expect(onChange).toHaveBeenCalledWith('my-preset'));
  });

  it('rejects an invalid preset name without saving', async () => {
    listPresets.mockResolvedValue(PRESET_LIST);
    const { utils } = await renderSelect();

    await fireEvent.press(await waitFor(() => utils.getByTestId(PRESET_SAVE_MODAL_TESTID)));
    const nameInput = await waitFor(() => utils.getByTestId(PRESET_NAME_INPUT_TESTID));
    await fireEvent.changeText(nameInput, '../evil');
    await fireEvent.press(utils.getByTestId('preset-save-confirm'));

    await waitFor(() => expect(utils.getByTestId('preset-name-error')).toBeTruthy());
    expect(savePreset).not.toHaveBeenCalled();
  });

  it('confirms, deletes the selected preset and resets to Manual', async () => {
    listPresets.mockResolvedValue(PRESET_LIST);
    getPreset.mockResolvedValue({ name: 'creative', source: 'bundled', params: {} });
    const onChange = jest.fn();
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);

    const { utils } = await renderSelect({ value: 'creative', onChange });

    const deleteButton = await waitFor(() => utils.getByTestId(PRESET_DELETE_BUTTON_TESTID));
    await fireEvent.press(deleteButton);

    expect(alertSpy).toHaveBeenCalledTimes(1);
    const buttons = alertSpy.mock.calls[0][2] as Array<{
      style?: string;
      onPress?: () => void;
    }>;
    const destructive = buttons.find((b) => b.style === 'destructive');

    await act(async () => {
      destructive?.onPress?.();
      await Promise.resolve();
    });

    await waitFor(() => expect(deletePreset).toHaveBeenCalledWith('creative'));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(''));
  });

  it('hides the Delete button while Manual is selected', async () => {
    listPresets.mockResolvedValue(PRESET_LIST);
    const { utils } = await renderSelect({ value: '' });
    await waitFor(() => expect(utils.getByTestId(PRESET_SAVE_MODAL_TESTID)).toBeTruthy());
    expect(utils.queryByTestId(PRESET_DELETE_BUTTON_TESTID)).toBeNull();
  });
});
