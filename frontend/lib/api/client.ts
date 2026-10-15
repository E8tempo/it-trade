"use client";

export class ApiError extends Error {
  constructor(
    public status: number,
    public detail: unknown,
  ) {
    super(`API ${status}`);
  }
}

let refreshing: Promise<unknown> | null = null;

/**
 * Refreshes the session: the new tokens, or null when it is over (401); rejects when the API is unreachable.
 * One refresh at a time for the whole page: the 401 retries below and the session provider's refresh ahead of
 * the token's expiry wait for the same request, so two refreshes never race with the same cookie.
 */
export function refreshTokens<T>(): Promise<T | null> {
  refreshing ??= fetch("/api/auth/refresh", { method: "POST" })
    .then(async (r) => {
      if (r.ok) return r.json();
      if (r.status === 401) return null;
      throw new ApiError(r.status, await r.json().catch(() => null));
    })
    .finally(() => {
      refreshing = null;
    });
  return refreshing as Promise<T | null>;
}

function refreshSession(): Promise<boolean> {
  return refreshTokens().then(
    (t) => t !== null,
    () => false,
  );
}

/**
 * Fetch from the browser. The API is same-origin (/api is proxied), so the httpOnly session
 * cookies are sent automatically; on 401 the session is refreshed once and the call retried.
 */
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  // JSON by default; FormData gets its multipart boundary from the browser
  if (init.body && !(init.body instanceof FormData) && !headers.has("content-type")) headers.set("content-type", "application/json");

  let res = await fetch(path, { ...init, headers });
  if (res.status === 401 && !path.startsWith("/api/auth/") && (await refreshSession())) {
    res = await fetch(path, { ...init, headers });
  }
  if (!res.ok) throw new ApiError(res.status, await res.json().catch(() => null));
  return (res.status === 204 ? undefined : await res.json()) as T;
}
