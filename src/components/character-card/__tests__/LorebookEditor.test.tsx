/**
 * LorebookViewerSheet + LorebookEntryEditor — round-trip tests (§3-4).
 *
 * Verifies:
 *  - `parseLorebook` defensive parsing ('' / 'null' / invalid → null).
 *  - header summary (entries · constant · scan depth) from the book.
 *  - enable/disable toggle is optimistic and preserves JSON fidelity.
 *  - view → edit → save round-trips `character_book` losslessly (all other
 *    entry fields preserved, only the edited field changes).
 *  - new entries get sensible defaults (enabled=true, position=before_char,
 *    insertion_order=10).
 *  - reduced-motion sheet cross-fade (static content, no slide wrapper).
 *
 * NOTE: RNTL v14 `fireEvent` is async — every interaction must be awaited.
 */

import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { LorebookViewerSheet } from '../LorebookViewerSheet';
import { parseLorebook } from '../lorebook';

// Controllable reduced-motion flag.
let mockReduceMotionFlag = false;

jest.mock('../../../hooks/useReducedMotion', () => ({
  useReducedMotion: () => mockReduceMotionFlag,
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
        text: { primary: '#ffffff', secondary: '#cccccc', muted: '#aaaaaa' },
      },
    },
  }),
}));

jest.mock('react-native-linear-gradient', () => {
  const React = require('react');
  const { View } = require('react-native');
  return ({ children, style, ...props }: any) =>
    React.createElement(View, { style, ...props }, children);
});

// jest.setup.js mocks react-native-paper without Modal/Portal — override it here.
jest.mock('react-native-paper', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    Provider: ({ children }: any) => children,
    Portal: ({ children }: any) => React.createElement(View, null, children),
    Modal: ({ children, ...props }: any) =>
      props.visible ? React.createElement(View, { ...props }, children) : null,
  };
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

jest.mock('../../themed/ThemedButton', () => {
  const React = require('react');
  const { View, Text } = require('react-native');
  return {
    __esModule: true,
    ThemedButton: ({ label, onPress, disabled, testID, ...props }: any) =>
      React.createElement(
        View,
        {
          onPress: () => onPress(),
          accessibilityState: { disabled: !!disabled },
          testID,
          accessibilityRole: 'button',
          ...props,
        },
        React.createElement(Text, { testID: `${testID}-label` }, label),
      ),
  };
});

const ENTRY_1 = {
  keys: ['library', 'books'],
  content: 'She runs the library.',
  extensions: {},
  enabled: true,
  insertion_order: 10,
  constant: true,
  name: 'The Librarian',
  comment: 'core entry',
  position: 'before_char',
};

const ENTRY_2 = {
  keys: ['night'],
  content: 'At night she reads.',
  extensions: {},
  enabled: false,
  insertion_order: 20,
  constant: false,
  position: 'before_char',
};

const BOOK_JSON = JSON.stringify({
  name: 'Test Lore',
  description: 'desc',
  scan_depth: 2,
  token_budget: 500,
  extensions: {},
  entries: [ENTRY_1, ENTRY_2],
});

describe('parseLorebook', () => {
  it('parses defensively (null / empty / "null" / invalid → null)', () => {
    expect(parseLorebook(null)).toBeNull();
    expect(parseLorebook(undefined)).toBeNull();
    expect(parseLorebook('')).toBeNull();
    expect(parseLorebook('null')).toBeNull();
    expect(parseLorebook('not json')).toBeNull();
    const book = parseLorebook('{"entries":[{"keys":["k"],"content":"c","extensions":{},"enabled":true,"insertion_order":10}]}');
    expect(book?.entries.length).toBe(1);
    expect(book?.entries[0].keys).toEqual(['k']);
  });
});

