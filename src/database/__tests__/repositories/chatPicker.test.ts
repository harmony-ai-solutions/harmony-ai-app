/**
 * getChatPickerRows — "Start a new chat" picker row query tests.
 *
 * Locks the picker rulings (product owner, Variant B):
 *  1a. CARD rows — live profiles (`deleted_at IS NULL`) that NO live entity
 *      references (neither 'ai' nor 'user'). Tapping mints a fresh entity
 *      (existing create path).
 *  1b. ENTITY rows — every live AI entity (`entity_type='ai'`,
 *      `deleted_at IS NULL`) with a LIVE linked card that has had NO
 *      interaction with the CURRENTLY impersonated persona. ONE ROW PER
 *      ENTITY — two unused entities sharing a card produce two rows.
 *  2.  "Has had an actual interaction" is persona-scoped: it counts ONLY the
 *      persona's own POV interaction rows (`entity_id = <persona>`,
 *      `presence_type='phone'`, `deleted_at IS NULL`, and the entity id appears
 *      in `participant_ids`). Engine-mirrored rows (`entity_id = <character
 *      entity>`) are IGNORED. Soft-deleted POV interactions do NOT count —
 *      deleting a conversation re-offers the entity as a fresh chat. Any
 *      scope counts, no status filter.
 *  3.  Disabled + muted entities ARE visible (no is_disabled/is_muted filter).
 *  4.  The union is a mixed alphabetical list sorted by resolved label
 *      (case-insensitive).
 */

import {useFreshDatabase} from '../repositoryFixtures';
import {
  createCharacterProfile,
  getChatPickerRows,
  hasChatPickerLibrary,
  resolveChatPickerRowLabel,
  ChatPickerRow,
} from '../../repositories/characters';
import {createEntity, deleteEntity} from '../../repositories/entities';
import {createInteraction} from '../../repositories/interactions';
import {deleteCharacterProfile} from '../../repositories/characters';
import {Interaction} from '../../models';

