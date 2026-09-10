/**
 * Round-trip fidelity test (4-4) — the P4 acceptance gate.
 *
 * Loads the shared V3 fixture (`fixtures/v3-card.json`) and drives the full
 * pipeline: parse → `mapCardToProfile` → `exportProfileToCardV3` → re-parse
 * (JSON + PNG `ccv3`) → field-by-field deep equality.
 *
 * ## Cross-side parity (Go 4-1)
 *
 * The same fixture is asserted on the Go side (4-1). The parity contract is
 * *spec-conformance of the canonical JSON-card output*, not byte-identity:
 * both sides emit the canonical key order documented in `exporter.ts` and both
 * embed `ccv3` as utf-8 → base64 JSON (SPEC_V3:24). This test validates the TS
 * side against that contract; `exporter.test.ts` pins the canonical key order.
 */

import { parseCharacterCard } from '../jsonParser';
import { mapCardToProfile } from '../mapper';
import {
  exportProfileToCardV3,
  exportToJSON,
  exportToPNG,
} from '../exporter';
import { extractCharacterCardFromPNG } from '../pngParser';
import type { TavernCardV2, CharacterBook } from '../types';

import fixture from './fixtures/v3-card.json';

const now = () => Math.floor(Date.now() / 1000);

/** The fixture as a typed card (the fixture JSON already matches the shape). */
const fixtureCard = fixture as unknown as TavernCardV2;

function roundTrip() {
  const parsed = parseCharacterCard(JSON.stringify(fixtureCard));
  const { profile } = mapCardToProfile(parsed);
  const exported = exportProfileToCardV3(profile, []);
  const reparsedJson = parseCharacterCard(exportToJSON(exported));
  const png = exportToPNG(exported);
  const { card: reparsedPng } = extractCharacterCardFromPNG(png);
  return { parsed, exported, reparsedJson, reparsedPng };
}

