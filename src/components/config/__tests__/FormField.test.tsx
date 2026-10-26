/**
 * FormField — numeric field draft-buffer behaviour (floating-point fix).
 *
 * Regression tests for the controlled-parseFloat bugs:
 *  - typing `0` + `.` + `7` used to collapse the separator and commit 7 —
 *    the draft keeps intermediate states and commits only complete numbers;
 *  - garbage (`parseFloat('-')` → NaN) used to brick the field with a literal
 *    "NaN" — invalid drafts never commit and revert on blur;
 *  - out-of-range values used to pass straight through — commits are now
 *    clamped to the field's declared min/max;
 *  - clearing still restores the sentinel (`0` unset) or null.
 */

import React from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react-native';
import { FormField } from '../FormField';
import type { FieldDefinition } from '../../../constants/providerFieldSchemas';

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

jest.mock('../SelectPicker', () => ({
  SelectPicker: () => null,
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

afterEach(async () => {
  await cleanup();
});

const TEMPERATURE: FieldDefinition = {
  key: 'temperature',
  label: 'Temperature',
  type: 'number',
  step: 0.01,
  min: 0,
  max: 2,
  placeholder: '0.7',
};

const MAX_COMPLETION_TOKENS: FieldDefinition = {
  key: 'max_completion_tokens',
  label: 'Max Completion Tokens',
  type: 'number',
  placeholder: 'Default',
  disabledValue: 0,
};

const renderNumberField = async (field: FieldDefinition, value: any = null) => {
  const onChange = jest.fn();
  const utils = await render(
    <FormField field={field} value={value} onChange={onChange} testID="num" />,
  );
  return { onChange, input: () => utils.getByTestId('num'), ...utils };
};

const type = (input: () => any, text: string) => fireEvent.changeText(input(), text);
const blur = (input: () => any) => fireEvent(input(), 'blur');
const displayed = (input: () => any) => String(input().props.value ?? '');

describe('FormField number input — decimal entry', () => {
  it('commits 0.7 when the user types 0 → . → 7 (dot-eating regression)', async () => {
    const { onChange, input } = await renderNumberField(TEMPERATURE);

    await type(input, '0');
    expect(onChange).toHaveBeenLastCalledWith('temperature', 0);

    // '0.' is a partial number — the separator must NOT be eaten: nothing
    // commits, and the draft keeps displaying '0.'.
    await type(input, '0.');
    expect(onChange).toHaveBeenLastCalledWith('temperature', 0);
    expect(displayed(input)).toBe('0.');

    await type(input, '0.7');
    expect(onChange).toHaveBeenLastCalledWith('temperature', 0.7);
  });

  it('accepts a leading-dot entry (.5 → 0.5)', async () => {
    const { onChange, input } = await renderNumberField(TEMPERATURE);
    await type(input, '.5');
    expect(onChange).toHaveBeenLastCalledWith('temperature', 0.5);
  });

  it('allows typing negative values in one pass (-1 → -1 on a signed field)', async () => {
    const penalty: FieldDefinition = {
      key: 'frequency_penalty',
      label: 'Frequency Penalty',
      type: 'number',
      step: 0.01,
      min: -2,
      max: 2,
    };
    const { onChange, input } = await renderNumberField(penalty);
    await type(input, '-');
    expect(onChange).not.toHaveBeenCalled();
    await type(input, '-1');
    expect(onChange).toHaveBeenLastCalledWith('frequency_penalty', -1);
  });
});

describe('FormField number input — clamping', () => {
  it('clamps commits to the declared max', async () => {
    const { onChange, input } = await renderNumberField(TEMPERATURE);
    await type(input, '42');
    expect(onChange).toHaveBeenLastCalledWith('temperature', 2);
  });

  it('clamps commits to the declared min', async () => {
    const { onChange, input } = await renderNumberField(TEMPERATURE);
    await type(input, '-4');
    expect(onChange).toHaveBeenLastCalledWith('temperature', 0);
  });

  it('rounds commits to the step precision', async () => {
    const { onChange, input } = await renderNumberField(TEMPERATURE);
    await type(input, '0.707');
    expect(onChange).toHaveBeenLastCalledWith('temperature', 0.71);
  });

  it('does not clamp fields without declared bounds', async () => {
    const { onChange, input } = await renderNumberField(MAX_COMPLETION_TOKENS);
    await type(input, '65536');
    expect(onChange).toHaveBeenLastCalledWith('max_completion_tokens', 65536);
  });
});

describe('FormField number input — garbage and NaN', () => {
  it('never commits garbage, and blur reverts the draft to the committed value', async () => {
    const { onChange, input } = await renderNumberField(TEMPERATURE, 0.7);
    await type(input, 'abc');
    expect(onChange).not.toHaveBeenCalled();
    // The old code displayed a literal "NaN" here and bricked the field.
    await blur(input);
    expect(onChange).not.toHaveBeenCalled();
    expect(displayed(input)).toBe('0.7');
  });

  it('finalizes a complete draft on blur (round-trip through a stateful parent)', async () => {
    // A real parent feeds the committed value back into `value`; blur then
    // clears the draft and the committed value keeps displaying.
    const Harness = () => {
      const [value, setValue] = React.useState<any>(null);
      return (
        <FormField
          field={MAX_COMPLETION_TOKENS}
          value={value}
          onChange={(_key, v) => setValue(v)}
          testID="num"
        />
      );
    };
    const utils = await render(<Harness />);
    const input = () => utils.getByTestId('num');

    await type(input, '1024');
    expect(displayed(input)).toBe('1024');
    await blur(input);
    expect(displayed(input)).toBe('1024');
  });
});

describe('FormField number input — clearing and sentinels', () => {
  it('restores the disabledValue sentinel when a sentinel-bearing field is cleared', async () => {
    const { onChange, input } = await renderNumberField(MAX_COMPLETION_TOKENS, 512);
    await type(input, '');
    expect(onChange).toHaveBeenLastCalledWith('max_completion_tokens', 0);
    expect(displayed(input)).toBe(''); // sentinel hidden → placeholder shows
  });

  it('commits null when a field without a sentinel is cleared', async () => {
    const { onChange, input } = await renderNumberField(TEMPERATURE, 0.7);
    await type(input, '');
    expect(onChange).toHaveBeenLastCalledWith('temperature', null);
  });
});

describe('FormField bounded slider input — same draft semantics', () => {
  const SPEED: FieldDefinition = {
    key: 'speed',
    label: 'Speed',
    type: 'number',
    step: 0.05,
    min: 0.25,
    max: 4,
    placeholder: '1.0',
  };

  it('shares the number-field draft behaviour (partial drafts do not commit)', async () => {
    const { onChange, input } = await renderNumberField(SPEED, 1);
    await type(input, '1.');
    expect(onChange).not.toHaveBeenCalled();
    expect(displayed(input)).toBe('1.');
    await type(input, '1.5');
    expect(onChange).toHaveBeenLastCalledWith('speed', 1.5);
  });

  it('clamps typed values into the slider range', async () => {
    const { onChange, input } = await renderNumberField(SPEED, 1);
    await type(input, '99');
    expect(onChange).toHaveBeenLastCalledWith('speed', 4);
  });
});
