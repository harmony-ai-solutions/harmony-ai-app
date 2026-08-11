/**
 * MacroHighlighter — management-surface macro rendering tests (§3-6).
 *
 * Verifies:
 *  - known macros ({{char}}/{{user}}/{{original}}) and any other {{…}} are
 *    HIGHLIGHTED (accent-styled chip segment), never resolved.
 *  - `splitMacroSegments` classifies segments correctly (pure helper).
 */

import React from 'react';
import { render } from '@testing-library/react-native';
import {
  MacroHighlighter,
  splitMacroSegments,
} from '../MacroHighlighter';

jest.mock('../../../contexts/ThemeContext', () => ({
  useAppTheme: () => ({
    theme: {
      colors: {
        accent: { primary: '#7c3aed' },
      },
    },
  }),
}));

describe('splitMacroSegments', () => {
  it('classifies {{…}} segments as macros and the rest as plain text', () => {
    const segments = splitMacroSegments('Hi {{char}}, meet {{user}}!');
    expect(segments).toEqual([
      { text: 'Hi ', isMacro: false },
      { text: '{{char}}', isMacro: true },
      { text: ', meet ', isMacro: false },
      { text: '{{user}}', isMacro: true },
      { text: '!', isMacro: false },
    ]);
  });

  it('detects {{original}} and unknown macros too', () => {
    const segments = splitMacroSegments('{{original}} then {{dice}}');
    expect(segments.map(s => s.isMacro)).toEqual([true, false, true]);
  });

  it('returns a single plain segment when no macros exist', () => {
    expect(splitMacroSegments('plain text')).toEqual([
      { text: 'plain text', isMacro: false },
    ]);
  });
});

describe('MacroHighlighter', () => {
  it('renders the raw text unchanged (macros visible, not resolved)', async () => {
    const { getByText, queryByText } = await render(
      <MacroHighlighter
        text={'Hello {{char}}, it\'s {{user}}'}
        testID="highlight"
      />,
    );
    // Raw macro tokens are visible…
    expect(getByText('{{char}}')).toBeTruthy();
    expect(getByText('{{user}}')).toBeTruthy();
    // …and never substituted.
    expect(queryByText("Hello Aria, it's Alex")).toBeNull();
  });

  it('highlights macro segments with accent styling', async () => {
    const { getByText } = await render(
      <MacroHighlighter text="Go {{original}}!" testID="highlight" />,
    );
    const macro = getByText('{{original}}');
    expect(macro.props.style).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ fontWeight: '700' }),
      ]),
    );
  });

  it('does NOT substitute macro values (management surface)', async () => {
    const { queryByText } = await render(
      <MacroHighlighter text="Hello {{char}}" testID="highlight" />,
    );
    expect(queryByText('Hello Aria')).toBeNull();
    expect(queryByText('{{char}}')).toBeTruthy();
  });

  it('renders plain text normally when there are no macros', async () => {
    const { getByText } = await render(
      <MacroHighlighter text="just text" testID="highlight" />,
    );
    expect(getByText('just text')).toBeTruthy();
  });
});
