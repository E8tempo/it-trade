import { redirect } from "next/navigation";

import type { AdminUser } from "@/lib/admin/types";
import { ApiError, apiServer } from "@/lib/api/server";

/**
 * The signed-in admin, or a redirect to the admin login. Reads the session cookie, so call it
 * inside a <Suspense> boundary (Cache Components). The API checks the role on every request
 * anyway; this only keeps other users from seeing the panel's pages.
 */
export async function requireAdmin(): Promise<AdminUser> {
  let user: AdminUser | null = null;
  try {
    user = await apiServer<AdminUser>("/api/auth/me");
  } catch (e) {
    if (!(e instanceof ApiError && e.status === 401)) throw e;
  }
  // redirect() throws, so it stays outside the try block
  if (!user) redirect("/admin/login");
  if (user.role !== "admin") redirect("/admin/login?denied=1");
  return user;
}
