/**
 * imageReconcile — diff-based character-image reconcile (Phase 8, Step 4).
 *
 * Replaces the old save path that hard-deleted + re-created every image row on
 * every save (engine-synced rows churned; ids changed on each edit). Given the
 * current DB rows and the desired editor state, compute only the deltas:
 *
 *   - create  — desired entries with no matching existing row
 *   - update  — matched rows whose description / display_order / is_primary
 *               changed (id PRESERVED — untouched images keep stable ids)
 *   - remove  — existing rows not present in the desired set
 *
 * Matching is by `id` when the desired entry carries a real row id, otherwise
 * by content (`image_data` + `mime_type`). Pure function — unit-testable.
 */

import type { CharacterImage } from '../../../database/models';

/** One image in the editor's desired state (avatar + gallery tiles). */
export interface DesiredEditorImage {
  /** Real DB row id when known; `null`/`undefined` for brand-new images. */
  id?: string | null;
  base64: string;
  mimeType: string;
  description: string;
  isPrimary: boolean;
}

export interface ImageCreateDelta {
  base64: string;
  mimeType: string;
  description: string;
  isPrimary: boolean;
  displayOrder: number;
}

export interface ImageUpdateDelta {
  id: string;
  description: string;
  displayOrder: number;
  isPrimary: boolean;
}

export interface ImageReconcileDelta {
  create: ImageCreateDelta[];
  update: ImageUpdateDelta[];
  /** Existing row ids to delete (soft). */
  remove: string[];
}

/** Identity key for content matching (base64 payload + mime type). */
const contentKey = (base64: string, mimeType: string): string =>
  `${mimeType}\u0000${base64}`;

/**
 * Compute create / update / remove deltas between the persisted image rows and
 * the desired editor state. Order of the desired list defines display_order.
 */
export function computeImageDeltas(
  existing: CharacterImage[],
  desired: DesiredEditorImage[],
): ImageReconcileDelta {
  const delta: ImageReconcileDelta = { create: [], update: [], remove: [] };
  const matched = new Set<string>();

  desired.forEach((item, index) => {
    const displayOrder = index;

    // 1. Exact id match (the row came from the DB and still carries its id).
    let row =
      item.id != null
        ? existing.find(
            (r) =>
              r.id === item.id && !matched.has(r.id) && r.deleted_at === null,
          )
        : undefined;

    // 2. Content match (new UI entries carry no id — stable across saves).
    if (!row) {
      const key = contentKey(item.base64, item.mimeType);
      row = existing.find(
        (r) => !matched.has(r.id) && r.deleted_at === null && contentKey(r.image_data, r.mime_type) === key,
      );
    }

    if (row) {
      matched.add(row.id);
      const isPrimary = item.isPrimary;
      const description = item.description ?? '';
      const needsUpdate =
        row.is_primary !== isPrimary ||
        row.description !== description ||
        row.display_order !== displayOrder;
      if (needsUpdate) {
        delta.update.push({ id: row.id, description, displayOrder, isPrimary });
      }
      return;
    }

    delta.create.push({
      base64: item.base64,
      mimeType: item.mimeType,
      description: item.description ?? '',
      isPrimary: item.isPrimary,
      displayOrder,
    });
  });

  for (const row of existing) {
    if (row.deleted_at === null && !matched.has(row.id)) {
      delta.remove.push(row.id);
    }
  }

  return delta;
}