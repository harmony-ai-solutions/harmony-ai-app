/**
 * Unit tests for the pure sync name-clash helpers (src/services/syncNameClash.ts).
 *
 * Covers:
 *  - Which tables actually enforce a unique `name` (only those can clash)
 *  - The reverse FK map used to remap references when a local entry's id is
 *    adopted from the incoming (server) record
 *  - Rename-name generation ("Original (1234567890)" + collision avoidance)
 */

import {
  NAME_UNIQUE_TABLES,
  CONFIG_ID_REFERENCES,
  isNameUniqueTable,
  generateRenamedName,
} from '../syncNameClash';

describe('syncNameClash helpers', () => {
  describe('NAME_UNIQUE_TABLES', () => {
    it('includes every module config table that enforces a unique name', () => {
      expect(NAME_UNIQUE_TABLES).toEqual(
        expect.arrayContaining([
          'backend_configs',
          'cognition_configs',
          'movement_configs',
          'rag_configs',
          'stt_configs',
          'tts_configs',
          'vision_configs',
          'imagination_configs',
        ]),
      );
    });

    it('excludes tables whose name column is not unique', () => {
      expect(NAME_UNIQUE_TABLES).toContain('vision_configs');
      expect(NAME_UNIQUE_TABLES).toContain('imagination_configs');
      expect(NAME_UNIQUE_TABLES).not.toContain('character_profiles');
      expect(NAME_UNIQUE_TABLES).not.toContain('provider_config_openai');
      expect(NAME_UNIQUE_TABLES).not.toContain('entities');
    });

    it('isNameUniqueTable reflects the constant', () => {
      expect(isNameUniqueTable('backend_configs')).toBe(true);
      expect(isNameUniqueTable('tts_configs')).toBe(true);
      expect(isNameUniqueTable('vision_configs')).toBe(true);
      expect(isNameUniqueTable('imagination_configs')).toBe(true);
      expect(isNameUniqueTable('character_profiles')).toBe(false);
    });
  });

  describe('CONFIG_ID_REFERENCES', () => {
    it('maps each unique-name config table to its entity_module_mappings FK column', () => {
      expect(CONFIG_ID_REFERENCES.backend_configs).toEqual([
        { table: 'entity_module_mappings', column: 'backend_config_id' },
      ]);
      expect(CONFIG_ID_REFERENCES.cognition_configs).toEqual([
        { table: 'entity_module_mappings', column: 'cognition_config_id' },
      ]);
      expect(CONFIG_ID_REFERENCES.movement_configs).toEqual([
        { table: 'entity_module_mappings', column: 'movement_config_id' },
      ]);
      expect(CONFIG_ID_REFERENCES.rag_configs).toEqual([
        { table: 'entity_module_mappings', column: 'rag_config_id' },
      ]);
      expect(CONFIG_ID_REFERENCES.stt_configs).toEqual([
        { table: 'entity_module_mappings', column: 'stt_config_id' },
      ]);
      expect(CONFIG_ID_REFERENCES.tts_configs).toEqual([
        { table: 'entity_module_mappings', column: 'tts_config_id' },
      ]);
      expect(CONFIG_ID_REFERENCES.vision_configs).toEqual([
        { table: 'entity_module_mappings', column: 'vision_config_id' },
        { table: 'character_profiles', column: 'vision_config_id' },
      ]);
      expect(CONFIG_ID_REFERENCES.imagination_configs).toEqual([
        { table: 'entity_module_mappings', column: 'imagination_config_id' },
      ]);
    });
  });

  describe('generateRenamedName', () => {
    it('appends a unix timestamp in parentheses', () => {
      expect(
        generateRenamedName('Default SoulbitsCloud', { nowSeconds: 1234567890 }),
      ).toBe('Default SoulbitsCloud (1234567890)');
    });

    it('uses the current time when nowSeconds is omitted', () => {
      const before = Math.floor(Date.now() / 1000);
      const renamed = generateRenamedName('X');
      const after = Math.floor(Date.now() / 1000);
      const match = renamed.match(/^X \((\d+)\)$/);
      expect(match).toBeTruthy();
      const ts = parseInt(match![1], 10);
      expect(ts).toBeGreaterThanOrEqual(before);
      expect(ts).toBeLessThanOrEqual(after);
    });

    it('avoids collisions with already-taken names', () => {
      const renamed = generateRenamedName('X', {
        nowSeconds: 100,
        takenNames: ['X (100)', 'X (100)-1'],
      });
      expect(renamed).toBe('X (100)-2');
    });

    it('returns the base name unchanged when nothing is taken', () => {
      expect(
        generateRenamedName('Backend', { nowSeconds: 42, takenNames: ['Other (42)'] }),
      ).toBe('Backend (42)');
    });
  });
});
