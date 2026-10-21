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
 * True while the player is NOT finished: playing, buffering, loading (initial
 * load) or ready (loaded/paused-ready). Only `ended`, `stopped`, `none`,
 * `paused` and `error` mean "done" — and only once [hasPlaybackStarted] has
 * been true for this utterance.
 */
export function isPlaybackInProgress(state: string | null | undefined): boolean {
  return typeof state === 'string' && IN_PROGRESS_STATES.has(state);
}

/** True when this observation proves the utterance actually started playing. */
export function hasPlaybackStarted(state: string | null | undefined): boolean {
  return state === STARTED_STATE;
}
