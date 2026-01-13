import React from 'react';
import { View, StyleSheet, ViewProps } from 'react-native';
import { useAppTheme } from '../../contexts/ThemeContext';

interface ThemedCardProps extends ViewProps {
    elevated?: boolean;
}

export const ThemedCard: React.FC<ThemedCardProps> = ({
    children,
    style,
    elevated = false,
    ...props
}) => {
    const { theme } = useAppTheme();

    if (!theme) return <View style={style} {...props}>{children}</View>;

    return (
        <View
            style={[
                styles.card,
                {
                    backgroundColor: elevated
                        ? theme.colors.background.elevated
                        : theme.colors.background.surface,
                    borderColor: theme.colors.border.default,
                },
                style,
            ]}
            {...props}
        >
            {children}
        </View>
    );
};

const styles = StyleSheet.create({
    card: {
        borderRadius: 12,
        borderWidth: 1,
        padding: 16,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
        elevation: 2,
    },
});
