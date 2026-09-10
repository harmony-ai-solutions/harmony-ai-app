/**
 * Macro Engine — Curly Braced Syntaxes (CBS) resolution.
 *
 * App-side, preview-only macro resolution (authoring/preview surfaces). The
 * engine side resolves macros at delivery/prompt-build time in Go.
 *
 * Supported macros (SPEC_V3 §"Curly Braced Syntaxes"):
 *   - {{char}}     → charName     (engine resolves to nickname ?? name; app-preview passes the editor's name/nickname)
 *   - {{user}}     → userName
 *   - {{original}} → original     (defaults to '' — engine passes the user's default system prompt/ujb)
 *
 * Behavior:
 *   - Case-insensitive matching; replaces ALL occurrences.
 *   - Unknown {{...}} macros are left unchanged (never stripped).
 *   - Substituted values are not re-scanned for macros.
 *   - Side-effect free (pure function).
 */

const MACRO_PATTERN = /\{\{\s*(char|user|original)\s*\}\}/gi;

export function resolveMacros(
  text: string,
  charName: string,
  userName: string,
  original: string = '',
): string {
  return text.replace(MACRO_PATTERN, (match, macro: string) => {
    switch (macro.toLowerCase()) {
      case 'char':
        return charName;
      case 'user':
        return userName;
      case 'original':
        return original;
      default:
        // Unreachable given the alternation; keeps the switch exhaustive.
        return match;
    }
  });
}
