import { cookies } from "next/headers";

const API_URL = process.env.API_URL ?? "http://localhost:8000";

export class ApiError extends Error {
  constructor(
    public status: number,
    public detail: unknown,
  ) {
    super(`API ${status}`);
  }
}

/**
 * Fetch from Server Components / Server Functions. Goes straight to the backend and forwards
 * the user's access token (the proxy has already refreshed an expired session).
 * Reading cookies makes the caller dynamic: with Cache Components keep it inside <Suspense>.
 */
export async function apiServer<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = (await cookies()).get("access_token")?.value;
  const headers = new Headers(init.headers);
  if (token) headers.set("authorization", `Bearer ${token}`);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");

  const res = await fetch(`${API_URL}${path}`, { ...init, headers });
  if (!res.ok) throw new ApiError(res.status, await res.json().catch(() => null));
  return (res.status === 204 ? undefined : await res.json()) as T;
}

/** Public catalog data that does not depend on the user: no cookies, so callers can cache it with "use cache". */
export async function apiPublic<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, init);
  if (!res.ok) throw new ApiError(res.status, await res.json().catch(() => null));
  return (await res.json()) as T;
}
