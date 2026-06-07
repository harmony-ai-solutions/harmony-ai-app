import { STANDARD_PARAM_KEYS } from '../constants/extendedParamMetadata';

/** Parse extra_params JSON string to object */
export function parseExtraParams(json: string | null): Record<string, any> {
  if (!json || json === '{}' || json === '') return {};
  try {
    return JSON.parse(json);
  } catch {
    return {};
  }
}

/** Serialize extra_params object to JSON string for DB storage */
export function serializeExtraParams(params: Record<string, any>): string {
  if (!params || Object.keys(params).length === 0) return '{}';
  return JSON.stringify(params);
}

/** Merge provider defaults with existing values (for edit mode) */
export function mergeWithDefaults(values: Record<string, any>, defaults: Record<string, any>): Record<string, any> {
  const merged = { ...defaults };
  for (const [key, value] of Object.entries(values)) {
    if (value !== null && value !== undefined) {
      merged[key] = value;
    }
  }
  return merged;
}

/** Get only the non-standard params from extra_params for display in the advanced section */
export function getExtendedParams(extraParams: Record<string, any>): Record<string, any> {
  const result: Record<string, any> = {};
  for (const [key, value] of Object.entries(extraParams)) {
    if (!STANDARD_PARAM_KEYS.has(key)) {
      result[key] = value;
    }
  }
  return result;
}