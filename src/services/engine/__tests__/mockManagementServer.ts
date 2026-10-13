/**
 * Mock management server for jest (task 3-2).
 *
 * A tiny in-memory HTTP router that returns fetch `Response`-like objects, so
 * the management-API client + repository adapters can be exercised without a
 * live engine. Routes match on method + a path predicate (string or RegExp).
 *
 * This mirrors the spirit of the existing websocket test harness
 * (`src/services/websocket/__tests__/helpers`) but for the REST side.
 */

import type { FetchLike } from '../EngineApiClient';

export interface MockRequest {
  method: string;
  url: string;
  path: string;
  query: Record<string, string>;
  headers: Record<string, string>;
  body: unknown;
}

export interface MockRoute {
  method: string;
  /** String = exact path match; RegExp = path.test(path). */
  path: string | RegExp;
  status?: number;
  /** JSON body (returned by `.json()`); ignored when `bytes` is set. */
  json?: unknown;
  /** Raw bytes (returned by `.arrayBuffer()`). */
  bytes?: Uint8Array;
  /** Optional dynamic responder overriding `json`/`bytes`. */
  respond?: (req: MockRequest) => { status?: number; json?: unknown; bytes?: Uint8Array };
}

function parseUrl(url: string): { path: string; query: Record<string, string> } {
  // `url` may be a full URL (http://127.0.0.1:port/path?q=1) or a bare path.
  const parsed = new URL(url, 'http://localhost');
  const query: Record<string, string> = {};
  parsed.searchParams.forEach((value, key) => {
    query[key] = value;
  });
  return { path: parsed.pathname, query };
}

function makeResponse(status: number, json: unknown, bytes?: Uint8Array): Response {
  const ok = status >= 200 && status < 300;
  const buffer = bytes ? bytes.slice().buffer : new ArrayBuffer(0);
  return {
    ok,
    status,
    json: async () => json,
    text: async () => (typeof json === 'string' ? json : JSON.stringify(json ?? '')),
    arrayBuffer: async () => buffer,
  } as unknown as Response;
}

export interface MockManagementServer {
  fetch: FetchLike;
  calls: MockRequest[];
  /** The last request matching the given method + path predicate, or undefined. */
  lastCall(method: string, path: string | RegExp): MockRequest | undefined;
}

export function createMockManagementServer(routes: MockRoute[]): MockManagementServer {
  const calls: MockRequest[] = [];

  const fetchImpl: FetchLike = async (url, init = {}) => {
    const method = (init.method ?? 'GET').toUpperCase();
    const { path, query } = parseUrl(url);
    const headers = (init.headers as Record<string, string>) ?? {};
    let body: unknown = undefined;
    if (typeof init.body === 'string') {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    }
    const req: MockRequest = { method, url, path, query, headers, body };
    calls.push(req);

    const route = routes.find(r => {
      if (r.method.toUpperCase() !== method) return false;
      return typeof r.path === 'string' ? r.path === path : r.path.test(path);
    });
    if (!route) {
      return makeResponse(404, { error: `no mock route for ${method} ${path}` });
    }
    const dynamic = route.respond?.(req);
    const status = dynamic?.status ?? route.status ?? 200;
    const json = dynamic?.json ?? route.json ?? null;
    const bytes = dynamic?.bytes ?? route.bytes;
    return makeResponse(status, json, bytes);
  };

  return {
    fetch: fetchImpl,
    calls,
    lastCall(method, path) {
      for (let i = calls.length - 1; i >= 0; i--) {
        const c = calls[i];
        if (c.method.toUpperCase() !== method.toUpperCase()) continue;
        const match = typeof path === 'string' ? c.path === path : path.test(c.path);
        if (match) return c;
      }
      return undefined;
    },
  };
}
