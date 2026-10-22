/**
 * CatalogModelSelect — engine-registry-backed model picker (provider-registry
 * 6-3; supersedes the 2-1 interim app-side catalog).
 *
 * Covers: catalog options from the capability registry + "Custom…"; the live
 * override (a fetched list wins over the catalog); the "Fetch from provider"
 * affordance; provenance + context chips; the stale-ref marker; and the
 * no-entries free-text fallback.
 *
 * The capability registry hook is mocked so the component is exercised in
 * isolation; the registry fetch itself is covered by its own hook tests.
 */

import React, { useState } from 'react';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react-native';
import {
  CatalogModelSelect,
  CUSTOM_MODEL_INPUT_TESTID,
  MODEL_FETCH_TESTID,
  MODEL_STALE_TESTID,
  formatContextWindow,
  modelProvenanceChipTestId,
} from '../CatalogModelSelect';
import type { ModelInfoDto } from '../../../services/engine/EngineApiClient';

afterEach(cleanup);
beforeEach(cleanup);

/** Mutable catalog returned by the mocked capability-registry hook. */
let mockCatalog: Record<string, ModelInfoDto[]> = {};

jest.mock('../../../hooks/useProviderCapabilityCatalog', () => ({
  useProviderCapabilityCatalog: () => ({
    catalog: mockCatalog,
    paramMapping: {},
    loading: false,
    error: null,
    refresh: jest.fn(),
  }),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts ? `${key} ${JSON.stringify(opts)}` : key,
  }),
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

const CHAT_MODELS: ModelInfoDto[] = [
  { id: 'gpt-6-astra', label: 'gpt-6-astra', capabilities: ['chat'], context: 1050000, provenance: 'known' },
  { id: 'gpt-4o', label: 'gpt-4o', capabilities: ['chat'], context: 128000, provenance: 'known' },
];

beforeEach(() => {
  mockCatalog = { openai: CHAT_MODELS, openrouter: [] };
});

describe('formatContextWindow', () => {
  it('formats token counts compactly', () => {
    expect(formatContextWindow(128000)).toBe('128K');
    expect(formatContextWindow(8192)).toBe('8.2K');
    expect(formatContextWindow(500000)).toBe('500K');
    expect(formatContextWindow(1000000)).toBe('1M');
    expect(formatContextWindow(1050000)).toBe('1.05M');
    expect(formatContextWindow(512)).toBe('512');
  });
});

describe('CatalogModelSelect — registry-backed picker', () => {
  it('renders the catalog options plus a Custom… option', async () => {
    const utils = await render(
      <CatalogModelSelect providerType="openai" moduleType="backend" value="" onChange={jest.fn()} label="Model" />,
    );

    fireEvent.press(utils.getByLabelText('Model'));
    await waitFor(() => expect(utils.getByText('gpt-6-astra')).toBeTruthy());
    expect(utils.getByText('modelCustom')).toBeTruthy();
  });

  it('round-trips the selected value through onChange', async () => {
    const Harness = () => {
      const [value, setValue] = useState('');
      return (
        <CatalogModelSelect
          providerType="openai"
          moduleType="backend"
          value={value}
          onChange={setValue}
          label="Model"
        />
      );
    };

    const utils = await render(<Harness />);
    fireEvent.press(utils.getByLabelText('Model'));
    await waitFor(() => expect(utils.getByText('gpt-6-astra')).toBeTruthy());
    fireEvent.press(utils.getByText('gpt-6-astra'));

    await waitFor(() => expect(utils.getByText('gpt-6-astra')).toBeTruthy());
    expect(utils.queryByText('modelCustom')).toBeNull();
  });

  it('keeps free text via the Custom… escape hatch', async () => {
    const onChange = jest.fn();
    const utils = await render(
      <CatalogModelSelect providerType="openai" moduleType="backend" value="" onChange={onChange} label="Model" />,
    );

    fireEvent.press(utils.getByLabelText('Model'));
    await waitFor(() => expect(utils.getByText('modelCustom')).toBeTruthy());
    fireEvent.press(utils.getByText('modelCustom'));

    const input = await waitFor(() => utils.getByTestId(CUSTOM_MODEL_INPUT_TESTID));
    fireEvent.changeText(input, 'my-private-model');
    expect(onChange).toHaveBeenCalledWith('my-private-model');
  });

  it('keeps a manual (non-catalog) value selectable in the picker', async () => {
    const utils = await render(
      <CatalogModelSelect providerType="openai" moduleType="backend" value="my-private-model" onChange={jest.fn()} label="Model" />,
    );
    expect(utils.getByText('my-private-model')).toBeTruthy();
    expect(utils.queryByTestId(CUSTOM_MODEL_INPUT_TESTID)).toBeNull();
  });

  it('falls back to free text when the catalog has no entries', async () => {
    const utils = await render(
      <CatalogModelSelect providerType="openrouter" moduleType="backend" value="" onChange={jest.fn()} label="Model" />,
    );
    expect(utils.getByTestId(CUSTOM_MODEL_INPUT_TESTID)).toBeTruthy();
    expect(utils.getByText('modelNoModels')).toBeTruthy();
  });

  it('prefers a live-discovered list over the catalog', async () => {
    const live: ModelInfoDto[] = [{ id: 'live-model', label: 'live-model', provenance: 'detected' }];
    const utils = await render(
      <CatalogModelSelect
        providerType="openai"
        moduleType="backend"
        value=""
        onChange={jest.fn()}
        label="Model"
        liveModels={live}
        canFetch
        onFetch={jest.fn()}
      />,
    );
    fireEvent.press(utils.getByLabelText('Model'));
    await waitFor(() => expect(utils.getByText('live-model')).toBeTruthy());
    // The catalog model is not offered once a live list exists.
    expect(utils.queryByText('gpt-6-astra')).toBeNull();
  });

  it('renders a context-window chip for a known model', async () => {
    const utils = await render(
      <CatalogModelSelect providerType="openai" moduleType="backend" value="gpt-4o" onChange={jest.fn()} label="Model" />,
    );
    expect(utils.getByText(/modelContextChip/)).toBeTruthy();
    expect(utils.getByText(/128K/)).toBeTruthy();
  });

  it('renders a provenance chip for the selected model', async () => {
    const utils = await render(
      <CatalogModelSelect providerType="openai" moduleType="backend" value="gpt-4o" onChange={jest.fn()} label="Model" />,
    );
    expect(utils.getByTestId(modelProvenanceChipTestId('gpt-4o'))).toBeTruthy();
  });

  it('runs the live refresh via the Fetch button', async () => {
    const onFetch = jest.fn();
    const utils = await render(
      <CatalogModelSelect
        providerType="openai"
        moduleType="backend"
        value=""
        onChange={jest.fn()}
        label="Model"
        canFetch
        onFetch={onFetch}
      />,
    );
    fireEvent.press(utils.getByTestId(MODEL_FETCH_TESTID));
    expect(onFetch).toHaveBeenCalledTimes(1);
  });

  it('disables the Fetch button without an account', async () => {
    const onFetch = jest.fn();
    const utils = await render(
      <CatalogModelSelect
        providerType="openai"
        moduleType="backend"
        value=""
        onChange={jest.fn()}
        label="Model"
        canFetch={false}
        onFetch={onFetch}
      />,
    );
    fireEvent.press(utils.getByTestId(MODEL_FETCH_TESTID));
    expect(onFetch).not.toHaveBeenCalled();
  });

  it('marks a saved value stale when the live list lacks it', async () => {
    const live: ModelInfoDto[] = [{ id: 'other-model', label: 'other-model' }];
    const utils = await render(
      <CatalogModelSelect
        providerType="openai"
        moduleType="backend"
        value="removed-model"
        onChange={jest.fn()}
        label="Model"
        liveModels={live}
        stale
        canFetch
        onFetch={jest.fn()}
      />,
    );
    expect(utils.getByTestId(MODEL_STALE_TESTID)).toBeTruthy();
    // The stale value is never dropped — it stays selectable.
    expect(utils.getByText('removed-model')).toBeTruthy();
  });
});
