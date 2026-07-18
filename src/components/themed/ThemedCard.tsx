import React from 'react';
import { View, StyleSheet, ViewProps, Platform } from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import { useAppTheme } from '../../contexts/ThemeContext';

interface ThemedCardProps extends ViewProps {
    elevated?: boolean;
    /** Render a 3 px left-edge gradient stripe (accent primary → secondary). */
    accentStripe?: boolean;
    /** Overlay a subtle prismatic tint (accent primary at ~10 % opacity) from top-left. */
    accentTint?: boolean;
}

/**
 * Solid card — gradient hairline border with opaque fill.
 *
 * Design rules:
 *  - 1dp hairline gradient border (white → accent tone).
 *  - Card body uses a solid opaque background (no transparency, no glass bleed).
 *  - Ambient colored glow shadow for depth.
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

    // ── Solid card fill — raw hex, no alpha ──────────────────────────────
    const bgHex = elevated
        ? theme.colors.background.elevated
        : theme.colors.background.surface;

    // ── Vivid hairline gradient border ────────────────────────────────────
    const { borderGradientStart, borderGradientEnd } = theme.colors.glass;

    // ── Ambient glow shadow colour ────────────────────────────────────────
    const glowColor = theme.colors.accent.primary;

    return (
        <View
            style={[
                styles.ambientGlow,
                { shadowColor: glowColor },
                style,
            ]}
            {...props}
        >
            <LinearGradient
                colors={[borderGradientStart, borderGradientEnd]}
                start={{ x: 0.15, y: 0 }}
                end={{ x: 0.85, y: 1 }}
                style={styles.borderOuter}
            >
                {/* Solid card surface — opaque background, no glass transparency */}
                <View style={[styles.cardInner, { backgroundColor: bgHex }]}>
                    {/* Prismatic accent tint — top-left corner bleed */}
                    {accentTint && (
                        <LinearGradient
                            colors={[
                                theme.colors.accent.primary + '1A',
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
                </View>
            </LinearGradient>
        </View>
    );
};

const styles = StyleSheet.create({
    ambientGlow: {
        // Magenta ambient drop shadow — card "levitates and radiates energy"
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.18,
        shadowRadius: 20,
        elevation: 8,
    },
    borderOuter: {
        borderRadius: 16,
        // 1dp hairline = padding simulates the gradient border thickness
        padding: StyleSheet.hairlineWidth,
    },
    cardInner: {
        borderRadius: 15,
        overflow: 'hidden',
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
