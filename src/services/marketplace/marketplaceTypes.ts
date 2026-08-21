/**
 * Marketplace shared types + pure serializers (no I/O).
 *
 * These types mirror the cloud backend's `/v1/marketplace` contract
 * (snake_case on the wire, camelCase in the app). Keeping them pure makes
 * them unit-testable and prevents the wire-format drift documented in
 * memory-bank (a wrong-case key silently reads as undefined).
 */

import type { MarketplaceItemType } from '../../database/repositories/marketplace';

export type { MarketplaceItemType } from '../../database/repositories/marketplace';

/** Every item type the marketplace supports (v1). */
export const MARKETPLACE_ITEM_TYPES: readonly MarketplaceItemType[] = [
  'character',
  'backstory',
  'description',
  'personality',
  'prompt',
  'dialogue',
  'theme',
];

/** i18n key (inside the `market` namespace) for a type's short label. */
export function itemTypeLabelKey(type: MarketplaceItemType): string {
  return `itemType${type.charAt(0).toUpperCase()}${type.slice(1)}`;
}

/** Material icon name for a type (used on cards / chips / rows). */
export function itemTypeIcon(type: MarketplaceItemType): string {
  switch (type) {
    case 'character':
      return 'account-heart';
    case 'backstory':
      return 'book-open-page-variant-outline';
    case 'description':
      return 'text-box-outline';
    case 'personality':
      return 'emoticon-outline';
    case 'prompt':
      return 'lightbulb-on-outline';
    case 'dialogue':
      return 'chat-processing-outline';
    case 'theme':
      return 'palette-outline';
    default:
      return 'package-variant-closed';
  }
}

/** True when a type is delivered/consumed as plain text. */
export function isTextItemType(type: MarketplaceItemType): boolean {
  return (
    type === 'backstory' ||
    type === 'description' ||
    type === 'personality' ||
    type === 'prompt' ||
    type === 'dialogue'
  );
}

// ── Wire DTOs (snake_case from the backend) ─────────────────────────────

export interface MarketplaceListingDTO {
  id: string;
  seller_user_id: string;
  item_type: MarketplaceItemType;
  title: string;
  summary: string | null;
  tags: string;
  price_souls: number;
  status: 'active' | 'delisted';
  sales_count: number;
  created_at: string;
  updated_at: string;
  preview_text?: string | null;
  preview_image_data?: string | null;
  preview_mime_type?: string | null;
  payload_json?: unknown;
}

export interface OwnedAssetDTO {
  id: string;
  listing_id: string;
  item_type: MarketplaceItemType;
  title: string;
  asset_json: unknown;
  kind: 'purchase' | 'free' | 'own';
  acquired_at: string;
  image_data?: string | null;
  image_mime?: string | null;
}

export interface AcquireDTO {
  ok: boolean;
  kind: 'own' | 'purchase' | 'free';
  asset_json: unknown;
  balance: number | null;
}

export interface PublishPayload {
  item_type: MarketplaceItemType;
  title: string;
  summary?: string | null;
  tags?: string[];
  price_souls: number;
  payload_json: unknown;
  preview_image_data?: string | null;
  preview_mime_type?: string | null;
}

// ── Pure serializers ────────────────────────────────────────────────────

function parseTags(raw: string | undefined | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter((t): t is string => typeof t === 'string');
    }
  } catch {
    // malformed — ignore
  }
  return [];
}

/** Convert a snake_case wire listing into the app's cached shape. */
export function listingDtoToCache(dto: MarketplaceListingDTO): {
  id: string;
  itemType: MarketplaceItemType;
  title: string;
  summary: string | null;
  tags: string[];
  priceSouls: number;
  status: 'active' | 'delisted';
  salesCount: number;
  sellerUserId: string | null;
  previewText: string | null;
  previewImageData: string | null;
  previewMimeType: string | null;
  payloadJson: unknown;
  cachedAt: Date;
  updatedAt: Date;
} {
  return {
    id: dto.id,
    itemType: dto.item_type,
    title: dto.title,
    summary: dto.summary ?? null,
    tags: parseTags(dto.tags),
    priceSouls: Number(dto.price_souls),
    status: dto.status === 'delisted' ? 'delisted' : 'active',
    salesCount: Number(dto.sales_count),
    sellerUserId: dto.seller_user_id ?? null,
    previewText: dto.preview_text ?? null,
    previewImageData: dto.preview_image_data ?? null,
    previewMimeType: dto.preview_mime_type ?? null,
    payloadJson: dto.payload_json ?? null,
    cachedAt: new Date(dto.updated_at),
    updatedAt: new Date(dto.updated_at),
  };
}

/** Convert an owned-asset wire DTO into the app's cached shape. */
export function ownedAssetDtoToCache(dto: OwnedAssetDTO): {
  id: string;
  listingId: string;
  itemType: MarketplaceItemType;
  title: string;
  assetJson: unknown;
  kind: 'purchase' | 'free' | 'own';
  acquiredAt: Date;
  imageData: string | null;
  imageMime: string | null;
} {
  return {
    id: dto.id,
    listingId: dto.listing_id,
    itemType: dto.item_type,
    title: dto.title,
    assetJson: dto.asset_json ?? null,
    kind: dto.kind,
    acquiredAt: new Date(dto.acquired_at),
    imageData: dto.image_data ?? null,
    imageMime: dto.image_mime ?? null,
  };
}