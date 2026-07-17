import { v7 as uuidv7 } from 'uuid';

/**
 * Generate a UUID v7 string for use as a primary key.
 * UUID v7 is time-ordered (first 48 bits = Unix ms timestamp),
 * which provides natural clustering in B-tree indexes.
 *
 * Harmony Link uses UUID v7 via its own generation; this mirrors
 * that convention so IDs are monotonic across both codebases.
 */
export function generateId(): string {
  return uuidv7();
}
