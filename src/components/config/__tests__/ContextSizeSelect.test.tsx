/**
 * ContextSizeSelect — the LLM "Context window" control (Backend / Cognition /
 * Movement capability cards).
 *
 * Covers: the five pills + DEFAULT badge; preset selection commits tokens;
 * feasibility from a known model max (dimmed + disabled, unknown blocks
 * nothing); the custom editor (numeric input, validation, clamp-on-blur, quick
 * chips, "Use max"); the model-switch auto-clamp + dismissible warning; the
 * module-specific compaction hint; and the model-max badge.
 *
 * Theme / i18n / gradients / themed text are mocked so the component is
 * exercised in isolation, matching the CatalogModelSelect test pattern.
 */

import React from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react-native';
import {
  ContextSizeSelect,
  CONTEXT_SIZE_ADJUSTED_DISMISS_TESTID,
  CONTEXT_SIZE_ADJUSTED_WARNING_TESTID,
  CONTEXT_SIZE_CUSTOM_INPUT_TESTID,
  CONTEXT_SIZE_HINT_TESTID,
  CONTEXT_SIZE_MAX_BADGE_TESTID,
  CONTEXT_SIZE_USE_MAX_TESTID,
  contextSizePillTestId,
} from '../ContextSizeSelect';

afterEach(cleanup);
beforeEach(cleanup);

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
        accent: { primary: '#b84fd0', secondary: '#4a5fcf' },
        background: { base: '#0b0f19', surface: '#0f1525', elevated: '#151d30' },
        border: { default: '#2e2355' },
        text: { primary: '#f0edf6', secondary: '#d2cde3', muted: '#9692b0', disabled: '#6b6780' },
        status: { success: '#4caf82', warning: '#f0a23b', error: '#ef5350' },
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

describe('ContextSizeSelect — pills', () => {
  it('renders the four presets plus Custom, with DEFAULT above Small', async () => {
    const utils = await render(
      <ContextSizeSelect moduleType="backend" onChange={jest.fn()} />,
    );

    for (const id of ['small', 'medium', 'large', 'xlarge', 'custom'] as const) {
      expect(utils.getByTestId(contextSizePillTestId(id))).toBeTruthy();
    }
    expect(utils.getByTestId('context-size-default-badge')).toBeTruthy();
    expect(utils.getByText('contextSizePresetXLarge')).toBeTruthy();
    // An untouched slot selects Small.
    expect(
      utils.getByTestId(contextSizePillTestId('small')).props.accessibilityState,
    ).toEqual({ selected: true, disabled: false });
  });

  it('commits a preset press as raw tokens', async () => {
    const onChange = jest.fn();
    const utils = await render(<ContextSizeSelect moduleType="backend" onChange={onChange} />);

    await fireEvent.press(utils.getByTestId(contextSizePillTestId('medium')));
    expect(onChange).toHaveBeenCalledWith(16384);

    await fireEvent.press(utils.getByTestId(contextSizePillTestId('xlarge')));
    expect(onChange).toHaveBeenLastCalledWith(65536);
  });

  it('selects the exact preset for a persisted value', async () => {
    const utils = await render(
      <ContextSizeSelect moduleType="cognition" value={32768} onChange={jest.fn()} />,
    );
    expect(
      utils.getByTestId(contextSizePillTestId('large')).props.accessibilityState,
    ).toEqual({ selected: true, disabled: false });
  });
});

