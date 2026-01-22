/**
 * Database Loading Screen
 * 
 * Displays during database initialization with error handling
 */

import React from 'react';
import {View, StyleSheet, ActivityIndicator} from 'react-native';
import {Text, Button} from 'react-native-paper';
import {useDatabase} from '../../contexts/DatabaseContext';
import {useAppTheme} from '../../contexts/ThemeContext';

/**
 * Database Loading Screen Component
 */
export function DatabaseLoadingScreen() {
  const {isLoading, error, retryInitialization} = useDatabase();
  const {theme} = useAppTheme();

  // Error state
  if (error) {
    return (
      <View style={[styles.container, {backgroundColor: theme?.colors.background.base || '#000'}]}>
        <View style={styles.content}>
          <Text style={[styles.title, {color: theme?.colors.status.error || '#ff5252'}]}>
            Database Error
          </Text>
          <Text style={[styles.message, {color: theme?.colors.text.primary || '#fff'}]}>
            Failed to initialize the database. This may be due to:
          </Text>
          <View style={styles.errorList}>
            <Text style={[styles.errorItem, {color: theme?.colors.text.secondary || '#ccc'}]}>
              • Insufficient storage space
            </Text>
            <Text style={[styles.errorItem, {color: theme?.colors.text.secondary || '#ccc'}]}>
              • Database file corruption
            </Text>
            <Text style={[styles.errorItem, {color: theme?.colors.text.secondary || '#ccc'}]}>
              • Permission issues
            </Text>
          </View>
          <Text style={[styles.errorDetails, {color: theme?.colors.text.secondary || '#ccc'}]}>
            Error: {error}
          </Text>
          <Button
            mode="contained"
            onPress={retryInitialization}
            style={styles.retryButton}
            buttonColor={theme?.colors.accent.primary || '#8e24aa'}>
            Retry Initialization
          </Button>
        </View>
      </View>
    );
  }

  // Loading state
  return (
    <View style={[styles.container, {backgroundColor: theme?.colors.background.base || '#000'}]}>
      <View style={styles.content}>
        <ActivityIndicator
          size="large"
          color={theme?.colors.accent.primary || '#8e24aa'}
          style={styles.spinner}
        />
        <Text style={[styles.title, {color: theme?.colors.text.primary || '#fff'}]}>
          Initializing Database
        </Text>
        <Text style={[styles.message, {color: theme?.colors.text.secondary || '#ccc'}]}>
          Setting up encrypted storage...
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  content: {
    alignItems: 'center',
    maxWidth: 400,
  },
  spinner: {
    marginBottom: 20,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 12,
    textAlign: 'center',
  },
  message: {
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 20,
  },
  errorList: {
    marginVertical: 16,
    alignSelf: 'stretch',
  },
  errorItem: {
    fontSize: 14,
    marginVertical: 4,
  },
  errorDetails: {
    fontSize: 12,
    fontFamily: 'monospace',
    marginVertical: 16,
    padding: 12,
    borderRadius: 4,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    alignSelf: 'stretch',
  },
  retryButton: {
    marginTop: 20,
    minWidth: 200,
  },
});
