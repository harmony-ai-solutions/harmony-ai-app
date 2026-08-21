/**
 * MarketplaceApiService — cloud-backed marketplace transport.
 *
 * Talks to the `soulbits-cloud-backend` marketplace service (Phase 1
 * contract) through `AuthService.fetch`, which already:
 *   - attaches the PASETO Bearer token
 *   - transparently retries once on 401 with a single deduplicated refresh
 *   - throws `AuthExpiredError` on a terminal auth failure
 *
 * The service is a thin typed wrapper around that fetch, with a documented
 * PUBLIC API (below). The cloud host is `CLOUD_HOSTS.auth` (the API gateway
 * routes `/v1/marketplace/*` to the marketplace service).
 */

import { CLOUD_HOSTS } from '../../config/cloud';
import AuthService, { AuthExpiredError } from '../auth/AuthService';
import type {
  AcquireDTO,
  MarketplaceListingDTO,
  OwnedAssetDTO,
  PublishPayload,
} from './marketplaceTypes';

const BASE = `${CLOUD_HOSTS.auth}/v1/marketplace`;

export interface ListOptions {
  query?: string;
  itemType?: string;
  freeOnly?: boolean;
  page?: number;
  limit?: number;
}

export interface ListResult {
  listings: MarketplaceListingDTO[];
  total: number;
}

/**
 * Optional dev/local override for tests — lets consumers point the service
 * at an in-memory mock without changing the public API.
 */
export interface MarketplaceApiOverrides {
  baseUrl?: string;
  fetchImpl?: typeof globalThis.fetch;
}

let overrides: MarketplaceApiOverrides | null = null;

/**
 * Inject an override (used only in tests / dev mocking). Pass null to reset.
 */
export function configureMarketplaceApi(o: MarketplaceApiOverrides | null): void {
  overrides = o;
}

async function apiFetch(url: string, init: RequestInit): Promise<Response> {
  if (overrides?.fetchImpl) {
    return overrides.fetchImpl(url, init);
  }
  return AuthService.fetch(url, init);
}

function encodeQuery(params: Record<string, string | number | boolean | undefined>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === '') continue;
    parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  }
  return parts.length ? `?${parts.join('&')}` : '';
}

async function parseJson<T>(res: Response): Promise<T> {
  try {
    return (await res.json()) as T;
  } catch {
    return undefined as unknown as T;
  }
}

export interface MarketplaceApiClient {
  publish(data: PublishPayload): Promise<MarketplaceListingDTO>;
  list(opts?: ListOptions): Promise<ListResult>;
  getDetail(id: string): Promise<MarketplaceListingDTO | null>;
  acquire(id: string): Promise<AcquireDTO>;
  getMine(): Promise<MarketplaceListingDTO[]>;
  getLibrary(): Promise<OwnedAssetDTO[]>;
  delist(id: string): Promise<void>;
  update(id: string, patch: Partial<PublishPayload>): Promise<MarketplaceListingDTO>;
}

class MarketplaceApiServiceClass implements MarketplaceApiClient {
  private baseUrl(): string {
    return overrides?.baseUrl ?? BASE;
  }

  private async guardAuth(): Promise<void> {
    try {
      await AuthService.getToken();
    } catch {
      throw new AuthExpiredError();
    }
  }

  /** Publish an item (any type; price_souls 0 = free). */
  async publish(data: PublishPayload): Promise<MarketplaceListingDTO> {
    await this.guardAuth();
    const res = await apiFetch(`${this.baseUrl()}/listings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new MarketApiError('publish', res);
    return parseJson<MarketplaceListingDTO>(res);
  }

  /** Browse the catalog (public; optional type / free / search filters). */
  async list(opts: ListOptions = {}): Promise<ListResult> {
    const qs = encodeQuery({
      q: opts.query?.trim() || undefined,
      item_type: opts.itemType,
      free: opts.freeOnly ? 'true' : undefined,
      page: opts.page ?? 1,
      limit: opts.limit ?? 50,
    });
    const res = await apiFetch(`${this.baseUrl()}/listings${qs}`, { method: 'GET' });
    if (!res.ok) throw new MarketApiError('list', res);
    return parseJson<ListResult>(res);
  }

  /** Item detail + preview (full payload only for owner/buyer). */
  async getDetail(id: string): Promise<MarketplaceListingDTO | null> {
    const res = await apiFetch(`${this.baseUrl()}/listings/${encodeURIComponent(id)}`, {
      method: 'GET',
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new MarketApiError('getDetail', res);
    return parseJson<MarketplaceListingDTO>(res);
  }

  /** Acquire an item — purchase (debit SOULs) or free grab. */
  async acquire(id: string): Promise<AcquireDTO> {
    await this.guardAuth();
    const res = await apiFetch(
      `${this.baseUrl()}/listings/${encodeURIComponent(id)}/acquire`,
      { method: 'POST' },
    );
    if (!res.ok) {
      const body = await parseJson<{ error?: string }>(res);
      throw new MarketApiError('acquire', res, body?.error);
    }
    return parseJson<AcquireDTO>(res);
  }

  /** The caller's own listings. */
  async getMine(): Promise<MarketplaceListingDTO[]> {
    await this.guardAuth();
    const res = await apiFetch(`${this.baseUrl()}/mine`, { method: 'GET' });
    if (!res.ok) throw new MarketApiError('getMine', res);
    const body = await parseJson<{ listings?: MarketplaceListingDTO[] }>(res);
    return body.listings ?? [];
  }

  /** Everything the account owns (purchases + free + own) — cross-device. */
  async getLibrary(): Promise<OwnedAssetDTO[]> {
    await this.guardAuth();
    const res = await apiFetch(`${this.baseUrl()}/library`, { method: 'GET' });
    if (!res.ok) throw new MarketApiError('getLibrary', res);
    const body = await parseJson<{ assets?: OwnedAssetDTO[] }>(res);
    return body.assets ?? [];
  }

  /** Delist (soft delete → status='delisted'). */
  async delist(id: string): Promise<void> {
    await this.guardAuth();
    const res = await apiFetch(`${this.baseUrl()}/listings/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
    if (!res.ok && res.status !== 204) throw new MarketApiError('delist', res);
  }

  /** Edit listing (owner only). */
  async update(id: string, patch: Partial<PublishPayload>): Promise<MarketplaceListingDTO> {
    await this.guardAuth();
    const res = await apiFetch(`${this.baseUrl()}/listings/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (!res.ok) throw new MarketApiError('update', res);
    return parseJson<MarketplaceListingDTO>(res);
  }
}

export class MarketApiError extends Error {
  readonly status: number | undefined;
  readonly action: string;
  constructor(action: string, res: Response, error?: string) {
    super(`Marketplace ${action} failed: ${error ?? `HTTP ${res.status}`}`);
    this.name = 'MarketApiError';
    this.action = action;
    this.status = res.status;
  }
}

const marketplaceApiService = new MarketplaceApiServiceClass();
export default marketplaceApiService;

// Named surface for dependency injection in tests.
export { MarketplaceApiServiceClass };