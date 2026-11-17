/**
 * EmotionalCurrents — engine-derived dyad cards on the State tab.
 *
 * Strictly presentational: verifies the keyword (capitalized), type badge,
 * source line, combined intensity out of 20, proportional bar, description, and
 * graceful degradation for an empty list / unknown type.
 */

import React from 'react';
import { StyleSheet } from 'react-native';
import { render, within } from '@testing-library/react-native';
import type { ActiveDyad } from '../../../services/engine/engineApiMappers';
import { EmotionalCurrents, formatSources } from '../EmotionalCurrents';

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
        text: { primary: '#ffffff', secondary: '#cccccc', muted: '#aaaaaa' },
        status: { error: '#ef4444', success: '#22c55e' },
        typography: { headerOpacity: 1, subtextOpacity: 0.7, captionOpacity: 0.5 },
      },
    },
  }),
}));

jest.mock('../../themed/ThemedText', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    __esModule: true,
    ThemedText: ({ children, style, ...props }: any) =>
      React.createElement(Text, { style, ...props }, children),
  };
});

const PRIMARY: ActiveDyad = {
  keyword: 'affection',
  type: 'primary',
  sourceEmotions: ['joy', 'trust'],
  sourceIntensities: [9.4, 6.2],
  combinedIntensity: 15.6,
  description: 'a warm sense of affection blooms in your heart',
};

const SECONDARY: ActiveDyad = {
  keyword: 'bittersweet',
  type: 'secondary',
  sourceEmotions: ['joy', 'sadness'],
  sourceIntensities: [5.5, 4.5],
  combinedIntensity: 10,
  description: 'a bittersweet memory surfaces',
};

describe('EmotionalCurrents', () => {
  it('renders one card per dyad with the engine values', async () => {
    const { getByTestId, queryByText } = await render(
      <EmotionalCurrents dyads={[PRIMARY, SECONDARY]} />,
    );

    expect(getByTestId('emotional-currents')).toBeTruthy();
    expect(getByTestId('emotional-current-0')).toBeTruthy();
    expect(getByTestId('emotional-current-1')).toBeTruthy();
    expect(queryByText('emotionalCurrents')).toBeNull(); // header belongs to the sheet
  });

  it('capitalizes the engine keyword and shows type + combined value', async () => {
    const { getByTestId } = await render(<EmotionalCurrents dyads={[PRIMARY]} />);

    expect(getByTestId('emotional-current-keyword-0').props.children).toBe('Affection');
    expect(
      within(getByTestId('emotional-current-type-0')).getByText('emotionalCurrentPrimary'),
    ).toBeTruthy();
    expect(getByTestId('emotional-current-combined-0').props.children).toBe('15.6 / 20');
  });

  it('lists the source emotions with their intensities', async () => {
    const { getByTestId } = await render(<EmotionalCurrents dyads={[PRIMARY]} />);
    expect(getByTestId('emotional-current-sources-0').props.children).toBe('joy 9.4 + trust 6.2');
  });

  it('fills the bar proportionally out of 20', async () => {
    const { getByTestId, rerender } = await render(<EmotionalCurrents dyads={[PRIMARY]} />);
    expect(StyleSheet.flatten(getByTestId('emotional-current-bar-0').props.style).width).toBe(
      '78%',
    );

    await rerender(<EmotionalCurrents dyads={[SECONDARY]} />);
    expect(StyleSheet.flatten(getByTestId('emotional-current-bar-0').props.style).width).toBe(
      '50%',
    );
  });

  it('shows the engine description as prose', async () => {
    const { getByTestId } = await render(<EmotionalCurrents dyads={[PRIMARY]} />);
    expect(getByTestId('emotional-current-description-0').props.children).toBe(
      'a warm sense of affection blooms in your heart',
    );
  });

  it('shows the SECONDARY type badge for a secondary dyad', async () => {
    const { getByTestId } = await render(<EmotionalCurrents dyads={[SECONDARY]} />);
    expect(
      within(getByTestId('emotional-current-type-0')).getByText('emotionalCurrentSecondary'),
    ).toBeTruthy();
  });

  it('does not invent a type badge for an unknown type', async () => {
    const { queryByTestId, getByTestId } = await render(
      <EmotionalCurrents dyads={[{ ...PRIMARY, type: 'tertiary' }]} />,
    );
    expect(queryByTestId('emotional-current-type-0')).toBeNull();
    expect(getByTestId('emotional-current-0')).toBeTruthy();
  });

  it('omits the description line when the engine sends none', async () => {
    const { queryByTestId } = await render(
      <EmotionalCurrents dyads={[{ ...PRIMARY, description: '' }]} />,
    );
    expect(queryByTestId('emotional-current-description-0')).toBeNull();
  });

  it('renders nothing for an empty dyad list', async () => {
    const { queryByTestId, toJSON } = await render(<EmotionalCurrents dyads={[]} />);
    expect(queryByTestId('emotional-currents')).toBeNull();
    expect(toJSON()).toBeNull();
  });

  it('exposes an accessible label per card', async () => {
    const { getByTestId } = await render(<EmotionalCurrents dyads={[PRIMARY]} />);
    const card = getByTestId('emotional-current-0');
    expect(card.props.accessibilityRole).toBe('summary');
    expect(card.props.accessibilityLabel).toBe('Affection, emotionalCurrentPrimary, 15.6 / 20');
  });

  it('formats sources without fabricating missing intensities', () => {
    expect(
      formatSources({
        ...PRIMARY,
        sourceEmotions: ['joy', 'trust'],
        sourceIntensities: [9.4],
      }),
    ).toBe('joy 9.4 + trust');
  });
});
