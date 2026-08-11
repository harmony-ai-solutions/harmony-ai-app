/**
 * ImportReviewSheet — post-import detection review tests (§3-5).
 *
 * Verifies:
 *  - `buildImportDetectionSummary` detection (greeting / alt-greetings /
 *    lorebook entries + constants / tags / provenance).
 *  - ✓/⚠ rows render from the summary.
 *  - no-greeting → prominent "Generate a greeting" CTA + author-one prompt;
 *    otherwise the CTA is absent.
 *  - Cancel / Save / Review & edit actions call their callbacks.
 */

import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import {
  ImportReviewSheet,
  buildImportDetectionSummary,
} from '../ImportReviewSheet';
import type { TavernCardV2 } from '../../../utils/charactercard/types';

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
        status: { success: '#22c55e', warning: '#f59e0b', error: '#ef4444' },
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

const WITH_GREETING_CARD = {
  spec: 'chara_card_v3',
  spec_version: '1.0',
  data: {
    name: 'Aria',
    first_mes: 'Hello {{user}}!',
    alternate_greetings: ['Alt one', 'Alt two'],
    character_book: {
      extensions: {},
      entries: [
        { keys: ['k'], content: 'c', extensions: {}, enabled: true, insertion_order: 10, constant: true },
      ],
    },
    tags: ['fantasy', 'rogue'],
    source: ['imported'],
  },
} as unknown as TavernCardV2;

const NO_GREETING_CARD = {
  spec: '',
  spec_version: '',
  data: {
    name: 'Bore',
    first_mes: '',
    alternate_greetings: [],
    character_book: null,
    tags: [],
  },
} as unknown as TavernCardV2;

describe('buildImportDetectionSummary', () => {
  it('detects greeting / alternates / lorebook / tags / provenance', () => {
    const s = buildImportDetectionSummary(WITH_GREETING_CARD);
    expect(s.name).toBe('Aria');
    expect(s.hasGreeting).toBe(true);
    expect(s.alternateGreetingsCount).toBe(2);
    expect(s.lorebookEntryCount).toBe(1);
    expect(s.constantEntryCount).toBe(1);
    expect(s.tags).toEqual(['fantasy', 'rogue']);
    expect(s.provenance?.spec).toBe('chara_card_v3');
    expect(s.provenance?.specVersion).toBe('1.0');
    expect(s.provenance?.source).toEqual(['imported']);
  });

  it('reports no greeting when first_mes is blank', () => {
    const s = buildImportDetectionSummary(NO_GREETING_CARD);
    expect(s.hasGreeting).toBe(false);
    expect(s.alternateGreetingsCount).toBe(0);
    expect(s.lorebookEntryCount).toBe(0);
    expect(s.constantEntryCount).toBe(0);
    expect(s.tags).toEqual([]);
    expect(s.provenance).toBeNull();
  });
});

describe('ImportReviewSheet', () => {
  const onCancel = jest.fn();
  const onSave = jest.fn();
  const onReviewAndEdit = jest.fn();
  const onGenerateGreeting = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  function renderSheet(summary: ReturnType<typeof buildImportDetectionSummary>) {
    return render(
      <ImportReviewSheet
        open
        summary={summary}
        onCancel={onCancel}
        onSave={onSave}
        onReviewAndEdit={onReviewAndEdit}
        onGenerateGreeting={onGenerateGreeting}
      />,
    );
  }

  it('renders ✓ rows when everything is detected (no generate CTA)', async () => {
    const { getByTestId, queryByTestId } = await renderSheet(
      buildImportDetectionSummary(WITH_GREETING_CARD),
    );
    expect(getByTestId('import-review-name').props.children).toBe('Aria');
    expect(getByTestId('import-review-greeting')).toBeTruthy();
    expect(getByTestId('import-review-alternates')).toBeTruthy();
    expect(getByTestId('import-review-lorebook')).toBeTruthy();
    expect(getByTestId('import-review-tags')).toBeTruthy();
    expect(getByTestId('import-review-provenance')).toBeTruthy();
    expect(queryByTestId('import-review-generate-greeting')).toBeNull();
    expect(queryByTestId('import-review-no-greeting')).toBeNull();
  });

  it('no-greeting → ⚠ row + prominent Generate-a-greeting CTA', async () => {
    const { getByTestId } = await renderSheet(
      buildImportDetectionSummary(NO_GREETING_CARD),
    );
    expect(getByTestId('import-review-no-greeting')).toBeTruthy();

    await fireEvent.press(getByTestId('import-review-generate-greeting'));
    expect(onGenerateGreeting).toHaveBeenCalledTimes(1);
  });

  it('Cancel / Save / Review & edit fire their callbacks', async () => {
    const { getByTestId } = await renderSheet(
      buildImportDetectionSummary(WITH_GREETING_CARD),
    );

    await fireEvent.press(getByTestId('import-review-cancel'));
    expect(onCancel).toHaveBeenCalledTimes(1);

    await fireEvent.press(getByTestId('import-review-save'));
    expect(onSave).toHaveBeenCalledTimes(1);

    await fireEvent.press(getByTestId('import-review-edit'));
    expect(onReviewAndEdit).toHaveBeenCalledTimes(1);
  });

  it('dismiss → onCancel (backdrop / swipe-down)', async () => {
    const { getByTestId } = await renderSheet(
      buildImportDetectionSummary(WITH_GREETING_CARD),
    );
    await act(async () => {
      getByTestId('import-review-sheet').props.onDismiss();
    });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