describe('getChatPickerRows', () => {
  const {getDb} = useFreshDatabase();

  /** The impersonated persona in most tests (engine-seeded built-in). */
  const PERSONA = 'user';

  const makeProfile = (id: string, name: string, nickname?: string) =>
    createCharacterProfile({
      id,
      name,
      description: `desc-${id}`,
      personality: '',
      voice_characteristics: '',
      base_prompt: '',
      scenario: '',
      typing_speed_wpm: 60,
      audio_response_chance_percent: 50,
      vision_config_id: null,
      lifecycle_config: '{}',
      ...(nickname !== undefined ? {nickname} : {}),
    });

  const makeEntity = (
    id: string,
    profileId: string | null,
    opts: {
      entity_type?: string;
      is_disabled?: number;
      is_muted?: number;
      alias?: string;
    } = {},
  ) =>
    createEntity(
      {
        id,
        alias: opts.alias ?? id,
        character_profile_id: profileId,
        lifecycle_config: '{}',
        rag_reindex_required: 1,
      },
      {
        entity_type: opts.entity_type ?? 'ai',
        is_disabled: opts.is_disabled ?? 0,
        is_muted: opts.is_muted ?? 0,
      },
    );

  const makeInteraction = (
    id: string,
    ownerId: string,
    participantIds: string[],
    opts: {presence_type?: string; deleted_at?: string | null} = {},
  ) => {
    const now = '2026-08-20T10:00:00.000Z';
    const ix: Interaction = {
      id,
      entity_id: ownerId,
      interaction_scope: participantIds.length === 2 ? 'private' : 'group',
      participant_key: `k-${id}`,
      participant_ids: JSON.stringify(participantIds),
      status: 'active',
      started_at: now,
      last_activity_at: now,
      ended_at: null,
      memory_id: null,
      continued_interaction_id: null,
      metadata: null,
      summary: null,
      presence_type: opts.presence_type ?? 'phone',
      created_at: now,
      updated_at: now,
      deleted_at: opts.deleted_at ?? null,
    };
    return createInteraction(ix);
  };

  /** Stable "<kind>:<id>" keys for asserting row identity + order. */
  const keys = (rows: ChatPickerRow[]) =>
    rows.map(r => (r.kind === 'card' ? `card:${r.profile.id}` : `entity:${r.entity.id}`));

  beforeEach(async () => {
    // interactions.entity_id FK-constrains entities(id) — seed the persona
    // entities BEFORE any interaction (precedent: interactionsPagination.test.ts).
    await makeEntity('user', null, {entity_type: 'user'});
  });

  // ── 1a. Card rows ────────────────────────────────────────────────────────

  it('a card with no entities yields one card row', async () => {
    await makeProfile('p1', 'Aria');

    const rows = await getChatPickerRows(PERSONA);

    expect(keys(rows)).toEqual(['card:p1']);
    expect(rows[0].kind).toBe('card');
  });

  it('a card with a live AI entity yields an ENTITY row only (no card row)', async () => {
    await makeProfile('p1', 'Aria');
    await makeEntity('e1', 'p1');

    const rows = await getChatPickerRows(PERSONA);

    expect(keys(rows)).toEqual(['entity:e1']);
  });

  it('a persona-owned card (live user entity) is hidden entirely', async () => {
    await makeProfile('p1', 'My Persona Card');
    await makeEntity('owner-user', 'p1', {entity_type: 'user'});

    const rows = await getChatPickerRows(PERSONA);

    // Neither a card row (a live entity references the card) nor an entity
    // row (user entities are chat identities, never picker partners).
    expect(rows).toEqual([]);
  });

  it('a soft-deleted profile appears nowhere', async () => {
    await makeProfile('p1', 'Aria');
    await deleteCharacterProfile('p1');

    const rows = await getChatPickerRows(PERSONA);

    expect(rows).toEqual([]);
  });

  it('a soft-deleted entity FREES its card row (card is offered again)', async () => {
    await makeProfile('p1', 'Aria');
    await makeEntity('e1', 'p1');
    await deleteEntity('e1');

    const rows = await getChatPickerRows(PERSONA);

    expect(keys(rows)).toEqual(['card:p1']);
  });

  // ── 1b. One row per entity ───────────────────────────────────────────────

  it('TWO unused entities on one card produce TWO entity rows', async () => {
    await makeProfile('p1', 'Aria');
    await makeEntity('e1', 'p1');
    await makeEntity('e2', 'p1');

    const rows = await getChatPickerRows(PERSONA);

    expect(keys(rows).sort()).toEqual(['entity:e1', 'entity:e2']);
    // No card row — the card is referenced by live entities.
    expect(rows.every(r => r.kind === 'entity')).toBe(true);
  });

  // ── 2. Persona-scoped "has had an actual interaction" (Variant B) ────────

  it('a POV phone interaction with the persona hides the entity', async () => {
    await makeProfile('p1', 'Aria');
    await makeEntity('e1', 'p1');
    await makeInteraction('ix-1', PERSONA, [PERSONA, 'e1']);

    const rows = await getChatPickerRows(PERSONA);

    expect(rows).toEqual([]);
  });

  it('an engine-mirrored row (entity_id = the character entity) does NOT hide', async () => {
    await makeProfile('p1', 'Aria');
    await makeEntity('e1', 'p1');
    // The engine syncs the same chat back with entity_id = the CHARACTER.
    await makeInteraction('ix-mirror', 'e1', [PERSONA, 'e1']);

    const rows = await getChatPickerRows(PERSONA);

    expect(keys(rows)).toEqual(['entity:e1']);
  });

  it('a soft-deleted POV interaction does NOT hide the entity (Variant B: delete re-offers)', async () => {
    await makeProfile('p1', 'Aria');
    await makeEntity('e1', 'p1');
    await makeInteraction('ix-1', PERSONA, [PERSONA, 'e1'], {
      deleted_at: '2026-08-21T10:00:00.000Z',
    });

    const rows = await getChatPickerRows(PERSONA);

    expect(keys(rows)).toEqual(['entity:e1']);
  });

  it("a presence_type='web' POV interaction does NOT hide the entity", async () => {
    await makeProfile('p1', 'Aria');
    await makeEntity('e1', 'p1');
    await makeInteraction('ix-1', PERSONA, [PERSONA, 'e1'], {presence_type: 'web'});

    const rows = await getChatPickerRows(PERSONA);

    expect(keys(rows)).toEqual(['entity:e1']);
  });

  it('a group-scope POV interaction hides the entity too (any scope counts)', async () => {
    await makeProfile('p1', 'Aria');
    await makeEntity('e1', 'p1');
    await makeEntity('e2', null); // a third group participant
    await makeInteraction('ix-group', PERSONA, [PERSONA, 'e1', 'e2']);

    const rows = await getChatPickerRows(PERSONA);

    expect(rows).toEqual([]);
  });

  it('persona scoping: an interaction under persona A does NOT hide the entity for persona B', async () => {
    await makeEntity('persona-b', null, {entity_type: 'user'});
    await makeProfile('p1', 'Aria');
    await makeEntity('e1', 'p1');
    await makeInteraction('ix-a', 'user', ['user', 'e1']);

    // Persona B never interacted with e1 → it is a fresh chat for them...
    expect(keys(await getChatPickerRows('persona-b'))).toEqual(['entity:e1']);
    // ...while persona A already chatted with it.
    expect(await getChatPickerRows('user')).toEqual([]);
  });

  it('falls back to JS filtering when a POV row carries malformed participant_ids JSON (no crash)', async () => {
    await makeProfile('p1', 'Char One');
    await makeProfile('p2', 'Char Two');
    await makeEntity('e1', 'p1');
    await makeEntity('e2', 'p2');
    // A VALID POV interaction hides e1…
    await makeInteraction('ix-valid', PERSONA, [PERSONA, 'e1']);
    // …and a MALFORMED participant_ids row makes `json_each` throw mid-scan —
    // the whole SQL query fails, so the defensive JS fallback must take over:
    // it skips the malformed row (hides nothing) and still applies the valid one.
    await getDb().executeSql(
      `INSERT INTO interactions
         (id, entity_id, interaction_scope, participant_ids, status,
          started_at, last_activity_at, presence_type, created_at, updated_at)
       VALUES ('ix-bad', 'user', 'private', 'not-json', 'active',
               '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z',
               'phone', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
    );

    const rows = await getChatPickerRows(PERSONA);

    expect(keys(rows)).toEqual(['entity:e2']);
  });

  it('survives a POV row with malformed participant_ids when nothing else matches', async () => {
    await makeProfile('p1', 'Aria');
    await makeEntity('e1', 'p1');
    await getDb().executeSql(
      `INSERT INTO interactions
         (id, entity_id, interaction_scope, participant_ids, status,
          started_at, last_activity_at, presence_type, created_at, updated_at)
       VALUES ('ix-bad', 'user', 'private', '{oops', 'active',
               '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z',
               'phone', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
    );

    // The malformed row hides nothing — no crash, entity still offered.
    expect(keys(await getChatPickerRows(PERSONA))).toEqual(['entity:e1']);
  });

  // ── 3. Disabled + muted stay visible ─────────────────────────────────────

  it('disabled and muted entities are STILL listed (no flag filter, ruling 3)', async () => {
    await makeProfile('p1', 'Aria');
    await makeProfile('p2', 'Bela');
    await makeEntity('e1', 'p1', {is_disabled: 1});
    await makeEntity('e2', 'p2', {is_muted: 1});

    const rows = await getChatPickerRows(PERSONA);

    expect(keys(rows).sort()).toEqual(['entity:e1', 'entity:e2']);
  });

  // ── 4. Mixed alphabetical ordering (COLLATE NOCASE) ──────────────────────

  it('interleaves card + entity rows sorted by resolved label, case-insensitive', async () => {
    // Labels resolve to: 'banana' (card name), 'Apple' (entity alias beats the
    // profile name 'Alicia'), 'Cherry' (entity alias '' falls back to name).
    await makeProfile('p-banana', 'banana');
    await makeProfile('p-alicia', 'Alicia');
    await makeProfile('p-cherry', 'Cherry');
    await makeEntity('e-apple', 'p-alicia', {alias: 'Apple'});
    await makeEntity('e-cherry', 'p-cherry', {alias: ''});

    const rows = await getChatPickerRows(PERSONA);

    // NOCASE: 'Apple' < 'banana' < 'Cherry' — a byte-order sort would put
    // 'Cherry' before 'banana' ('C' < 'b' in ASCII).
    expect(keys(rows)).toEqual(['entity:e-apple', 'card:p-banana', 'entity:e-cherry']);
  });

  // ── resolveChatPickerRowLabel (shared label helper) ──────────────────────

  describe('resolveChatPickerRowLabel', () => {
    /** Minimal in-memory profile stub — the label helper only reads name/nickname. */
    const stubProfile = (name: string, nickname: string): any => ({
      id: 'p1',
      name,
      nickname,
    });

    it('card rows prefer the nickname, falling back to the name', () => {
      const named: ChatPickerRow = {kind: 'card', profile: stubProfile('Alicia', 'Ali')};
      expect(resolveChatPickerRowLabel(named)).toBe('Ali');

      const plain: ChatPickerRow = {kind: 'card', profile: stubProfile('Alicia', '')};
      expect(resolveChatPickerRowLabel(plain)).toBe('Alicia');
    });

    it('entity rows prefer the alias, then nickname, then name', () => {
      const aliased: ChatPickerRow = {
        kind: 'entity',
        entity: {id: 'e1', alias: 'Apple'} as any,
        profile: stubProfile('Alicia', 'Ali'),
      };
      expect(resolveChatPickerRowLabel(aliased)).toBe('Apple');

      const noAlias: ChatPickerRow = {
        kind: 'entity',
        entity: {id: 'e1', alias: ''} as any,
        profile: stubProfile('Alicia', 'Ali'),
      };
      expect(resolveChatPickerRowLabel(noAlias)).toBe('Ali');

      const bare: ChatPickerRow = {
        kind: 'entity',
        entity: {id: 'e1', alias: ''} as any,
        profile: stubProfile('Alicia', ''),
      };
      expect(resolveChatPickerRowLabel(bare)).toBe('Alicia');
    });
  });

  // ── hasChatPickerLibrary (empty-state discriminator) ─────────────────────

  describe('hasChatPickerLibrary', () => {
    it('is false on a truly empty library', async () => {
      expect(await hasChatPickerLibrary()).toBe(false);
    });

    it('is true when at least one non-persona-owned card exists', async () => {
      await makeProfile('p1', 'Aria');
      expect(await hasChatPickerLibrary()).toBe(true);
    });

    it('is false when the only card is persona-owned', async () => {
      await makeProfile('p1', 'My Persona Card');
      await makeEntity('owner-user', 'p1', {entity_type: 'user'});
      expect(await hasChatPickerLibrary()).toBe(false);
    });
  });
});
