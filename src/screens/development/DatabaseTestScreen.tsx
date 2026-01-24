/**
 * Database Test Runner Screen (DEV ONLY)
 * 
 * Provides an in-app interface to run database repository tests
 * Only available in development builds (__DEV__ === true)
 */

import React, { useState, useRef, useEffect } from 'react';
import {
    View,
    Text,
    ScrollView,
    TouchableOpacity,
    StyleSheet,
    ActivityIndicator,
    Alert,
} from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useAppTheme } from '../../contexts/ThemeContext';
import runAllTests from '../../database/test-runner';
import { createLogger } from '../../utils/logger';

const log = createLogger('[DatabaseTestScreen]');

interface ConsoleMessage {
    text: string;
    type: 'log' | 'error' | 'success' | 'warning';
}

export const DatabaseTestScreen: React.FC = () => {
    const { theme } = useAppTheme();
    const [isRunning, setIsRunning] = useState(false);
    const [consoleOutput, setConsoleOutput] = useState<ConsoleMessage[]>([]);
    const [testsPassed, setTestsPassed] = useState<boolean | null>(null);
    const scrollViewRef = useRef<ScrollView>(null);

    // Auto-scroll to bottom when new console messages arrive
    useEffect(() => {
        if (scrollViewRef.current) {
            scrollViewRef.current.scrollToEnd({ animated: true });
        }
    }, [consoleOutput]);

    const addConsoleMessage = (text: string, type: ConsoleMessage['type'] = 'log') => {
        setConsoleOutput(prev => [...prev, { text, type }]);
    };

    const runTests = async () => {
        if (isRunning) return;

        setIsRunning(true);
        setConsoleOutput([]);
        setTestsPassed(null);

        // Override console methods to capture output
        const originalLog = console.log;
        const originalError = console.error;
        const originalWarn = console.warn;

        console.log = (...args: any[]) => {
            const message = args.map(arg => 
                typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
            ).join(' ');
            
            // Determine message type based on content
            let type: ConsoleMessage['type'] = 'log';
            if (message.includes('✅') || message.includes('PASSED')) {
                type = 'success';
            } else if (message.includes('❌') || message.includes('FAILED')) {
                type = 'error';
            } else if (message.includes('⚠️')) {
                type = 'warning';
            }
            
            addConsoleMessage(message, type);
            log.info(message);
        };

        console.error = (...args: any[]) => {
            const message = args.map(arg => 
                typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
            ).join(' ');
            addConsoleMessage(message, 'error');
            log.error(message);
        };

        console.warn = (...args: any[]) => {
            const message = args.map(arg => 
                typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
            ).join(' ');
            addConsoleMessage(message, 'warning');
            log.warn(message);
        };

        try {
            addConsoleMessage('Starting database tests...', 'log');
            const success = await runAllTests().catch((error) => {
                addConsoleMessage(`\n❌ Unhandled promise rejection: ${error}`, 'error');
                return false;
            });
            setTestsPassed(success);
            
            if (success) {
                addConsoleMessage('\n🎉 All tests completed successfully!', 'success');
            } else {
                addConsoleMessage('\n⚠️ Some tests failed. Review output above.', 'error');
            }
        } catch (error) {
            addConsoleMessage(`\n❌ Fatal error: ${error}`, 'error');
            setTestsPassed(false);
        } finally {
            // Restore original console methods
            console.log = originalLog;
            console.error = originalError;
            console.warn = originalWarn;
            setIsRunning(false);
        }
    };

    const clearOutput = () => {
        setConsoleOutput([]);
        setTestsPassed(null);
    };

    const copyToClipboard = () => {
        if (consoleOutput.length === 0) return;
        
        const fullOutput = consoleOutput.map(m => m.text).join('\n');
        Clipboard.setString(fullOutput);
        Alert.alert('Copied', 'Test output has been copied to clipboard.');
    };

    const getMessageColor = (type: ConsoleMessage['type']) => {
        switch (type) {
            case 'error':
                return theme?.colors.status.error || '#ff4444';
            case 'success':
                return theme?.colors.status.success || '#00cc66';
            case 'warning':
                return theme?.colors.status.warning || '#ffaa00';
            default:
                return theme?.colors.text.primary || '#ffffff';
        }
    };

    if (!theme) return null;

    return (
        <View style={[styles.container, { backgroundColor: theme.colors.background.base }]}>
            {/* Header */}
            <View style={[styles.header, { backgroundColor: theme.colors.background.surface }]}>
                <View style={styles.headerContent}>
                    <Icon name="test-tube" size={28} color={theme.colors.accent.primary} />
                    <View style={styles.headerText}>
                        <Text style={[styles.title, { color: theme.colors.text.primary }]}>
                            Database Tests
                        </Text>
                        <Text style={[styles.subtitle, { color: theme.colors.text.secondary }]}>
                            Development Environment Only
                        </Text>
                    </View>
                </View>
                
                {testsPassed !== null && (
                    <View style={[
                        styles.statusBadge,
                        { backgroundColor: testsPassed ? theme.colors.status.success : theme.colors.status.error }
                    ]}>
                        <Icon 
                            name={testsPassed ? "check-circle" : "alert-circle"} 
                            size={16} 
                            color="#ffffff" 
                        />
                        <Text style={styles.statusText}>
                            {testsPassed ? 'PASSED' : 'FAILED'}
                        </Text>
                    </View>
                )}
            </View>

            {/* Console Output */}
            <View style={[styles.consoleContainer, { backgroundColor: theme.colors.background.elevated }]}>
                <View style={styles.consoleHeader}>
                    <Icon name="console" size={18} color={theme.colors.text.muted} />
                    <Text style={[styles.consoleTitle, { color: theme.colors.text.muted }]}>
                        Test Output
                    </Text>
                </View>
                
                <ScrollView
                    ref={scrollViewRef}
                    style={styles.consoleScroll}
                    contentContainerStyle={styles.consoleContent}
                >
                    {consoleOutput.length === 0 ? (
                        <Text style={[styles.consoleEmpty, { color: theme.colors.text.muted }]}>
                            No output yet. Press "Run Tests" to start.
                        </Text>
                    ) : (
                        consoleOutput.map((message, index) => (
                            <Text
                                key={index}
                                style={[
                                    styles.consoleMessage,
                                    { color: getMessageColor(message.type) }
                                ]}
                            >
                                {message.text}
                            </Text>
                        ))
                    )}
                </ScrollView>
            </View>

            {/* Action Buttons */}
            <View style={styles.actions}>
                <TouchableOpacity
                    style={[
                        styles.actionButton,
                        styles.runButton,
                        { backgroundColor: theme.colors.accent.primary },
                        isRunning && styles.buttonDisabled
                    ]}
                    onPress={runTests}
                    disabled={isRunning}
                >
                    {isRunning ? (
                        <>
                            <ActivityIndicator color="#ffffff" size="small" />
                            <Text style={styles.buttonText}>Running Tests...</Text>
                        </>
                    ) : (
                        <>
                            <Icon name="play-circle" size={20} color="#ffffff" />
                            <Text style={styles.buttonText}>Run All Tests</Text>
                        </>
                    )}
                </TouchableOpacity>

                <TouchableOpacity
                    style={[
                        styles.actionButton,
                        styles.copyButton,
                        { backgroundColor: theme.colors.background.surface },
                        (isRunning || consoleOutput.length === 0) && styles.buttonDisabled
                    ]}
                    onPress={copyToClipboard}
                    disabled={isRunning || consoleOutput.length === 0}
                >
                    <Icon name="content-copy" size={20} color={theme.colors.text.primary} />
                    <Text style={[styles.buttonText, { color: theme.colors.text.primary }]}>
                        Copy
                    </Text>
                </TouchableOpacity>

                <TouchableOpacity
                    style={[
                        styles.actionButton,
                        styles.clearButton,
                        { backgroundColor: theme.colors.background.surface },
                        isRunning && styles.buttonDisabled
                    ]}
                    onPress={clearOutput}
                    disabled={isRunning}
                >
                    <Icon name="broom" size={20} color={theme.colors.text.primary} />
                    <Text style={[styles.buttonText, { color: theme.colors.text.primary }]}>
                        Clear
                    </Text>
                </TouchableOpacity>
            </View>

            {/* Info Banner */}
            <View style={[styles.infoBanner, { backgroundColor: theme.colors.background.surface }]}>
                <Icon name="information" size={16} color={theme.colors.accent.primary} />
                <Text style={[styles.infoText, { color: theme.colors.text.secondary }]}>
                    This screen is only visible in development builds
                </Text>
            </View>
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    header: {
        padding: 20,
        paddingTop: 60,
        borderBottomWidth: 1,
        borderBottomColor: 'rgba(255, 255, 255, 0.1)',
    },
    headerContent: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    headerText: {
        marginLeft: 12,
        flex: 1,
    },
    title: {
        fontSize: 24,
        fontWeight: 'bold',
    },
    subtitle: {
        fontSize: 14,
        marginTop: 4,
    },
    statusBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 16,
        marginTop: 12,
        alignSelf: 'flex-start',
    },
    statusText: {
        color: '#ffffff',
        fontSize: 12,
        fontWeight: 'bold',
        marginLeft: 6,
    },
    consoleContainer: {
        flex: 1,
        margin: 16,
        borderRadius: 12,
        overflow: 'hidden',
    },
    consoleHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 12,
        borderBottomWidth: 1,
        borderBottomColor: 'rgba(255, 255, 255, 0.1)',
    },
    consoleTitle: {
        fontSize: 14,
        fontWeight: '600',
        marginLeft: 8,
        textTransform: 'uppercase',
        letterSpacing: 0.5,
    },
    consoleScroll: {
        flex: 1,
    },
    consoleContent: {
        padding: 12,
    },
    consoleEmpty: {
        textAlign: 'center',
        fontStyle: 'italic',
        marginTop: 20,
    },
    consoleMessage: {
        fontFamily: 'monospace',
        fontSize: 12,
        lineHeight: 18,
        marginBottom: 2,
    },
    actions: {
        flexDirection: 'row',
        padding: 16,
        gap: 12,
    },
    actionButton: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 14,
        borderRadius: 12,
        gap: 8,
    },
    runButton: {
        flex: 2,
    },
    copyButton: {
        flex: 1,
    },
    clearButton: {
        flex: 1,
    },
    buttonDisabled: {
        opacity: 0.5,
    },
    buttonText: {
        color: '#ffffff',
        fontSize: 16,
        fontWeight: '600',
    },
    infoBanner: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 12,
        gap: 8,
    },
    infoText: {
        fontSize: 12,
    },
});
