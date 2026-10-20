/**
 * ChatBackgroundService — per-entity chat background image + dim scrim.
 *
 * Storage seam
 * ------------
 * The background belongs to the CHARACTER ENTITY the user chats with (the
 * partner entity), NOT to the conversation/persona pair: switching the active
 * persona keeps the same background. App-local entity-scoped preferences use
 * AsyncStorage keyed by the entity id (see `ChatPreferencesService`'s reply
 * pacing family) — this service follows the same seam and key convention:
 *
 *   `@soulbits_chat_background_<entityId>` → JSON
 *   `{ ref: ChatBackgroundRef | null, dim: number }`
 *
 * `dim` is the dark scrim opacity (0–100) drawn over the image behind the
 * message bubbles. The record is kept even when `ref` is null so the user's
 * dim choice survives "No background" → pick another image.
 *
 * Image refs
 * ----------
 *  - Profile gallery images are referenced by id (`{kind:'profile', profileId,
 *    imageId}`). The URL is rebuilt on every render via
 *    `characterImageSource` — engine restarts rotate the port/token, so a
 *    stored URL would go stale. A missing id (image deleted) self-heals: the
 *    read drops the ref.
 *  - Chat-history images arrive as base64 `image_data`; a settings row must
 *    never hold megabytes of base64, so the bytes are written once to the
 *    persistent document directory (`chat-backgrounds/`) and only the file
 *    path is stored. A missing file self-heals the same way.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ImageSourcePropType } from 'react-native';
import RNFS from 'react-native-fs';
import {
  characterImageSource,
  getCharacterImagesMetadata,
} from './engine/repositories/characters';
import { createLogger } from '../utils/logger';

const log = createLogger('[ChatBackgroundService]');

/** AsyncStorage key prefix (entity-id keyed; mirrors the reply-mode family). */
export const CHAT_BACKGROUND_KEY_PREFIX = '@soulbits_chat_background_';

/** Default scrim opacity when the user has not chosen one. */
export const DEFAULT_CHAT_BACKGROUND_DIM = 40;

/** Persistent directory for chat-history images promoted to a background. */
const BACKGROUND_DIR = `${RNFS.DocumentDirectoryPath}/chat-backgrounds`;

/** A profile gallery image (referenced by id, never by a stale URL). */
export interface ProfileBackgroundRef {
  kind: 'profile';
  profileId: string;
  imageId: string;
}

/** A chat-history image written to the app's persistent image storage. */
export interface FileBackgroundRef {
  kind: 'file';
  path: string;
  mimeType: string;
  /** Chat message the image came from (lets the picker re-mark its tile). */
  messageId?: string;
}

export type ChatBackgroundRef = ProfileBackgroundRef | FileBackgroundRef;

export interface ChatBackgroundRecord {
  ref: ChatBackgroundRef | null;
  dim: number;
}

/** Record plus the render-ready image source (resolved, validated). */
export interface ResolvedChatBackground extends ChatBackgroundRecord {
  source: ImageSourcePropType | null;
}

function storageKey(entityId: string): string {
  return `${CHAT_BACKGROUND_KEY_PREFIX}${entityId}`;
}

/** Clamp a dim value into the 0–100 integer range (default on garbage). */
export function normalizeChatBackgroundDim(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return DEFAULT_CHAT_BACKGROUND_DIM;
  return Math.max(0, Math.min(100, Math.round(n)));
}

/** Validate a parsed ref; unknown shapes are dropped. */
function parseRef(raw: unknown): ChatBackgroundRef | null {
  if (!raw || typeof raw !== 'object') return null;
  const ref = raw as Record<string, unknown>;
  if (ref.kind === 'profile') {
    const profileId = typeof ref.profileId === 'string' ? ref.profileId : '';
    const imageId = typeof ref.imageId === 'string' ? ref.imageId : '';
    if (!profileId || !imageId) return null;
    return { kind: 'profile', profileId, imageId };
  }
  if (ref.kind === 'file') {
    const path = typeof ref.path === 'string' ? ref.path : '';
    if (!path) return null;
    return {
      kind: 'file',
      path,
      mimeType:
        typeof ref.mimeType === 'string' && ref.mimeType
          ? ref.mimeType
          : 'image/jpeg',
      messageId:
        typeof ref.messageId === 'string' && ref.messageId
          ? ref.messageId
          : undefined,
    };
  }
  return null;
}

