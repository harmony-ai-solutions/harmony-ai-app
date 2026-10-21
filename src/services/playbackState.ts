/**
 * playbackState — the single classification of "is the current utterance still
 * being worked on?" for the 250 ms completion polls (TtsTestPanel, ChatBubble).
 *
 * `AudioPlayer.playAudio` / `playBase64Audio` resolve at playback START (they
 * only call `TrackPlayer.play()`), so the polls infer completion from the
 * player's own state. RNTP's `State` goes through `loading` / `ready` while a
 * track is being prepared (`ready` is also the state right after a queue reset),
 * so "not playing and not buffering" is NOT "finished" — treating it as such
 * dropped the keep-awake flag ~250 ms into playback and made the player row
 * disappear (owner device, Android 15, 2026-10-21).
 *
 * The state is a plain string at runtime (`PlaybackState.state`), so these
 * predicates deliberately take `string` — the RNTP `State` values are the
 * source of truth for the sets below, so an upstream rename breaks the build.
 *
 * ## Why `paused` is NOT an end state (owner device, 2026-10-21 investigation)
 *
 * The same classifier originally counted `paused` as an END once `playing` had
 * been observed, because a user pause is supposed to settle the UI. That is
 * wrong for an EXTERNAL pause: `AudioPlayer.initialize()` calls
 * `TrackPlayer.setupPlayer({ autoHandleInterruptions: true })` (v5 / media3
 * `handleAudioFocus = true`), so ANY audio-focus loss — an incoming call,
 * another app claiming audio, Bluetooth turning noisy, OEM ducking — PAUSES the
 * player for us. The poll then read `paused`, classified it terminal and the TTS
 * panel dropped to `idle`: the sample looked dead (player row gone, no resume
 * path even though the queue still held the track) and the refcounted
 * keep-screen-on hold was released mid-listen.
 *
 * So the three questions are now answered SEPARATELY and the consumers combine
 * them:
 *  - {@link isPlaybackInProgress} — still working on the utterance
 *    (`playing` / `buffering` / `loading` / `ready`, i.e. the pre-start
 *    transients stay non-terminal).
 *  - {@link hasPlaybackStarted} — this observation proves playback really began
 *    (only `playing` does), so nothing is "finished" before it.
 *  - {@link isPlaybackPaused} — parked mid-utterance, which the consumers treat
 *    as an INTERRUPTION (one auto-resume attempt), never as the end.
 *
 * Everything that is neither in progress nor paused is a genuine end:
 * `ended` / `stopped` / `none` / `error` (plus any unknown future value, so a
 * renamed-upstream state can never strand a poll in a forever-running interval).
 */

import { State } from 'react-native-track-player';

/** States in which the player is still working on the utterance. */
const IN_PROGRESS_STATES: ReadonlySet<string> = new Set<string>([
  State.Playing,
  State.Buffering,
  State.Loading,
  State.Ready,
]);

/** The one state that proves playback really began. */
const STARTED_STATE: string = State.Playing;

/**
 * The state that means "parked mid-utterance". Deliberately NOT part of any
 * end set — see the header: `autoHandleInterruptions` turns every external
 * audio-focus loss into exactly this state.
 */
const PAUSED_STATE: string = State.Paused;

/**
 * True while the player is NOT finished: playing, buffering, loading (initial
 * load) or ready (loaded/paused-ready). Only `ended`, `stopped`, `none`,
 * `paused` and `error` are outside it — and only once [hasPlaybackStarted] has
 * been true for this utterance. `paused` must be handled through
 * [isPlaybackPaused], never as an end.
 */
export function isPlaybackInProgress(state: string | null | undefined): boolean {
  return typeof state === 'string' && IN_PROGRESS_STATES.has(state);
}

/** True when this observation proves the utterance actually started playing. */
export function hasPlaybackStarted(state: string | null | undefined): boolean {
  return state === STARTED_STATE;
}

/**
 * True when the player is paused — i.e. interrupted mid-utterance, NOT finished.
 *
 * Why it needs its own predicate: a pause the USER asked for never reaches the
 * polls (the panel's `handleTogglePlayback` moves its phase to `paused` itself,
 * and ChatBubble clears its playing flag on tap). So a `paused` observation
 * during an active poll is by definition an EXTERNAL interruption (audio focus
 * loss, call, another app, Bluetooth noise) and must not read as "done" —
 * see the header for the owner-device evidence (2026-10-21).
 */
export function isPlaybackPaused(state: string | null | undefined): boolean {
  return state === PAUSED_STATE;
}
