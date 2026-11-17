/**
 * CharacterStateSheet — the combined State | Memories | Knowledge surface
 * (tts-voice-ux Phase 5 + 6).
 *
 * Verifies the freshness stamp, the dominant-emotion card, the eight bars, the
 * READ-ONLY voice-expression card (no knob), the empty state, and lazy tab
 * mounting (only the active tab is rendered/fetched).
 */

import React from 'react';
import { fireEvent, render, within } from '@testing-library/react-native';
import type { EmotionState } from '../../../database/models';
import type { DominantEmotion } from '../../../hooks/useEmotionState';
import type { EmotionDerived } from '../../../services/engine/engineApiMappers';
import {
  CharacterStateSheet,
  normalizeVocalExpressiveness,
} from '../CharacterStateSheet';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
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

// The heavy tabs are asserted by their lazy mounting only — their own suites
// cover the data behaviour.
jest.mock('../MemoriesTab', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    MemoriesTab: () => React.createElement(View, { testID: 'memories-tab-mock' }),
  };
});

jest.mock('../KnowledgeTab', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    KnowledgeTab: () => React.createElement(View, { testID: 'knowledge-tab-mock' }),
  };
});

function buildState(): EmotionState {
  const state: any = {
    entity_id: 'ent-1',
    last_update: new Date('2026-11-17T14:32:00Z'),
    decay_tau: 6,
    high_threshold: 7,
    low_threshold: 2,
  };
  for (const emotion of [
    'joy',
    'sadness',
    'trust',
    'disgust',
    'fear',
    'anger',
    'surprise',
    'anticipation',
  ]) {
    state[`${emotion}_intensity`] = emotion === 'joy' ? 7.2 : 1;
    state[`${emotion}_baseline`] = 1;
    state[`${emotion}_crystallize_start`] = null;
  }
  return state as EmotionState;
}

const DOMINANT: DominantEmotion = {
  emotion: 'joy',
  intensity: 7.2,
  baseline: 3.1,
  crystallized: true,
};

const DERIVED: EmotionDerived = {
  dominantEmotion: 'joy',
  dominantIntensity: 7.2,
  intensityLabel: 'overwhelming',
  intensityLabels: { joy: 'overwhelming', sadness: 'neutral', trust: 'moderate' },
  activeDyads: [
    {
      keyword: 'affection',
      type: 'primary',
      sourceEmotions: ['joy', 'trust'],
      sourceIntensities: [9.4, 6.2],
      combinedIntensity: 15.6,
      description: 'a warm sense of affection blooms in your heart',
    },
  ],
  topEmotions: [{ emotion: 'joy', intensity: 7.2, label: 'overwhelming' }],
};

const onClose = jest.fn();
const onRefreshEmotion = jest.fn();

function renderSheet(overrides: Partial<React.ComponentProps<typeof CharacterStateSheet>> = {}) {
  return render(
    <CharacterStateSheet
      visible
      onClose={onClose}
      entityId="ent-1"
      characterName="Mira"
      emotion={buildState()}
      dominant={DOMINANT}
      derived={DERIVED}
      emotionLoading={false}
      emotionError={null}
      onRefreshEmotion={onRefreshEmotion}
      vocalExpressiveness="expressive"
      {...overrides}
    />,
  );
}

