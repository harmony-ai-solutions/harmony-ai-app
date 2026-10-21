/**
 * EntitySessionContext — referential stability of the exposed session API.
 *
 * Regression guard for the 3 Hz session re-INIT loop (owner device, 2026-10-21).
 * Two independent identity leaks fed that loop:
 *
 *   1. `startInteractionSession` stored the session with
 *      `new Map(prev); newMap.set(id, session); return newMap` — for a REUSED
 *      session (the service returns the existing object, same content) that
 *      produced a brand-new Map reference for zero observable change, so the
 *      provider's `value` useMemo recomputed on every re-INIT.
 *   2. `startInteractionSession` / `isSessionActive` were plain functions rebuilt
 *      on every render, so every recompute handed consumers NEW identities.
 *      ChatDetailScreen lists them as deps of its `initializeSession`; the init
 *      effect therefore re-fired, paid GET /api/entities/:id/chat-list (~330 ms)
 *      and a reused INIT, and the cycle repeated forever.
 *
 * Both are pinned here: a reused start must not change the map reference and the
 * two callbacks must keep one identity across renders that DO change state.
 */
import React from 'react';
import { renderHook, act } from '@testing-library/react-native';
import { EntitySessionProvider, useEntitySession } from '../EntitySessionContext';
import EntitySessionService from '../../services/EntitySessionService';

jest.mock('../../services/EntitySessionService', () => {
  const { EventEmitter } = require('eventemitter3');
  const svc: any = new EventEmitter();
  const realEmit = svc.emit.bind(svc);
  svc.emit = jest.fn((...args: any[]) => realEmit(...args));
  svc.startInteractionSession = jest.fn();
  svc.stopInteractionSession = jest.fn(async (id: string) => {
    realEmit('session:stopped', id);
  });
  svc.closeAllSessions = jest.fn(async () => undefined);
  svc.sendTextMessage = jest.fn();
  return { __esModule: true, default: svc, EntitySessionService: svc };
});

jest.mock('../../utils/logger', () => ({
  createLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }),
}));

jest.mock('../SyncConnectionContext', () => ({
  useSyncConnection: () => ({ isConnected: true }),
}));

const serviceMock = EntitySessionService as any;

const wrapper = ({ children }: any) => (
  <EntitySessionProvider>{children}</EntitySessionProvider>
);

/** A discarded session in the shape the service returns (content only). */
function makeSession(): any {
  return {
    interactionId: 'ix-1',
    interaction: null,
    ownEntityId: 'user',
    participantIds: ['claire', 'user'],
    connections: new Map([
      ['claire', { connectionId: 'c-claire', status: 'active' }],
      ['user', { connectionId: 'c-user', status: 'active' }],
    ]),
    pendingTranscriptions: new Map(),
    replyMode: 'realistic',
    initRetryCount: 0,
  };
}

describe('EntitySessionContext — session API referential stability', () => {
  beforeEach(() => {
    // The provider arms its 15 s initialization timer on every start; fake timers
    // keep it from holding the jest worker open (same convention as the sibling
    // retry/sessionFailed suites for long-lived timers).
    jest.useFakeTimers();
    jest.clearAllMocks();
    serviceMock.startInteractionSession.mockReset();
    serviceMock.removeAllListeners();
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it('a REUSED session start keeps the activeSessions Map reference (no observable change)', async () => {
    // The service returns the SAME object twice: the second call is the "Reusing
    // existing interaction session" path from the owner-device trace.
    const reused = makeSession();
    serviceMock.startInteractionSession.mockResolvedValue(reused);

    const { result } = await renderHook(() => useEntitySession(), { wrapper });

    await act(async () => {
      await result.current.startInteractionSession('user', ['claire', 'user']);
    });
    const mapAfterFirst = result.current.activeSessions;
    expect(mapAfterFirst.get('ix-1')).toBe(reused);

    await act(async () => {
      await result.current.startInteractionSession('user', ['claire', 'user']);
    });

    // Pre-fix: a NEW Map with the same single entry (identity churn → provider
    // value recompute → new callbacks → ChatDetail init effect re-fire).
    expect(result.current.activeSessions).toBe(mapAfterFirst);
    expect(result.current.getInteractionSession('ix-1')).toBe(reused);
  });

  it('keeps startInteractionSession / isSessionActive identical across real state updates', async () => {
    serviceMock.startInteractionSession.mockResolvedValue(makeSession());

    const { result } = await renderHook(() => useEntitySession(), { wrapper });

    const startRef = result.current.startInteractionSession;
    const isActiveRef = result.current.isSessionActive;

    // A real change: the session is added to the map.
    await act(async () => {
      await result.current.startInteractionSession('user', ['claire', 'user']);
    });
    expect(result.current.activeSessions.size).toBe(1);

    // And a real removal (the service emits session:stopped on teardown).
    await act(async () => {
      serviceMock.stopInteractionSession('ix-1');
    });
    expect(result.current.activeSessions.size).toBe(0);

    // Three renders, two state changes, ONE identity each — deps downstream
    // (initializeSession, re-arm listeners) stay put.
    expect(result.current.startInteractionSession).toBe(startRef);
    expect(result.current.isSessionActive).toBe(isActiveRef);

    // Behaviour preserved: still reads live state through the refs.
    expect(result.current.isSessionActive('ix-1')).toBe(false);
  });
});