function parseRecord(raw: string | null): ChatBackgroundRecord {
  if (!raw) {
    return { ref: null, dim: DEFAULT_CHAT_BACKGROUND_DIM };
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      ref: parseRef(parsed.ref),
      dim: normalizeChatBackgroundDim(parsed.dim),
    };
  } catch {
    log.warn('Discarding malformed chat background record');
    return { ref: null, dim: DEFAULT_CHAT_BACKGROUND_DIM };
  }
}

/** Raw stored record (no validation of the referenced image). */
export async function getChatBackgroundRecord(
  entityId: string,
): Promise<ChatBackgroundRecord> {
  if (!entityId) return { ref: null, dim: DEFAULT_CHAT_BACKGROUND_DIM };
  try {
    return parseRecord(await AsyncStorage.getItem(storageKey(entityId)));
  } catch (err) {
    log.warn('Failed to read chat background:', err);
    return { ref: null, dim: DEFAULT_CHAT_BACKGROUND_DIM };
  }
}

async function writeRecord(
  entityId: string,
  record: ChatBackgroundRecord,
): Promise<void> {
  if (!entityId) return;
  const normalized: ChatBackgroundRecord = {
    ref: record.ref,
    dim: normalizeChatBackgroundDim(record.dim),
  };
  try {
    await AsyncStorage.setItem(storageKey(entityId), JSON.stringify(normalized));
  } catch (err) {
    log.warn('Failed to persist chat background:', err);
  }
}

/** True when `path` lives in this service's managed directory. */
function isOwnedPath(path: string): boolean {
  return path.startsWith(BACKGROUND_DIR);
}

/** Best-effort delete of a previously stored chat-history file. */
async function deleteOwnedFile(ref: ChatBackgroundRef | null): Promise<void> {
  if (!ref || ref.kind !== 'file' || !isOwnedPath(ref.path)) return;
  try {
    if (await RNFS.exists(ref.path)) {
      await RNFS.unlink(ref.path);
    }
  } catch (err) {
    log.warn('Failed to delete old chat background file:', err);
  }
}

function extensionForMime(mimeType: string): string {
  const mime = (mimeType || '').toLowerCase();
  if (mime.includes('png')) return 'png';
  if (mime.includes('webp')) return 'webp';
  if (mime.includes('gif')) return 'gif';
  return 'jpg';
}

function sanitizeFilePart(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
}

/** Set the background to a profile gallery image, preserving the dim. */
export async function setChatBackgroundProfile(
  entityId: string,
  profileId: string,
  imageId: string,
): Promise<void> {
  const current = await getChatBackgroundRecord(entityId);
  await deleteOwnedFile(current.ref);
  await writeRecord(entityId, {
    ref: { kind: 'profile', profileId, imageId },
    dim: current.dim,
  });
}

/**
 * Set the background from a chat-history message image. Writes the base64
 * bytes to the persistent image directory and stores only the file path.
 * Returns the written path (null when the write failed).
 */
export async function setChatBackgroundFromBase64(
  entityId: string,
  base64: string,
  mimeType: string,
  messageId?: string,
): Promise<string | null> {
  if (!entityId || !base64) return null;
  const current = await getChatBackgroundRecord(entityId);
  try {
    if (!(await RNFS.exists(BACKGROUND_DIR))) {
      await RNFS.mkdir(BACKGROUND_DIR);
    }
    const ext = extensionForMime(mimeType);
    const filename = `${sanitizeFilePart(entityId)}_${Date.now()}.${ext}`;
    const path = `${BACKGROUND_DIR}/${filename}`;
    await RNFS.writeFile(path, base64, 'base64');
    await deleteOwnedFile(current.ref);
    await writeRecord(entityId, {
      ref: { kind: 'file', path, mimeType: mimeType || 'image/jpeg', messageId },
      dim: current.dim,
    });
    return path;
  } catch (err) {
    log.error('Failed to store chat-history background image:', err);
    return null;
  }
}

/** Persist the scrim opacity only (0–100), preserving the ref. */
export async function setChatBackgroundDim(
  entityId: string,
  dim: number,
): Promise<void> {
  const current = await getChatBackgroundRecord(entityId);
  await writeRecord(entityId, { ref: current.ref, dim });
}

