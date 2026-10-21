import React, { createContext, useContext, useState, useEffect, useMemo, useCallback, useRef, ReactNode } from 'react';
import EntitySessionService, { InteractionSession } from '../services/EntitySessionService';
import { useSyncConnection } from './SyncConnectionContext';
import { isEntityLocked } from '../services/variant/entityAccess';
import { createLogger } from '../utils/logger';

const log = createLogger('[EntitySessionContext]');

/**
 * App-side terminal sentinel for a store-variant locked entity (plan 7-14 V3).
 * A locked entity's provider is not offered by this build, so INIT is refused
 * BEFORE it reaches the engine; the message must be classified as non-retryable
 * so the bounded retry loop gives up immediately (no "Scheduling retry 1/3"
 * spin) and the screen shows its neutral lock state.
 */
const ENTITY_PROVIDER_LOCKED = 'entity_provider_locked';

interface RetryState {
  attempts: number;
  nextRetryDelay: number;
  retryTimer?: any;
}

const DEFAULT_RETRY_POLICY = {
  maxAttempts: 3,
  initialDelay: 1000,
  maxDelay: 10000,
  backoffMultiplier: 2
};

/**
 * True when storing `next` in place of `prev` would not observably change
 * anything the UI reads (owner device, 2026-10-21 — the 3 Hz re-INIT loop).
 *
 * Why this exists: `EntitySessionService.startInteractionSession` REUSES a live
 * session for the same participant set and returns the very same object, so
 * `newMap.set(id, session)` stored identical CONTENT under a brand-new Map
 * REFERENCE. The provider's `value` useMemo (deps: activeSessions) then
 * recomputed and handed consumers freshly-built closures, which are deps of
 * ChatDetailScreen's `initializeSession` → the init effect re-fired → GET
 * /api/entities/:id/chat-list + a reused INIT … every ~330 ms, forever, for
 * every mounted chat screen. Returning the PREVIOUS map in this case keeps the
 * provider value referentially stable and cuts the loop at its source (the
 * screen guard in ChatDetailScreen is the second belt).
 *
 * Deliberately compares the fields consumers actually read (plus `replyMode`,
 * which decides pacing and therefore must not be silently dropped):
 * interactionId, own entity, failed marker, hasFirstMes, started, replyMode,
 * the participant id LIST (order matters — `participantIds` is rendered and
 * joined verbatim in places) and every connection's status.
 */
function sessionEntryUnchanged(
  prev: InteractionSession | undefined,
  next: InteractionSession,
): boolean {
  if (!prev) return false;
  if (prev === next) return true;
  if (prev.interactionId !== next.interactionId) return false;
  if (prev.ownEntityId !== next.ownEntityId) return false;
  if (prev.failed?.error !== next.failed?.error) return false;
  if (prev.hasFirstMes !== next.hasFirstMes) return false;
  if (prev.started !== next.started) return false;
  if (prev.replyMode !== next.replyMode) return false;
  if (prev.participantIds.length !== next.participantIds.length) return false;
  for (let i = 0; i < prev.participantIds.length; i++) {
    if (prev.participantIds[i] !== next.participantIds[i]) return false;
  }
  if (prev.connections.size !== next.connections.size) return false;
  for (const [entityId, connection] of prev.connections) {
    const other = next.connections.get(entityId);
    if (!other || other.status !== connection.status) return false;
  }
  return true;
}

interface EntitySessionContextType {
  // Interaction session management
  activeSessions: Map<string, InteractionSession>;
  isSessionActive: (interactionId: string) => boolean;
  startInteractionSession: (ownEntityId: string, participantIds: string[], replyMode?: string) => Promise<void>;
  stopInteractionSession: (interactionId: string) => Promise<void>;
  getInteractionSession: (interactionId: string) => InteractionSession | null;
  /**
   * 4-3 (bounded retention): stop + clear flagged (failed) session entries for
   * a participant set. Called on navigation-back — failed entries are keyed by
   * the service's temp interactionId, which a plain stop-by-id call never
   * matches (the temp→canonical swap only happens on INIT SUCCESS).
   */
  clearFailedSession: (ownEntityId: string, participantIds: string[]) => Promise<void>;

  // Message sending
  sendMessage: (interactionId: string, message: string) => Promise<void>;

  // Connection requirements
  canStartSession: boolean;
}

