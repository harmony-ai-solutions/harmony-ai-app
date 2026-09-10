import { resolveMacros } from '../macros';

describe('resolveMacros', () => {
  it('replaces {{char}} with the character name', () => {
    expect(resolveMacros('Hello, {{char}}!', 'Aria', 'User')).toBe(
      'Hello, Aria!',
    );
  });

  it('replaces {{user}} with the user name', () => {
    expect(resolveMacros('{{user}} says hi.', 'Aria', 'Alex')).toBe(
      'Alex says hi.',
    );
  });

  it('replaces {{original}} with the provided original text', () => {
    expect(
      resolveMacros(
        'Base: {{original}}',
        'Aria',
        'Alex',
        'You are a helpful assistant.',
      ),
    ).toBe('Base: You are a helpful assistant.');
  });

  it('resolves {{original}} to an empty string when original is omitted', () => {
    expect(resolveMacros('Base: {{original}}', 'Aria', 'Alex')).toBe('Base: ');
    expect(resolveMacros('No macros here', 'Aria', 'Alex')).toBe(
      'No macros here',
    );
  });

  it('matches macros case-insensitively', () => {
    expect(
      resolveMacros('{{CHAR}} {{User}} {{ORIGINAL}}', 'Aria', 'Alex', 'Orig'),
    ).toBe('Aria Alex Orig');
    expect(resolveMacros('{{cHaR}}', 'Aria', 'Alex')).toBe('Aria');
  });

  it('replaces all occurrences, not just the first', () => {
    expect(resolveMacros('{{char}} and {{char}} again', 'Aria', 'Alex')).toBe(
      'Aria and Aria again',
    );
  });

  it('passes unknown {{...}} macros through unchanged', () => {
    expect(
      resolveMacros('{{random:Hello,Hi}} {{time}} {{char}}', 'Aria', 'Alex'),
    ).toBe('{{random:Hello,Hi}} {{time}} Aria');
  });

  it('does not treat substituted values as new macros', () => {
    expect(resolveMacros('{{char}}', '{{user}}', 'Alex')).toBe('{{user}}');
  });

  it('handles empty text', () => {
    expect(resolveMacros('', 'Aria', 'Alex')).toBe('');
  });

  it('handles empty char/user names', () => {
    expect(resolveMacros('{{char}}/{{user}}', '', '')).toBe('/');
  });
});
