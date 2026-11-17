/**
 * EmotionBars — eight Ekman intensity bars (tts-voice-ux Phase 5).
 *
 * Verifies engine order, value labels, the intensity fill scale, the baseline
 * notch and the per-emotion "crystallized" badge.
 */

import React from 'react';
import { StyleSheet } from 'react-native';
import { render, within } from '@testing-library/react-native';
import type { EmotionState } from '../../../database/models';
import {
  EmotionBars,
  EMOTION_DISPLAY,
  emotionBandLabelKey,
  emotionScaleMax,
} from '../EmotionBars';

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

function buildState(overrides: Partial<EmotionState> = {}): EmotionState {
  const base = {
    entity_id: 'ent-1',
    joy_intensity: 7.2,
    sadness_intensity: 1.1,
    trust_intensity: 3,
    disgust_intensity: 0,
    fear_intensity: 0.4,
    anger_intensity: 0,
    surprise_intensity: 2.2,
    anticipation_intensity: 4.5,
    last_update: new Date('2026-11-17T14:32:00Z'),
    decay_tau: 6,
    high_threshold: 7,
    low_threshold: 2,
  };
  const state = { ...base } as unknown as EmotionState;
  for (const emotion of Object.keys(EMOTION_DISPLAY)) {
    (state as any)[`${emotion}_baseline`] = 1;
    (state as any)[`${emotion}_crystallize_start`] = null;
  }
  (state as any).joy_baseline = 3.1;
  (state as any).joy_crystallize_start = new Date('2026-11-16T09:00:00Z');
  return { ...state, ...overrides };
}

describe('EmotionBars', () => {
  it('renders all eight emotions with their intensity values', async () => {
    const { getByTestId } = await render(<EmotionBars state={buildState()} />);

    for (const emotion of Object.keys(EMOTION_DISPLAY)) {
      expect(getByTestId(`emotion-bar-${emotion}`)).toBeTruthy();
    }
    expect(getByTestId('emotion-value-joy').props.children).toBe('7.2');
    expect(getByTestId('emotion-value-anticipation').props.children).toBe('4.5');
  });

  it('fills the bar on a max(high_threshold, 10) scale', async () => {
    const { getByTestId, rerender } = await render(<EmotionBars state={buildState()} />);
    expect(StyleSheet.flatten(getByTestId('emotion-bar-fill-joy').props.style).width).toBe('72%');

    // A profile whose high_threshold exceeds 10 widens the scale.
    await rerender(<EmotionBars state={buildState({ high_threshold: 12 })} />);
    expect(StyleSheet.flatten(getByTestId('emotion-bar-fill-joy').props.style).width).toBe('60%');
  });

  it('marks only crystallized emotions with the badge', async () => {
    const { getByTestId, queryByTestId } = await render(
      <EmotionBars state={buildState()} />,
    );
    expect(getByTestId('emotion-crystallized-joy')).toBeTruthy();
    expect(queryByTestId('emotion-crystallized-anger')).toBeNull();
  });

  it('renders a baseline notch for every emotion', async () => {
    const { getByTestId } = await render(<EmotionBars state={buildState()} />);
    const notch = getByTestId('emotion-baseline-joy');
    expect(StyleSheet.flatten(notch.props.style).left).toBe('31%');
    expect(getByTestId('emotion-baseline-sadness')).toBeTruthy();
  });

  it('scale is never narrower than 10', () => {
    expect(emotionScaleMax({ high_threshold: 7 } as EmotionState)).toBe(10);
    expect(emotionScaleMax({ high_threshold: 14 } as EmotionState)).toBe(14);
  });

  it('adds a band chip per row from the engine intensity labels', async () => {
    const { getByTestId } = await render(
      <EmotionBars
        state={buildState()}
        intensityLabels={{ joy: 'overwhelming', sadness: 'mild' }}
      />,
    );

    expect(
      within(getByTestId('emotion-band-joy')).getByText('emotionBandOverwhelming'),
    ).toBeTruthy();
    expect(
      within(getByTestId('emotion-band-sadness')).getByText('emotionBandMild'),
    ).toBeTruthy();
  });

  it('lays each row out on one line with the chip after the value', async () => {
    const { getByTestId } = await render(
      <EmotionBars state={buildState()} intensityLabels={{ joy: 'overwhelming' }} />,
    );

    const row = getByTestId('emotion-bar-joy');
    expect(StyleSheet.flatten(row.props.style).flexDirection).toBe('row');
    const inner = within(row);
    expect(inner.getByTestId('emotion-value-joy')).toBeTruthy();
    expect(inner.getByTestId('emotion-band-joy')).toBeTruthy();
    expect(inner.getByTestId('emotion-bar-fill-joy')).toBeTruthy();
  });

  it('renders no chip for unknown or missing band labels', async () => {
    const { queryByTestId, queryAllByTestId } = await render(
      <EmotionBars state={buildState()} intensityLabels={{ disgust: 'cosmic' }} />,
    );

    expect(queryAllByTestId(/^emotion-band-/)).toHaveLength(0);
    expect(queryByTestId('emotion-band-joy')).toBeNull();
    // The rows themselves are untouched.
    expect(queryByTestId('emotion-bar-joy')).toBeTruthy();
  });

  it('renders no chips without the optional derived labels (older engine)', async () => {
    const { queryAllByTestId } = await render(<EmotionBars state={buildState()} />);
    expect(queryAllByTestId(/^emotion-band-/)).toHaveLength(0);
  });

  it('maps only the known engine band names', () => {
    expect(emotionBandLabelKey('overwhelming')).toBe('emotionBandOverwhelming');
    expect(emotionBandLabelKey('INTENSE')).toBe('emotionBandIntense');
    expect(emotionBandLabelKey('moderate')).toBe('emotionBandModerate');
    expect(emotionBandLabelKey('mild')).toBe('emotionBandMild');
    expect(emotionBandLabelKey('neutral')).toBe('emotionBandNeutral');
    expect(emotionBandLabelKey('cosmic')).toBeNull();
    expect(emotionBandLabelKey('')).toBeNull();
    expect(emotionBandLabelKey(null)).toBeNull();
  });
});
