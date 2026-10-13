/**
 * engineFeatures — unit tests (task 3-2).
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

jest.mock('../../utils/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

import {
  ENGINE_API_DATA_LAYER_DEFAULT,
  ENGINE_API_DATA_LAYER_STORAGE_KEY,
  hasEngineApiDataLayerOverride,
  isEngineApiDataLayerEnabled,
  loadEngineFeatureFlags,
  setEngineApiDataLayerEnabled,
  setEngineApiDataLayerEnabledPersisted,
} from '../engineFeatures';

const mockedGetItem = AsyncStorage.getItem as jest.Mock;
const mockedSetItem = AsyncStorage.setItem as jest.Mock;
const mockedRemoveItem = AsyncStorage.removeItem as jest.Mock;

/** Route getItem by key so the flag hydrates deterministically. */
function mockStorage(values: Record<string, string | null>) {
  mockedGetItem.mockImplementation((key: string) =>
    Promise.resolve(key in values ? values[key] : null),
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  setEngineApiDataLayerEnabled(null);
});

describe('ENGINE_API_DATA_LAYER flag (3-2)', () => {
  it('defaults to the build-time value (ON, task 3-4) with no override', () => {
    expect(ENGINE_API_DATA_LAYER_DEFAULT).toBe(true);
    expect(isEngineApiDataLayerEnabled()).toBe(true);
    expect(hasEngineApiDataLayerOverride()).toBe(false);
  });

  it('honors an in-memory override and restores the default on null', () => {
    setEngineApiDataLayerEnabled(false);
    expect(isEngineApiDataLayerEnabled()).toBe(false);
    expect(hasEngineApiDataLayerOverride()).toBe(true);
    setEngineApiDataLayerEnabled(null);
    expect(isEngineApiDataLayerEnabled()).toBe(true);
  });

  it('hydrates true / false / absent from AsyncStorage', async () => {
    mockStorage({ [ENGINE_API_DATA_LAYER_STORAGE_KEY]: 'false' });
    await loadEngineFeatureFlags();
    expect(isEngineApiDataLayerEnabled()).toBe(false);

    mockStorage({ [ENGINE_API_DATA_LAYER_STORAGE_KEY]: 'true' });
    await loadEngineFeatureFlags();
    expect(isEngineApiDataLayerEnabled()).toBe(true);

    mockStorage({});
    await loadEngineFeatureFlags();
    expect(isEngineApiDataLayerEnabled()).toBe(true);
  });

  it('clears the override when AsyncStorage throws', async () => {
    setEngineApiDataLayerEnabled(false);
    mockedGetItem.mockRejectedValueOnce(new Error('boom'));
    await loadEngineFeatureFlags();
    expect(isEngineApiDataLayerEnabled()).toBe(true);
  });

  it('persists and applies an override', async () => {
    await setEngineApiDataLayerEnabledPersisted(false);
    expect(isEngineApiDataLayerEnabled()).toBe(false);
    expect(mockedSetItem).toHaveBeenCalledWith(ENGINE_API_DATA_LAYER_STORAGE_KEY, 'false');

    await setEngineApiDataLayerEnabledPersisted(null);
    expect(mockedRemoveItem).toHaveBeenCalledWith(ENGINE_API_DATA_LAYER_STORAGE_KEY);
    expect(isEngineApiDataLayerEnabled()).toBe(true);
  });
});