describe('ContextSizeSelect — feasibility', () => {
  it('dims presets above a known model max and never commits them', async () => {
    const onChange = jest.fn();
    const utils = await render(
      <ContextSizeSelect
        moduleType="backend"
        onChange={onChange}
        modelMax={32768}
        modelLabel="gpt-4o-mini"
      />,
    );

    expect(
      utils.getByTestId(contextSizePillTestId('xlarge')).props.accessibilityState,
    ).toEqual({ selected: false, disabled: true });
    expect(
      utils.getByTestId(contextSizePillTestId('large')).props.accessibilityState,
    ).toEqual({ selected: false, disabled: false });

    await fireEvent.press(utils.getByTestId(contextSizePillTestId('xlarge')));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('blocks nothing when the model max is unknown', async () => {
    const utils = await render(<ContextSizeSelect moduleType="backend" onChange={jest.fn()} />);

    expect(
      utils.getByTestId(contextSizePillTestId('xlarge')).props.accessibilityState,
    ).toEqual({ selected: false, disabled: false });
    expect(utils.getByTestId(CONTEXT_SIZE_MAX_BADGE_TESTID)).toBeTruthy();
    expect(utils.getByText(/contextSizeModelMaxUnknown/)).toBeTruthy();
  });

  it('shows the model max badge when known', async () => {
    const utils = await render(
      <ContextSizeSelect moduleType="backend" onChange={jest.fn()} modelMax={131072} />,
    );
    expect(utils.getByText(/contextSizeModelMax/)).toBeTruthy();
    expect(utils.getByText(/131\.1K/)).toBeTruthy();
  });
});

describe('ContextSizeSelect — custom editor', () => {
  it('reveals the input only when Custom is selected', async () => {
    const utils = await render(<ContextSizeSelect moduleType="backend" onChange={jest.fn()} />);
    expect(utils.queryByTestId(CONTEXT_SIZE_CUSTOM_INPUT_TESTID)).toBeNull();

    await fireEvent.press(utils.getByTestId(contextSizePillTestId('custom')));
    expect(utils.getByTestId(CONTEXT_SIZE_CUSTOM_INPUT_TESTID)).toBeTruthy();
    expect(
      utils.getByTestId(contextSizePillTestId('custom')).props.accessibilityState,
    ).toEqual({ selected: true, disabled: false });
  });

  it('commits a valid typed value as the user types', async () => {
    const onChange = jest.fn();
    const utils = await render(<ContextSizeSelect moduleType="backend" onChange={onChange} />);
    await fireEvent.press(utils.getByTestId(contextSizePillTestId('custom')));

    await fireEvent.changeText(utils.getByTestId(CONTEXT_SIZE_CUSTOM_INPUT_TESTID), '24576');
    expect(onChange).toHaveBeenCalledWith(24576);
  });

  it('shows the too-small error and does not commit', async () => {
    const onChange = jest.fn();
    const utils = await render(<ContextSizeSelect moduleType="backend" onChange={onChange} />);
    await fireEvent.press(utils.getByTestId(contextSizePillTestId('custom')));

    await fireEvent.changeText(utils.getByTestId(CONTEXT_SIZE_CUSTOM_INPUT_TESTID), '500');
    expect(utils.getByText(/contextSizeErrorTooSmall/)).toBeTruthy();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('shows the above-max error with a "Use max" action', async () => {
    const onChange = jest.fn();
    const utils = await render(
      <ContextSizeSelect moduleType="backend" onChange={onChange} modelMax={32768} />,
    );
    await fireEvent.press(utils.getByTestId(contextSizePillTestId('custom')));

    await fireEvent.changeText(utils.getByTestId(CONTEXT_SIZE_CUSTOM_INPUT_TESTID), '40000');
    expect(utils.getByText(/contextSizeErrorAboveMax/)).toBeTruthy();

    await fireEvent.press(utils.getByTestId(CONTEXT_SIZE_USE_MAX_TESTID));
    expect(onChange).toHaveBeenLastCalledWith(32768);
  });

  it('clamps on blur, never on keystroke', async () => {
    const onChange = jest.fn();
    const utils = await render(
      <ContextSizeSelect moduleType="backend" onChange={onChange} modelMax={32768} />,
    );
    await fireEvent.press(utils.getByTestId(contextSizePillTestId('custom')));

    const input = utils.getByTestId(CONTEXT_SIZE_CUSTOM_INPUT_TESTID);
    await fireEvent.changeText(input, '40000');
    // Typing an out-of-range draft never commits it…
    expect(onChange).not.toHaveBeenCalledWith(40000);

    await fireEvent(input, 'blur');
    // …blur clamps it into the model's window.
    expect(onChange).toHaveBeenLastCalledWith(32768);
  });

  it('offers the 16K / 128K / model-max quick chips', async () => {
    const onChange = jest.fn();
    const utils = await render(
      <ContextSizeSelect moduleType="backend" onChange={onChange} modelMax={131072} />,
    );
    await fireEvent.press(utils.getByTestId(contextSizePillTestId('custom')));

    await fireEvent.press(utils.getByTestId('context-size-quick-16384'));
    expect(onChange).toHaveBeenLastCalledWith(16384);

    await fireEvent.press(utils.getByTestId('context-size-quick-131072'));
    expect(onChange).toHaveBeenLastCalledWith(131072);

    await fireEvent.press(utils.getByTestId('context-size-quick-model-max'));
    expect(onChange).toHaveBeenLastCalledWith(131072);
  });

  it('hides the model-max chip when the max is unknown', async () => {
    const utils = await render(<ContextSizeSelect moduleType="backend" onChange={jest.fn()} />);
    await fireEvent.press(utils.getByTestId(contextSizePillTestId('custom')));
    expect(utils.queryByTestId('context-size-quick-model-max')).toBeNull();
  });
});

describe('ContextSizeSelect — model switch', () => {
  it('auto-clamps a shrinking model max and warns dismissibly', async () => {
    const onChange = jest.fn();
    const props = {
      moduleType: 'backend' as const,
      value: 65536,
      onChange,
      modelLabel: 'gpt-4o',
    };
    const utils = await render(<ContextSizeSelect {...props} modelMax={65536} />);
    expect(utils.queryByTestId(CONTEXT_SIZE_ADJUSTED_WARNING_TESTID)).toBeNull();

    await utils.rerender(
      <ContextSizeSelect {...props} modelMax={32768} modelLabel="gpt-4o-mini" />,
    );

    expect(onChange).toHaveBeenCalledWith(32768);
    const warning = utils.getByTestId(CONTEXT_SIZE_ADJUSTED_WARNING_TESTID);
    expect(warning).toBeTruthy();
    expect(utils.getByText(/contextSizeAdjusted/)).toBeTruthy();
    expect(utils.getByText(/"from":"65\.5K"/)).toBeTruthy();
    expect(utils.getByText(/"to":"32\.8K"/)).toBeTruthy();
    expect(utils.getByText(/"model":"gpt-4o-mini"/)).toBeTruthy();

    await fireEvent.press(utils.getByTestId(CONTEXT_SIZE_ADJUSTED_DISMISS_TESTID));
    expect(utils.queryByTestId(CONTEXT_SIZE_ADJUSTED_WARNING_TESTID)).toBeNull();
  });

  it('does not warn when the new max still fits the value', async () => {
    const onChange = jest.fn();
    const props = { moduleType: 'backend' as const, value: 16384, onChange };
    const utils = await render(<ContextSizeSelect {...props} modelMax={65536} />);
    await utils.rerender(<ContextSizeSelect {...props} modelMax={32768} />);
    expect(onChange).not.toHaveBeenCalled();
    expect(utils.queryByTestId(CONTEXT_SIZE_ADJUSTED_WARNING_TESTID)).toBeNull();
  });

  it('does not warn when the max becomes unknown', async () => {
    const onChange = jest.fn();
    const props = { moduleType: 'backend' as const, value: 65536, onChange };
    const utils = await render(<ContextSizeSelect {...props} modelMax={65536} />);
    await utils.rerender(<ContextSizeSelect {...props} modelMax={undefined} />);
    expect(onChange).not.toHaveBeenCalled();
    expect(utils.queryByTestId(CONTEXT_SIZE_ADJUSTED_WARNING_TESTID)).toBeNull();
  });
});

describe('ContextSizeSelect — module hints', () => {
  it('explains trimming + the 80% compaction point for backend', async () => {
    const utils = await render(<ContextSizeSelect moduleType="backend" onChange={jest.fn()} />);
    const hint = utils.getByTestId(CONTEXT_SIZE_HINT_TESTID);
    expect(String(hint.props.children)).toMatch(/contextSizeHintBackend/);
    expect(String(hint.props.children)).toMatch(/6\.6K/);
  });

  it('explains decisions + compaction for cognition', async () => {
    const utils = await render(
      <ContextSizeSelect moduleType="cognition" value={32768} onChange={jest.fn()} />,
    );
    const hint = utils.getByTestId(CONTEXT_SIZE_HINT_TESTID);
    expect(String(hint.props.children)).toMatch(/contextSizeHintCognition/);
    expect(String(hint.props.children)).toMatch(/26\.2K/);
  });

  it('explains movement planning from the same 80% rule', async () => {
    const utils = await render(<ContextSizeSelect moduleType="movement" onChange={jest.fn()} />);
    expect(String(utils.getByTestId(CONTEXT_SIZE_HINT_TESTID).props.children)).toMatch(
      /contextSizeHintMovement/,
    );
  });
});
