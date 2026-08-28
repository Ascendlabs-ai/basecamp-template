import { type NextRequest, NextResponse } from "next/server";

import { createServerClient } from "@supabase/ssr";

import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./env";

/** Routes reachable without a session. Everything else requires one. */
const PUBLIC_PATHS = ["/login"];

/**
 * Routes reachable EITHER WAY — signed in or not — and never redirected away
 * from.
 *
 * These cannot go in PUBLIC_PATHS, and the reason is NOT that the visitor
 * arrives authenticated — they do not. The token is in the URL fragment and is
 * exchanged client-side, so at middleware time there is no session cookie at
 * all.
 *
 * The reason is the other direction: someone who is ALREADY signed in and opens
 * an issued link would be bounced to `/` by the `user && isPublic` rule below,
 * landing them anywhere except the form they opened. A route that must work in
 * both states cannot be described by a flag that means "signed out only".
 */
const ALWAYS_PATHS = [
  // The two halves of the admin-issued sign-in flow, here for BOTH reasons at
  // once. A person following an invite link has no session yet, so a
  // signed-in-only rule would bounce them to /login — the one page that cannot
  // help, since they have no password to sign in with. And someone who IS
  // signed in and opens a link for a different account must still land on the
  // form rather than being sent to `/`.
  "/auth/confirm",
  "/accept-invite",
];

export async function updateSession(request: NextRequest) {
  // CROSS-SITE MUTATIONS ARE REFUSED BEFORE ANYTHING ELSE — including before
  // the Supabase client is built.
  //
  // The /api/admin routes are this app's ONLY cookie-authenticated
  // state-changing endpoints — every other write goes browser→Supabase with a
  // bearer token in a header, which is structurally immune to CSRF. A
  // cross-site POST to /api/admin/people/<id>/ban would otherwise be defended
  // only by @supabase/ssr's default SameSite=Lax cookie attribute: a default,
  // from a dependency, that this codebase neither asserts nor tests. This file
  // is built on asserting invariants rather than describing them, so the check
  // is here rather than assumed.
  //
  // `Sec-Fetch-Site` is a forbidden header — page JavaScript cannot set it —
  // and a missing one falls through to the Origin comparison, so a client that
  // sends neither is treated as same-origin, which is the pre-existing
  // behaviour rather than a new hole.
  // FIRST, not after getUser(). Placed later, every refused cross-site request
  // still cost a GoTrue round trip, so any third-party page could drive load on
  // the auth endpoint for free — and worse, the 403 returned without copying
  // the rotated session cookies, which in the same-site-subdomain case (where
  // SameSite=Lax cookies ARE sent) signed the victim out. Reading only headers
  // means nothing has been rotated yet and there is nothing to preserve.
  //
  // CAVEAT FOR REVERSE PROXIES: `request.nextUrl.origin` must reflect the
  // PUBLIC origin. Behind a proxy that does not set `x-forwarded-host` and
  // `x-forwarded-proto`, this refuses every legitimate same-origin POST and the
  // admin screens fail wholesale with "Cross-site requests are refused."
  // EVERY non-GET, not a path prefix. An earlier version guarded only `/api/`,
  // which is the allow-list shape this same file rejects thirty lines down —
  // and it was already wrong: `/auth/signout` is a POST route handler on a
  // cookie-authenticated state change and sat outside the prefix, so
  // cross-site forced logout was reachable. A route added later would be
  // unguarded by default, which is precisely the failure mode named there.
  if (request.method !== "GET" && request.method !== "HEAD") {
    const site = request.headers.get("sec-fetch-site");
    const origin = request.headers.get("origin");
    const crossSite =
      site === "cross-site" ||
      (origin !== null && origin !== request.nextUrl.origin);
    if (crossSite) {
      return NextResponse.json({ error: "Cross-site requests are refused." }, { status: 403 });
    }
  }

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
  const matches = (list: string[]) =>
    list.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  const isPublic = matches(PUBLIC_PATHS);
  const isAlways = matches(ALWAYS_PATHS);

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

  if (!user && !isPublic && !isAlways) {
    // A REDIRECT IS A DOCUMENT-NAVIGATION ANSWER. Sent to a `fetch`, it is
    // followed automatically and the caller gets 200 + the login page's HTML,
    // which its `res.json()` then chokes on — reporting a parse error for what
    // is really "your session expired".
    //
    // An earlier fix exempted the whole `/api/` tree from this branch. That was
    // the wrong shape and this file says why thirty lines up: an allow-list of
    // paths is the pattern that leaks, because a route added later is
    // unprotected by default. It also mis-described its own category —
    // `/auth/signout` is a route handler too and was never in the list.
    //
    // So the REFUSAL changes shape and the GATE stays. Deny-by-default still
    // covers every present and future route; a non-navigation request just gets
    // a 401 it can read. `sec-fetch-dest` is sent by every browser that can
    // reach this app, and its absence is treated as a navigation — the
    // conservative direction, since that preserves the old behaviour.
    if (request.headers.get("sec-fetch-dest") !== "document") {
      const refused = NextResponse.json({ error: "Not signed in." }, { status: 401 });
      response.cookies.getAll().forEach((cookie) => refused.cookies.set(cookie));
      return refused;
    }
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
