import { NextResponse, type NextRequest } from "next/server";

const API_URL = process.env.API_URL ?? "http://localhost:8000";

/**
 * Refreshes an expired JWT session before a page is rendered.
 *
 * The access_token cookie lives exactly as long as the token (15 min by default). Once the
 * browser has dropped it, the first page request that still carries refresh_token gets a new
 * pair from the API: the cookies are set on the response, and the new access token is also
 * put into this request's headers so Server Components rendering it are already logged in.
 */
export async function proxy(request: NextRequest) {
  const refreshToken = request.cookies.get("refresh_token")?.value;
  if (!refreshToken) return NextResponse.next();

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
    return NextResponse.next(); // API unreachable: render as a guest, retry on the next request
  }

  let response: NextResponse;
  if (res.ok) {
    const { access_token } = (await res.json()) as { access_token: string };
    request.cookies.set("access_token", access_token);
    const headers = new Headers(request.headers);
    headers.set("cookie", request.cookies.toString());
    response = NextResponse.next({ request: { headers } });
  } else {
    response = NextResponse.next(); // the session is over; the API response deletes the cookies
  }
  for (const cookie of res.headers.getSetCookie()) {
    response.headers.append("set-cookie", cookie);
  }
  return response;
}

export const config = {
  matcher: [
    {
      // pages only: not the API, media, Next.js assets or files with an extension
      source: "/((?!api/|media/|_next/static|_next/image|favicon.ico|.*\\.\\w+$).*)",
      has: [{ type: "cookie", key: "refresh_token" }],
      missing: [{ type: "cookie", key: "access_token" }],
    },
  ],
};
