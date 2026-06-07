import React from 'react';
import { StyleSheet, View, ViewStyle } from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import { Appbar } from 'react-native-paper';
import { useAppTheme } from '../../contexts/ThemeContext';

interface ThemedAppbarProps {
    /** Rendered inside the Appbar header (use Appbar.BackAction, Appbar.Content, etc.) */
    children: React.ReactNode;
    style?: ViewStyle;
}

/**
 * A wrapper around React Native Paper's `Appbar.Header` that applies a
 * horizontal elevated→surface gradient background, matching the Harmony Link
 * desktop app header chrome pattern.
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

    return (
        <View style={[styles.wrapper, style]}>
            <LinearGradient
                colors={[theme.colors.background.elevated, theme.colors.background.surface]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.gradient}
            >
                {/* Subtle prismatic tint at the top edge */}
                <LinearGradient
                    colors={[theme.colors.accent.primary + '12', 'transparent']}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 0.6, y: 1 }}
                    style={StyleSheet.absoluteFillObject}
                    pointerEvents="none"
                />
                <Appbar.Header style={styles.appbar}>
                    {children}
                </Appbar.Header>
                {/* Bottom separator */}
                <View style={[styles.separator, { backgroundColor: 'rgba(255,255,255,0.07)' }]} />
            </LinearGradient>
        </View>
    );
};

const styles = StyleSheet.create({
    wrapper: {
        overflow: 'hidden',
        elevation: 4,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.2,
        shadowRadius: 6,
    },
    gradient: {
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
