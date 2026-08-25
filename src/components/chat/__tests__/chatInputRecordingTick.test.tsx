/**
 * ChatInputBar recording countdown (D1-3) — unit tests for the pure
 * `nextRecordingTick` helper.
 *
 * Pins the 120 s auto-stop timer behavior:
 *  - the count clamps at the ceiling (MAX_RECORDING_SECONDS)
 *  - `onCeiling` fires EXACTLY ONCE — on the tick that first reaches the
 *    ceiling — so the auto-stop can never double-trigger
 *  - after the ceiling the count stays pinned and does NOT re-fire
 *
 * The component itself is not rendered (heavy dependency graph); the pure
 * helper is the extractable timer logic per the F4/D1-3 spec.
 */

// The imports below are only needed to make `../ChatInputBar` importable;
// `nextRecordingTick` itself is pure.
jest.mock('../../../utils/logger', () => ({
  createLogger: jest.fn(() => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() })),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('../../../contexts/ThemeContext', () => ({
  useAppTheme: () => ({ theme: null }),
}));

jest.mock('../../../contexts/AppToastContext', () => ({
  useToast: () => ({ showToast: jest.fn() }),
}));

jest.mock('../../../contexts/AppAlertContext', () => ({
  useAppAlert: () => ({ showAlert: jest.fn() }),
}));

jest.mock('../../../contexts/BiometricLockContext', () => ({
  useBiometricLock: () => ({ withExternalFlow: (fn: () => Promise<unknown>) => fn() }),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ bottom: 0 }),
}));

jest.mock('react-native-linear-gradient', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    default: ({ children, ...props }: any) => React.createElement(View, props, children),
  };
});

jest.mock('../../emoji/EmojiPickerInline', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    default: () => React.createElement(View),
  };
});

jest.mock('../EmptyChatCTA', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    EmptyChatCTA: () => React.createElement(View),
  };
});

import { nextRecordingTick } from '../ChatInputBar';

const MAX = 120;

describe('nextRecordingTick (D1-3 120 s auto-stop)', () => {
  it('increments the count while below the ceiling', () => {
    const onCeiling = jest.fn();
    expect(nextRecordingTick(0, MAX, onCeiling)).toBe(1);
    expect(nextRecordingTick(59, MAX, onCeiling)).toBe(60);
    expect(nextRecordingTick(118, MAX, onCeiling)).toBe(119);
    expect(onCeiling).not.toHaveBeenCalled();
  });

  it('fires onCeiling exactly once when the count first reaches the ceiling', () => {
    const onCeiling = jest.fn();
    // 119 → 120: the tick that crosses the ceiling.
    expect(nextRecordingTick(119, MAX, onCeiling)).toBe(120);
    expect(onCeiling).toHaveBeenCalledTimes(1);
  });

  it('pins the count at the ceiling and does NOT re-fire onCeiling afterwards', () => {
    const onCeiling = jest.fn();
    expect(nextRecordingTick(120, MAX, onCeiling)).toBe(120);
    expect(nextRecordingTick(120, MAX, onCeiling)).toBe(120);
    expect(onCeiling).not.toHaveBeenCalled();
  });

  it('clamps any oversized current value to the ceiling without firing', () => {
    const onCeiling = jest.fn();
    expect(nextRecordingTick(999, MAX, onCeiling)).toBe(120);
    expect(onCeiling).not.toHaveBeenCalled();
  });

  it('behaves for a non-120 ceiling (configurable max)', () => {
    const onCeiling = jest.fn();
    expect(nextRecordingTick(9, 10, onCeiling)).toBe(10);
    expect(onCeiling).toHaveBeenCalledTimes(1);
    expect(nextRecordingTick(10, 10, onCeiling)).toBe(10);
    expect(onCeiling).toHaveBeenCalledTimes(1); // still exactly once
  });
});