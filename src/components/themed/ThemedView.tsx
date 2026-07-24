import React from 'react';
import { View, ViewProps, StyleSheet } from 'react-native';
import { useAppTheme } from '../../contexts/ThemeContext';
import { hexToRgba } from '../../utils/colorUtils';

interface ThemedViewProps extends ViewProps {
    variant?: 'base' | 'surface' | 'elevated';
}

/**
 * Opacity per variant for glassmorphism bleed-through.
 * base: 75% — lets 25% aurora through for vivid glass feel
 * base: 75% — lets 25% aurora through for vivid glass feel
 * surface: 85% — panels let 15% through for depth
 * elevated: 93% — cards stay mostly solid for text readability
 */
const VARIANT_OPACITY: Record<string, number> = {
    base: 0.75,
    surface: 0.85,
    elevated: 0.93,
};

export const ThemedView: React.FC<ThemedViewProps> = ({
    style,
    variant = 'base',
    ...props
}) => {
    const { theme } = useAppTheme();

    if (!theme) return <View style={style} {...props} />;

    const hexColor = theme.colors.background[variant];
    const alpha = VARIANT_OPACITY[variant] ?? 0.92;
    const backgroundColor = hexToRgba(hexColor, alpha);

    return (
        <View
            style={[
                { backgroundColor },
                style,
            ]}
            {...props}
        />
    );
};
