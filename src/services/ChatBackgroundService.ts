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
 *   `{ ref: ChatBackgroundRef | null, dim: number, transparency: number }`
 *
 * `dim` is the dark scrim opacity (0–100) drawn over the image behind the
 * message bubbles. `transparency` is the IMAGE's own opacity (0–100, default
 * 100 = fully opaque) — the chat content always renders above the background,
 * there is no overlay mode. Both are kept even when `ref` is null so the user's
 * choices survive "No background" → pick another image.
 *
 * Image refs
 * ----------
 *  - Profile gallery images are referenced by id (`{kind:'profile', profileId,
 *    imageId}`). The DISPLAY source is rebuilt on every read: the ORIGINAL bytes
 *    come from the app's image byte cache and are rendered as a `data:` URL
 *    (`getCachedImageBytes` → `createDataURL`). A URL + `source.headers` source
 *    is not an option — RN's Fabric image loader drops the headers, so the
 *    engine 401s the GET and the layer paints blank (owner device, Android 15,
 *    2026-10-21). A missing id (image deleted) self-heals: the read drops the
 *    ref.
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
  getCachedImageBytes,
  getCharacterImagesMetadata,
} from './engine/repositories/characters';
import { createDataURL } from '../database/base64';
import { createLogger } from '../utils/logger';

const log = createLogger('[ChatBackgroundService]');

/** AsyncStorage key prefix (entity-id keyed; mirrors the reply-mode family). */
export const CHAT_BACKGROUND_KEY_PREFIX = '@soulbits_chat_background_';

/** Default scrim opacity when the user has not chosen one. */
export const DEFAULT_CHAT_BACKGROUND_DIM = 40;

/**
 * Default image opacity: fully opaque. Records written before the transparency
 * slider existed omit the field and therefore read as 100 — an existing install
 * looks exactly as it did.
 */
export const DEFAULT_CHAT_BACKGROUND_TRANSPARENCY = 100;

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
  /** Image opacity 0–100 (0 = invisible, 100 = fully opaque). */
  transparency: number;
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

/**
 * Clamp a transparency value into the 0–100 integer range (default on garbage).
 * Garbage falls back to {@link DEFAULT_CHAT_BACKGROUND_TRANSPARENCY} (100), so
 * a corrupt/missing field can only ever leave the image fully visible — never
 * silently hide the user's background. `null`/`''` count as garbage here:
 * `Number()` would turn them into 0 (an invisible image).
 */
export function normalizeChatBackgroundTransparency(value: unknown): number {
  if (value === null || value === undefined || value === '') {
    return DEFAULT_CHAT_BACKGROUND_TRANSPARENCY;
  }
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return DEFAULT_CHAT_BACKGROUND_TRANSPARENCY;
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
    return {
      ref: null,
      dim: DEFAULT_CHAT_BACKGROUND_DIM,
      transparency: DEFAULT_CHAT_BACKGROUND_TRANSPARENCY,
    };
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      ref: parseRef(parsed.ref),
      dim: normalizeChatBackgroundDim(parsed.dim),
      // Absent (pre-slider record) reads as 100 — see the constant doc.
      transparency: normalizeChatBackgroundTransparency(parsed.transparency),
    };
  } catch {
    log.warn('Discarding malformed chat background record');
    return {
      ref: null,
      dim: DEFAULT_CHAT_BACKGROUND_DIM,
      transparency: DEFAULT_CHAT_BACKGROUND_TRANSPARENCY,
    };
  }
}

/** Raw stored record (no validation of the referenced image). */
export async function getChatBackgroundRecord(
  entityId: string,
): Promise<ChatBackgroundRecord> {
  if (!entityId) {
    return {
      ref: null,
      dim: DEFAULT_CHAT_BACKGROUND_DIM,
      transparency: DEFAULT_CHAT_BACKGROUND_TRANSPARENCY,
    };
  }
  try {
    return parseRecord(await AsyncStorage.getItem(storageKey(entityId)));
  } catch (err) {
    log.warn('Failed to read chat background:', err);
    return {
      ref: null,
      dim: DEFAULT_CHAT_BACKGROUND_DIM,
      transparency: DEFAULT_CHAT_BACKGROUND_TRANSPARENCY,
    };
  }
}

/** Persist a record. Returns false when the write failed (never throws). */
async function writeRecord(
  entityId: string,
  record: ChatBackgroundRecord,
): Promise<boolean> {
  if (!entityId) return false;
  const normalized: ChatBackgroundRecord = {
    ref: record.ref,
    dim: normalizeChatBackgroundDim(record.dim),
    transparency: normalizeChatBackgroundTransparency(record.transparency),
  };
  try {
    await AsyncStorage.setItem(storageKey(entityId), JSON.stringify(normalized));
    return true;
  } catch (err) {
    log.warn('Failed to persist chat background:', err);
    return false;
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

/** Set the background to a profile gallery image, preserving dim/transparency. */
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
    transparency: current.transparency,
  });
}

