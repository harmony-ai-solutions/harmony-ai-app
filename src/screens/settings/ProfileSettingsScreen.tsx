import React from 'react';
import { StyleSheet } from 'react-native';
import { useAppTheme } from '../../contexts/ThemeContext';
import { ThemedView } from '../../components/themed/ThemedView';
import { ThemedText } from '../../components/themed/ThemedText';

export const ProfileSettingsScreen: React.FC = () => {
    const { theme } = useAppTheme();
    if (!theme) return null;
    return (
        <ThemedView style={styles.container}>
            <ThemedText>Profile Settings (Coming Soon)</ThemedText>
        </ThemedView>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
});
