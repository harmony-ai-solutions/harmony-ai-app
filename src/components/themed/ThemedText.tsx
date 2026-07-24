import React from 'react';
import { Text, TextProps } from 'react-native';
import { useAppTheme } from '../../contexts/ThemeContext';

interface ThemedTextProps extends TextProps {
    variant?: 'primary' | 'secondary' | 'muted' | 'disabled' | 'accent' | 'success';
    weight?: 'normal' | 'medium' | 'bold';
    size?: number;
    /**
     * Typographic hierarchy for visual depth:
     *  - 'header'    — full-contrast white, 1.0 opacity
     *  - 'subtext'   — 70 % opacity for details / secondary info
     *  - 'caption'   — 50 % opacity for muted labels / captions
     *
     * When omitted, the opacity is driven by the `variant` prop
     * (primary = full, secondary ≈ 0.70, muted ≈ 0.50).
     */
    hierarchy?: 'header' | 'subtext' | 'caption';
}

/**
 * Typography hierarchy — Phase 2.
 *
 * High-contrast white for headers combined with 70 % opacity sub-text
 * and 50 % opacity captions, creating visual depth and readability.
 */
export const ThemedText: React.FC<ThemedTextProps> = ({
    style,
    variant = 'primary',
    weight = 'normal',
    size,
    hierarchy,
    ...props
}) => {
    const { theme } = useAppTheme();

    if (!theme) return <Text style={style} {...props} />;

    // ── Color ────────────────────────────────────────────────────────────────
    let color = theme.colors.text[variant as keyof typeof theme.colors.text]
        || theme.colors.text.primary;

    if (variant === 'accent') {
        color = theme.colors.accent.primary;
    } else if (variant === 'success') {
        color = theme.colors.status.success;
    }

    // ── Opacity from typographic hierarchy ───────────────────────────────────
    let opacity: number | undefined;

    if (hierarchy === 'header') {
        opacity = theme.colors.typography.headerOpacity;           // 1.0
    } else if (hierarchy === 'subtext') {
        opacity = theme.colors.typography.subtextOpacity;          // 0.70
    } else if (hierarchy === 'caption') {
        opacity = theme.colors.typography.captionOpacity;          // 0.50
    } else if (variant === 'secondary') {
        opacity = theme.colors.typography.subtextOpacity;          // 0.70
    } else if (variant === 'muted') {
        opacity = theme.colors.typography.captionOpacity;          // 0.50
    }

    // ── Font weight ─────────────────────────────────────────────────────────
    const fontWeight =
        weight === 'bold' ? '700' :
        weight === 'medium' ? '500' : '400';

    return (
        <Text
            style={[
                { color, fontWeight, fontSize: size, opacity },
                style,
            ]}
            {...props}
        />
    );
};
