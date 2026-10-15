"use client";

import { useEffect } from "react";

import { authHref } from "@/components/shop/next-url";
import { useSession } from "@/components/shop/session-provider";

/**
 * The shop is for signed-in clients only. proxy.ts sends a visitor without a session to the login page before
 * a page renders; this covers a session that ends while a page is open (signed out in another tab or
 * everywhere, a password change). Only on the API's 401: a page whose API is unreachable stays as it is.
 */
export function RequireSession() {
  const { signedOut } = useSession();
  useEffect(() => {
    if (!signedOut) return;
    const { pathname, search } = window.location;
    // a full load: drops what the page keeps in memory for the account that is gone
    window.location.replace(authHref("/login", pathname === "/" ? null : pathname + search));
  }, [signedOut]);
  return null;
}
