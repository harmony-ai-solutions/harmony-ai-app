import React, { useState } from 'react';
import { View, TextInput, Switch, TouchableOpacity, StyleSheet } from 'react-native';
import { FieldDefinition } from '../../constants/providerFieldSchemas';
import { useAppTheme } from '../../contexts/ThemeContext';
import { ThemedText } from '../themed/ThemedText';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

interface FormFieldProps {
  field: FieldDefinition;
  value: any;
  onChange: (key: string, value: any) => void;
}

export const FormField: React.FC<FormFieldProps> = ({ field, value, onChange }) => {
  const { theme } = useAppTheme();
  const [showPassword, setShowPassword] = useState(false);

  if (!theme) return null;

  const handleChange = (text: string) => {
    let parsedValue: any = text;
    
    if (field.type === 'number') {
      parsedValue = text === '' ? null : parseFloat(text);
      if (field.disabledValue !== undefined && parsedValue === field.disabledValue) {
        parsedValue = field.disabledValue;
      }
    }
    
    onChange(field.key, parsedValue);
  };

  const renderInput = () => {
    switch (field.type) {
      case 'password':
        return (
          <View style={styles.passwordContainer}>
            <TextInput
              style={[
                styles.input,
                styles.passwordInput,
                {
                  color: theme.colors.text.primary,
                  borderColor: theme.colors.border.default,
                  backgroundColor: theme.colors.background.base,
                },
              ]}
              value={value?.toString() || ''}
              onChangeText={handleChange}
              placeholder={field.placeholder}
              secureTextEntry={!showPassword}
              placeholderTextColor={theme.colors.text.muted}
            />
            <TouchableOpacity
              style={styles.eyeButton}
              onPress={() => setShowPassword(!showPassword)}
            >
              <Icon
                name={showPassword ? 'eye-off' : 'eye'}
                size={18}
                color={theme.colors.text.muted}
              />
            </TouchableOpacity>
          </View>
        );
      
      case 'number':
        return (
          <TextInput
            style={[
              styles.input,
              {
                color: theme.colors.text.primary,
                borderColor: theme.colors.border.default,
                backgroundColor: theme.colors.background.base,
              },
            ]}
            value={value !== null && value !== undefined ? value.toString() : ''}
            onChangeText={handleChange}
            placeholder={field.placeholder}
            keyboardType="decimal-pad"
            placeholderTextColor={theme.colors.text.muted}
          />
        );
      
      case 'checkbox':
        return (
          <Switch
            value={value === true}
            onValueChange={(val) => onChange(field.key, val)}
            trackColor={{ false: theme.colors.border.default, true: theme.colors.accent.primary }}
          />
        );
      
      case 'comma-list':
        return (
          <TextInput
            style={[
              styles.input,
              {
                color: theme.colors.text.primary,
                borderColor: theme.colors.border.default,
                backgroundColor: theme.colors.background.base,
              },
            ]}
            value={value?.toString() || ''}
            onChangeText={(text) => onChange(field.key, text)}
            placeholder={field.placeholder}
            placeholderTextColor={theme.colors.text.muted}
          />
        );
      
      case 'select':
        return (
          <TextInput
            style={[
              styles.input,
              {
                color: theme.colors.text.primary,
                borderColor: theme.colors.border.default,
                backgroundColor: theme.colors.background.base,
              },
            ]}
            value={value?.toString() || ''}
            onChangeText={handleChange}
            placeholder={field.placeholder}
            placeholderTextColor={theme.colors.text.muted}
            editable={false}
          />
        );
      
      default:
        return (
          <TextInput
            style={[
              styles.input,
              {
                color: theme.colors.text.primary,
                borderColor: theme.colors.border.default,
                backgroundColor: theme.colors.background.base,
              },
            ]}
            value={value?.toString() || ''}
            onChangeText={handleChange}
            placeholder={field.placeholder}
            placeholderTextColor={theme.colors.text.muted}
          />
        );
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.labelRow}>
        <ThemedText size={13} variant="secondary" style={styles.label}>
          {field.label}
        </ThemedText>
        {field.required && (
          <ThemedText size={13} style={{ color: theme.colors.status.error }}>
            *
          </ThemedText>
        )}
      </View>
      {field.tooltip && (
        <ThemedText variant="muted" size={11} style={styles.tooltip}>
          {field.tooltip}
        </ThemedText>
      )}
      {renderInput()}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    marginBottom: 16,
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  label: {
    marginRight: 4,
  },
  tooltip: {
    marginBottom: 4,
  },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    minHeight: 44,
  },
  passwordContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  passwordInput: {
    flex: 1,
    paddingRight: 44,
  },
  eyeButton: {
    position: 'absolute',
    right: 12,
    padding: 4,
  },
});