describe('V3 round-trip fidelity (4-4)', () => {
  it('preserves all standard fields through import → export → re-parse (JSON)', () => {
    const { parsed, exported, reparsedJson } = roundTrip();

    expect(exported.spec).toBe('chara_card_v3');
    expect(exported.spec_version).toBe('3.0');
    expect(reparsedJson.spec).toBe('chara_card_v3');
    expect(reparsedJson.spec_version).toBe('3.0');

    const d = parsed.data;
    const r = reparsedJson.data;

    // String fields
    expect(r.name).toBe(d.name);
    expect(r.description).toBe(d.description);
    expect(r.personality).toBe(d.personality);
    expect(r.scenario).toBe(d.scenario);
    expect(r.first_mes).toBe(d.first_mes);
    expect(r.mes_example).toBe(d.mes_example);
    expect(r.creator_notes).toBe(d.creator_notes);
    expect(r.system_prompt).toBe(d.system_prompt);
    expect(r.post_history_instructions).toBe(d.post_history_instructions);
    expect(r.creator).toBe(d.creator);
    expect(r.character_version).toBe(d.character_version);
    expect(r.nickname).toBe(d.nickname);

    // Array fields
    expect(r.alternate_greetings).toEqual(d.alternate_greetings);
    expect(r.tags).toEqual(d.tags);
    expect(r.group_only_greetings).toEqual(d.group_only_greetings);
  });

  it('preserves character_book spec fields — top-level, every entry, decorators', () => {
    const { parsed, reparsedJson } = roundTrip();

    const original = parsed.data.character_book as CharacterBook;
    const reparsed = reparsedJson.data.character_book as CharacterBook;

    expect(reparsed).toEqual(original);
    expect(reparsed.entries).toHaveLength(original.entries.length);
    expect(reparsed.extensions).toEqual(original.extensions);

    // Spot-check every V3 entry field + @@ decorators.
    const entry0 = reparsed.entries[0];
    expect(entry0.keys).toEqual(original.entries[0].keys);
    expect(entry0.enabled).toBe(original.entries[0].enabled);
    expect(entry0.insertion_order).toBe(original.entries[0].insertion_order);
    expect(entry0.case_sensitive).toBe(original.entries[0].case_sensitive);
    expect(entry0.use_regex).toBe(original.entries[0].use_regex);
    expect(entry0.constant).toBe(original.entries[0].constant);
    expect(entry0.name).toBe(original.entries[0].name);
    expect(entry0.priority).toBe(original.entries[0].priority);
    expect(entry0.id).toBe(original.entries[0].id);
    expect(entry0.comment).toBe(original.entries[0].comment);
    expect(entry0.selective).toBe(original.entries[0].selective);
    expect(entry0.secondary_keys).toEqual(original.entries[0].secondary_keys);
    expect(entry0.position).toBe(original.entries[0].position);
    expect(entry0.extensions).toEqual(original.entries[0].extensions);

    // @@ decorators preserved in content
    expect(entry0.content).toContain('@@depth 2');
    expect(entry0.content).toContain('@@role assistant');
    expect(reparsed.entries[1].content).toContain('@@keep_activate_after_match');
  });

  it('preserves extensions unchanged (spec mandate)', () => {
    const { parsed, reparsedJson } = roundTrip();
    expect(reparsedJson.data.extensions).toEqual(parsed.data.extensions);
  });

  it('drops unknown data keys on import (no-unknown-fields policy; cross-side parity with Go)', () => {
    const { reparsedJson } = roundTrip();
    // _future_extension is a non-spec key; it must be dropped on import and
    // never re-exported (the mapper no longer stores it, the exporter never
    // restores it).
    expect(
      (reparsedJson.data as unknown as Record<string, unknown>)._future_extension,
    ).toBeUndefined();
  });

  it('preserves assets unchanged', () => {
    const { parsed, reparsedJson } = roundTrip();
    expect(reparsedJson.data.assets).toEqual(parsed.data.assets);
  });

  it('preserves provenance: source + creation_date unchanged; modification_date bumped', () => {
    const { parsed, reparsedJson, exported } = roundTrip();

    expect(reparsedJson.data.source).toEqual(parsed.data.source);
    expect(reparsedJson.data.creation_date).toBe(parsed.data.creation_date);
    expect(reparsedJson.data.creator_notes_multilingual).toEqual(
      parsed.data.creator_notes_multilingual,
    );

    const originalMod = parsed.data.modification_date as number;
    expect(reparsedJson.data.modification_date).toBe(
      exported.data.modification_date,
    );
    expect(reparsedJson.data.modification_date as number).toBeGreaterThan(
      originalMod,
    );
    expect(reparsedJson.data.modification_date as number).toBeGreaterThanOrEqual(now());
  });

  it('re-parses the exported PNG to the identical card (modification_date preserved)', () => {
    const { reparsedJson, reparsedPng } = roundTrip();

    expect(reparsedPng.spec).toBe('chara_card_v3');
    expect(reparsedPng.spec_version).toBe('3.0');
    expect(reparsedPng.data).toEqual(reparsedJson.data);
    expect(reparsedPng.data.modification_date).toBe(
      reparsedJson.data.modification_date,
    );
  });

  it('produces a spec-conformant canonical JSON-card (parity reference)', () => {
    const { exported } = roundTrip();
    const parsed = JSON.parse(exportToJSON(exported)) as {
      spec: string;
      spec_version: string;
      data: Record<string, unknown>;
    };

    // Spec conformance (SPEC_V3): spec values, required arrays present.
    expect(parsed.spec).toBe('chara_card_v3');
    expect(parsed.spec_version).toBe('3.0');
    expect(Array.isArray(parsed.data.alternate_greetings)).toBe(true);
    expect(Array.isArray(parsed.data.tags)).toBe(true);
    expect(Array.isArray(parsed.data.group_only_greetings)).toBe(true);
    expect(typeof parsed.data.modification_date).toBe('number');

    // Canonical key order (see exporter.ts header — Go side must match).
    const keys = Object.keys(parsed.data);
    expect(keys.slice(0, 10)).toEqual([
      'name',
      'description',
      'personality',
      'scenario',
      'first_mes',
      'mes_example',
      'creator_notes',
      'system_prompt',
      'post_history_instructions',
      'alternate_greetings',
    ]);
    expect(keys.indexOf('group_only_greetings')).toBeLessThan(
      keys.indexOf('modification_date'),
    );
  });
});
