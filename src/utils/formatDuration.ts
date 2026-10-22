/**
 * formatDuration — `m:ss` clock label for audio playback.
 *
 * Extracted from the helpers ChatBubble.tsx / ChatInputBar.tsx each carry
 * module-locally, so the TTS test panel's player row reuses the EXACT same
 * formatting (`0:03 / 0:12`) instead of growing a third copy.
 */
export function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}