describe('CharacterStateSheet', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders nothing while closed', async () => {
    const { queryByTestId } = await renderSheet({ visible: false });
    expect(queryByTestId('character-state-sheet')).toBeNull();
  });

  it('stamps the vector ("as of … decays over …") instead of claiming real-time', async () => {
    const { getByTestId } = await renderSheet();
    const stamp = getByTestId('character-state-as-of');
    expect(stamp.props.children).toBe('emotionAsOfDecay');
  });

  it('shows the dominant emotion card and all eight bars', async () => {
    const { getByTestId } = await renderSheet();
    expect(getByTestId('dominant-emotion-card')).toBeTruthy();
    expect(getByTestId('emotion-bars')).toBeTruthy();
    expect(getByTestId('emotion-bar-joy')).toBeTruthy();
  });

  it('badges the dominant emotion with its engine intensity band', async () => {
    const { getByTestId } = await renderSheet();
    const badge = getByTestId('dominant-emotion-band');
    expect(badge).toBeTruthy();
    expect(getByTestId('dominant-emotion-card')).toBeTruthy();
    expect(
      within(badge).getByText('emotionBandOverwhelming'),
    ).toBeTruthy();
  });

  it('falls back to the flat intensity label when the per-emotion map lacks the dominant', async () => {
    const { getByTestId } = await renderSheet({
      derived: { ...DERIVED, intensityLabels: {}, intensityLabel: 'intense' },
    });
    expect(
      within(getByTestId('dominant-emotion-band')).getByText('emotionBandIntense'),
    ).toBeTruthy();
  });

  it('shows the dominant value against the actual bar scale (no baseline text)', async () => {
    const { getByText, queryByText } = await renderSheet();
    expect(getByText('7.2 / 10')).toBeTruthy();
    expect(queryByText('emotionBaselineShort')).toBeNull();
  });

  it('uses the profile high_threshold for the dominant denominator', async () => {
    const { getByText, queryByText } = await renderSheet({
      emotion: { ...buildState(), high_threshold: 12 },
    });
    expect(getByText('7.2 / 12')).toBeTruthy();
    expect(queryByText('7.2 / 10')).toBeNull();
  });

  it('renders one card per active dyad from the engine', async () => {
    const { getByTestId, getByText } = await renderSheet();

    expect(getByTestId('emotional-currents-header')).toBeTruthy();
    expect(getByText('emotionalCurrents')).toBeTruthy();
    expect(getByTestId('emotional-currents')).toBeTruthy();
    expect(getByTestId('emotional-current-0')).toBeTruthy();

    expect(getByTestId('emotional-current-keyword-0').props.children).toBe('Affection');
    expect(
      within(getByTestId('emotional-current-type-0')).getByText('emotionalCurrentPrimary'),
    ).toBeTruthy();
    expect(getByTestId('emotional-current-sources-0').props.children).toBe('joy 9.4 + trust 6.2');
    expect(getByTestId('emotional-current-combined-0').props.children).toBe('15.6 / 20');
    expect(getByTestId('emotional-current-description-0').props.children).toBe(
      'a warm sense of affection blooms in your heart',
    );
    expect(getByTestId('emotional-current-bar-0')).toBeTruthy();
  });

  it('labels the eight-bar section with its scale', async () => {
    const { getByText } = await renderSheet();
    expect(getByText('eightEmotions')).toBeTruthy();
    expect(getByText('emotionScale')).toBeTruthy();
  });

  it('shows a band chip per bar only for known engine labels', async () => {
    const { getByTestId, queryByTestId } = await renderSheet();
    expect(getByTestId('emotion-band-joy')).toBeTruthy();
    // `anger` has no engine label in the fixture — no chip is invented.
    expect(queryByTestId('emotion-band-anger')).toBeNull();
  });

  it('hides the Emotional currents section when there are no dyads', async () => {
    const { queryByTestId, getByTestId } = await renderSheet({
      derived: { ...DERIVED, activeDyads: [] },
    });
    expect(queryByTestId('emotional-currents')).toBeNull();
    expect(queryByTestId('emotional-currents-header')).toBeNull();
    // The vector and the voice card stay visible.
    expect(getByTestId('emotion-bars')).toBeTruthy();
    expect(getByTestId('voice-expression-card')).toBeTruthy();
  });

  it('degrades cleanly when the engine omits the derived view (older engine)', async () => {
    const { queryByTestId, queryAllByTestId, getByTestId } = await renderSheet({
      derived: null,
    });

    expect(queryByTestId('emotional-currents')).toBeNull();
    expect(queryByTestId('emotional-currents-header')).toBeNull();
    expect(queryByTestId('dominant-emotion-band')).toBeNull();
    expect(queryAllByTestId(/^emotion-band-/)).toHaveLength(0);

    // Everything that does not depend on the derived view still renders.
    expect(getByTestId('dominant-emotion-card')).toBeTruthy();
    expect(getByTestId('emotion-bars')).toBeTruthy();
    expect(getByTestId('emotion-bar-joy')).toBeTruthy();
    expect(getByTestId('voice-expression-card')).toBeTruthy();
  });

  it('never renders the excluded "derived" / "read only" explanations', async () => {
    const { queryByText, queryByTestId } = await renderSheet();

    expect(queryByText(/derived/i)).toBeNull();
    expect(queryByText(/read.?only/i)).toBeNull();
    expect(queryByTestId('voice-expression-hint')).toBeNull();
    expect(queryByText(/overwhelming appears/i)).toBeNull();
  });

  it('shows the voice expression READ-ONLY (level + budget, no knob)', async () => {
    const { getByTestId, getByText, queryAllByRole } = await renderSheet();

    expect(getByTestId('voice-expression-card')).toBeTruthy();
    expect(getByText('voiceLevelExpressive')).toBeTruthy();
    // Nothing in the card is interactive — the level is engine-derived.
    expect(queryAllByRole('switch')).toHaveLength(0);
    expect(queryAllByRole('slider')).toHaveLength(0);
  });

  it('shows the empty state before the first turn', async () => {
    const { getByTestId, queryByTestId } = await renderSheet({
      emotion: null,
      dominant: null,
    });
    expect(getByTestId('character-state-empty')).toBeTruthy();
    expect(queryByTestId('emotion-bars')).toBeNull();
    // The derived voice expression stays visible — it does not depend on turns.
    expect(getByTestId('voice-expression-card')).toBeTruthy();
  });

  it('mounts Memories / Knowledge only when their tab is activated', async () => {
    const { getByTestId, queryByTestId } = await renderSheet();

    expect(queryByTestId('memories-tab-mock')).toBeNull();
    expect(queryByTestId('knowledge-tab-mock')).toBeNull();

    await fireEvent.press(getByTestId('character-state-tab-memories'));
    expect(getByTestId('memories-tab-mock')).toBeTruthy();
    expect(queryByTestId('knowledge-tab-mock')).toBeNull();
    // Leaving the State tab unmounts it.
    expect(queryByTestId('emotion-bars')).toBeNull();

    await fireEvent.press(getByTestId('character-state-tab-knowledge'));
    expect(getByTestId('knowledge-tab-mock')).toBeTruthy();
    expect(queryByTestId('memories-tab-mock')).toBeNull();
  });

  it('re-reads the vector when the State tab regains focus', async () => {
    const { getByTestId } = await renderSheet();
    await fireEvent.press(getByTestId('character-state-tab-memories'));
    await fireEvent.press(getByTestId('character-state-tab-state'));
    expect(onRefreshEmotion).toHaveBeenCalledTimes(1);
  });

  it('normalizes the derived level (absent / unknown ⇒ natural)', () => {
    expect(normalizeVocalExpressiveness('expressive')).toBe('expressive');
    expect(normalizeVocalExpressiveness('SUBDUED')).toBe('subdued');
    expect(normalizeVocalExpressiveness('')).toBe('natural');
    expect(normalizeVocalExpressiveness(null)).toBe('natural');
    expect(normalizeVocalExpressiveness('loud')).toBe('natural');
  });
});
