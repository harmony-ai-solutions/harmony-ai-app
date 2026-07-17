import React from 'react';
import { StyleSheet, View, ViewStyle } from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import { Appbar } from 'react-native-paper';
import { useAppTheme } from '../../contexts/ThemeContext';
import { hexToRgba } from '../../utils/colorUtils';

interface ThemedAppbarProps {
    /** Rendered inside the Appbar header (use Appbar.BackAction, Appbar.Content, etc.) */
    children: React.ReactNode;
    style?: ViewStyle;
}

/**
 * Glassmorphism Appbar header — Phase 2.
 *
 * Semi-transparent glass surface with a 1dp hairline gradient separator
 * at the bottom edge, mimicking light hitting the top-left edge of the glass.
 *
 * Usage:
 * ```tsx
 * <ThemedAppbar>
 *   <Appbar.BackAction onPress={() => navigation.goBack()} />
 *   <Appbar.Content title="My Screen" />
 * </ThemedAppbar>
 * ```
 */
export const ThemedAppbar: React.FC<ThemedAppbarProps> = ({ children, style }) => {
    const { theme } = useAppTheme();

    if (!theme) {
        return (
            <Appbar.Header style={style}>
                {children}
            </Appbar.Header>
        );
    }

    const { borderGradientStart, borderGradientEnd } = theme.colors.glass;
    const glassBg = hexToRgba(theme.colors.background.surface, theme.colors.glass.cardOpacity);

    return (
        <View style={[styles.wrapper, style]}>
            <LinearGradient
                colors={[
                    hexToRgba(theme.colors.background.elevated, 0.72),
                    glassBg,
                ]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.gradientBg}
            >
                {/* Subtle prismatic tint at the top edge */}
                <LinearGradient
                    colors={[theme.colors.accent.primary + '0F', 'transparent']}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 0.6, y: 1 }}
                    style={StyleSheet.absoluteFillObject}
                    pointerEvents="none"
                />
                <Appbar.Header style={styles.appbar}>
                    {children}
                </Appbar.Header>
                {/* 1dp gradient separator mimicking light hitting the glass edge */}
                <LinearGradient
                    colors={[borderGradientStart, borderGradientEnd]}
                    start={{ x: 0.2, y: 0 }}
                    end={{ x: 0.85, y: 0 }}
                    style={styles.separator}
                />
            </LinearGradient>
        </View>
    );
};

const styles = StyleSheet.create({
    wrapper: {
        overflow: 'hidden',
        elevation: 3,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.15,
        shadowRadius: 8,
    },
    gradientBg: {
        // Appbar.Header has its own height, we just wrap it
    },
    appbar: {
        backgroundColor: 'transparent',
        elevation: 0,
    },
    separator: {
        height: StyleSheet.hairlineWidth,
    },
});
