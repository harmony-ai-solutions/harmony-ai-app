/**
 * entityAccess — store-variant entity lock predicate (plan 7-14 V3).
 *
 * The predicate is COMPUTED from the entity→module→provider chain and never
 * persisted. These tests cover the pure mapping judgement ({@link isMappingLocked})
 * and the batch/cache behaviour of {@link isEntityLocked} /
 * {@link getLockedEntityIds} with the repository seam mocked. The full variant
 * must short-circuit with ZERO repository reads.
 */

import type { EntityModuleMapping } from '../../../database/models';

jest.mock('../../../database/repositories', () => ({
  getAllEntityModuleMappings: jest.fn(),
  getAllBackendConfigs: jest.fn(),
  getAllCognitionConfigs: jest.fn(),
  getAllMovementConfigs: jest.fn(),
  getAllRAGConfigs: jest.fn(),
  getAllSTTConfigs: jest.fn(),
  getAllTTSConfigs: jest.fn(),
  getAllVisionConfigs: jest.fn(),
  getAllImaginationConfigs: jest.fn(),
}));

import * as repos from '../../../database/repositories';
import {
  getLockedEntityIds,
  invalidateEntityAccessCache,
  isEntityLocked,
  isMappingLocked,
} from '../entityAccess';
import { setAppVariantForTests } from '../../../config/appVariant';

const mocked = repos as unknown as {
  getAllEntityModuleMappings: jest.Mock;
  getAllBackendConfigs: jest.Mock;
  getAllCognitionConfigs: jest.Mock;
  getAllMovementConfigs: jest.Mock;
  getAllRAGConfigs: jest.Mock;
  getAllSTTConfigs: jest.Mock;
  getAllTTSConfigs: jest.Mock;
  getAllVisionConfigs: jest.Mock;
  getAllImaginationConfigs: jest.Mock;
};

function mapping(overrides: Partial<EntityModuleMapping> = {}): EntityModuleMapping {
  return {
    entity_id: 'e',
    backend_config_id: null,
    cognition_config_id: null,
    imagination_config_id: null,
    movement_config_id: null,
    rag_config_id: null,
    stt_config_id: null,
    tts_config_id: null,
    vision_config_id: null,
    deleted_at: null,
    ...overrides,
  };
}

const NO_CONFIGS: unknown[] = [];

beforeEach(() => {
  jest.resetAllMocks();
  invalidateEntityAccessCache();
  mocked.getAllEntityModuleMappings.mockResolvedValue({});
  mocked.getAllBackendConfigs.mockResolvedValue(NO_CONFIGS);
  mocked.getAllCognitionConfigs.mockResolvedValue(NO_CONFIGS);
  mocked.getAllMovementConfigs.mockResolvedValue(NO_CONFIGS);
  mocked.getAllRAGConfigs.mockResolvedValue(NO_CONFIGS);
  mocked.getAllSTTConfigs.mockResolvedValue(NO_CONFIGS);
  mocked.getAllTTSConfigs.mockResolvedValue(NO_CONFIGS);
  mocked.getAllVisionConfigs.mockResolvedValue(NO_CONFIGS);
  mocked.getAllImaginationConfigs.mockResolvedValue(NO_CONFIGS);
});

afterEach(() => {
  setAppVariantForTests(null);
  invalidateEntityAccessCache();
});

describe('isMappingLocked (pure)', () => {
  const index = new Map<string, string[]>([
    ['backend:b1', ['soulbitscloud']],
    ['tts:cloud', ['soulbitscloud']],
    ['tts:openai', ['openai']],
    ['stt:tx', ['soulbitscloud', 'soulbitscloud']],
    ['stt:voices', ['soulvoice']],
  ]);

  it('unlocked when every wired slot is soulbitscloud', () => {
    expect(
      isMappingLocked(mapping({ backend_config_id: 'b1', tts_config_id: 'cloud' }), index),
    ).toBe(false);
  });

  it('unlocked for a fully-unwired entity', () => {
    expect(isMappingLocked(mapping(), index)).toBe(false);
  });

  it('locked when any slot uses a non-cloud provider', () => {
    expect(isMappingLocked(mapping({ tts_config_id: 'openai' }), index)).toBe(true);
    expect(isMappingLocked(mapping({ stt_config_id: 'voices' }), index)).toBe(true);
  });

  it('locked when a wired config id is missing locally (unknown)', () => {
    expect(isMappingLocked(mapping({ backend_config_id: 'gone' }), index)).toBe(true);
  });

  it('null mapping is not locked', () => {
    expect(isMappingLocked(null, index)).toBe(false);
  });
});

describe('isEntityLocked / getLockedEntityIds', () => {
  it('full variant short-circuits to unlocked with ZERO repository reads', async () => {
    setAppVariantForTests('full');
    await expect(isEntityLocked('e1')).resolves.toBe(false);
    await expect(getLockedEntityIds()).resolves.toEqual(new Set());
    expect(mocked.getAllEntityModuleMappings).not.toHaveBeenCalled();
    expect(mocked.getAllBackendConfigs).not.toHaveBeenCalled();
  });

  it('store variant locks entities wired to a non-cloud provider', async () => {
    setAppVariantForTests('store');
    mocked.getAllEntityModuleMappings.mockResolvedValue({
      cloud: mapping({ entity_id: 'cloud', backend_config_id: 'b1' }),
      other: mapping({ entity_id: 'other', tts_config_id: 't1' }),
    });
    mocked.getAllBackendConfigs.mockResolvedValue([{ id: 'b1', provider: 'soulbitscloud' }]);
    mocked.getAllTTSConfigs.mockResolvedValue([{ id: 't1', provider: 'openai' }]);

    await expect(isEntityLocked('cloud')).resolves.toBe(false);
    await expect(isEntityLocked('other')).resolves.toBe(true);
    expect(await getLockedEntityIds()).toEqual(new Set(['other']));
  });

  it('accepts an entity-like object', async () => {
    setAppVariantForTests('store');
    mocked.getAllEntityModuleMappings.mockResolvedValue({
      e1: mapping({ entity_id: 'e1', backend_config_id: 'b1' }),
    });
    mocked.getAllBackendConfigs.mockResolvedValue([{ id: 'b1', provider: 'soulvoice' }]);
    await expect(isEntityLocked({ id: 'e1' })).resolves.toBe(true);
  });

  it('caches the batch pass until invalidated', async () => {
    setAppVariantForTests('store');
    mocked.getAllEntityModuleMappings.mockResolvedValue({ e1: mapping({ entity_id: 'e1' }) });
    await isEntityLocked('e1');
    await isEntityLocked('e1');
    expect(mocked.getAllEntityModuleMappings).toHaveBeenCalledTimes(1);

    invalidateEntityAccessCache();
    await isEntityLocked('e1');
    expect(mocked.getAllEntityModuleMappings).toHaveBeenCalledTimes(2);
  });

  it('fails OPEN (nothing locked) when a read throws', async () => {
    setAppVariantForTests('store');
    mocked.getAllEntityModuleMappings.mockRejectedValue(new Error('engine down'));
    await expect(getLockedEntityIds()).resolves.toEqual(new Set());
  });
});
