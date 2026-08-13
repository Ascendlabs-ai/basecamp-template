import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

/**
 * POST-only. Sign-out is a state change, so it must not be reachable by GET:
 * a prefetch, a crawler, or an <img src> on any page would otherwise log the
 * user out. The header uses a real <form method="post">, which also means it
 * still works with JavaScript disabled.
 */
export async function POST(request: Request) {
  const supabase = await createClient();

  // scope: "local" — NOT the SDK default.
  //
  // signOut() defaults to scope "global", which revokes every refresh token
  // that user holds across the ENTIRE Supabase project. This Supabase project may be shared
  // with client-facing apps, so the default would mean: clicking "Sign out" in
  // this read-only internal catalog also signs that person out of every other
  // app on the project, on every device. "local" ends this browser's session and
  // nothing else, which is what the button appears to promise.
  const { error } = await supabase.auth.signOut({ scope: "local" });

  if (error) {
    // Redirecting blind on failure is worse than failing loudly: middleware
    // would see the user as still authenticated, bounce them from /login back
    // to /, and they would appear to have clicked a dead button.
    console.error("[basecamp] sign-out failed:", error.message);
    return NextResponse.json(
      { error: "Sign-out failed. Close this browser to end the session." },
      { status: 500 },
    );
  }

  return NextResponse.redirect(new URL("/login", request.url), {
    // 303: turn the POST into a GET for the redirect target, so the browser
    // does not re-issue the POST against /login.
    status: 303,
  });
}
