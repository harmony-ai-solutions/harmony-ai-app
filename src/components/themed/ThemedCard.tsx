import React from 'react';
import { View, StyleSheet, ViewProps } from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import { useAppTheme } from '../../contexts/ThemeContext';
import { hexToRgba } from '../../utils/colorUtils';

interface ThemedCardProps extends ViewProps {
    elevated?: boolean;
    /** Render a 3 px left-edge gradient stripe (accent primary → secondary). */
    accentStripe?: boolean;
    /** Overlay a subtle prismatic tint (accent primary at ~10 % opacity) from top-left. */
    accentTint?: boolean;
}

/**
 * Obsidian Glass Card — Dark, High-Contrast, Premium Glassmorphism.
 *
 * Anatomy (outside → in):
 *   1. Ambient colored shadow — accent color at very low opacity,
 *      soft halo that makes the card float above the aurora background.
 *   2. Razor-thin 1dp gradient border — top-left white/silver at low
 *      opacity catches the light; bottom-right fades into faint
 *      translucent indigo/purple. No thick outlines, no solid magenta.
 *   3. Deep dark glass body — rich gothic charcoal at ~45 % opacity,
 *      dark enough for crisp white text contrast while still letting
 *      the aurora/stardust background bleed through.
 *   4. Specular sweep — diagonal white light refraction at ~10 %
 *      opacity for the glass surface feel.
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

    const bgHex = elevated
        ? theme.colors.background.elevated
        : theme.colors.background.surface;

    // ── Deep dark glass body — 45 % opacity, rich charcoal base ──
    const glassFill = hexToRgba(bgHex, 0.45);

    // ── Ambient glow — accent color, very subtle ──
    const glowColor = theme.colors.accent.primary;

    // ── Hairline gradient border: silver top-left → faint indigo bottom-right ──
    const borderStart = 'rgba(255, 255, 255, 0.20)';
    const borderEnd = hexToRgba(theme.colors.accent.secondary, 0.10);

    return (
        <View
            style={[
                style,
                {
                    // Subtle ambient glow — low opacity, wide radius
                    shadowColor: glowColor,
                    shadowOffset: { width: 0, height: 4 },
                    shadowOpacity: 0.06,
                    shadowRadius: 16,
                    elevation: 6,
                },
            ]}
            {...props}
        >
            {/* ── 1dp hairline gradient border ── */}
            <LinearGradient
                colors={[borderStart, borderEnd]}
                start={{ x: 0.15, y: 0 }}
                end={{ x: 0.85, y: 1 }}
                style={styles.border}
            >
                {/* ── Deep dark glass body ── */}
                <View style={[styles.body, { backgroundColor: glassFill }]}>
                    {/* Specular sweep — faint diagonal light across the glass surface */}
                    <LinearGradient
                        colors={['rgba(255, 255, 255, 0.10)', 'transparent']}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 0.7, y: 1 }}
                        style={StyleSheet.absoluteFillObject}
                        pointerEvents="none"
                    />

                    {/* Prismatic accent tint (optional) */}
                    {accentTint && (
                        <LinearGradient
                            colors={[theme.colors.accent.primary + '10', 'transparent']}
                            start={{ x: 0, y: 0 }}
                            end={{ x: 1, y: 1 }}
                            style={StyleSheet.absoluteFillObject}
                            pointerEvents="none"
                        />
                    )}

                    {children}

                    {/* Accent stripe (optional) */}
                    {accentStripe && (
                        <LinearGradient
                            colors={[theme.colors.accent.primary, theme.colors.accent.secondary]}
                            start={{ x: 0, y: 0 }}
                            end={{ x: 0, y: 1 }}
                            style={styles.stripe}
                            pointerEvents="none"
                        />
                    )}
                </View>
            </LinearGradient>
        </View>
    );
};

const styles = StyleSheet.create({
    border: {
        borderRadius: 16,
        // Razor-thin 1dp hairline border
        padding: StyleSheet.hairlineWidth,
    },
    body: {
        borderRadius: 15,
        overflow: 'hidden',
        padding: 16,
    },
    stripe: {
        position: 'absolute',
        left: 0,
        top: 0,
        bottom: 0,
        width: 3,
        borderTopLeftRadius: 15,
        borderBottomLeftRadius: 15,
    },
});
