import React from 'react';
import { View, StyleSheet, ViewProps } from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import { useAppTheme } from '../../contexts/ThemeContext';
import { hexToRgba } from '../../utils/colorUtils';

interface ThemedCardProps extends ViewProps {
    elevated?: boolean;
    /** Render a 3 px left-edge gradient stripe (accent primary → secondary). */
    accentStripe?: boolean;
    /** Overlay a subtle prismatic tint (accent primary at ~8 % opacity) from top-left. */
    accentTint?: boolean;
}

/**
 * Glassmorphism card — Phase 2 "SoulBits Look".
 *
 * Design rules:
 *  - Single-layer glass element with 1dp hairline gradient border
 *    (transparent-white → transparent-accent), no nested dark borders.
 *  - Card background at 30–40 % opacity over the deep base colour,
 *    producing a high-intensity frosted-glass bleed-through.
 *  - Optional left accent stripe and prismatic accent-tint overlay.
 */
export const ThemedCard: React.FC<ThemedCardProps> = ({
    children,
    style,
    elevated = false,
    accentStripe = false,
    accentTint = false,
    ...props
}) => {
    const { theme } = useAppTheme();

    if (!theme) return <View style={style} {...props}>{children}</View>;

    // ── Glass material ──────────────────────────────────────────────────────
    const bgHex = elevated
        ? theme.colors.background.elevated
        : theme.colors.background.surface;
    const glassOpacity = theme.colors.glass.cardOpacity;
    const glassBgStart = hexToRgba(bgHex, glassOpacity);
    const glassBgEnd = hexToRgba(bgHex, glassOpacity * 0.55);

    // ── Hairline gradient border ────────────────────────────────────────────
    const { borderGradientStart, borderGradientEnd } = theme.colors.glass;

    return (
        <LinearGradient
            colors={[borderGradientStart, borderGradientEnd]}
            start={{ x: 0.2, y: 0 }}
            end={{ x: 0.85, y: 1 }}
            style={[styles.borderOuter, style]}
            {...props}
        >
            {/* Single glass-material surface — no inner border, no shadow */}
            <LinearGradient
                colors={[glassBgStart, glassBgEnd]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.glassInner}
            >
                {/* Prismatic accent tint — top-left corner bleed */}
                {accentTint && (
                    <LinearGradient
                        colors={[
                            theme.colors.accent.primary + '14',
                            'transparent',
                        ]}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 1 }}
                        style={StyleSheet.absoluteFillObject}
                        pointerEvents="none"
                    />
                )}

                {children}

                {/* Left accent stripe — rendered after children so it stays on top */}
                {accentStripe && (
                    <LinearGradient
                        colors={[theme.colors.accent.primary, theme.colors.accent.secondary]}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 0, y: 1 }}
                        style={styles.accentStripeBar}
                        pointerEvents="none"
                    />
                )}
            </LinearGradient>
        </LinearGradient>
    );
};

const styles = StyleSheet.create({
    borderOuter: {
        borderRadius: 16,
        // 1dp hairline = padding simulates the gradient border thickness
        padding: StyleSheet.hairlineWidth,
    },
    glassInner: {
        borderRadius: 15,
        overflow: 'hidden',
        // Flat single-layer: no inner shadow — clean, modern glass surface
        padding: 16,
    },
    accentStripeBar: {
        position: 'absolute',
        left: 0,
        top: 0,
        bottom: 0,
        width: 3,
        borderTopLeftRadius: 15,
        borderBottomLeftRadius: 15,
    },
});
