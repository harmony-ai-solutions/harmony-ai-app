import React from 'react';
import { View, StyleSheet, ViewStyle } from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import { useAppTheme } from '../../contexts/ThemeContext';
import { ThemedText } from './ThemedText';

interface SectionHeaderProps {
    title: string;
    /** Show a small accent-colored left pip/indicator. Default: true */
    accentPip?: boolean;
    style?: ViewStyle;
    /** Optional right-side element (e.g. a chevron icon) */
    right?: React.ReactNode;
}

/**
 * Glassmorphism section header — Phase 2.
 *
 * Gradient background fading from elevated to transparent (left→right),
 * with a 1dp hairline gradient separator at the bottom and an optional
 * 3px left accent pip.
 */
export const SectionHeader: React.FC<SectionHeaderProps> = ({
    title,
    accentPip = true,
    style,
    right,
}) => {
    const { theme } = useAppTheme();

    if (!theme) return null;

    return (
        <View style={[styles.container, style]}>
            {accentPip && (
                <LinearGradient
                    colors={[theme.colors.accent.primary, theme.colors.accent.secondary]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 0, y: 1 }}
                    style={styles.pip}
                />
            )}
            <ThemedText
                variant="muted"
                weight="bold"
                hierarchy="caption"
                style={[styles.label, right ? styles.labelFlex : undefined]}
            >
                {title.toUpperCase()}
            </ThemedText>
            {right && <View style={styles.rightSlot}>{right}</View>}
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 10,
        paddingHorizontal: 16,
        gap: 10,
    },
    pip: {
        width: 3,
        height: 18,
        borderRadius: 99,
        flexShrink: 0,
    },
    label: {
        fontSize: 11,
        letterSpacing: 1.0,
    },
    labelFlex: {
        flex: 1,
    },
    rightSlot: {
        marginLeft: 4,
    },
    separator: {
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        height: StyleSheet.hairlineWidth,
    },
});
