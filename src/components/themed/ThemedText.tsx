import React from 'react';
import { Text, TextProps, StyleSheet } from 'react-native';
import { useAppTheme } from '../../contexts/ThemeContext';

interface ThemedTextProps extends TextProps {
    variant?: 'primary' | 'secondary' | 'muted' | 'disabled' | 'accent' | 'success';
    weight?: 'normal' | 'medium' | 'bold';
    size?: number;
}

export const ThemedText: React.FC<ThemedTextProps> = ({
    style,
    variant = 'primary',
    weight = 'normal',
    size,
    ...props
}) => {
    const { theme } = useAppTheme();

    if (!theme) return <Text style={style} {...props} />;

    let color = theme.colors.text[variant as keyof typeof theme.colors.text] || theme.colors.text.primary;

    if (variant === 'accent') {
        color = theme.colors.accent.primary;
    } else if (variant === 'success') {
        color = theme.colors.status.success;
    }

    const fontWeight =
        weight === 'bold' ? '700' :
            weight === 'medium' ? '500' : '400';

    return (
        <Text
            style={[
                { color, fontWeight, fontSize: size },
                style,
            ]}
            {...props}
        />
    );
};