describe('LorebookViewerSheet', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockReduceMotionFlag = false;
  });

  const onChange = jest.fn();
  const onClose = jest.fn();

  it('shows the header summary (entries · constant · scan depth)', async () => {
    const { getByText, getByTestId } = await render(
      <LorebookViewerSheet open characterBook={BOOK_JSON} onChange={onChange} onClose={onClose} />,
    );
    // Header composes: Lorebook · N entries · C constant · scan depth S · token budget T
    expect(getByText(/lorebookScanDepth 2/)).toBeTruthy();
    expect(getByText(/lorebookTokenBudget 500/)).toBeTruthy();
    expect(getByTestId('lorebook-entry-0')).toBeTruthy();
    expect(getByTestId('lorebook-entry-1')).toBeTruthy();
    // Constant badge on entry 0 only.
    expect(getByTestId('lorebook-toggle-0').props.value).toBe(true);
    expect(getByTestId('lorebook-toggle-1').props.value).toBe(false);
  });

  it('enable/disable toggle is optimistic and preserves JSON fidelity', async () => {
    let currentBookJson = BOOK_JSON;
    const onChanged = jest.fn((next: string) => {
      currentBookJson = next;
    });

    const { rerender, getByTestId } = await render(
      <LorebookViewerSheet open characterBook={currentBookJson} onChange={onChanged} onClose={onClose} />,
    );

    await fireEvent(getByTestId('lorebook-toggle-0'), 'valueChange', false);

    expect(onChanged).toHaveBeenCalledTimes(1);
    currentBookJson = onChanged.mock.calls[0][0];

    // Parent applies the optimistic update via a re-render.
    await rerender(
      <LorebookViewerSheet open characterBook={currentBookJson} onChange={onChanged} onClose={onClose} />,
    );
    expect(getByTestId('lorebook-toggle-0').props.value).toBe(false);

    // JSON fidelity: only the toggled field changed.
    const parsed = JSON.parse(currentBookJson);
    expect(parsed.entries[0].enabled).toBe(false);
    expect(parsed.entries[0].keys).toEqual(['library', 'books']);
    expect(parsed.entries[0].constant).toBe(true);
    expect(parsed.entries[0].name).toBe('The Librarian');
    expect(parsed.entries[1]).toEqual(ENTRY_2);
    expect(parsed.scan_depth).toBe(2);
    expect(parsed.token_budget).toBe(500);
  });

  it('round-trips character_book through view → edit → save (JSON fidelity)', async () => {
    let currentBookJson = BOOK_JSON;
    const onChanged = jest.fn((next: string) => {
      currentBookJson = next;
    });

    const { rerender, getByTestId } = await render(
      <LorebookViewerSheet open characterBook={currentBookJson} onChange={onChanged} onClose={onClose} />,
    );

    // Open the entry editor for row 0.
    await fireEvent.press(getByTestId('lorebook-entry-0'));
    expect(getByTestId('lorebook-entry-editor')).toBeTruthy();

    // Edit the primary `content` field.
    await fireEvent.changeText(getByTestId('lorebook-entry-content-input'), 'New content');

    // Save.
    await fireEvent.press(getByTestId('lorebook-entry-save'));

    expect(onChanged).toHaveBeenCalledTimes(1);
    currentBookJson = onChanged.mock.calls[0][0];
    const parsed = JSON.parse(currentBookJson);

    expect(parsed.entries.length).toBe(2);
    expect(parsed.entries[0].content).toBe('New content');
    // All other fields preserved.
    expect(parsed.entries[0].keys).toEqual(['library', 'books']);
    expect(parsed.entries[0].enabled).toBe(true);
    expect(parsed.entries[0].constant).toBe(true);
    expect(parsed.entries[0].insertion_order).toBe(10);
    expect(parsed.entries[0].name).toBe('The Librarian');
    expect(parsed.entries[0].comment).toBe('core entry');
    expect(parsed.entries[0].position).toBe('before_char');
    expect(parsed.entries[1]).toEqual(ENTRY_2);
    expect(parsed.extensions).toEqual({});
  });

  it('new entries get sensible defaults (enabled, position, insertion_order)', async () => {
    const onChanged = jest.fn();
    const { getByTestId } = await render(
      <LorebookViewerSheet open characterBook={null} onChange={onChanged} onClose={onClose} />,
    );

    await fireEvent.press(getByTestId('lorebook-add-entry'));
    expect(getByTestId('lorebook-entry-editor')).toBeTruthy();

    await fireEvent.press(getByTestId('lorebook-entry-save'));

    expect(onChanged).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(onChanged.mock.calls[0][0]);
    expect(parsed.entries.length).toBe(1);
    expect(parsed.entries[0].enabled).toBe(true);
    expect(parsed.entries[0].position).toBe('before_char');
    expect(parsed.entries[0].insertion_order).toBe(10);
    expect(parsed.entries[0].content).toBe('');
  });

  it('default → slide wrapper; reduced-motion → cross-fade (no slide)', async () => {
    const first = await render(
      <LorebookViewerSheet open characterBook={BOOK_JSON} onChange={onChange} onClose={onClose} />,
    );
    expect(first.getByTestId('lorebook-viewer-content-slide')).toBeTruthy();
    expect(first.queryByTestId('lorebook-viewer-content-static')).toBeNull();

    mockReduceMotionFlag = true;
    const second = await render(
      <LorebookViewerSheet open characterBook={BOOK_JSON} onChange={onChange} onClose={onClose} />,
    );
    expect(second.getByTestId('lorebook-viewer-content-static')).toBeTruthy();
    expect(second.queryByTestId('lorebook-viewer-content-slide')).toBeNull();
  });

  it('dismiss → onClose', async () => {
    const { getByTestId } = await render(
      <LorebookViewerSheet open characterBook={BOOK_JSON} onChange={onChange} onClose={onClose} />,
    );
    await act(async () => {
      getByTestId('lorebook-viewer').props.onDismiss();
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
