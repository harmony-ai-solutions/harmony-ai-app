/**
 * Fetch wrapper — one-way delegate to `AuthService.fetch()`.
 *
 * Exists only to preserve the `authFetch(url, init)` + `AuthExpiredError`
 * public API that later phases (6-x) and any current importers expect.
 *
 * The real 401-refresh-retry logic lives in `AuthService.fetch()` so the
 * dependency is strictly one-way (authFetch → AuthService → tokenStorage)
 * with no circular import.
 */

import AuthService from './AuthService';

export async function authFetch(
  url: string,
  init: RequestInit = {},
): Promise<Response> {
  return AuthService.fetch(url, init);
}

export { AuthExpiredError } from './AuthService';
