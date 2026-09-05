/**
 * ChatDetailScreen — render-only greeting gate tests (§1-10).
 *
 * `shouldShowEmptyChatHint` is the display mirror of the engine's truly-new-chat
 * gate: show the (P1-disabled) "generate a greeting" hint ONLY when the engine
 * reported `has_first_mes === false` AND the conversation has zero messages.
 */
import {
  buildGreetingSwipes,
  shouldRevealEmptyChat,
  shouldShowEmptyChatHint,
} from '../ChatDetailScreen';

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

describe('shouldRevealEmptyChat (empty-chat splash reveal gate)', () => {
  it('reveals once loading settled with has_first_mes=false and zero messages', () => {
    expect(shouldRevealEmptyChat(false, false, 0)).toBe(true);
  });

  it('holds the splash while the INIT_ENTITY signal is unknown (null)', () => {
    expect(shouldRevealEmptyChat(false, null, 0)).toBe(false);
    expect(shouldRevealEmptyChat(true, false, 0)).toBe(false);
  });

  it('holds the splash while a greeting is pending (has_first_mes=true)', () => {
    expect(shouldRevealEmptyChat(false, true, 0)).toBe(false);
  });

  it('never fires for non-empty chats (the content reveal owns those)', () => {
    expect(shouldRevealEmptyChat(false, false, 1)).toBe(false);
    expect(shouldRevealEmptyChat(false, true, 3)).toBe(false);
  });
});

describe('buildGreetingSwipes (authored swipes: first_mes + alternate_greetings)', () => {
  it('prepends the delivered greeting to the parsed alternate_greetings', () => {
    expect(
      buildGreetingSwipes('Hello!', { alternate_greetings: '["Alt one","Alt two"]' }),
    ).toEqual(['Hello!', 'Alt one', 'Alt two']);
  });

  it('degrades to just the delivered greeting when the profile is missing', () => {
    expect(buildGreetingSwipes('Hello!', null)).toEqual(['Hello!']);
    expect(buildGreetingSwipes('Hello!', {})).toEqual(['Hello!']);
  });

  it('degrades to just the delivered greeting for malformed JSON columns', () => {
    expect(buildGreetingSwipes('Hello!', { alternate_greetings: '{not json' })).toEqual([
      'Hello!',
    ]);
    expect(buildGreetingSwipes('Hello!', { alternate_greetings: '"just a string"' })).toEqual([
      'Hello!',
    ]);
  });

  it('drops blank greetings (delivered or alternate)', () => {
    expect(
      buildGreetingSwipes('  ', { alternate_greetings: '["", "Real one", null]' }),
    ).toEqual(['Real one']);
  });
});
