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
 * A glassmorphism Appbar header with accent-tinted gradient background,
 * matching the SoulBits Portal dock/header glass pattern.
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

    // Glass header: semi-transparent with accent tint border
    const glassBg = theme.colors.background.surface + 'CC'; // ~80% opacity
    const glassBorder = theme.colors.accent.primary + '1A'; // ~10% opacity

    return (
        <View style={[styles.wrapper, style]}>
            <LinearGradient
                colors={[theme.colors.background.elevated + 'E6', glassBg]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.gradient}
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
                {/* Bottom glass separator */}
                <View style={[styles.separator, { backgroundColor: glassBorder }]} />
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
