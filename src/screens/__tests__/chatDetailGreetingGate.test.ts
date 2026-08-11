/**
 * ChatDetailScreen — render-only greeting gate tests (§1-10).
 *
 * `shouldShowEmptyChatHint` is the display mirror of the engine's truly-new-chat
 * gate: show the (P1-disabled) "generate a greeting" hint ONLY when the engine
 * reported `has_first_mes === false` AND the conversation has zero messages.
 */
import { shouldShowEmptyChatHint } from '../ChatDetailScreen';

describe('shouldShowEmptyChatHint (P1 empty-chat hint gate)', () => {
  it('shows the hint when has_first_mes=false and the chat has zero messages', () => {
    expect(shouldShowEmptyChatHint(false, 0)).toBe(true);
  });

  it('hides the hint when has_first_mes is true (greeting arrives as a message)', () => {
    expect(shouldShowEmptyChatHint(true, 0)).toBe(false);
  });

  it('hides the hint when the INIT_ENTITY signal has not arrived yet (null)', () => {
    expect(shouldShowEmptyChatHint(null, 0)).toBe(false);
  });

  it('hides the hint once the conversation has messages (existing chat)', () => {
    expect(shouldShowEmptyChatHint(false, 1)).toBe(false);
    expect(shouldShowEmptyChatHint(true, 3)).toBe(false);
  });
});
