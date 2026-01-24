/**
 * Database Table Viewer Screen (DEV ONLY)
 * 
 * Provides an in-app interface to browse database tables and their contents
 * Only available in development builds (__DEV__ === true)
 */

import React, { useState, useEffect, useRef } from 'react';
import {
    View,
    Text,
    ScrollView,
    TouchableOpacity,
    StyleSheet,
    ActivityIndicator,
    Dimensions,
    Modal,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useAppTheme } from '../../contexts/ThemeContext';
import { executeRawQuery } from '../../database/connection';
import { createLogger } from '../../utils/logger';

const log = createLogger('[DatabaseTableViewer]');

interface TableInfo {
    name: string;
    rowCount: number;
}

interface ColumnInfo {
    name: string;
    type: string;
}

export const DatabaseTableViewerScreen: React.FC = () => {
    const { theme } = useAppTheme();
    const [tables, setTables] = useState<TableInfo[]>([]);
    const [selectedTable, setSelectedTable] = useState<string | null>(null);
    const [columns, setColumns] = useState<ColumnInfo[]>([]);
    const [rows, setRows] = useState<any[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [isPortrait, setIsPortrait] = useState(true);
    const [dropdownVisible, setDropdownVisible] = useState(false);
    const scrollViewRef = useRef<ScrollView>(null);

    // Check orientation on mount and window changes
    useEffect(() => {
        const updateOrientation = () => {
            const { width, height } = Dimensions.get('window');
            setIsPortrait(height > width);
        };
        
        updateOrientation();
        const subscription = Dimensions.addEventListener('change', updateOrientation);
        
        return () => {
            subscription?.remove();
        };
    }, []);

    // Load all tables on mount
    useEffect(() => {
        loadTables();
    }, []);

    // Load table data when selection changes
    useEffect(() => {
        if (selectedTable) {
            loadTableData(selectedTable);
        }
    }, [selectedTable]);

    const loadTables = async () => {
        setIsLoading(true);
        setError(null);
        
        try {
            // Get all user tables (exclude SQLite internal tables)
            const result = await executeRawQuery(
                "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
            );

            const tableList: TableInfo[] = [];
            
            // Get row count for each table
            for (let i = 0; i < result.rows.length; i++) {
                const tableName = result.rows.item(i).name;
                const countResult = await executeRawQuery(`SELECT COUNT(*) as count FROM ${tableName}`);
                const rowCount = countResult.rows.item(0).count;
                
                tableList.push({ name: tableName, rowCount });
            }

            setTables(tableList);
        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : 'Failed to load tables';
            setError(errorMessage);
            log.error('Error loading tables:', err);
        } finally {
            setIsLoading(false);
        }
    };

    const loadTableData = async (tableName: string) => {
        setIsLoading(true);
        setError(null);
        
        try {
            // Get table schema
            const schemaResult = await executeRawQuery(`PRAGMA table_info(${tableName})`);
            const columnList: ColumnInfo[] = [];
            
            for (let i = 0; i < schemaResult.rows.length; i++) {
                const row = schemaResult.rows.item(i);
                columnList.push({ name: row.name, type: row.type });
            }
            
            setColumns(columnList);

            // Get all rows from the table
            const dataResult = await executeRawQuery(`SELECT * FROM ${tableName}`);
            const rowList: any[] = [];
            
            for (let i = 0; i < dataResult.rows.length; i++) {
                const row = dataResult.rows.item(i);
                rowList.push(row);
            }
            
            setRows(rowList);
        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : 'Failed to load table data';
            setError(errorMessage);
            log.error('Error loading table data:', err);
        } finally {
            setIsLoading(false);
        }
    };

    const formatValue = (value: any, columnType: string): string => {
        if (value === null) {
            return 'NULL';
        }
        if (value === undefined) {
            return 'undefined';
        }
        if (columnType === 'BLOB') {
            if (value instanceof Uint8Array) {
                return `[BLOB: ${value.length} bytes]`;
            }
            return '[BLOB]';
        }
        if (typeof value === 'object') {
            try {
                return JSON.stringify(value);
            } catch {
                return '[Object]';
            }
        }
        return String(value);
    };

    const renderTableDropdown = () => {
        if (!theme) return null;

        return (
            <>
                <TouchableOpacity
                    style={[
                        styles.dropdownButton,
                        { 
                            backgroundColor: theme.colors.background.surface,
                            borderColor: 'rgba(255, 255, 255, 0.1)',
                        }
                    ]}
                    onPress={() => setDropdownVisible(true)}
                >
                    <Icon name="table" size={10} color={theme.colors.text.secondary} />
                    <Text style={[styles.dropdownButtonText, { color: theme.colors.text.primary }]}>
                        {selectedTable || 'Select Table'}
                    </Text>
                    <Icon name="chevron-down" size={10} color={theme.colors.text.secondary} />
                </TouchableOpacity>

                <Modal
                    visible={dropdownVisible}
                    transparent={true}
                    animationType="fade"
                    onRequestClose={() => setDropdownVisible(false)}
                >
                    <TouchableOpacity
                        style={styles.modalOverlay}
                        activeOpacity={1}
                        onPress={() => setDropdownVisible(false)}
                    >
                        <View style={[styles.dropdownModal, { backgroundColor: theme.colors.background.elevated }]}>
                            <View style={styles.dropdownHeader}>
                                <Text style={[styles.dropdownTitle, { color: theme.colors.text.primary }]}>
                                    Select Table
                                </Text>
                                <TouchableOpacity onPress={() => setDropdownVisible(false)}>
                                    <Icon name="close" size={12} color={theme.colors.text.secondary} />
                                </TouchableOpacity>
                            </View>
                            <ScrollView style={styles.dropdownList}>
                                {tables.map((table) => (
                                    <TouchableOpacity
                                        key={table.name}
                                        style={[
                                            styles.dropdownItem,
                                            { 
                                                backgroundColor: selectedTable === table.name 
                                                    ? theme.colors.accent.primary + '20'
                                                    : 'transparent',
                                            }
                                        ]}
                                        onPress={() => {
                                            setSelectedTable(table.name);
                                            setDropdownVisible(false);
                                        }}
                                    >
                                        <Icon 
                                            name="table" 
                                            size={10} 
                                            color={selectedTable === table.name 
                                                ? theme.colors.accent.primary 
                                                : theme.colors.text.secondary
                                            } 
                                        />
                                        <View style={styles.dropdownItemText}>
                                            <Text style={[
                                                styles.dropdownTableName,
                                                { color: theme.colors.text.primary }
                                            ]}>
                                                {table.name}
                                            </Text>
                                            <Text style={[
                                                styles.dropdownTableRowCount,
                                                { color: theme.colors.text.muted }
                                            ]}>
                                                {table.rowCount} rows
                                            </Text>
                                        </View>
                                        {selectedTable === table.name && (
                                            <Icon name="check" size={10} color={theme.colors.accent.primary} />
                                        )}
                                    </TouchableOpacity>
                                ))}
                            </ScrollView>
                        </View>
                    </TouchableOpacity>
                </Modal>
            </>
        );
    };

    const renderTableList = () => {
        if (!theme) return null;
        
        return (
            <View style={styles.tableList}>
                <Text style={[styles.sectionTitle, { color: theme.colors.text.muted }]}>
                    DATABASE TABLES ({tables.length})
                </Text>
                <ScrollView style={styles.tableScroll}>
                    {tables.map((table) => (
                        <TouchableOpacity
                            key={table.name}
                            style={[
                                styles.tableItem,
                                { 
                                    backgroundColor: selectedTable === table.name 
                                        ? theme.colors.accent.primary + '20'
                                        : theme.colors.background.surface,
                                    borderColor: selectedTable === table.name
                                        ? theme.colors.accent.primary
                                        : 'rgba(255, 255, 255, 0.1)',
                                }
                            ]}
                            onPress={() => setSelectedTable(table.name)}
                        >
                            <Icon 
                                name="table" 
                                size={10} 
                                color={selectedTable === table.name 
                                    ? theme.colors.accent.primary 
                                    : theme.colors.text.secondary
                                } 
                            />
                            <View style={styles.tableItemText}>
                                <Text style={[
                                    styles.tableName,
                                    { color: theme.colors.text.primary }
                                ]}>
                                    {table.name}
                                </Text>
                                <Text style={[
                                    styles.tableRowCount,
                                    { color: theme.colors.text.muted }
                                ]}>
                                    {table.rowCount} rows
                                </Text>
                            </View>
                            {selectedTable === table.name && (
                                <Icon name="chevron-right" size={10} color={theme.colors.accent.primary} />
                            )}
                        </TouchableOpacity>
                    ))}
                </ScrollView>
            </View>
        );
    };

    const renderTableData = () => {
        if (!theme) return null;
        
        if (!selectedTable) {
            return (
                <View style={styles.emptyState}>
                    <Icon name="table-arrow-left" size={64} color={theme.colors.text.muted} />
                    <Text style={[styles.emptyText, { color: theme.colors.text.muted }]}>
                        Select a table to view its contents
                    </Text>
                </View>
            );
        }

        return (
            <View style={styles.tableData}>
                <View style={[styles.tableHeader, { backgroundColor: theme.colors.background.surface }]}>
                    <Text style={[styles.tableTitle, { color: theme.colors.text.primary }]}>
                        {selectedTable}
                    </Text>
                    <Text style={[styles.tableSubtitle, { color: theme.colors.text.secondary }]}>
                        {rows.length} rows • {columns.length} columns
                    </Text>
                </View>

                <ScrollView 
                    ref={scrollViewRef}
                    horizontal 
                    style={styles.horizontalScroll}
                    contentContainerStyle={styles.horizontalScrollContent}
                >
                    <View>
                        {/* Column Headers */}
                        <View style={[styles.row, styles.headerRow, { backgroundColor: theme.colors.background.elevated }]}>
                            <View style={[styles.cell, styles.indexCell]}>
                                <Text style={[styles.indexHeaderText, { color: theme.colors.text.muted }]}>#</Text>
                            </View>
                            {columns.map((col) => (
                                <View key={col.name} style={styles.cell}>
                                    <Text style={[styles.columnHeaderText, { color: theme.colors.text.primary }]}>
                                        {col.name}
                                    </Text>
                                    <Text style={[styles.columnType, { color: theme.colors.text.muted }]}>
                                        {col.type}
                                    </Text>
                                </View>
                            ))}
                        </View>

                        {/* Data Rows */}
                        <ScrollView style={styles.verticalScroll}>
                            {rows.length === 0 ? (
                                <View style={styles.emptyTableState}>
                                    <Icon name="table-off" size={32} color={theme.colors.text.muted} />
                                    <Text style={[styles.emptyTableText, { color: theme.colors.text.muted }]}>
                                        No rows in this table
                                    </Text>
                                </View>
                            ) : (
                                rows.map((row, rowIndex) => (
                                    <View 
                                        key={rowIndex} 
                                        style={[
                                            styles.row,
                                            { 
                                                backgroundColor: rowIndex % 2 === 0 
                                                    ? theme.colors.background.base
                                                    : theme.colors.background.surface
                                            }
                                        ]}
                                    >
                                        <View style={[styles.cell, styles.indexCell]}>
                                            <Text style={[styles.indexText, { color: theme.colors.text.muted }]}>
                                                {rowIndex + 1}
                                            </Text>
                                        </View>
                                        {columns.map((col) => (
                                            <View key={col.name} style={styles.cell}>
                                                <Text 
                                                    style={[
                                                        styles.cellText,
                                                        { color: row[col.name] === null 
                                                            ? theme.colors.text.muted
                                                            : theme.colors.text.primary
                                                        }
                                                    ]}
                                                    numberOfLines={3}
                                                >
                                                    {formatValue(row[col.name], col.type)}
                                                </Text>
                                            </View>
                                        ))}
                                    </View>
                                ))
                            )}
                        </ScrollView>
                    </View>
                </ScrollView>
            </View>
        );
    };

    if (!theme) return null;

    return (
        <View style={[styles.container, { backgroundColor: theme.colors.background.base }]}>
            {/* Header */}
            <View style={[styles.header, { backgroundColor: theme.colors.background.surface }]}>
                <View style={styles.headerContent}>
                    <Icon name="database-eye" size={28} color={theme.colors.accent.primary} />
                    <View style={styles.headerText}>
                        <Text style={[styles.title, { color: theme.colors.text.primary }]}>
                            Database Table Viewer
                        </Text>
                        <Text style={[styles.subtitle, { color: theme.colors.text.secondary }]}>
                            Browse table contents
                        </Text>
                    </View>
                </View>
                
                <TouchableOpacity
                    style={[
                        styles.refreshButton,
                        { backgroundColor: theme.colors.accent.primary },
                        isLoading && styles.buttonDisabled
                    ]}
                    onPress={() => selectedTable ? loadTableData(selectedTable) : loadTables()}
                    disabled={isLoading}
                >
                    <Icon name="refresh" size={20} color="#ffffff" />
                </TouchableOpacity>
            </View>

            {/* Error Display */}
            {error && (
                <View style={[styles.errorBanner, { backgroundColor: theme.colors.status.error }]}>
                    <Icon name="alert-circle" size={16} color="#ffffff" />
                    <Text style={styles.errorText}>{error}</Text>
                </View>
            )}

            {/* Table Dropdown for Portrait Mode */}
            {!isLoading && isPortrait && (
                <View style={styles.dropdownContainer}>
                    {renderTableDropdown()}
                </View>
            )}

            {/* Content */}
            {isLoading ? (
                <View style={styles.loadingContainer}>
                    <ActivityIndicator size="large" color={theme.colors.accent.primary} />
                    <Text style={[styles.loadingText, { color: theme.colors.text.secondary }]}>
                        Loading database...
                    </Text>
                </View>
            ) : (
                <View style={isPortrait ? styles.contentPortrait : styles.content}>
                    {!isPortrait && renderTableList()}
                    {!isPortrait && <View style={styles.separator} />}
                    {renderTableData()}
                </View>
            )}

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
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: 10,
        paddingTop: 30,
        borderBottomWidth: 0.5,
        borderBottomColor: 'rgba(255, 255, 255, 0.1)',
    },
    headerContent: {
        flexDirection: 'row',
        alignItems: 'center',
        flex: 1,
    },
    headerText: {
        marginLeft: 6,
        flex: 1,
    },
    title: {
        fontSize: 12,
        fontWeight: 'bold',
    },
    subtitle: {
        fontSize: 7,
        marginTop: 2,
    },
    refreshButton: {
        padding: 5,
        borderRadius: 4,
    },
    buttonDisabled: {
        opacity: 0.5,
    },
    errorBanner: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 12,
        gap: 8,
    },
    errorText: {
        color: '#ffffff',
        fontSize: 14,
        flex: 1,
    },
    loadingContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        gap: 12,
    },
    loadingText: {
        fontSize: 16,
    },
    content: {
        flex: 1,
        flexDirection: 'row',
    },
    contentPortrait: {
        flex: 1,
    },
    dropdownContainer: {
        padding: 8,
        borderBottomWidth: 0.5,
        borderBottomColor: 'rgba(255, 255, 255, 0.1)',
    },
    dropdownButton: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 6,
        borderRadius: 4,
        borderWidth: 0.5,
        gap: 5,
    },
    dropdownButtonText: {
        flex: 1,
        fontSize: 7,
        fontWeight: '500',
    },
    modalOverlay: {
        flex: 1,
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        justifyContent: 'center',
        alignItems: 'center',
    },
    dropdownModal: {
        width: '80%',
        maxHeight: '70%',
        borderRadius: 8,
        overflow: 'hidden',
    },
    dropdownHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: 8,
        borderBottomWidth: 0.5,
        borderBottomColor: 'rgba(255, 255, 255, 0.1)',
    },
    dropdownTitle: {
        fontSize: 9,
        fontWeight: 'bold',
    },
    dropdownList: {
        maxHeight: 300,
    },
    dropdownItem: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 6,
        gap: 5,
    },
    dropdownItemText: {
        flex: 1,
    },
    dropdownTableName: {
        fontSize: 7,
        fontWeight: '500',
    },
    dropdownTableRowCount: {
        fontSize: 5.5,
        marginTop: 1,
    },
    tableList: {
        width: 125,
        borderRightWidth: 0.5,
        borderRightColor: 'rgba(255, 255, 255, 0.1)',
    },
    sectionTitle: {
        fontSize: 5.5,
        fontWeight: '600',
        textTransform: 'uppercase',
        letterSpacing: 0.25,
        padding: 8,
        paddingBottom: 4,
    },
    tableScroll: {
        flex: 1,
    },
    tableItem: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 6,
        marginHorizontal: 4,
        marginBottom: 2,
        borderRadius: 4,
        borderWidth: 0.5,
        gap: 5,
    },
    tableItemText: {
        flex: 1,
    },
    tableName: {
        fontSize: 7,
        fontWeight: '500',
    },
    tableRowCount: {
        fontSize: 5.5,
        marginTop: 1,
    },
    separator: {
        width: 1,
        backgroundColor: 'rgba(255, 255, 255, 0.1)',
    },
    tableData: {
        flex: 1,
    },
    emptyState: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        gap: 16,
        padding: 40,
    },
    emptyText: {
        fontSize: 16,
        textAlign: 'center',
    },
    tableHeader: {
        padding: 8,
        borderBottomWidth: 0.5,
        borderBottomColor: 'rgba(255, 255, 255, 0.1)',
    },
    tableTitle: {
        fontSize: 9,
        fontWeight: 'bold',
    },
    tableSubtitle: {
        fontSize: 6,
        marginTop: 2,
    },
    horizontalScroll: {
        flex: 1,
    },
    horizontalScrollContent: {
        paddingRight: 8,
    },
    verticalScroll: {
        maxHeight: 300,
    },
    row: {
        flexDirection: 'row',
        borderBottomWidth: 0.5,
        borderBottomColor: 'rgba(255, 255, 255, 0.05)',
    },
    headerRow: {
        borderBottomWidth: 1,
        borderBottomColor: 'rgba(255, 255, 255, 0.2)',
    },
    cell: {
        width: 75,
        padding: 6,
        justifyContent: 'center',
    },
    indexCell: {
        width: 25,
        alignItems: 'center',
    },
    columnHeaderText: {
        fontSize: 6.5,
        fontWeight: '600',
    },
    columnType: {
        fontSize: 5,
        marginTop: 1,
    },
    indexHeaderText: {
        fontSize: 5.5,
        fontWeight: '600',
    },
    indexText: {
        fontSize: 6,
        fontWeight: '500',
    },
    cellText: {
        fontSize: 6,
        fontFamily: 'monospace',
    },
    emptyTableState: {
        padding: 20,
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
    },
    emptyTableText: {
        fontSize: 8,
        textAlign: 'center',
    },
    infoBanner: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 6,
        gap: 4,
    },
    infoText: {
        fontSize: 6,
    },
});
