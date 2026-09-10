/**
 * ChatBubbleService — multi-bubble JS API unit tests.
 *
 * These lock the JS-side contract of the Messenger-style bubble stack:
 *  - getActiveBubbleConversations() returns every shown conversation
 *  - getActiveBubbleConversation() keeps legacy single-bubble semantics
 *  - showBubble tracks each conversation (multi-bubble)
 *  - hideBubble(key) removes only that conversation; hideBubble() clears all
 *  - setBubbleUnreadCount forwards the participantKey to the native module
 */

import { NativeModules, Platform } from 'react-native';

jest.mock('../../utils/logger', () => ({
  createLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }),
}));

const mockNative = {
  isSupported: jest.fn(async () => true),
  hasPermission: jest.fn(async () => true),
  requestPermission: jest.fn(async () => true),
  show: jest.fn(() => true),
  hide: jest.fn(),
  hideOne: jest.fn(),
  setUnreadCount: jest.fn(),
  closeWindow: jest.fn(),
};

function makeConversation(participantKey: string) {
  return {
    participantKey,
    interactionId: `interaction-${participantKey}`,
    entityId: `entity-${participantKey}`,
    ownEntityId: 'user',
    entityName: `Name ${participantKey}`,
    participantIds: ['user', `entity-${participantKey}`],
    avatar: null,
  };
}

/** Load the service module with a fresh module registry + our native mock. */
async function loadService() {
  jest.resetModules();
  (Platform as any).OS = 'android';
  (NativeModules as any).ChatBubbleModule = mockNative;
  const mod = require('../ChatBubbleService');
  // The AppState listener registered at module load must be cleaned up per
  // load, but the service API is what we assert on.
  return mod;
}

describe('ChatBubbleService multi-bubble API', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('tracks every shown conversation (stack order)', async () => {
    const svc = await loadService();
    await svc.showBubble(makeConversation('alice'));
    await svc.showBubble(makeConversation('bob'));

    const all = svc.getActiveBubbleConversations();
    expect(all.map((c: any) => c.participantKey)).toEqual(['alice', 'bob']);
  });

  it('showBubble overwrites the same conversation (reopen) without duplicating', async () => {
    const svc = await loadService();
    await svc.showBubble(makeConversation('alice'));
    await svc.showBubble({ ...makeConversation('alice'), entityName: 'Alice v2' });

    const all = svc.getActiveBubbleConversations();
    expect(all).toHaveLength(1);
    expect(all[0].entityName).toBe('Alice v2');
  });

  it('getActiveBubbleConversation returns the most recent (legacy)', async () => {
    const svc = await loadService();
    await svc.showBubble(makeConversation('alice'));
    await svc.showBubble(makeConversation('bob'));

    expect(svc.getActiveBubbleConversation()?.participantKey).toBe('bob');
  });

  it('hideBubble(key) removes only that bubble', async () => {
    const svc = await loadService();
    await svc.showBubble(makeConversation('alice'));
    await svc.showBubble(makeConversation('bob'));

    await svc.hideBubble('alice');

    const keys = svc.getActiveBubbleConversations().map((c: any) => c.participantKey);
    expect(keys).toEqual(['bob']);
    expect(mockNative.hideOne).toHaveBeenCalledWith('alice');
    expect(mockNative.hide).not.toHaveBeenCalled();
  });

  it('hideBubble() without key clears everything and calls native hide()', async () => {
    const svc = await loadService();
    await svc.showBubble(makeConversation('alice'));
    await svc.showBubble(makeConversation('bob'));

    await svc.hideBubble();

    expect(svc.getActiveBubbleConversations()).toHaveLength(0);
    expect(mockNative.hide).toHaveBeenCalledTimes(1);
    expect(mockNative.hideOne).not.toHaveBeenCalled();
  });

  it('setBubbleUnreadCount forwards the participantKey to the native module', async () => {
    await loadService();
    const { setBubbleUnreadCount } = require('../ChatBubbleService');
    await setBubbleUnreadCount(7, 'alice');
    expect(mockNative.setUnreadCount).toHaveBeenCalledWith(7, 'alice');
  });

  it('setBubbleUnreadCount without key forwards null (legacy single bubble)', async () => {
    await loadService();
    const { setBubbleUnreadCount } = require('../ChatBubbleService');
    await setBubbleUnreadCount(3);
    expect(mockNative.setUnreadCount).toHaveBeenCalledWith(3, null);
  });

  it('hasBubblePermission still works', async () => {
    const svc = await loadService();
    await expect(svc.hasBubblePermission()).resolves.toBe(true);
  });
});
