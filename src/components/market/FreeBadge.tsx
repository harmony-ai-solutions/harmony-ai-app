/**
 * FreeBadge — green pill shown on marketplace listings with price 0.
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useAppTheme } from '../../contexts/ThemeContext';

interface FreeBadgeProps {
  label?: string;
}

export const FreeBadge: React.FC<FreeBadgeProps> = ({ label = 'FREE' }) => {
  const { theme } = useAppTheme();
  if (!theme) return null;

  return (
    <View
      style={[
        styles.badge,
        { backgroundColor: 'rgba(46, 160, 67, 0.15)', borderColor: 'rgba(46, 160, 67, 0.6)' },
      ]}
    >
      <Text style={[styles.text, { color: '#2ea043' }]}>{label}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: 1,
    alignSelf: 'flex-start',
  },
  text: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
});