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
 * A styled section header bar that mirrors the Harmony Link
 * `character-editor-section-header` pattern:
 *  - Gradient background fading left (elevated) to transparent
 *  - Uppercase, letter-spaced muted label
 *  - Optional 4 px left accent pip
 *  - Optional right slot for icons / actions
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
        <LinearGradient
            colors={[theme.colors.background.elevated, 'transparent']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={[styles.container, style]}
        >
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
                style={[styles.label, right ? styles.labelFlex : undefined]}
            >
                {title.toUpperCase()}
            </ThemedText>
            {right && <View style={styles.rightSlot}>{right}</View>}
        </LinearGradient>
    );
};

const styles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 8,
        paddingHorizontal: 16,
        gap: 10,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: 'rgba(255,255,255,0.07)',
    },
    pip: {
        width: 4,
        height: 16,
        borderRadius: 2,
        flexShrink: 0,
    },
    label: {
        fontSize: 11,
        letterSpacing: 0.8,
    },
    labelFlex: {
        flex: 1,
    },
    rightSlot: {
        marginLeft: 4,
    },
});