const EntitySessionContext = createContext<EntitySessionContextType | undefined>(undefined);

interface EntitySessionProviderProps {
  children: ReactNode;
}

export const EntitySessionProvider: React.FC<EntitySessionProviderProps> = ({ children }) => {
  const [activeSessions, setActiveSessions] = useState<Map<string, InteractionSession>>(new Map());

  // Retry bookkeeping (attempt counter, backoff delay, pending timer IDs) lives
  // in a ref, NOT state: nothing ever reads it during render, so a useState
  // binding would only trigger pointless provider re-renders. All reads/writes
  // go through retryStateRef.current (same pattern as activeSessionsRef), and
  // mutating the Map in place keeps every call site seeing the latest values.
  const retryStateRef = useRef<Map<string, RetryState>>(new Map());

  // Mirror activeSessions in a ref so the context's callbacks (memoized below)
  // always read the latest sessions WITHOUT capturing state in their closure.
  // This keeps the context value referentially stable across re-renders that
  // don't change sessions, so consumers (e.g. ChatDetailScreen) don't re-render
  // on every unrelated parent/provider render.
  const activeSessionsRef = useRef(activeSessions);
  activeSessionsRef.current = activeSessions;
  const entitySessionService = EntitySessionService;
  const { isConnected: isSyncConnected } = useSyncConnection();

  const canStartSession = isSyncConnected;

  // Live-value mirror for the ref-routed callbacks below: `canStartSession` is
  // state-derived, so a callback that closed over it directly would have to be
  // rebuilt on every connection change — and every rebuild changes the context
  // value's identity (the 3 Hz re-INIT loop, owner device 2026-10-21).
  const canStartSessionRef = useRef(canStartSession);
  canStartSessionRef.current = canStartSession;

  // Monitor sync connection and clean up sessions when it drops.
  // 4-3 (D36) evaluation: sync loss keeps the deliberate FULL teardown (no
  // retention of flagged/failed entries). Sync is a hard prerequisite for
  // entity sessions (start requires it), so nothing can proceed while down;
  // on reconnect the open chat's init effect re-runs and starts a fresh
  // session (the next session:started also purges same-set flagged entries).
  // Full teardown is additionally the GC point for flagged entries of chats
  // that are NOT on screen. See EntitySessionService.closeAllSessions.
  useEffect(() => {
    if (!isSyncConnected) {
      log.warn('Sync connection lost, clearing all entity sessions');
      entitySessionService.closeAllSessions();
    }
    // entitySessionService is a stable module-level singleton — including it
    // keeps the exhaustive-deps rule satisfied without re-running the effect.
  }, [isSyncConnected, entitySessionService]);

  useEffect(() => {
    const handleSessionStarted = (interactionId: string, session: InteractionSession) => {
      log.info('Interaction session started:', interactionId);

      // Clear retry state and timers — clean up by both interactionId and
      // participant-based fallback key (used when session creation failed)
      const retryMap = retryStateRef.current;
      // Clean up by interactionId
      const retry = retryMap.get(interactionId);
      if (retry?.retryTimer) {
        clearTimeout(retry.retryTimer);
      }
      retryMap.delete(interactionId);
      // Also clean up by participant-based fallback key
      const fallbackKey = session.participantIds.sort().join('+');
      const fallbackRetry = retryMap.get(fallbackKey);
      if (fallbackRetry?.retryTimer) {
        clearTimeout(fallbackRetry.retryTimer);
      }
      retryMap.delete(fallbackKey);

      setActiveSessions(prev => {
        const newMap = new Map(prev);
        const sortedParticipants = [...session.participantIds].sort().join('+');
        // Remove stale entries with temp UUIDv7 keys pointing to the same session
        // (the InteractionService re-keys from temp UUIDv7 to canonical ID)
        for (const [key, existing] of newMap.entries()) {
          if (existing === session && key !== interactionId) {
            newMap.delete(key);
            continue;
          }
          // 4-3 bounded retention (review 4): a flagged (failed) entry for the
          // same participant set is superseded by the fresh session — drop it
          // so failed entries don't accumulate one per failed chat.
          if (
            existing.failed &&
            existing !== session &&
            existing.ownEntityId === session.ownEntityId &&
            [...existing.participantIds].sort().join('+') === sortedParticipants
          ) {
            newMap.delete(key);
          }
        }
        newMap.set(interactionId, session);
        return newMap;
      });
    };

    const handleSessionStopped = (interactionId: string) => {
      log.info('Interaction session stopped:', interactionId);
      setActiveSessions(prev => {
        const newMap = new Map(prev);
        newMap.delete(interactionId);
        return newMap;
      });
    };

    const handleSessionError = (interactionId: string, error: string) => {
      log.error('Session error for interaction:', interactionId, error);
      // 4-3 (D36): KEEP the entry — flag it as terminally failed instead of
      // deleting (the old deletion here was the second silent-drop site). The
      // service flags the shared session object too; the shallow clone below
      // guarantees the state change propagates to consumers. A missing entry
      // (e.g. the legacy participant-keyed exhaustion emission for a start
      // that never registered) has nothing to flag.
      setActiveSessions(prev => {
        const existing = prev.get(interactionId);
        if (!existing || existing.failed) {
          return prev;
        }
        const newMap = new Map(prev);
        newMap.set(interactionId, {
          ...existing,
          failed: { error, at: Date.now() },
        });
        return newMap;
      });
    };

    entitySessionService.on('session:started', handleSessionStarted);
    entitySessionService.on('session:stopped', handleSessionStopped);
    entitySessionService.on('session:error', handleSessionError);

    return () => {
      entitySessionService.off('session:started', handleSessionStarted);
      entitySessionService.off('session:stopped', handleSessionStopped);
      entitySessionService.off('session:error', handleSessionError);
    };
    // entitySessionService is a stable module-level singleton — including it
    // keeps the exhaustive-deps rule satisfied without re-subscribing.
  }, [entitySessionService]);

  /**
   * INIT implementation. NOT exported directly: consumers get the ref-routed
   * `startInteractionSession` wrapper below, whose identity never changes.
   *
   * Identity note (owner device 2026-10-21 — the 3 Hz re-INIT loop): this
   * function is a plain closure rebuilt on every provider render, so exposing
   * it as-is made the context value's `startInteractionSession` change identity
   * whenever `activeSessions` changed. ChatDetailScreen lists it as a dep of its
   * `initializeSession`, so every session-map update re-fired that screen's init
   * effect → `getReplyMode()` (GET /api/entities/:id/chat-list, ~330 ms) +
   * a REUSED `startInteractionSession` (log: "Reusing existing interaction
   * session") → a fresh Map with identical content → next render → loop.
   */
  const startInteractionSessionImpl = async (
    ownEntityId: string,
    participantIds: string[],
    replyMode: string = 'realistic',
    preserveRetryState: boolean = false
  ): Promise<void> => {
    if (!canStartSessionRef.current) {
      throw new Error('Sync connection required for entity sessions');
    }

    // Store-variant entity lock (plan 7-14 V3): a locked partner (a provider
    // this build doesn't offer) must never INIT. Refuse here as defense in
    // depth for any start path that bypasses ChatDetail's gate. No-op / false
    // in the full variant (isEntityLocked short-circuits, zero fetches).
    const lockedPartner = (
      await Promise.all(
        participantIds
          .filter(id => id !== ownEntityId)
          .map(async id => ((await isEntityLocked(id)) ? id : null)),
      )
    ).find((id): id is string => id !== null);
    if (lockedPartner) {
      log.warn(`Refusing session INIT: partner ${lockedPartner} is locked in this build (7-14).`);
      throw new Error(ENTITY_PROVIDER_LOCKED);
    }

    // Derive a participant-based key for pre-session retry deduplication.
    // After the session is created, we switch to interactionId as the primary key.
    const participantKey = participantIds.sort().join('+');

    // Clear any existing retry state for this participant set — EXCEPT when this
    // call is itself a retry (preserveRetryState). The retry path must keep the
    // attempt counter so scheduleRetry escalates 1→2→3 and then gives up.
    // Clearing it here resets the counter to 0 on every retry, which made the
    // app loop "Scheduling retry 1/3" forever (an infinite connect/disconnect
    // loop hammering the engine).
    if (!preserveRetryState) {
      const retry = retryStateRef.current.get(participantKey);
      if (retry?.retryTimer) {
        clearTimeout(retry.retryTimer);
      }
      retryStateRef.current.delete(participantKey);
    }

    log.info(`Starting interaction session: ownEntity=${ownEntityId}, participants=[${participantIds.join(', ')}]`);

    try {
      // This will create N+1 connections in 'connecting' state and return immediately
      // The sessions will transition to 'active' when INIT_ENTITY responses arrive
      const session = await entitySessionService.startInteractionSession(ownEntityId, participantIds, replyMode);

      // Add to state immediately (connections are 'connecting')
      setActiveSessions(prev => {
        const existing = prev.get(session.interactionId);
        // Identity-stability fast path (owner device, 2026-10-21 — the 3 Hz
        // re-INIT loop): a REUSED session arrives here as the SAME object
        // already stored under its canonical id, i.e. identical content. Storing
        // it again would allocate a new Map REFERENCE for no observable change,
        // recompute the provider `value` useMemo and hand consumers new
        // callbacks — which re-fired ChatDetailScreen's init effect forever.
        // Returning `prev` makes this call a true no-op.
        //
        // The one exception is a stale ALIAS: if another key still points at
        // this same session object (pre-canonical temp id), the re-key must
        // still happen, so that case falls through to the copy below.
        let aliasedUnderOtherKey = false;
        for (const [key, value] of prev.entries()) {
          if (key !== session.interactionId && value === session) {
            aliasedUnderOtherKey = true;
            break;
          }
        }
        if (!aliasedUnderOtherKey && sessionEntryUnchanged(existing, session)) {
          return prev;
        }
        const newMap = new Map(prev);
        newMap.set(session.interactionId, session);
        return newMap;
      });

      // Use session.interactionId as the primary key for all subsequent tracking
      startInitializationTimer(session.interactionId, ownEntityId, participantIds);
    } catch (error) {
      log.error(`Failed to start interaction session:`, error);
      // No interactionId available — use participant-based fallback key for retry
      scheduleRetry(participantKey, ownEntityId, participantIds, error);
      throw error;
    }
  };

  /**
   * Live implementation handle for the ref-routed public `startInteractionSession`
   * below. The ref is re-pointed on every provider render, so the wrapper always
   * runs the CURRENT implementation (freshest state/closure) while its own
   * identity stays frozen — the property ChatDetailScreen's init effect needs.
   */
  const startInteractionSessionImplRef = useRef(startInteractionSessionImpl);
  startInteractionSessionImplRef.current = startInteractionSessionImpl;

  /**
   * STABLE `startInteractionSession` exposed through the context.
   *
   * Why a wrapper instead of `useCallback` on the implementation: the body calls
   * the local `startInitializationTimer`/`scheduleRetry` helpers, which are
   * themselves rebuilt every render and form a cycle with `retryInitialization`
   * → so no honest dependency array can keep a useCallback'd implementation
   * stable. Delegating through a ref gives the same guarantee without touching
   * the retry machinery's behaviour (the impl captured at call time is always
   * the latest one).
   */
  const startInteractionSession = useCallback(
    (
      ownEntityId: string,
      participantIds: string[],
      replyMode?: string,
      preserveRetryState?: boolean
    ): Promise<void> =>
      startInteractionSessionImplRef.current(
        ownEntityId,
        participantIds,
        replyMode,
        preserveRetryState
      ),
    [],
  );

  const startInitializationTimer = (
    interactionId: string,
    ownEntityId: string,
    participantIds: string[]
  ) => {
    // Use participantKey consistently as the retry state key so that
    // handleSessionStarted can find and cancel it via fallbackKey.
    // (interactionId may change from temp UUIDv7 to canonical — can't rely on it)
    const participantKey = participantIds.sort().join('+');

    // Wait up to 15 seconds for all connections to become active
    const timeoutId = setTimeout(() => {
      setActiveSessions(currentSessions => {
        // Find session by participant match (key may have changed from temp UUIDv7 to canonical)
        let foundSession: InteractionSession | null = null;
        let foundKey: string | null = null;
        for (const [key, s] of currentSessions.entries()) {
          if (s.ownEntityId === ownEntityId &&
              s.participantIds.sort().join('+') === participantKey) {
            foundSession = s;
            foundKey = key;
            break;
          }
        }

        if (!foundSession || !foundKey) {
          // 4-3 timer fix: the session disappeared (e.g. the service flagged a
          // failure and a stale entry was cleaned, or teardown raced the
          // timer). This used to log and silently stop — the exact dead-end
          // behind the eternal "Connecting…" dot. Schedule one context retry
          // (existing 3-attempt budget) instead.
          log.warn(`Initialization timeout: session for participants [${participantIds.join(', ')}] no longer exists — scheduling context retry`);
          scheduleRetry(
            participantKey,
            ownEntityId,
            participantIds,
            new Error('Session initialization timeout'),
          );
          return currentSessions;
        }

        // 4-3 timer fix (D36): a FLAGGED session is a terminal failure the
        // service already surfaced — but it may be transient (the incident
        // class: the engine hadn't ingested a freshly created entity). Give it
        // the same bounded context-retry budget instead of stopping silently.
        if (foundSession.failed) {
          log.warn(`Initialization timeout: session for [${participantIds.join(', ')}] already failed (${foundSession.failed.error}) — scheduling context retry`);
          scheduleRetry(
            participantKey,
            ownEntityId,
            participantIds,
            new Error(`Session initialization failed: ${foundSession.failed.error}`),
          );
          return currentSessions;
        }

        // Check if any connection is still not active
        const allActive = Array.from(foundSession.connections.values()).every(
          conn => conn.status === 'active'
        );

        if (!allActive) {
          const statuses = Array.from(foundSession.connections.entries())
            .map(([eid, conn]) => `${eid}=${conn.status}`)
            .join(', ');
          log.warn(`Initialization timeout for ${foundKey}: ${statuses}`);

          // Trigger retry using participantKey (consistent with startInteractionSession catch path)
          const error = new Error('Session initialization timeout');
          scheduleRetry(participantKey, ownEntityId, participantIds, error);
        }
        return currentSessions;
      });
    }, 15000); // 15 second timeout

    // Store timeout ID in retry state under participantKey (not interactionId)
    const current = retryStateRef.current.get(participantKey) || {
      attempts: 0,
      nextRetryDelay: DEFAULT_RETRY_POLICY.initialDelay
    };
    current.retryTimer = timeoutId;
    retryStateRef.current.set(participantKey, current);
  };

  const scheduleRetry = (
    key: string,
    ownEntityId: string,
    participantIds: string[],
    error: any
  ) => {
    // Check if this is a retryable error
    if (!isRetryableError(error)) {
      log.info(`Error is not retryable for ${key}, giving up`);
      return;
    }

    const currentRetry = retryStateRef.current.get(key) || {
      attempts: 0,
      nextRetryDelay: DEFAULT_RETRY_POLICY.initialDelay
    };

    // Check if we've exceeded max attempts
    if (currentRetry.attempts >= DEFAULT_RETRY_POLICY.maxAttempts) {
      log.error(`Max retry attempts (${DEFAULT_RETRY_POLICY.maxAttempts}) exceeded for ${key}`);

      // 4-3 review-4 wiring fix: find the tracked session entry for this
      // participant set and (a) flag it terminally failed, (b) emit
      // session:error with its REAL interactionId. The legacy code emitted
      // with the retry-map key (the participant key), which ChatDetail's
      // interactionId-matching listener never matched — the terminal error
      // never surfaced and no failed marker was ever set.
      const sortedParticipants = [...participantIds].sort().join('+');
      let matchedId: string | null = null;
      let matchedSession: InteractionSession | null = null;
      for (const [id, s] of activeSessionsRef.current.entries()) {
        if (
          s.ownEntityId === ownEntityId &&
          [...s.participantIds].sort().join('+') === sortedParticipants
        ) {
          matchedId = id;
          matchedSession = s;
          break;
        }
      }

      if (matchedId && matchedSession) {
        // Preserve the underlying cause when the service already flagged a
        // failure (e.g. 'entity_not_defined') — the screen uses it for the
        // D35 sync-now hint; otherwise use the generic exhaustion message.
        const message =
          matchedSession.failed?.error ??
          `Failed to initialize session after ${currentRetry.attempts} attempts`;
        matchedSession.failed = { error: message, at: Date.now() };
        entitySessionService.emit('session:error' as any, matchedId, message);
      } else {
        // No tracked session (start kept throwing before registration) — keep
        // the legacy participant-key emission so an observer still sees the
        // terminal failure. ChatDetail cannot match this key; the init-failure
        // toast from its start catch path remains the surface there.
        entitySessionService.emit(
          'session:error' as any,
          key,
          `Failed to initialize session after ${currentRetry.attempts} attempts`,
        );
      }

      retryStateRef.current.delete(key);
      return;
    }

    const nextAttempt = currentRetry.attempts + 1;
    const delay = Math.min(
      currentRetry.nextRetryDelay,
      DEFAULT_RETRY_POLICY.maxDelay
    );

    log.info(`Scheduling retry ${nextAttempt}/${DEFAULT_RETRY_POLICY.maxAttempts} for ${key} in ${delay}ms`);

    retryStateRef.current.set(key, {
      attempts: nextAttempt,
      nextRetryDelay: delay * DEFAULT_RETRY_POLICY.backoffMultiplier,
      retryTimer: setTimeout(() => {
        retryInitialization(key, ownEntityId, participantIds);
      }, delay)
    });
  };

  const retryInitialization = async (
    key: string,
    ownEntityId: string,
    participantIds: string[],
    replyMode?: string
  ) => {
    log.info(`Retrying initialization for ${key}`);

    // Snapshot the retry state BEFORE the cleanup below: stopInteractionSession
    // unconditionally deletes the participant-key retry entry ("Cancelled
    // pending fallback retry"), which would reset the attempt counter to 0 on
    // every retry — the second half of the infinite "Scheduling retry 1/3"
    // loop (the preserveRetryState flag alone only covers the clear inside
    // startInteractionSession, not the cleanup stop).
    const preservedRetryState = retryStateRef.current.get(key);

    // Clean up any existing sessions with these participants
    // Find any active session that matches this participant set
    for (const [interactionId, session] of activeSessionsRef.current.entries()) {
      if (session.ownEntityId === ownEntityId &&
          session.participantIds.sort().join('+') === participantIds.sort().join('+')) {
        await stopInteractionSession(interactionId);
      }
    }

    // Restore the attempt counter if the cleanup stop wiped it. The stored
    // retryTimer has already fired (we're executing inside it), so restoring
    // the entry is safe — scheduleRetry overwrites it with the next timer.
    if (preservedRetryState && !retryStateRef.current.has(key)) {
      retryStateRef.current.set(key, preservedRetryState);
    }

    // Retry (preserve the attempt counter so scheduleRetry can escalate to the
    // max-attempts cap instead of resetting to 1/3 forever)
    try {
      await startInteractionSession(ownEntityId, participantIds, replyMode, true);
    } catch (error) {
      log.error(`Retry failed for ${key}:`, error);
    }
  };

  const isRetryableError = (error: any): boolean => {
    const message = error?.message || '';
    // Don't retry if error explicitly says it's permanent
    if (message.includes('invalid entity') ||
        message.includes('not found') ||
        message.includes('Sync connection required')) {
      return false;
    }

    // 4-3: a DISABLED partner is terminal — the engine will reject every
    // re-INIT with entity_disabled until the user re-enables (Q8/A3). The
    // flag arrives wrapped in the timer-fix error message too
    // ("Session initialization failed: entity_disabled").
    if (message.includes('entity_disabled')) {
      return false;
    }

    // 7-14 V3: a store-variant locked entity is terminal — the provider is not
    // offered by this build, so retrying INIT can never succeed.
    if (message.includes(ENTITY_PROVIDER_LOCKED)) {
      return false;
    }

    // Retry on network errors, timeouts, connection failures
    if (message.includes('timeout') ||
        message.includes('Connection') ||
        message.includes('network') ||
        error?.code === 'ECONNREFUSED' ||
        error?.code === 'ETIMEDOUT') {
      return true;
    }

    // Default: retry (conservative approach)
    return true;
  };

  const stopInteractionSession = async (interactionId: string): Promise<void> => {
    log.info(`Stopping interaction session for ${interactionId}`);

    // Cancel any pending retries — clean up by both interactionId and
    // participant-based fallback key to prevent orphaned timers
    const session = activeSessionsRef.current.get(interactionId);
    const retryMap = retryStateRef.current;
    // Clean up by interactionId
    const retry = retryMap.get(interactionId);
    if (retry?.retryTimer) {
      clearTimeout(retry.retryTimer);
      log.info(`Cancelled pending retry for ${interactionId}`);
    }
    retryMap.delete(interactionId);
    // Also clean up by participant-based fallback key
    if (session) {
      const fallbackKey = session.participantIds.sort().join('+');
      const fallbackRetry = retryMap.get(fallbackKey);
      if (fallbackRetry?.retryTimer) {
        clearTimeout(fallbackRetry.retryTimer);
        log.info(`Cancelled pending fallback retry for ${fallbackKey}`);
      }
      retryMap.delete(fallbackKey);
    }

    await entitySessionService.stopInteractionSession(interactionId);
    // Session will be removed from state via handleSessionStopped event
  };

  const sendMessage = async (interactionId: string, message: string): Promise<void> => {
    const session = activeSessionsRef.current.get(interactionId);
    if (!session) {
      throw new Error(`No active session for interaction ${interactionId}`);
    }
    await entitySessionService.sendTextMessage(interactionId, message);
  };

  /**
   * STABLE `isSessionActive` (identity pinned; reads live state via
   * activeSessionsRef). It used to be a plain function rebuilt every render and
   * the provider `value` useMemo handed the new identity to consumers whenever
   * `activeSessions` changed — enough to re-run ChatDetailScreen's emoji-seed and
   * re-arm effects (and, through `initializeSession`'s deps, the init effect) on
   * every session-map tick. See the 3 Hz re-INIT note above.
   */
  const isSessionActive = useCallback((interactionId: string): boolean => {
    const session = activeSessionsRef.current.get(interactionId);
    // 4-3 (D36): a flagged (failed) session is never active — retained entries
    // must not pass the gate anywhere (verified safe-to-retain precondition).
    if (!session || session.failed) return false;

    // ALL connections must be 'active' (not just 'connecting')
    return Array.from(session.connections.values()).every(
      conn => conn.status === 'active'
    );
  }, []);

  const clearFailedSession = async (ownEntityId: string, participantIds: string[]): Promise<void> => {
    // 4-3 bounded retention (review 4): drop flagged (failed) entries for this
    // participant set. Called on navigation-back (ChatDetail unmount) — failed
    // entries are keyed by the service's temp interactionId, which the
    // screen's plain stop-by-id never matches, so they would otherwise
    // accumulate one per failed chat.
    const targetKey = [...participantIds].sort().join('+');
    for (const [id, session] of activeSessionsRef.current.entries()) {
      if (!session.failed) continue;
      if (session.ownEntityId !== ownEntityId) continue;
      if ([...session.participantIds].sort().join('+') !== targetKey) continue;
      await stopInteractionSession(id);
    }
  };

  const getInteractionSession = (interactionId: string): InteractionSession | null => {
    return activeSessionsRef.current.get(interactionId) || null;
  };

  // Memoize so consumers only re-render when exposed state actually changes
  // (activeSessions / canStartSession). The callbacks read live state through
  // activeSessionsRef, so a memoized instance stays correct between recomputes.
  //
  // activeSessions only gets a NEW reference when something observably changed:
  // the start path returns the previous Map for a reused session (see
  // sessionEntryUnchanged), so a re-INIT that the service short-circuits no
  // longer re-renders every consumer — which was the identity half of the 3 Hz
  // re-INIT loop (owner device, 2026-10-21). isSessionActive and
  // startInteractionSession are identity-stable useCallbacks now, so listing
  // them as deps is safe and keeps the lint rule honest.
  //
  // stopInteractionSession / clearFailedSession / sendMessage are deliberately
  // NOT listed: they are still plain closures, so listing them would recompute
  // this memo on every provider render — exactly the churn this comment is
  // about. Their identity is not consumed by any effect dependency chain that
  // matters (no consumer lists them in an effect dep array).
  const value: EntitySessionContextType = useMemo(() => ({
    activeSessions,
    isSessionActive,
    startInteractionSession,
    stopInteractionSession,
    getInteractionSession,
    clearFailedSession,
    sendMessage,
    canStartSession,
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [activeSessions, canStartSession, isSessionActive, startInteractionSession]);

  return (
    <EntitySessionContext.Provider value={value}>
      {children}
    </EntitySessionContext.Provider>
  );
};

export const useEntitySession = (): EntitySessionContextType => {
  const context = useContext(EntitySessionContext);
  if (!context) {
    throw new Error('useEntitySession must be used within EntitySessionProvider');
  }
  return context;
};
