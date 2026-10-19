/**
 * usePresets — engine preset list hook (provider-registry 2-2).
 *
 * Covers the net-new fetch pattern: fetch-on-mount, the module-level cache
 * (one request shared across mounts), the error surface and `refresh`.
 */

import { renderHook, waitFor } from '@testing-library/react-native';
import { resetPresetsCache, usePresets } from '../usePresets';
import { engineApiClient } from '../../services/engine/EngineApiClient';

jest.mock('../../services/engine/EngineApiClient', () => ({
  engineApiClient: {
    listPresets: jest.fn(),
    savePreset: jest.fn(),
    deletePreset: jest.fn(),
  },
}));

const listPresets = engineApiClient.listPresets as jest.Mock;
const savePreset = engineApiClient.savePreset as jest.Mock;
const deletePreset = engineApiClient.deletePreset as jest.Mock;

const LIST = { presets: [{ name: 'creative', source: 'bundled', param_count: 2 }] };

beforeEach(() => {
  resetPresetsCache();
  listPresets.mockReset();
  savePreset.mockReset();
  deletePreset.mockReset();
});

describe('usePresets', () => {
  it('fetches the preset list on mount', async () => {
    listPresets.mockResolvedValue(LIST);
    const { result } = await renderHook(() => usePresets());

    await waitFor(() => expect(result.current.presets).toHaveLength(1));
    expect(result.current.presets[0].name).toBe('creative');
    expect(result.current.error).toBeNull();
    expect(listPresets).toHaveBeenCalledTimes(1);
  });

  it('serves the cached list to a second mount (one request)', async () => {
    listPresets.mockResolvedValue(LIST);
    await renderHook(() => usePresets());
    await waitFor(() => expect(listPresets).toHaveBeenCalledTimes(1));

    const { result } = await renderHook(() => usePresets());
    await waitFor(() => expect(result.current.presets).toHaveLength(1));
    expect(listPresets).toHaveBeenCalledTimes(1);
  });

  it('surfaces an error and keeps an empty list on failure', async () => {
    listPresets.mockRejectedValue(new Error('boom'));
    const { result } = await renderHook(() => usePresets());

    await waitFor(() => expect(result.current.error).toBe('boom'));
    expect(result.current.presets).toEqual([]);
  });

  it('refresh re-fetches the list', async () => {
    listPresets.mockResolvedValue(LIST);
    const { result } = await renderHook(() => usePresets());
    await waitFor(() => expect(listPresets).toHaveBeenCalledTimes(1));

    await result.current.refresh();
    expect(listPresets).toHaveBeenCalledTimes(2);
  });

  it('savePreset calls the engine then refreshes the shared list', async () => {
    listPresets.mockResolvedValue(LIST);
    savePreset.mockResolvedValue({ name: 'fresh', status: 'created' });

    const { result } = await renderHook(() => usePresets());
    await waitFor(() => expect(listPresets).toHaveBeenCalledTimes(1));

    await result.current.savePreset('fresh', 'temperature: 0.5\n');

    expect(savePreset).toHaveBeenCalledWith('fresh', 'temperature: 0.5\n');
    expect(listPresets).toHaveBeenCalledTimes(2);
  });

  it('deletePreset calls the engine then refreshes the shared list', async () => {
    listPresets.mockResolvedValue(LIST);
    deletePreset.mockResolvedValue({ name: 'creative', status: 'deleted' });

    const { result } = await renderHook(() => usePresets());
    await waitFor(() => expect(listPresets).toHaveBeenCalledTimes(1));

    await result.current.deletePreset('creative');

    expect(deletePreset).toHaveBeenCalledWith('creative');
    expect(listPresets).toHaveBeenCalledTimes(2);
  });

  it('propagates a save failure without refetching', async () => {
    listPresets.mockResolvedValue(LIST);
    savePreset.mockRejectedValue(new Error('nope'));

    const { result } = await renderHook(() => usePresets());
    await waitFor(() => expect(listPresets).toHaveBeenCalledTimes(1));

    await expect(result.current.savePreset('x', '')).rejects.toThrow('nope');
    expect(listPresets).toHaveBeenCalledTimes(1);
  });
});
