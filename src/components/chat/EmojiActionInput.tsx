/**
 * EmojiActionInput - Dual-layer input component with substitution previews
 *
 * Architecture (substitution mode):
 *   Layer 1 (normal flow, visible): Display `Text` — drives container height,
 *     renders the user's text with inline italic substitution labels.
 *     Also renders a blinking cursor when the TextInput is focused.
 *   Layer 2 (absolute cover, opacity:0): `TextInput` — fully invisible but
 *     still receives all touch/focus/keyboard events.
 *
 * Why opacity:0 instead of color:'transparent':
 *   On Android, emoji glyphs are rendered as colored images by the OS and
 *   ignore text color. color:'transparent' makes latin text invisible but
 *   leaves emoji glyphs fully visible, causing a double-render ghost.
 *   opacity:0 makes the entire view invisible (including emoji glyphs) while
 *   keeping it interactive.
 *
 * Cursor: because the TextInput cursor is hidden by opacity:0 we render a
 *   custom blinking "|" at the end of the display layer when focused.
 */
import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { View, TextInput, Text, StyleSheet, Animated } from 'react-native';
import { createLogger } from '../../utils/logger';
import { EntityEmojiActionService } from '../../services/EntityEmojiActionService';
import EmojiService from '../../services/EmojiService';
import { EmojiAction } from '../../database/models';
import { Theme } from '../../theme/types';

const log = createLogger('[EmojiActionInput]');

interface EmojiActionInputProps {
  value: string;
  onChangeText: (text: string) => void;
  onSubmitEditing?: () => void;
  placeholder?: string;
  placeholderTextColor?: string;
  textColor?: string;
  backgroundColor?: string;
  editable?: boolean;
  blurOnSubmit?: boolean;
  maxLength?: number;
  entityId: string | null;
  theme: Theme;
  style?: any;
}

const FONT_SIZE = 16;
const LINE_HEIGHT = 22;
const PADDING_HORIZONTAL = 0;
const PADDING_VERTICAL = 0;
const MAX_INPUT_LINES = 4;
const MAX_INPUT_HEIGHT = LINE_HEIGHT * MAX_INPUT_LINES; // 88

/** Blinking cursor shown in the display layer when the hidden TextInput is focused */
const BlinkingCursor: React.FC<{ color?: string }> = ({ color }) => {
  const opacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0, duration: 400, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: 400, useNativeDriver: true }),
      ]),
    );
    anim.start();
    return () => anim.stop();
  }, [opacity]);

  return (
    <Animated.Text
      style={[styles.cursor, { color: color ?? '#fff', opacity }]}
      selectable={false}
    >
      |
    </Animated.Text>
  );
};

