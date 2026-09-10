import { MODULE_TYPES } from '../moduleConfiguration';
import { SOULBITS_MODEL_QUERY } from '../soulbitsModels';

describe('moduleConfiguration — provider list consistency', () => {
  it('lists the Soulbits Cloud provider for every module that has a Soulbits model catalog', () => {
    // Every module type that has a Soulbits model query MUST also expose the
    // Soulbits Cloud provider chip. This keeps the provider list and the model
    // catalog in sync (regression guard for Dom's feedback that STT/VAD were
    // missing Soulbits even though it is supported).
    for (const module of MODULE_TYPES) {
      if (SOULBITS_MODEL_QUERY[module.id]) {
        const hasSoulbits = module.providerOptions.some(p => p.id === 'soulbitscloud');
        expect(
          hasSoulbits,
        ).toBe(true);
      }
    }
  });

  it('has unique provider ids per module', () => {
    for (const module of MODULE_TYPES) {
      const ids = module.providerOptions.map(p => p.id);
      const unique = new Set(ids);
      expect(unique.size).toBe(ids.length);
    }
  });

  it('every provider option has a name and icon', () => {
    for (const module of MODULE_TYPES) {
      for (const provider of module.providerOptions) {
        expect(typeof provider.name).toBe('string');
        expect(provider.name.length).toBeGreaterThan(0);
        expect(typeof provider.icon).toBe('string');
      }
    }
  });
});
