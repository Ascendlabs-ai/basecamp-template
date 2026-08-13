import { type NextRequest, NextResponse } from "next/server";

import { createServerClient } from "@supabase/ssr";

import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./env";

/** Routes reachable without a session. Everything else requires one. */
const PUBLIC_PATHS = ["/login"];

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    db: { schema: "basecamp" },
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
      },
    },
  });

  // getUser(), not getSession(). getSession() reads the cookie and trusts it;
  // getUser() revalidates the token against the auth server. On a shared Supabase project
  // a stale or forged cookie must not be enough to reach the catalog.
  // This call is also what refreshes an expiring token — do not remove it.
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  // Without this, a Supabase auth outage is indistinguishable from "no
  // session": every user is bounced to a login page that also cannot work,
  // and nothing anywhere says why. AuthSessionMissingError is the ordinary
  // signed-out case and is not worth logging.
  if (authError && authError.name !== "AuthSessionMissingError") {
    console.error("[basecamp] auth.getUser failed:", authError.message);
  }

  const { pathname } = request.nextUrl;
  const isPublic = PUBLIC_PATHS.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );

  // A redirect is a BRAND NEW response and carries none of the cookies that
  // `setAll` wrote onto `response` above. Returning one bare drops the rotated
  // token pair, so the browser keeps a refresh token Supabase has already
  // consumed and the user is logged out on their next request. The `!user`
  // branch has the mirror problem: when a refresh fails, supabase-js calls
  // `setAll` with empty values to CLEAR the dead cookies, and dropping those
  // clears makes the browser retry a doomed refresh forever.
  //
  // So: build the redirect, then copy the session cookies onto it.
  const redirectWithSession = (url: URL) => {
    const redirect = NextResponse.redirect(url);
    response.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
    return redirect;
  };

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    // Preserve where they were headed so login can return them there. Only the
    // path is carried, never the full URL — and the login form re-validates it
    // through sameOriginPath() before navigating, because this value round
    // trips through the address bar where anyone can rewrite it.
    // Only for document navigations. A sign-out click in a tab whose session
    // has already expired is a POST; carrying it into `next` means the user
    // signs in and is then sent to GET /auth/signout, which exports only POST
    // and answers 405. `next` is a navigation concept and must come from one.
    if (request.method === "GET") {
      url.searchParams.set("next", `${pathname}${request.nextUrl.search}`);
    }
    return redirectWithSession(url);
  }

  if (user && isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return redirectWithSession(url);
  }

  // Must return THIS response object: it carries the refreshed auth cookies
  // set above. Returning a fresh NextResponse.next() drops them and the user
  // is silently logged out on token expiry.
  return response;
}