const EmojiActionInput: React.FC<EmojiActionInputProps> = React.memo(({
  value,
  onChangeText,
  onSubmitEditing,
  placeholder,
  placeholderTextColor,
  textColor,
  backgroundColor,
  editable = true,
  blurOnSubmit = false,
  maxLength,
  entityId,
  theme,
  style,
}) => {
  const [actionsMap, setActionsMap] = useState<Map<string, EmojiAction> | null>(null);
  const [isFocused, setIsFocused] = useState(false);

  useEffect(() => {
    if (!entityId) { setActionsMap(null); return; }

    let isMounted = true;
    const loadActions = async () => {
      try {
        const map = await EntityEmojiActionService.getActionsMap(entityId);
        if (isMounted) setActionsMap(map);
      } catch (error) {
        log.error('Failed to load emoji actions map:', error);
        if (isMounted) setActionsMap(null);
      }
    };

    loadActions();
    return () => { isMounted = false; };
  }, [entityId]);

  const displaySegments = useMemo(() => {
    if (!entityId || !actionsMap || actionsMap.size === 0) return null;

    const segments = EmojiService.splitTextOnEmojis(value);
    const result: { type: 'text' | 'emoji-with-action'; value: string; substitution?: string }[] = [];

    for (const segment of segments) {
      if (segment.type === 'text') {
        result.push({ type: 'text', value: segment.value });
      } else if (segment.type === 'emoji') {
        const action = actionsMap.get(segment.value);
        if (action?.substitutionText) {
          result.push({ type: 'emoji-with-action', value: segment.value, substitution: action.substitutionText });
        } else {
          result.push({ type: 'text', value: segment.value });
        }
      }
    }
    return result;
  }, [value, entityId, actionsMap]);

  const handleFocus = useCallback(() => setIsFocused(true), []);
  const handleBlur = useCallback(() => setIsFocused(false), []);

  // Simple path: no entity / no actions — plain TextInput
  if (!entityId || !actionsMap || actionsMap.size === 0) {
    return (
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={placeholderTextColor}
        style={[
          styles.input,
          { color: textColor, maxHeight: MAX_INPUT_HEIGHT },
          style,
        ]}
        multiline
        scrollEnabled
        maxLength={maxLength}
        editable={editable}
        onSubmitEditing={onSubmitEditing}
        blurOnSubmit={blurOnSubmit}
      />
    );
  }

  // Substitution mode:
  //   Layer 1 (visible display Text, normal flow) drives container height.
  //   Layer 2 (opacity:0 TextInput, absolute) receives all input.
  //   Blinking cursor renders in Layer 1 when Layer 2 is focused.
  const isEmpty = value.length === 0;

  return (
    <View style={styles.container}>

      {/* ── Layer 1: visible display (drives height) ── */}
      <Text
        style={[
          styles.displayText,
          { color: textColor, maxHeight: MAX_INPUT_HEIGHT },
        ]}
        selectable={false}
        numberOfLines={undefined}
      >
        {isEmpty ? (
          // When empty: show placeholder if unfocused, cursor only if focused
          isFocused
            ? <BlinkingCursor color={textColor} />
            : <Text style={{ color: placeholderTextColor }}>{placeholder}</Text>
        ) : (
          <>
            {displaySegments?.map((segment, index) => {
              if (segment.type === 'text') {
                return <Text key={index} style={{ color: textColor }}>{segment.value}</Text>;
              }
              return (
                <Text key={index} style={{ color: textColor }}>
                  {segment.value}
                  <Text style={styles.substitutionText}>({segment.substitution})</Text>
                </Text>
              );
            })}
            {/* Cursor after all content */}
            {isFocused && <BlinkingCursor color={textColor} />}
          </>
        )}
      </Text>

      {/* ── Layer 2: invisible TextInput (absolute, opacity:0) ── */}
      {/* opacity:0 hides everything including emoji glyphs (color:'transparent' does not). */}
      {/* The view still receives all touch and keyboard events at opacity:0. */}
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder=""
        style={[styles.input, styles.hiddenInput]}
        multiline
        scrollEnabled
        maxLength={maxLength}
        editable={editable}
        onSubmitEditing={onSubmitEditing}
        blurOnSubmit={blurOnSubmit}
        onFocus={handleFocus}
        onBlur={handleBlur}
      />
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    // Height driven by Layer 1 (display Text in normal flow)
  },
  input: {
    fontSize: FONT_SIZE,
    lineHeight: LINE_HEIGHT,
    paddingHorizontal: PADDING_HORIZONTAL,
    paddingVertical: PADDING_VERTICAL,
  },
  hiddenInput: {
    // Covers the full container; opacity:0 makes it invisible yet interactive
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    opacity: 0,
  },
  displayText: {
    fontSize: FONT_SIZE,
    lineHeight: LINE_HEIGHT,
    paddingHorizontal: PADDING_HORIZONTAL,
    paddingVertical: PADDING_VERTICAL,
  },
  substitutionText: {
    fontStyle: 'italic',
    opacity: 0.6,
  },
  cursor: {
    fontSize: FONT_SIZE,
    lineHeight: LINE_HEIGHT,
    fontWeight: '100',
  },
});

export { EmojiActionInput };
export default EmojiActionInput;
