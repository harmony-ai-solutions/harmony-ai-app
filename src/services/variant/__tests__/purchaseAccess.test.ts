/**
 * purchaseAccess — variant-aware purchase availability (plan 7-14 V4).
 *
 * Store builds disable PAID purchases (wallet top-up, marketplace buy,
 * billing); the full variant is unchanged. The test seam
 * (`setAppVariantForTests`) simulates a store build without a rebuild.
 */

import { purchasesEnabled } from '../purchaseAccess';
import { setAppVariantForTests } from '../../../config/appVariant';

describe('purchaseAccess (7-14 V4)', () => {
  afterEach(() => {
    setAppVariantForTests(null);
  });

  it('full variant enables purchases (today\'s behavior)', () => {
    setAppVariantForTests('full');
    expect(purchasesEnabled()).toBe(true);
  });

  it('store variant disables purchases (disabled at launch)', () => {
    setAppVariantForTests('store');
    expect(purchasesEnabled()).toBe(false);
  });

  it('defaults to enabled (full) when nothing is configured', () => {
    setAppVariantForTests(null);
    expect(purchasesEnabled()).toBe(true);
  });
});
