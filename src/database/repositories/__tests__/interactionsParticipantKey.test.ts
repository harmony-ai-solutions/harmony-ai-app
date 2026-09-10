/**
 * Participant-key derivation (F4/O3) — pins the app's
 * `deriveParticipantKey` / `deriveScopeFromParticipants` against the EXACT
 * engine contract (harmony-link-private `DeriveParticipantKey` /
 * `DeriveScopeFromParticipants`, database/controllers/interaction_controller.go):
 *
 *   - world:  0 or 1 participants → scope "world", key ""
 *   - private: exactly 2 participants → sorted pair "own+partner" (the own
 *     entity is ALWAYS in the key)
 *   - group:  3+ participants → full sorted participant set joined by "+"
 *     (the set ALWAYS includes the own entity; overlapping groups must not
 *     collide; every member of the same group derives the same key)
 *
 * The caller-convention cases (per-persona private keys, group set incl. own
 * entity) mirror the engine's own tests:
 *   interaction_controller_test.go: TestDeriveParticipantKey_Private,
 *   TestDeriveParticipantKey_Group, TestDeriveParticipantKey_GroupOverlapCollision,
 *   TestDeriveParticipantKey_World, TestDeriveParticipantKey_OwnEntityNotInSet
 */

jest.mock('../../connection', () => ({
  getDatabase: jest.fn(),
}));

import {
  deriveParticipantKey,
  deriveScopeFromParticipants,
} from '../interactions';

describe('deriveScopeFromParticipants (engine parity)', () => {
  it('maps participant counts to scopes exactly like the engine', () => {
    expect(deriveScopeFromParticipants([])).toBe('world');
    expect(deriveScopeFromParticipants(['own'])).toBe('world');
    expect(deriveScopeFromParticipants(['own', 'partner'])).toBe('private');
    expect(deriveScopeFromParticipants(['own', 'a', 'b'])).toBe('group');
    expect(deriveScopeFromParticipants(['own', 'a', 'b', 'c'])).toBe('group');
  });
});

describe('deriveParticipantKey — private pair includes own entity (O3)', () => {
  it('derives the sorted pair key when the own entity is in the set', () => {
    expect(deriveParticipantKey(['a', 'b'], 'a', 'private')).toBe('a+b');
    // Unsorted input — the pair is always sorted for a deterministic key.
    expect(deriveParticipantKey(['b', 'a'], 'a', 'private')).toBe('a+b');
    // Own entity is the SECOND id — key must still be the sorted pair.
    expect(deriveParticipantKey(['a', 'b'], 'b', 'private')).toBe('a+b');
  });

  it('per-persona semantics: different personas derive DIFFERENT private keys for the same partner', () => {
    const keyPersona1 = deriveParticipantKey(
      ['user-persona-1', 'marcella'],
      'user-persona-1',
      'private',
    );
    const keyPersona2 = deriveParticipantKey(
      ['user-persona-2', 'marcella'],
      'user-persona-2',
      'private',
    );
    expect(keyPersona1).toBe('marcella+user-persona-1');
    expect(keyPersona2).toBe('marcella+user-persona-2');
    expect(keyPersona1).not.toBe(keyPersona2);
  });

  it('matches the engine scope-from-count shortcut: count===2 derives a private key even when scope differs', () => {
    // Engine: `if scope == "private" || n == 2` — a 2-person set keyed as
    // private even when an inconsistent scope string is passed.
    expect(deriveParticipantKey(['a', 'b'], 'a', 'group')).toBe('a+b');
  });

  it('engine parity edge: own entity NOT in the set pairs own with the first other (not the caller convention)', () => {
    // Mirrors engine TestDeriveParticipantKey_OwnEntityNotInSet: a robust
    // fallback, but every real caller passes the full set incl. own entity.
    expect(
      deriveParticipantKey(['entity-2', 'entity-3'], 'entity-1', 'private'),
    ).toBe('entity-1+entity-2');
  });

  it('engine parity edge: a set of only the own entity has no partner → empty key', () => {
    expect(deriveParticipantKey(['entity-1'], 'entity-1', 'private')).toBe('');
  });
});

describe('deriveParticipantKey — group set includes own entity (O3)', () => {
  it('derives the full sorted participant set key', () => {
    expect(
      deriveParticipantKey(['alice', 'bob', 'own'], 'own', 'group'),
    ).toBe('alice+bob+own');
  });

  it('every member of the same group derives the SAME key (engine regression)', () => {
    const groupA = ['alice', 'bob', 'carol'];
    expect(deriveParticipantKey(groupA, 'alice', 'group')).toBe(
      'alice+bob+carol',
    );
    expect(deriveParticipantKey(groupA, 'bob', 'group')).toBe('alice+bob+carol');
    expect(deriveParticipantKey(groupA, 'carol', 'group')).toBe(
      'alice+bob+carol',
    );
  });

  it('overlapping groups produce DIFFERENT keys (engine collision regression)', () => {
    const groupA = ['alice', 'bob', 'own'];
    const groupB = ['alice', 'dave', 'own'];
    const keyA = deriveParticipantKey(groupA, 'own', 'group');
    const keyB = deriveParticipantKey(groupB, 'own', 'group');
    expect(keyA).toBe('alice+bob+own');
    expect(keyB).toBe('alice+dave+own');
    expect(keyA).not.toBe(keyB);
  });
});

describe('deriveParticipantKey — world scope (O3)', () => {
  it('returns an empty key for 0 or 1 participants', () => {
    expect(deriveParticipantKey(['only-one'], 'only-one', 'world')).toBe('');
    expect(deriveParticipantKey([], 'anyone', 'world')).toBe('');
  });
});

describe('deriveParticipantKey — 6-1 §3 vectors with TIMESTAMPED entity ids (D2 compatibility)', () => {
  // Post-D2 ids carry "-" (base-YYYYMMDDHHMMSS) and dedupe suffixes
  // ("-2"); the "+"-joined key format is unaffected — the sorted pair/set
  // must round-trip timestamped ids exactly like the engine.
  it('private: sorted pair with timestamped ids', () => {
    expect(
      deriveParticipantKey(
        ['Isabella-20260905123514', 'user'],
        'user',
        'private',
      ),
    ).toBe('Isabella-20260905123514+user');
  });

  it('private: order-flipped input still sorts (deterministic key)', () => {
    expect(
      deriveParticipantKey(
        ['user', 'Isabella-20260905123514'],
        'user',
        'private',
      ),
    ).toBe('Isabella-20260905123514+user');
    // Same key from the OTHER side's perspective (own = Isabella).
    expect(
      deriveParticipantKey(
        ['Isabella-20260905123514', 'user'],
        'Isabella-20260905123514',
        'private',
      ),
    ).toBe('Isabella-20260905123514+user');
  });

  it('group: sorted full set with dedupe-suffixed timestamped ids', () => {
    expect(
      deriveParticipantKey(
        ['B-20260905123514-2', 'A-20260905123514', 'C-20260905123514'],
        'A-20260905123514',
        'group',
      ),
    ).toBe('A-20260905123514+B-20260905123514-2+C-20260905123514');
  });

  it('world: a single timestamped id yields an empty key', () => {
    expect(
      deriveParticipantKey(
        ['Isabella-20260905123514'],
        'Isabella-20260905123514',
        'world',
      ),
    ).toBe('');
  });
});