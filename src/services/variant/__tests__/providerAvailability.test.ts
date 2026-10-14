/**
 * providerAvailability — variant-aware provider filtering (plan 7-14 V3).
 *
 * Store builds offer ONLY `soulbitscloud`; the full variant is unchanged. The
 * `soulvoice` provider (the full-only self-hosted speech engine) is the trap
 * case — it must never survive the store filter.
 */

import {
  STORE_PROVIDER_ID,
  filterModuleConfigsForVariant,
  getAvailableProviders,
  isModuleAvailable,
  isProviderAvailable,
  moduleConfigProviderTypes,
} from '../providerAvailability';
import { setAppVariantForTests } from '../../../config/appVariant';

describe('providerAvailability (7-14 V3)', () => {
  afterEach(() => {
    setAppVariantForTests(null);
  });

  it('full variant exposes the raw provider list (including soulvoice)', () => {
    setAppVariantForTests('full');
    const tts = getAvailableProviders('tts').map(p => p.id);
    expect(tts).toContain('openai');
    expect(tts).toContain('soulvoice');
    expect(isProviderAvailable('soulvoice')).toBe(true);
    expect(isProviderAvailable('soulbitscloud')).toBe(true);
  });

  it('store variant collapses every module to soulbitscloud only', () => {
    setAppVariantForTests('store');
    for (const moduleType of [
      'backend',
      'cognition',
      'movement',
      'rag',
      'stt',
      'tts',
      'vision',
      'imagination',
    ]) {
      const providers = getAvailableProviders(moduleType);
      expect(providers.map(p => p.id)).toEqual([STORE_PROVIDER_ID]);
      expect(isModuleAvailable(moduleType)).toBe(true);
    }
  });

  it('store variant never offers soulvoice (disambiguation trap)', () => {
    setAppVariantForTests('store');
    expect(isProviderAvailable('soulvoice')).toBe(false);
    expect(getAvailableProviders('tts').some(p => p.id === 'soulvoice')).toBe(false);
    expect(getAvailableProviders(('tts'))[0].id).toBe('soulbitscloud');
  });

  it('returns [] for an unknown module type', () => {
    setAppVariantForTests('store');
    expect(getAvailableProviders('nope')).toEqual([]);
    expect(isModuleAvailable('nope')).toBe(false);
  });

  describe('moduleConfigProviderTypes', () => {
    it('reads the single provider for standard modules', () => {
      expect(moduleConfigProviderTypes('tts', { provider: 'openai' })).toEqual(['openai']);
      expect(moduleConfigProviderTypes('backend', { provider: 'soulbitscloud' })).toEqual([
        'soulbitscloud',
      ]);
    });

    it('reads both STT slots and skips the disabled sentinel / empties', () => {
      expect(
        moduleConfigProviderTypes('stt', {
          transcription_provider: 'soulbitscloud',
          vad_provider: 'soulbitscloud',
        }),
      ).toEqual(['soulbitscloud', 'soulbitscloud']);
      expect(
        moduleConfigProviderTypes('stt', {
          transcription_provider: 'disabled',
          vad_provider: '',
        }),
      ).toEqual([]);
    });
  });

  describe('filterModuleConfigsForVariant', () => {
    const configs = [
      { id: 'c1', provider: 'soulbitscloud' },
      { id: 'c2', provider: 'openai' },
    ];

    it('is a no-op in the full variant', () => {
      setAppVariantForTests('full');
      expect(filterModuleConfigsForVariant('tts', configs)).toBe(configs);
    });

    it('keeps only cloud-wired configs in the store variant', () => {
      setAppVariantForTests('store');
      expect(filterModuleConfigsForVariant('tts', configs).map(c => c.id)).toEqual(['c1']);
    });

    it('drops configs with no resolvable provider in store (never offer a locked config)', () => {
      setAppVariantForTests('store');
      expect(
        filterModuleConfigsForVariant('backend', [{ id: 'x', provider: '' }]).map(c => c.id),
      ).toEqual([]);
    });
  });
});
