/**
 * TtsTestPanel-adjacent picker data — the TTS Language / Base Voice pickers in
 * ProviderSlotSection consume a model's `speech_options` and its declared
 * shapes DIFFER per provider (research soulvoice.md §3.2 / the gateway's
 * `SpeechOptions` type):
 *
 *  - soulbitscloud gateway live: `languages` = [{code, name, voices: [...]}]
 *    OBJECTS, and a flat `voices` ONLY when the model accepts `voice` without
 *    a language scope (KittenTTS) — chatterbox's voices live per language
 *  - soulvoice (HSE) live: `languages` = plain names, `voices` = [{voice,
 *    language?, styles?}] descriptors keyed `voice`
 *  - the app's offline catalog: neither (generic fallback applies)
 *
 * Regression notes (owner report, 2026-10-22): `String(code)` over the
 * gateway's language objects rendered "[object Object]" rows, and the old
 * voice normalizer only read `id`/`name` — so soulvoice's `voice`-keyed
 * entries were all dropped and chatterbox (no flat voices) always fell back
 * to the generic list (which looks like KittenTTS's defaults).
 */

import {
  normalizeTtsLanguageOptions,
  normalizeTtsVoiceOptions,
} from '../ProviderSlotSection';

describe('normalizeTtsLanguageOptions', () => {
  it('passes plain language-name strings through (soulvoice live shape)', () => {
    expect(
      normalizeTtsLanguageOptions(['default', 'en', 'de']),
    ).toEqual([
      { id: 'default', name: 'default' },
      { id: 'en', name: 'en' },
      { id: 'de', name: 'de' },
    ]);
  });

  it('maps the gateway descriptor objects by their code, naming them (soulbitscloud shape)', () => {
    expect(
      normalizeTtsLanguageOptions([
        { code: 'EN', name: 'English', voices: ['Voxel'] },
        { code: 'ZH', name: 'Chinese' },
      ]),
    ).toEqual([
      { id: 'EN', name: 'English' },
      { id: 'ZH', name: 'Chinese' },
    ]);
  });

  it('falls back to name/language/id fields when code is absent', () => {
    expect(
      normalizeTtsLanguageOptions([
        { language: 'default' },
        { id: 'en' },
        { name: 'German' },
      ]),
    ).toEqual([
      { id: 'default', name: 'default' },
      { id: 'en', name: 'en' },
      { id: 'German', name: 'German' },
    ]);
  });

  it('uses the generic fallback when the model declares no languages', () => {
    const fallback = normalizeTtsLanguageOptions(undefined);
    expect(fallback).toEqual(normalizeTtsLanguageOptions([]));
    // Auto + the ISO codes, uppercased exactly as Chatterbox declares them.
    expect(fallback[0]).toEqual({ id: 'Auto', name: 'Auto' });
    expect(fallback).toHaveLength(10);
    expect(fallback.some((o) => o.id === 'EN')).toBe(true);
  });

  it('never emits "[object Object]" rows for object entries', () => {
    const options = normalizeTtsLanguageOptions([
      { code: 'EN', name: 'English' } as any,
    ]);
    expect(options.every((o) => !o.id.includes('object'))).toBe(true);
  });
});

describe('normalizeTtsVoiceOptions', () => {
  it('passes flat voice strings through (soulbitscloud KittenTTS shape)', () => {
    expect(
      normalizeTtsVoiceOptions({ voices: ['Bella', 'Jasper'] }, 'default'),
    ).toEqual([
      { id: 'Bella', name: 'Bella' },
      { id: 'Jasper', name: 'Jasper' },
    ]);
  });

  it('reads soulvoice descriptor objects keyed `voice` (not just id/name)', () => {
    expect(
      normalizeTtsVoiceOptions(
        {
          voices: [
            { voice: 'Voxel', language: 'default', styles: ['whispering'] } as any,
            { voice: 'Bella' },
          ],
        },
        '',
      ),
    ).toEqual([
      { id: 'Voxel', name: 'Voxel' },
      { id: 'Bella', name: 'Bella' },
    ]);
  });

  it('scopes voices to the selected language when that language declares a set', () => {
    const speechOptions = {
      languages: [
        { code: 'EN', name: 'English', voices: ['Voxel', 'Slerp'] },
        { code: 'ZH', name: 'Chinese', voices: ['Mandarin'] },
      ],
    };
    expect(normalizeTtsVoiceOptions(speechOptions, 'EN')).toEqual([
      { id: 'Voxel', name: 'Voxel' },
      { id: 'Slerp', name: 'Slerp' },
    ]);
    // Case-insensitive match against the stored value.
    expect(normalizeTtsVoiceOptions(speechOptions, ' en ')).toEqual([
      { id: 'Voxel', name: 'Voxel' },
      { id: 'Slerp', name: 'Slerp' },
    ]);
  });

  it('shows the UNION of per-language voices + flat voices when no language is selected', () => {
    expect(
      normalizeTtsVoiceOptions(
        {
          languages: [
            { code: 'EN', name: 'English', voices: ['Voxel'] },
            { code: 'ZH', name: 'Chinese', voices: ['Mandarin'] },
          ],
          voices: ['Bella'],
        },
        '',
      ),
    ).toEqual([
      { id: 'Bella', name: 'Bella' },
      { id: 'Voxel', name: 'Voxel' },
      { id: 'Mandarin', name: 'Mandarin' },
    ]);
  });

  it('dedupes voices shared across languages', () => {
    const union = normalizeTtsVoiceOptions(
      {
        languages: [
          { code: 'EN', voices: ['Voxel'] },
          { code: 'ZH', voices: ['Voxel', 'Mandarin'] },
        ],
      },
      '',
    );
    expect(union).toEqual([
      { id: 'Voxel', name: 'Voxel' },
      { id: 'Mandarin', name: 'Mandarin' },
    ]);
  });

  it('falls back to the generic voice list only when NOTHING is declared', () => {
    // The app's offline catalog declares neither voices nor languages.
    const options = normalizeTtsVoiceOptions(null, '');
    expect(options).toEqual([
      { id: 'Claire', name: 'Claire' },
      { id: 'Bella', name: 'Bella' },
      { id: 'Nova', name: 'Nova' },
      { id: 'Alloy', name: 'Alloy' },
      { id: 'Echo', name: 'Echo' },
      { id: 'Shimmer', name: 'Shimmer' },
    ]);
    // A model with languages but no voices at all still gets the fallback
    // (its language entry carries no scoped set).
    expect(normalizeTtsVoiceOptions({ languages: ['default'] }, '')).toEqual(options);
  });

  it('prefers flat voices over per-language entries with no scoped match', () => {
    // KittenTTS: flat voices present; language "default" may or may not
    // declare its own set — the flat list wins when no scoped match applies.
    expect(
      normalizeTtsVoiceOptions(
        { voices: ['Bella', 'Jasper'], languages: [{ code: 'default' }] },
        'default',
      ),
    ).toEqual([
      { id: 'Bella', name: 'Bella' },
      { id: 'Jasper', name: 'Jasper' },
    ]);
  });
});
