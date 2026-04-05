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

    const gradientStart = elevated
        ? theme.colors.background.elevated
        : theme.colors.background.surface;
    // For non-elevated: surface → base; for elevated: elevated → surface
    const gradientEnd = elevated
        ? theme.colors.background.surface
        : theme.colors.background.base;

    return (
        <LinearGradient
            colors={[gradientStart, gradientEnd]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={[styles.card, style]}
            {...props}
        >
            {/* Prismatic accent tint overlay — top-left bleed, renders behind content */}
            {accentTint && (
                <LinearGradient
                    colors={[theme.colors.accent.primary + '17', 'transparent']}
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
        borderRadius: 12,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.06)',
        padding: 16,
        overflow: 'hidden',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.22,
        shadowRadius: 10,
        elevation: 4,
    },
    accentStripe: {
        position: 'absolute',
        left: 0,
        top: 0,
        bottom: 0,
        width: 3,
        borderTopLeftRadius: 12,
        borderBottomLeftRadius: 12,
    },
});
