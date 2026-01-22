import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useAppTheme } from '../../contexts/ThemeContext';

export const ProfileSettingsScreen: React.FC = () => {
    const { theme } = useAppTheme();
    return (
        <View style={[styles.container, { backgroundColor: theme?.colors.background.base }]}>
            <Text style={{ color: theme?.colors.text.primary }}>Profile Settings (Coming Soon)</Text>
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
});
