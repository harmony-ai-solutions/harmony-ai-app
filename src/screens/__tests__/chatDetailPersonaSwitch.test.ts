/**
 * ChatDetailScreen — persona-switch decision (review).
 *
 * The persona switcher must navigate to the persona's OWN thread (thread-per-
 * persona: `participant_key` includes the own identity, engine FindResumableSession
 * matches exact participant sets). This verifies the extracted pure decision
 * helper `buildPersonaSwitchPlan`, which the full screen (no node-env render
 * harness — RN 0.86 crash) delegates to:
 *   - selecting the currently-active persona → no-op (just close the modal)
 *   - a new persona → a replace-target param set for the persona's own thread
 *   - 'user' ("chat as myself") → clears the stored persona pref path
 */

import { buildPersonaSwitchPlan, PersonaSwitchPlan } from '../ChatDetailScreen';

type SwitchParams = Extract<PersonaSwitchPlan, { action: 'switch' }>['params'];

function expectSwitch(plan: PersonaSwitchPlan): SwitchParams {
  expect(plan.action).toBe('switch');
  if (plan.action !== 'switch') {
    throw new Error('Expected a switch plan');
  }
  return plan.params;
}

describe('buildPersonaSwitchPlan (persona switch decision)', () => {
  const base = {
    currentOwnEntityId: 'user',
    currentParticipantIds: ['user', 'claire'],
    partnerEntityName: 'Claire',
    newInteractionId: 'ix-temp',
  };

  it('no-op when selecting the currently-active persona (early return, no params)', () => {
    const plan = buildPersonaSwitchPlan({
      ...base,
      personaId: 'user',
    });
    expect(plan.action).toBe('noop');
  });

  it('produces replace-target params for a NEW persona (private chat)', () => {
    const plan = buildPersonaSwitchPlan({
      ...base,
      personaId: 'selina',
    });

    expect(expectSwitch(plan)).toEqual({
      interactionId: 'ix-temp',
      // Per-persona semantics: the own identity (selina) replaces 'user' and
      // the pair key sorts deterministically.
      participantKey: 'claire+selina',
      participantIds: ['selina', 'claire'],
      entityId: 'selina',
      entityName: 'Claire',
    });
  });

  it("'user' path replaces a persona with the chat-as-myself identity", () => {
    const plan = buildPersonaSwitchPlan({
      currentOwnEntityId: 'selina',
      currentParticipantIds: ['selina', 'claire'],
      partnerEntityName: 'Claire',
      newInteractionId: 'ix-temp',
      personaId: 'user',
    });

    expect(expectSwitch(plan)).toEqual({
      interactionId: 'ix-temp',
      participantKey: 'claire+user',
      participantIds: ['user', 'claire'],
      entityId: 'user',
      entityName: 'Claire',
    });
  });

  it('keeps every OTHER participant when switching identity in a group chat', () => {
    const plan = buildPersonaSwitchPlan({
      currentOwnEntityId: 'user',
      currentParticipantIds: ['user', 'alice', 'bob'],
      partnerEntityName: 'Alice',
      newInteractionId: 'ix-temp',
      personaId: 'selina',
    });

    expect(expectSwitch(plan)).toEqual({
      interactionId: 'ix-temp',
      participantKey: 'alice+bob+selina',
      participantIds: ['selina', 'alice', 'bob'],
      entityId: 'selina',
      entityName: 'Alice',
    });
  });
});
