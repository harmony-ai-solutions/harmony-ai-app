import React from 'react';
import { View, StyleSheet, ViewProps } from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import { useAppTheme } from '../../contexts/ThemeContext';

interface ThemedCardProps extends ViewProps {
    elevated?: boolean;
    /** Render a 3 px left-edge gradient stripe (accent primary → secondary). */
    accentStripe?: boolean;
    /** Overlay a subtle prismatic tint (accent primary at ~8 % opacity) from top-left. */
    accentTint?: boolean;
}

/**
 * Glassmorphism card component.
 * Renders a translucent, glass-like surface with accent-tinted borders
 * and soft glow shadows. Uses the current theme's colors for the glass effect.
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

    // Glass background: semi-transparent surface/elevated
    const glassBgStart = elevated
        ? theme.colors.background.elevated + 'D9'  // ~85% opacity
        : theme.colors.background.surface + 'B3';   // ~70% opacity
    const glassBgEnd = elevated
        ? theme.colors.background.surface + '99'    // ~60% opacity
        : theme.colors.background.base + '73';       // ~45% opacity

    // Glass border: accent-tinted translucent
    const glassBorder = theme.colors.accent.primary + '21'; // ~13% opacity

    // Glow shadow: accent-colored soft glow
    const glowColor = theme.colors.accent.primary;

    return (
        <LinearGradient
            colors={[glassBgStart, glassBgEnd]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={[styles.card, { borderColor: glassBorder, shadowColor: glowColor }, style]}
            {...props}
        >
            {/* Prismatic accent tint overlay — top-left bleed */}
            {accentTint && (
                <LinearGradient
                    colors={[theme.colors.accent.primary + '14', 'transparent']}
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
                    style={styles.accentStripe}
                    pointerEvents="none"
                />
            )}
        </LinearGradient>
    );
};

const styles = StyleSheet.create({
    card: {
        borderRadius: 16,
        borderWidth: 1,
        padding: 16,
        overflow: 'hidden',
        // Soft shadow with accent glow
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.15,
        shadowRadius: 16,
        elevation: 4,
    },
    accentStripe: {
        position: 'absolute',
        left: 0,
        top: 0,
        bottom: 0,
        width: 3,
        borderTopLeftRadius: 16,
        borderBottomLeftRadius: 16,
    },
});
