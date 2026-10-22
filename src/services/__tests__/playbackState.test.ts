/**
 * playbackState — the shared completion classifier used by the two 250 ms
 * playback polls (`TtsTestPanel`, `ChatBubble`).
 *
 * The split under test (owner device, 2026-10-21): `paused` is NOT an end
 * state. `AudioPlayer` initializes RNTP with `autoHandleInterruptions: true`,
 * so any audio-focus loss (call, another app, Bluetooth noise, OEM ducking)
 * pauses the player; the polls must be able to tell that apart from a genuine
 * `ended`/`stopped`/`none`/`error`, or the preview UI dies mid-utterance.
 */

import { State } from 'react-native-track-player';
import {
  hasPlaybackStarted,
  isPlaybackInProgress,
  isPlaybackPaused,
} from '../playbackState';

describe('playbackState — in-progress classification', () => {
  it('treats every working state as in progress', () => {
    for (const state of [State.Playing, State.Buffering, State.Loading, State.Ready]) {
      expect(isPlaybackInProgress(state)).toBe(true);
    }
  });

  it('treats the pre-start transients as NON-terminal (loading/ready)', () => {
    // RNTP reports these while a track is prepared — reading them as "finished"
    // dropped the player row ~250 ms into a real sample.
    expect(isPlaybackInProgress(State.Loading)).toBe(true);
    expect(isPlaybackInProgress(State.Ready)).toBe(true);
  });

  it('is not paused while it is in progress', () => {
    for (const state of [State.Playing, State.Buffering, State.Loading, State.Ready]) {
      expect(isPlaybackPaused(state)).toBe(false);
    }
  });

  it('guards null/undefined/unknown values', () => {
    expect(isPlaybackInProgress(null)).toBe(false);
    expect(isPlaybackInProgress(undefined)).toBe(false);
    expect(isPlaybackPaused(null)).toBe(false);
    expect(isPlaybackPaused(undefined)).toBe(false);
    expect(isPlaybackPaused('some-future-state')).toBe(false);
  });
});

describe('playbackState — paused is its own class (never an end)', () => {
  it('classifies paused distinctly', () => {
    expect(isPlaybackPaused(State.Paused)).toBe(true);
    // …and not as any of the other two answers.
    expect(isPlaybackInProgress(State.Paused)).toBe(false);
    expect(hasPlaybackStarted(State.Paused)).toBe(false);
  });

  it('keeps the genuine end states outside both the paused and progress classes', () => {
    // The consumers end playback on "neither in progress nor paused"; these are
    // the states that must land there.
    for (const state of [State.Ended, State.Stopped, State.None, State.Error]) {
      expect(isPlaybackInProgress(state)).toBe(false);
      expect(isPlaybackPaused(state)).toBe(false);
    }
  });
});

describe('playbackState — proof that playback began', () => {
  it('only `playing` proves the utterance started', () => {
    expect(hasPlaybackStarted(State.Playing)).toBe(true);
    for (const state of [
      State.Buffering,
      State.Loading,
      State.Ready,
      State.Paused,
      State.Stopped,
      State.None,
      State.Ended,
      State.Error,
      null,
      undefined,
    ]) {
      expect(hasPlaybackStarted(state as string | null | undefined)).toBe(false);
    }
  });
});
