import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useAppTheme } from '../contexts/ThemeContext';
import { ChatListScreen } from '../screens/ChatListScreen';
import { CharactersScreen } from '../screens/CharactersScreen';
import { AIConfigScreen } from '../screens/AIConfigScreen';

export type BottomTabParamList = {
    Chat: undefined;
    Characters: undefined;
    AIConfig: undefined;
};

const Tab = createBottomTabNavigator<BottomTabParamList>();

export const BottomNavigator: React.FC = () => {
    const { theme } = useAppTheme();

    if (!theme) {
        return null; // Or loading screen
    }

    return (
        <Tab.Navigator
            screenOptions={{
                headerShown: false,
                tabBarStyle: {
                    backgroundColor: theme.colors.background.surface,
                    borderTopColor: theme.colors.border.default,
                    borderTopWidth: 1,
                    height: 60,
                    paddingBottom: 8,
                    paddingTop: 8,
                },
                tabBarActiveTintColor: theme.colors.accent.primary,
                tabBarInactiveTintColor: theme.colors.text.muted,
                tabBarLabelStyle: {
                    fontSize: 12,
                    fontWeight: '600',
                },
            }}
        >
            <Tab.Screen
                name="Chat"
                component={ChatListScreen}
                options={{
                    tabBarIcon: ({ color, size }) => (
                        <Icon name="message-text" size={size} color={color} />
                    ),
                }}
            />
            <Tab.Screen
                name="Characters"
                component={CharactersScreen}
                options={{
                    tabBarIcon: ({ color, size }) => (
                        <Icon name="robot" size={size} color={color} />
                    ),
                }}
            />
            <Tab.Screen
                name="AIConfig"
                component={AIConfigScreen}
                options={{
                    tabBarLabel: 'AI Config',
                    tabBarIcon: ({ color, size }) => (
                        <Icon name="cog" size={size} color={color} />
                    ),
                }}
            />
        </Tab.Navigator>
    );
};
