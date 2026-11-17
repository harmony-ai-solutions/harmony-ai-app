/**
 * Stable test ids for paralinguistic tags.
 *
 * Kept in a tiny leaf module so both the panel (chip testIDs) and
 * `TtsTagPickerModal` (row testIDs) derive the SAME slug without a circular
 * import between the two components. `TtsTestPanel` re-exports
 * `paralinguisticTagTestId` for its existing consumers.
 */

/**
 * Tag → stable slug: `[clears throat]` → `clears-throat`.
 *
 * The picker/chips now carry ASTERISK natural forms (`*clears throat*`), which
 * must keep the SAME stable testID as the bracketed provider form — the
 * explicit wrapper strip makes that contract obvious rather than relying on the
 * generic non-alphanumeric fold below (which already dropped both).
 */
export function paralinguisticTagSlug(tag: string): string {
  return tag
    .replace(/^[[\]*]+/, '')
    .replace(/[[\]*]+$/, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
}

/** Tag → chip testID (`tts-tag-<slug>`). */
export function paralinguisticTagTestId(tag: string): string {
  return `tts-tag-${paralinguisticTagSlug(tag)}`;
}