/**
 * Set the background from a chat-history message image. Writes the base64
 * bytes to the persistent image directory and stores only the file path.
 * Returns the written path (null when the write failed).
 *
 * Record-first ordering: the NEW file is written, the NEW ref is recorded, and
 * only THEN is the previous managed file deleted. Deleting first (the old
 * order) left a window where a crash between the unlink and the `setItem` lost
 * the user's background entirely — the self-heal would then fall back to "no
 * background". A crash before the record write now merely leaves one orphaned
 * file behind (harmless) while the previous setting stays valid.
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
    // Unique per write: two applies inside the same millisecond must not reuse
    // (and then delete) the file the other one just wrote.
    const suffix = Math.random().toString(36).slice(2, 8);
    const filename = `${sanitizeFilePart(entityId)}_${Date.now()}_${suffix}.${ext}`;
    const path = `${BACKGROUND_DIR}/${filename}`;
    await RNFS.writeFile(path, base64, 'base64');
    const recorded = await writeRecord(entityId, {
      ref: { kind: 'file', path, mimeType: mimeType || 'image/jpeg', messageId },
      dim: current.dim,
      transparency: current.transparency,
    });
    if (!recorded) {
      // The new ref did not persist, so the old setting is still what the user
      // will see on the next read: keep its file and drop the useless copy.
      try {
        await RNFS.unlink(path);
      } catch {
        // Best effort — an orphan file is harmless.
      }
      return null;
    }
    // The new record is durable — the previous file can go now (never the file
    // we just wrote, in case a ref somehow points at the new path).
    if (!(current.ref && current.ref.kind === 'file' && current.ref.path === path)) {
      await deleteOwnedFile(current.ref);
    }
    return path;
  } catch (err) {
    log.error('Failed to store chat-history background image:', err);
    return null;
  }
}

/** Persist the scrim opacity only (0–100), preserving the ref/transparency. */
export async function setChatBackgroundDim(
  entityId: string,
  dim: number,
): Promise<void> {
  const current = await getChatBackgroundRecord(entityId);
  await writeRecord(entityId, {
    ref: current.ref,
    dim,
    transparency: current.transparency,
  });
}

/** Persist the image opacity only (0–100), preserving the ref/dim. */
export async function setChatBackgroundTransparency(
  entityId: string,
  transparency: number,
): Promise<void> {
  const current = await getChatBackgroundRecord(entityId);
  await writeRecord(entityId, {
    ref: current.ref,
    dim: current.dim,
    transparency,
  });
}

/** Remove the image, keeping the chosen dim/transparency for the next one. */
export async function clearChatBackground(entityId: string): Promise<void> {
  const current = await getChatBackgroundRecord(entityId);
  await deleteOwnedFile(current.ref);
  await writeRecord(entityId, {
    ref: null,
    dim: current.dim,
    transparency: current.transparency,
  });
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
 *
 * Profile refs render the ORIGINAL bytes from the app's display cache as a
 * `data:` URL — a URL + headers source is blank under Fabric (see the module
 * header). The header/URL builder stays only as the cheap liveness probe.
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

  // Engine restarting/stopped — no source, but keep the ref for the next focus.
  if (!characterImageSource(ref.profileId, ref.imageId)) return null;
  try {
    const images = await getCharacterImagesMetadata(ref.profileId);
    if (!images.some(image => image.id === ref.imageId)) return null;
  } catch {
    // Engine unavailable — keep the ref; the byte read below decides whether a
    // cached copy can still be shown.
  }
  try {
    const bytes = await getCachedImageBytes(ref.profileId, ref.imageId, 'original');
    if (!bytes) return null;
    // Response mime, never an assumed one: originals keep GIF/WebP.
    return { uri: createDataURL(bytes.data, bytes.contentType || 'image/jpeg') };
  } catch {
    // Transient engine failure — render nothing now, keep the stored ref.
    return null;
  }
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
 * (the setting falls back to "no background" and dim/transparency are
 * preserved). A transient resolution failure keeps the stored ref so it can
 * render again when the engine/file system is back.
 */
export async function loadChatBackground(
  entityId: string,
): Promise<ResolvedChatBackground> {
  const record = await getChatBackgroundRecord(entityId);
  if (!record.ref) return { ...record, source: null };

  const source = await resolveChatBackgroundSource(record.ref);
  if (source) return { ...record, source };

  if (await isChatBackgroundRefDangling(record.ref)) {
    await writeRecord(entityId, {
      ref: null,
      dim: record.dim,
      transparency: record.transparency,
    });
    return { ref: null, dim: record.dim, transparency: record.transparency, source: null };
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
  DEFAULT_CHAT_BACKGROUND_TRANSPARENCY,
  CHAT_BACKGROUND_KEY_PREFIX,
  getChatBackgroundRecord,
  setChatBackgroundProfile,
  setChatBackgroundFromBase64,
  setChatBackgroundDim,
  setChatBackgroundTransparency,
  clearChatBackground,
  loadChatBackground,
  resolveChatBackgroundSource,
  normalizeChatBackgroundDim,
  normalizeChatBackgroundTransparency,
  chatBackgroundFileUri,
  isSameBackgroundRef,
};
