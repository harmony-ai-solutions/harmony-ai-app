/**
 * useKeyboardHeight — the shared IME inset (Android edge-to-edge + iOS events).
 */

import { act, renderHook } from '@testing-library/react-native';
import { Keyboard } from 'react-native';
import { useKeyboardHeight } from '../useKeyboardHeight';

type Handler = (event?: { endCoordinates?: { height?: number } }) => void;

let handlers: Record<string, Handler>;

beforeEach(() => {
  handlers = {};
  jest
    .spyOn(Keyboard, 'addListener')
    .mockImplementation(((event: string, handler: Handler) => {
      handlers[event] = handler;
      return { remove: jest.fn() };
    }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('useKeyboardHeight', () => {
  it('tracks the reported keyboard height through show/hide', async () => {
    const { result } = await renderHook(() => useKeyboardHeight(true));
    expect(result.current).toBe(0);

    await act(async () => {
      handlers.keyboardDidShow({ endCoordinates: { height: 320 } });
    });
    expect(result.current).toBe(320);

    await act(async () => {
      handlers.keyboardDidHide();
    });
    expect(result.current).toBe(0);
  });

  it('falls back to a sane height when the event omits endCoordinates', async () => {
    const { result } = await renderHook(() => useKeyboardHeight(true));

    await act(async () => {
      handlers.keyboardDidShow({});
    });
    expect(result.current).toBeGreaterThan(0);
  });

  it('subscribes by default — self-positioning layouts need the inset on both platforms', async () => {
    const { result } = await renderHook(() => useKeyboardHeight());
    expect(handlers.keyboardDidShow).toBeDefined();

    await act(async () => {
      handlers.keyboardDidShow({ endCoordinates: { height: 288 } });
    });
    expect(result.current).toBe(288);
  });

  it('never subscribes and reports no inset when disabled (iOS keeps native avoiding)', async () => {
    const { result } = await renderHook(() => useKeyboardHeight(false));

    expect(handlers.keyboardDidShow).toBeUndefined();
    expect(result.current).toBe(0);
  });
});
