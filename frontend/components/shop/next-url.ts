// Where to go after login or registration (?next=). Only paths of this site are followed:
// `//evil.com`, `/\evil.com`, `/<tab>/evil.com` and the like resolve to another origin and are
// dropped, as is anything that is not a path (`javascript:...`, full URLs).

const ORIGIN = "http://shop.invalid"; // any fixed origin: only used to see where a path leads
const AUTH_PAGES = /^\/(login|register)\/?$/;

export function safeNext(raw: string | null | undefined, fallback = "/"): string {
  if (!raw?.startsWith("/") || raw.startsWith("//")) return fallback;
  try {
    const url = new URL(raw, ORIGIN);
    // the normalised path is checked too: "/..//evil.com" becomes "//evil.com"
    if (url.origin !== ORIGIN || url.pathname.startsWith("//") || AUTH_PAGES.test(url.pathname)) return fallback;
    return url.pathname + url.search + url.hash;
  } catch {
    return fallback;
  }
}

/** `/login?next=/cart`: an auth page that brings the visitor back to `path` afterwards. */
export function authHref(page: "/login" | "/register", path: string | null): string {
  return path ? `${page}?next=${encodeURIComponent(path)}` : page;
}

/** `next` of the current URL, for the auth pages (read in event handlers and effects only). */
export function nextFromLocation(fallback?: string): string {
  return safeNext(new URLSearchParams(window.location.search).get("next"), fallback);
}
