import React from 'react';
import { View, ViewProps, StyleSheet } from 'react-native';
import { useAppTheme } from '../../contexts/ThemeContext';

interface ThemedViewProps extends ViewProps {
    variant?: 'base' | 'surface' | 'elevated';
}

export const ThemedView: React.FC<ThemedViewProps> = ({
    style,
    variant = 'base',
    ...props
}) => {
    const { theme } = useAppTheme();

    if (!theme) return <View style={style} {...props} />;

    const backgroundColor = theme.colors.background[variant];

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
