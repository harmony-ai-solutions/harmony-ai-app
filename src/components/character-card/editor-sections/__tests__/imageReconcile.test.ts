/**
 * imageReconcile tests (Phase 8, Step 4) — the image-churn gate.
 *
 * The old CreateAI edit save path hard-deleted + re-created every image row on
 * every save, so engine-synced rows churned (ids changed each edit). The
 * diff-based reconcile must leave UNCHANGED images with stable ids:
 * `computeImageDeltas` returns empty deltas for an untouched set — nothing is
 * written, ids survive.
 */

import { computeImageDeltas } from '../imageReconcile';
import type { CharacterImage } from '../../../../database/models';
import type { DesiredEditorImage } from '../imageReconcile';

const makeRow = (
  id: string,
  base64: string,
  mimeType: string,
  opts: Partial<CharacterImage> = {},
): CharacterImage => ({
  id,
  character_profile_id: 'p1',
  image_data: base64,
  mime_type: mimeType,
  description: '',
  is_primary: false,
  display_order: 0,
  vl_model_interpretation: '',
  vl_model: '',
  created_at: new Date(),
  updated_at: new Date(),
  deleted_at: null,
  ...opts,
});

const desired = (
  base64: string,
  mimeType: string,
  opts: Partial<DesiredEditorImage> = {},
): DesiredEditorImage => ({
  base64,
  mimeType,
  description: '',
  isPrimary: false,
  ...opts,
});

describe('computeImageDeltas — image churn gate', () => {
  it('unchanged images produce NO deltas — ids stay stable across save', () => {
    const existing = [
      makeRow('img-1', 'AAA', 'image/png', { is_primary: true, display_order: 0 }),
      makeRow('img-2', 'BBB', 'image/jpeg', { is_primary: false, display_order: 1 }),
    ];
    const want = [
      desired('AAA', 'image/png', { isPrimary: true }),
      desired('BBB', 'image/jpeg'),
    ];

    const delta = computeImageDeltas(existing, want);

    expect(delta.create).toEqual([]);
    expect(delta.update).toEqual([]);
    expect(delta.remove).toEqual([]);
  });

  it('a caption change becomes an UPDATE on the SAME id (no recreate)', () => {
    const existing = [makeRow('img-1', 'AAA', 'image/png')];
    const want = [desired('AAA', 'image/png', { description: 'New caption' })];

    const delta = computeImageDeltas(existing, want);

    expect(delta.create).toEqual([]);
    expect(delta.remove).toEqual([]);
    expect(delta.update).toEqual([
      { id: 'img-1', description: 'New caption', displayOrder: 0, isPrimary: false },
    ]);
  });

  it('removed images are deleted; untouched ids survive', () => {
    const existing = [
      makeRow('img-1', 'AAA', 'image/png'),
      makeRow('img-2', 'BBB', 'image/jpeg'),
    ];
    const want = [desired('AAA', 'image/png')];

    const delta = computeImageDeltas(existing, want);

    expect(delta.remove).toEqual(['img-2']);
    expect(delta.update).toEqual([]);
    expect(delta.create).toEqual([]);
  });

  it('new images are created (no id / no content match)', () => {
    const existing = [makeRow('img-1', 'AAA', 'image/png')];
    const want = [
      desired('AAA', 'image/png'),
      desired('CCC', 'image/webp', { description: 'brand new' }),
    ];

    const delta = computeImageDeltas(existing, want);

    expect(delta.create).toEqual([
      {
        base64: 'CCC',
        mimeType: 'image/webp',
        description: 'brand new',
        isPrimary: false,
        displayOrder: 1,
      },
    ]);
    expect(delta.update).toEqual([]);
    expect(delta.remove).toEqual([]);
  });

  it('promoting a gallery image to primary is an UPDATE on its id (stable)', () => {
    const existing = [
      makeRow('img-1', 'AAA', 'image/png', { is_primary: true, display_order: 0 }),
      makeRow('img-2', 'BBB', 'image/jpeg', { is_primary: false, display_order: 1 }),
    ];
    const want = [
      desired('BBB', 'image/jpeg', { isPrimary: true }),
      desired('AAA', 'image/png'),
    ];

    const delta = computeImageDeltas(existing, want);

    expect(delta.create).toEqual([]);
    expect(delta.remove).toEqual([]);
    expect(delta.update).toHaveLength(2);
    expect(delta.update).toContainEqual({
      id: 'img-2',
      description: '',
      displayOrder: 0,
      isPrimary: true,
    });
    expect(delta.update).toContainEqual({
      id: 'img-1',
      description: '',
      displayOrder: 1,
      isPrimary: false,
    });
  });

  it('reordering updates display_order but keeps ids', () => {
    const existing = [
      makeRow('img-1', 'AAA', 'image/png', { display_order: 0 }),
      makeRow('img-2', 'BBB', 'image/jpeg', { display_order: 1 }),
    ];
    const want = [
      desired('BBB', 'image/jpeg'),
      desired('AAA', 'image/png'),
    ];

    const delta = computeImageDeltas(existing, want);

    expect(delta.create).toEqual([]);
    expect(delta.remove).toEqual([]);
    expect(delta.update).toEqual([
      { id: 'img-2', description: '', displayOrder: 0, isPrimary: false },
      { id: 'img-1', description: '', displayOrder: 1, isPrimary: false },
    ]);
  });

  it('content match finds the right row even when the desired entry has no id', () => {
    // Simulates an image the user added this session: present in UI state
    // (galleryImages) but already persisted by a previous save — content match
    // must keep its real id stable, not recreate it.
    const existing = [
      makeRow('img-real-1', 'AAA', 'image/png', { display_order: 0 }),
      makeRow('img-real-2', 'BBB', 'image/jpeg', { display_order: 1 }),
    ];
    const want = [
      desired('AAA', 'image/png'),
      desired('BBB', 'image/jpeg'),
    ];

    const delta = computeImageDeltas(existing, want);
    expect(delta.create).toEqual([]);
    expect(delta.remove).toEqual([]);
    expect(delta.update).toEqual([]);
  });
});