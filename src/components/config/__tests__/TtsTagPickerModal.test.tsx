/**
 * TtsTagPickerModal — searchable paralinguistic-tag picker.
 *
 * Locks the picker contract the TTS test panel relies on: tags render in
 * case-insensitive alphabetical order, the search filters by substring live, a
 * row tap reports the picked tag, the close button closes and an empty search
 * shows the muted no-match text.
 */

import React from 'react';
import { cleanup, fireEvent, render, type RenderResult } from '@testing-library/react-native';
import { TtsTagPickerModal } from '../TtsTagPickerModal';

afterEach(cleanup);
beforeEach(cleanup);

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('../../../utils/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

jest.mock('../../../utils/haptics', () => ({ hapticLightPress: jest.fn() }));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('react-native-vector-icons/MaterialCommunityIcons', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return ({ name, ...props }: any) => React.createElement(Text, { ...props }, name);
});

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

jest.mock('../../themed/ThemedText', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    __esModule: true,
    ThemedText: ({ children, style, ...props }: any) =>
      React.createElement(Text, { style, ...props }, children),
  };
});

const TAGS = ['[sigh]', '[laughter]', '[whisper]', '[clears throat]'];

async function renderPicker(
  overrides: Partial<React.ComponentProps<typeof TtsTagPickerModal>> = {},
): Promise<{ view: RenderResult; onClose: jest.Mock; onPick: jest.Mock }> {
  const onClose = jest.fn();
  const onPick = jest.fn();
  const view = await render(
    <TtsTagPickerModal visible tags={TAGS} onClose={onClose} onPick={onPick} {...overrides} />,
  );
  return { view, onClose, onPick };
}

describe('TtsTagPickerModal', () => {
  it('renders every tag in case-insensitive alphabetical order', async () => {
    const { view } = await renderPicker({ tags: ['[zebra]', '[Apple]', '[mango]'] });

    const rows = view.getAllByTestId(/^tts-tag-row:/);
    expect(rows.map((row) => row.props.testID)).toEqual([
      'tts-tag-row:apple',
      'tts-tag-row:mango',
      'tts-tag-row:zebra',
    ]);
  });

  it('filters the list by case-insensitive substring', async () => {
    const { view } = await renderPicker();

    await fireEvent.changeText(view.getByTestId('tts-tag-search'), 'LAUGH');

    expect(view.getByTestId('tts-tag-row:laughter')).toBeTruthy();
    expect(view.queryByTestId('tts-tag-row:sigh')).toBeNull();
    expect(view.queryByTestId('tts-tag-row:whisper')).toBeNull();
  });

  it('matches mid-tag substrings (not just prefixes)', async () => {
    const { view } = await renderPicker();

    await fireEvent.changeText(view.getByTestId('tts-tag-search'), 'clear');

    expect(view.getByTestId('tts-tag-row:clears-throat')).toBeTruthy();
    expect(view.queryByTestId('tts-tag-row:laughter')).toBeNull();
  });

  it('reports the picked tag', async () => {
    const { view, onPick, onClose } = await renderPicker();

    await fireEvent.press(view.getByTestId('tts-tag-row:clears-throat'));

    expect(onPick).toHaveBeenCalledWith('[clears throat]');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('shows the no-match text when the search matches nothing', async () => {
    const { view } = await renderPicker();

    await fireEvent.changeText(view.getByTestId('tts-tag-search'), 'zzz');

    expect(view.getByTestId('tts-tag-empty')).toBeTruthy();
    expect(view.getByText('noTagMatches')).toBeTruthy();
    expect(view.queryAllByTestId(/^tts-tag-row:/)).toHaveLength(0);
  });

  it('closes from the header close button', async () => {
    const { view, onClose } = await renderPicker();

    await fireEvent.press(view.getByTestId('tts-tag-modal-close'));

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('TtsTagPickerModal — kinded sections (Phase 3)', () => {
  const SECTIONS = [
    { kind: 'cues', label: 'Cues', tags: ['*whispers*', '*sighs*'] },
    { kind: 'tones', label: 'Tones', tags: ['*calm*', '*excited*'] },
    { kind: 'breaks', label: 'Breaks', tags: ['*short pause*'] },
  ];

  it('renders one header per kind plus that kind’s rows, alphabetically', async () => {
    const { view } = await renderPicker({ tags: undefined, sections: SECTIONS });

    expect(view.getByTestId('tts-tag-section-cues')).toBeTruthy();
    expect(view.getByText('Cues · 2')).toBeTruthy();
    expect(view.getByTestId('tts-tag-section-breaks')).toBeTruthy();
    expect(view.getByText('Breaks · 1')).toBeTruthy();

    // Rows keep their stable testIDs (asterisks stripped) and sort within the
    // section, not across sections.
    const rows = view.getAllByTestId(/^tts-tag-row:/);
    expect(rows.map((row) => row.props.testID)).toEqual([
      'tts-tag-row:sighs',
      'tts-tag-row:whispers',
      'tts-tag-row:calm',
      'tts-tag-row:excited',
      'tts-tag-row:short-pause',
    ]);
  });

  it('restricts the list to one kind when kindFilter is set', async () => {
    const { view } = await renderPicker({
      tags: undefined,
      sections: SECTIONS,
      kindFilter: 'tones',
    });

    expect(view.getByTestId('tts-tag-section-tones')).toBeTruthy();
    expect(view.queryByTestId('tts-tag-section-cues')).toBeNull();
    expect(view.queryByTestId('tts-tag-section-breaks')).toBeNull();
    expect(view.queryAllByTestId(/^tts-tag-row:/)).toHaveLength(2);
  });

  it('hides a section whose tags do not match the search', async () => {
    const { view } = await renderPicker({ tags: undefined, sections: SECTIONS });

    await fireEvent.changeText(view.getByTestId('tts-tag-search'), 'pause');

    expect(view.getByTestId('tts-tag-section-breaks')).toBeTruthy();
    expect(view.queryByTestId('tts-tag-section-cues')).toBeNull();
    expect(view.getByTestId('tts-tag-row:short-pause')).toBeTruthy();
  });

  it('reports the ASTERISK form of a picked row (never a bracketed tag)', async () => {
    const { view, onPick } = await renderPicker({ tags: undefined, sections: SECTIONS });

    await fireEvent.press(view.getByTestId('tts-tag-row:sighs'));

    expect(onPick).toHaveBeenCalledWith('*sighs*');
  });

  it('shows the no-match state when no section matches', async () => {
    const { view } = await renderPicker({ tags: undefined, sections: SECTIONS });

    await fireEvent.changeText(view.getByTestId('tts-tag-search'), 'zzz');

    expect(view.getByTestId('tts-tag-empty')).toBeTruthy();
    expect(view.queryAllByTestId(/^tts-tag-section-/)).toHaveLength(0);
  });
});