/** Remove the image, keeping the chosen dim for the next background. */
export async function clearChatBackground(entityId: string): Promise<void> {
  const current = await getChatBackgroundRecord(entityId);
  await deleteOwnedFile(current.ref);
  await writeRecord(entityId, { ref: null, dim: current.dim });
}

/** Render-ready URI for a stored chat-history file. */
export function chatBackgroundFileUri(path: string): string {
  return path.startsWith('file://') ? path : `file://${path}`;
}

/**
 * Resolve a ref to an RN Image source. Returns null when the bytes cannot be
 * rendered right now (dangling ref OR a transient engine/file-system
 * failure) — callers use {@link isChatBackgroundRefDangling} to decide
 * whether the stored ref should be dropped.
 */
export async function resolveChatBackgroundSource(
  ref: ChatBackgroundRef | null,
): Promise<ImageSourcePropType | null> {
  if (!ref) return null;
  if (ref.kind === 'file') {
    try {
      if (!(await RNFS.exists(ref.path))) return null;
    } catch {
      // Cannot stat the file — do not destroy the setting on a transient error.
      return null;
    }
    return { uri: chatBackgroundFileUri(ref.path) };
  }

  const source = characterImageSource(ref.profileId, ref.imageId);
  if (!source) return null;
  try {
    const images = await getCharacterImagesMetadata(ref.profileId);
    if (!images.some(image => image.id === ref.imageId)) return null;
  } catch {
    // Engine unavailable — keep the ref, let the URL source try to render.
  }
  return source;
}

/**
 * True when the ref's bytes are confirmed gone. A transient engine/file-system
 * failure is NOT dangling — only a successful check that no longer finds the
 * image/file clears the setting.
 */
export async function isChatBackgroundRefDangling(
  ref: ChatBackgroundRef | null,
): Promise<boolean> {
  if (!ref) return false;
  if (ref.kind === 'file') {
    try {
      return !(await RNFS.exists(ref.path));
    } catch {
      return false;
    }
  }
  // No URL builder (engine restarting) or a failed metadata read means we
  // cannot decide — keep the ref for the next focus.
  if (!characterImageSource(ref.profileId, ref.imageId)) return false;
  try {
    const images = await getCharacterImagesMetadata(ref.profileId);
    return !images.some(image => image.id === ref.imageId);
  } catch {
    return false;
  }
}

/**
 * Load a chat background for rendering. A dangling ref is cleaned up on read
 * (the setting falls back to "no background" and the dim is preserved). A
 * transient resolution failure keeps the stored ref so it can render again
 * when the engine/file system is back.
 */
export async function loadChatBackground(
  entityId: string,
): Promise<ResolvedChatBackground> {
  const record = await getChatBackgroundRecord(entityId);
  if (!record.ref) return { ...record, source: null };

  const source = await resolveChatBackgroundSource(record.ref);
  if (source) return { ...record, source };

  if (await isChatBackgroundRefDangling(record.ref)) {
    await writeRecord(entityId, { ref: null, dim: record.dim });
    return { ref: null, dim: record.dim, source: null };
  }
  return { ...record, source: null };
}

/** True when `candidate` is the currently stored background ref. */
export function isSameBackgroundRef(
  current: ChatBackgroundRef | null,
  candidate: ChatBackgroundRef | null,
): boolean {
  if (!current || !candidate) return false;
  if (current.kind === 'profile' && candidate.kind === 'profile') {
    return (
      current.profileId === candidate.profileId &&
      current.imageId === candidate.imageId
    );
  }
  if (current.kind === 'file' && candidate.kind === 'file') {
    return current.path === candidate.path;
  }
  return false;
}

export default {
  DEFAULT_CHAT_BACKGROUND_DIM,
  CHAT_BACKGROUND_KEY_PREFIX,
  getChatBackgroundRecord,
  setChatBackgroundProfile,
  setChatBackgroundFromBase64,
  setChatBackgroundDim,
  clearChatBackground,
  loadChatBackground,
  resolveChatBackgroundSource,
  normalizeChatBackgroundDim,
  chatBackgroundFileUri,
  isSameBackgroundRef,
};
