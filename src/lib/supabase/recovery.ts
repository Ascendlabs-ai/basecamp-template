import { createClient as createSupabaseClient } from "@supabase/supabase-js";

import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./env";

/**
 * Password recovery, on the IMPLICIT flow — deliberately not the app's normal
 * browser client.
 *
 * WHY THIS FILE EXISTS. `@supabase/ssr`'s `createBrowserClient` hardcodes
 * `flowType: "pkce"` *after* spreading caller options, so it cannot be
 * overridden. Under PKCE, `resetPasswordForEmail` generates a code verifier and
 * stores it in **the calling browser's** storage, then mails a `?code=` link
 * that can only be exchanged by a browser holding that verifier.
 *
 * For a self-service "forgot password" that is correct — same person, same
 * browser. For an ADMIN sending a link to SOMEONE ELSE it is fatal: the verifier
 * is in the administrator's browser and the recipient's browser has none, so the
 * SDK does not even recognise the callback (`_isPKCECallback` is false when
 * storage is empty) and the page reports the link as unusable. A link issued
 * thirty seconds ago reads as expired, and the operator resends until they hit
 * the rate limit.
 *
 * The implicit flow has no verifier: GoTrue mails a link carrying the token in
 * the URL fragment, and any browser that opens it can complete the exchange.
 * That is what makes admin-initiated recovery possible at all without an admin
 * API — which this app has no key for, by design.
 *
 * Both ends must agree on the flow, which is why both live here: a PKCE client
 * rejects a fragment callback outright with `Not a valid PKCE flow url`.
 */

/**
 * Sender. Used by the admin screen.
 *
 * `persistSession: false` and `detectSessionInUrl: false` are load-bearing: this
 * client must never touch the administrator's own session or try to consume the
 * URL of the page it is called from. It exists to make one unauthenticated POST.
 */
export function createRecoverySender() {
  return createSupabaseClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      flowType: "implicit",
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

/**
 * Receiver. Used by /auth/reset.
 *
 * `detectSessionInUrl: true` is what reads the fragment and establishes the
 * short-lived recovery session that `updateUser` needs.
 *
 * `persistSession: false` is deliberate and worth stating: this recovery session
 * is NOT the app's session. It lives in memory for the length of the password
 * change and is then discarded. The app's real session is established afterwards
 * through the normal cookie client, by signing in with the password the person
 * just chose — so the server components see a session the ordinary way, and
 * there is no second, divergent session store to reason about.
 */
export function createRecoveryReceiver() {
  return createSupabaseClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      flowType: "implicit",
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: true,
    },
  });
}
