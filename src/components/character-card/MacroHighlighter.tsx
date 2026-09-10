/**
 * MacroHighlighter (3-6) — shared helper for card-management screens.
 *
 * Detects `{{char}}` / `{{user}}` / `{{original}}` (and any other `{{…}}`
 * macro) and renders each as a subtle accent chip/underline. Macros are
 * **visible + highlighted, never resolved** on management surfaces — preview
 * surfaces resolve them via `resolveMacros` instead (§1-7, 3-6 consistency
 * pass).
 */

import React, { useMemo } from 'react';
import { StyleSheet, Text, TextStyle } from 'react-native';
import { useAppTheme } from '../../contexts/ThemeContext';

/** Split pattern that KEEPS the delimited macro segments in the result. */
const MACRO_SPLIT = /(\{\{[^{}]+\}\})/g;
/** Test pattern (non-global — no lastIndex state). */
const MACRO_ONLY = /^\{\{[^{}]+\}\}$/;

export interface MacroSegment {
  text: string;
  isMacro: boolean;
}

/** Pure helper — exposed for unit tests and reuse. */
export function splitMacroSegments(text: string): MacroSegment[] {
  return text
    .split(MACRO_SPLIT)
    .filter(seg => seg.length > 0)
    .map(seg => ({ text: seg, isMacro: MACRO_ONLY.test(seg) }));
}

export interface MacroHighlighterProps {
  text: string;
  /** Style applied to the whole line (inherited by plain segments). */
  style?: TextStyle;
  numberOfLines?: number;
  testID?: string;
}

/**
 * Renders `text` with every `{{…}}` macro highlighted in the accent color
 * (bold + dotted underline). The text itself is unchanged — management
 * surfaces keep macros visible for the author.
 */
export const MacroHighlighter: React.FC<MacroHighlighterProps> = ({
  text,
  style,
  numberOfLines,
  testID,
}) => {
  const { theme } = useAppTheme();
  const segments = useMemo(() => splitMacroSegments(text), [text]);

  if (!theme) {
    return (
      <Text style={style} numberOfLines={numberOfLines} testID={testID}>
        {text}
      </Text>
    );
  }

  return (
    <Text style={style} numberOfLines={numberOfLines} testID={testID}>
      {segments.map((seg, i) =>
        seg.isMacro ? (
          <Text key={i} style={[styles.macro, { color: theme.colors.accent.primary }]}>
            {seg.text}
          </Text>
        ) : (
          <Text key={i}>{seg.text}</Text>
        ),
      )}
    </Text>
  );
};

const styles = StyleSheet.create({
  macro: {
    fontWeight: '700',
    textDecorationLine: 'underline',
    textDecorationStyle: 'dotted',
  },
});
