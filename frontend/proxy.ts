import { NextResponse, type NextRequest } from "next/server";

const API_URL = process.env.API_URL ?? "http://localhost:8000";

// Open without a session: the login and registration pages, and the admin panel (it has its own login).
const PUBLIC = /^\/(login|register)\/?$|^\/admin(\/|$)/;

/**
 * Runs before every page.
 *
 * The site is for signed-in clients only: a visitor without a session is sent to the login page,
 * and comes back to the page they asked for after signing in (?next=).
 *
 * It also refreshes an expired JWT session before a page is rendered. The access_token cookie lives
 * exactly as long as the token (15 min by default). Once the browser has dropped it, the first page
 * request that still carries refresh_token gets a new pair from the API: the cookies are set on the
 * response, and the new access token is also put into this request's headers so Server Components
 * rendering it are already logged in.
 */
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isPublic = PUBLIC.test(pathname);
  if (request.cookies.has("access_token")) return NextResponse.next();
  const refreshToken = request.cookies.get("refresh_token")?.value;
  if (!refreshToken) return isPublic ? NextResponse.next() : toLogin(request);

  let res: Response;
  try {
    res = await fetch(`${API_URL}/api/auth/refresh`, {
      method: "POST",
      headers: {
        cookie: `refresh_token=${refreshToken}`,
        "user-agent": request.headers.get("user-agent") ?? "",
      },
      cache: "no-store",
    });
  } catch {
    // API unreachable: render the page as is, the browser retries on the next request
    return NextResponse.next();
  }

  let response: NextResponse;
  if (res.ok) {
    const { access_token } = (await res.json()) as { access_token: string };
    request.cookies.set("access_token", access_token);
    const headers = new Headers(request.headers);
    headers.set("cookie", request.cookies.toString());
    response = NextResponse.next({ request: { headers } });
  } else {
    // the session is over; the API response deletes the cookies
    response = isPublic ? NextResponse.next() : toLogin(request);
  }
  for (const cookie of res.headers.getSetCookie()) {
    response.headers.append("set-cookie", cookie);
  }
  return response;
}

/** `/login?next=/c/noutbuki?page=2`: back to the asked page after signing in (the home page needs no `next`). */
function toLogin(request: NextRequest): NextResponse {
  const { pathname, search } = request.nextUrl;
  const url = new URL("/login", request.url);
  if (pathname !== "/") url.searchParams.set("next", pathname + search);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: [
    // pages only: not the API, media, Next.js internals (assets, dev tools) or files with an extension
    "/((?!api/|media/|_next/|__next|favicon.ico|.*\\.\\w+$).*)",
  ],
};
