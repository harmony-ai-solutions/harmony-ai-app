/**
 * Marketplace + SOUL Wallet Repository Tests
 *
 * Verifies the client-only commerce layer:
 *   - marketplace listings (upsert / remove / query + join with visibility)
 *   - SOUL wallet balance (get / credit / debit)
 *   - purchases (buy flow + guards + access helper)
 */

import { useFreshDatabase } from '../repositoryFixtures';
import {
  createCharacterProfile,
  setCharacterProfileVisibility,
  getCharacterProfileVisibility,
} from '../../repositories/characters';
import { setCharacterCreator } from '../../repositories/characterSocial';
import {
  isMarketplaceListed,
  getMarketplaceListing,
  upsertMarketplaceListing,
  removeMarketplaceListing,
  getMarketplaceCharacterProfiles,
  getSoulBalance,
  hasClaimedSignupBonus,
  claimSignupBonus,
  creditSouls,
  debitSouls,
  hasPurchased,
  getSoulPurchases,
  purchaseCharacter,
  canChatWithCharacter,
} from '../../repositories/marketplace';

describe('marketplace repository', () => {
  useFreshDatabase();

  async function createMinimalProfile(id: string, name: string) {
    return createCharacterProfile({
      id,
      name,
      description: '',
      personality: '',
      voice_characteristics: '',
      base_prompt: '',
      scenario: '',
      typing_speed_wpm: 60,
      audio_response_chance_percent: 50,
      vision_config_id: null,
      lifecycle_config: '{}',
    });
  }

  // ── Listings ─────────────────────────────────────────────────────────

  it('isMarketplaceListed defaults to false, then true after upsert', async () => {
    await createMinimalProfile('p1', 'Aria');
    expect(await isMarketplaceListed('p1')).toBe(false);
    await upsertMarketplaceListing('p1', 250);
    expect(await isMarketplaceListed('p1')).toBe(true);
  });

  it('getMarketplaceListing returns the price, or null when not listed', async () => {
    await createMinimalProfile('p1', 'Aria');
    expect(await getMarketplaceListing('p1')).toBeNull();
    await upsertMarketplaceListing('p1', 100);
    const listing = await getMarketplaceListing('p1');
    expect(listing).not.toBeNull();
    expect(listing!.profileId).toBe('p1');
    expect(listing!.priceSouls).toBe(100);
  });

  it('upsertMarketplaceListing is idempotent and updates the price', async () => {
    await createMinimalProfile('p1', 'Aria');
    await upsertMarketplaceListing('p1', 100);
    await upsertMarketplaceListing('p1', 350);
    const listing = await getMarketplaceListing('p1');
    expect(listing!.priceSouls).toBe(350);
  });

  it('removeMarketplaceListing removes the listing but keeps the profile', async () => {
    await createMinimalProfile('p1', 'Aria');
    await upsertMarketplaceListing('p1', 100);
    await removeMarketplaceListing('p1');
    expect(await isMarketplaceListed('p1')).toBe(false);
    expect(await getCharacterProfileVisibility('p1')).toBe('public');
  });

  it('getMarketplaceCharacterProfiles only returns profiles with visibility=marketplace AND a listing', async () => {
    await createMinimalProfile('p1', 'Aria');
    await createMinimalProfile('p2', 'Max');
    await createMinimalProfile('p3', 'Luna');

    // p1: listed + marketplace
    await upsertMarketplaceListing('p1', 250);
    await setCharacterProfileVisibility('p1', 'marketplace');
    // p2: listed but visibility stays public → NOT in market
    await upsertMarketplaceListing('p2', 500);
    await setCharacterProfileVisibility('p2', 'public');
    // p3: marketplace visibility but NO listing → NOT in market
    await setCharacterProfileVisibility('p3', 'marketplace');

    const listings = await getMarketplaceCharacterProfiles();
    expect(listings).toHaveLength(1);
    expect(listings[0].profileId).toBe('p1');
    expect(listings[0].priceSouls).toBe(250);
    expect(listings[0].profile.name).toBe('Aria');
  });

  it('marketplace visibility persists through the sidecar (extended CHECK)', async () => {
    await createMinimalProfile('p1', 'Aria');
    await setCharacterProfileVisibility('p1', 'marketplace');
    expect(await getCharacterProfileVisibility('p1')).toBe('marketplace');
  });

  // ── Wallet ───────────────────────────────────────────────────────────

  it('getSoulBalance defaults to 0', async () => {
    expect(await getSoulBalance()).toBe(0);
  });

  it('creditSouls adds to the balance and persists across calls', async () => {
    expect(await creditSouls(100)).toBe(100);
    expect(await creditSouls(50)).toBe(150);
    expect(await getSoulBalance()).toBe(150);
  });

  it('debitSouls subtracts when funds are sufficient', async () => {
    await creditSouls(200);
    expect(await debitSouls(80)).toBe(120);
    expect(await getSoulBalance()).toBe(120);
  });

  it('debitSouls throws on insufficient balance', async () => {
    await creditSouls(10);
    await expect(debitSouls(50)).rejects.toThrow('insufficient_soul_balance');
    expect(await getSoulBalance()).toBe(10);
  });

  // ── Purchases ────────────────────────────────────────────────────────

  it('purchaseCharacter rejects when not listed', async () => {
    await createMinimalProfile('p1', 'Aria');
    const result = await purchaseCharacter('p1');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('not_listed');
  });

  it('purchaseCharacter rejects on insufficient balance', async () => {
    await createMinimalProfile('p1', 'Aria');
    await upsertMarketplaceListing('p1', 500);
    await creditSouls(100);
    const result = await purchaseCharacter('p1');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('insufficient_balance');
  });

  it('purchaseCharacter debits the wallet and records the purchase', async () => {
    await createMinimalProfile('p1', 'Aria');
    await upsertMarketplaceListing('p1', 250);
    await creditSouls(1000);

    const result = await purchaseCharacter('p1');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.balance).toBe(750);
      expect(result.purchase.profileId).toBe('p1');
      expect(result.purchase.priceSouls).toBe(250);
    }
    expect(await getSoulBalance()).toBe(750);
    expect(await hasPurchased('p1')).toBe(true);

    const purchases = await getSoulPurchases();
    expect(purchases).toHaveLength(1);
    expect(purchases[0].profileId).toBe('p1');
  });

  it('purchaseCharacter rejects double purchase (no double charge)', async () => {
    await createMinimalProfile('p1', 'Aria');
    await upsertMarketplaceListing('p1', 100);
    await creditSouls(500);
    await purchaseCharacter('p1');
    const second = await purchaseCharacter('p1');
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.reason).toBe('already_purchased');
    expect(await getSoulBalance()).toBe(400);
  });

  // ── Access helper ────────────────────────────────────────────────────

  it('canChatWithCharacter is true for non-marketplace profiles', async () => {
    await createMinimalProfile('p1', 'Aria');
    expect(await canChatWithCharacter('p1', null)).toBe(true);
  });

  it('canChatWithCharacter is false for marketplace items not purchased', async () => {
    await createMinimalProfile('p1', 'Aria');
    await upsertMarketplaceListing('p1', 100);
    await setCharacterProfileVisibility('p1', 'marketplace');
    expect(await canChatWithCharacter('p1', null)).toBe(false);
    expect(await canChatWithCharacter('p1', 'someone-else')).toBe(false);
  });

  it('canChatWithCharacter is true for marketplace items the user purchased', async () => {
    await createMinimalProfile('p1', 'Aria');
    await upsertMarketplaceListing('p1', 100);
    await setCharacterProfileVisibility('p1', 'marketplace');
    await creditSouls(500);
    await purchaseCharacter('p1');
    expect(await canChatWithCharacter('p1', 'someone-else')).toBe(true);
  });

  it('canChatWithCharacter is true for the creator/owner even without purchase', async () => {
    await createMinimalProfile('p1', 'Aria');
    await upsertMarketplaceListing('p1', 100);
    await setCharacterProfileVisibility('p1', 'marketplace');
    await setCharacterCreator({
      profileId: 'p1',
      creatorUserId: 'creator-123',
      creatorDisplayName: 'Creator',
      creatorAvatarUrl: null,
    });
    expect(await canChatWithCharacter('p1', 'creator-123')).toBe(true);
    expect(await canChatWithCharacter('p1', 'other-user')).toBe(false);
  });

  // ── Signup bonus ───────────────────────────────────────────────────────

  it('hasClaimedSignupBonus defaults to false', async () => {
    expect(await hasClaimedSignupBonus()).toBe(false);
  });

  it('claimSignupBonus grants 50 SOUL on the first call only', async () => {
    const first = await claimSignupBonus();
    expect(first.claimed).toBe(true);
    expect(first.balance).toBe(50);
    expect(await getSoulBalance()).toBe(50);
    expect(await hasClaimedSignupBonus()).toBe(true);

    // Second call must be a no-op — the bonus is one-time only.
    const second = await claimSignupBonus();
    expect(second.claimed).toBe(false);
    expect(second.balance).toBe(50);
    expect(await getSoulBalance()).toBe(50);
  });

  it('claimSignupBonus keeps already-earned souls intact', async () => {
    await creditSouls(120);
    const result = await claimSignupBonus();
    expect(result.claimed).toBe(true);
    expect(result.balance).toBe(170);
    // A second claim adds nothing.
    const again = await claimSignupBonus();
    expect(again.claimed).toBe(false);
    expect(await getSoulBalance()).toBe(170);
  });

  it('claimSignupBonus never double-grants after a fresh wallet row', async () => {
    // Simulate a pristine wallet (migration default 0) → first claim works.
    expect(await getSoulBalance()).toBe(0);
    expect(await claimSignupBonus()).toEqual({ claimed: true, balance: 50 });
    // Recap: subsequent claims are no-ops even after direct balance moves.
    await creditSouls(25);
    expect(await claimSignupBonus()).toEqual({ claimed: false, balance: 75 });
  });
});
