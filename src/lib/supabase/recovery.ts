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
 * BOTH factories return a lazily-created MODULE SINGLETON, and both pass their
 * own `storageKey`. Neither is decoration.
 *
 * A `GoTrueClient` registers a `visibilitychange` listener on `window` during
 * `_initialize()`, and removes it only on `signOut`/`stopAutoRefresh`/dispose —
 * none of which this app calls. So a factory that returns a NEW client per call
 * leaks one permanent window listener per call, each retaining its client. The
 * sender is invoked from a click handler, so "per call" means per button press.
 *
 * The `storageKey` matters for a second reason: auth-js keys its
 * "Multiple GoTrueClient instances detected" warning off a per-storageKey
 * instance counter. Left at the default, these clients share the app client's
 * key and every one of them prints that warning — on the admin screen, which is
 * the last place a scary console message helps anyone. Distinct keys keep the
 * counters separate. Nothing is actually written under either key, because
 * `persistSession: false` routes storage to an in-memory adapter.
 */

/**
 * Sender. Used by the admin screen.
 *
 * `persistSession: false` and `detectSessionInUrl: false` are load-bearing: this
 * client must never touch the administrator's own session or try to consume the
 * URL of the page it is called from. It exists to make one unauthenticated POST.
 */
let sender: ReturnType<typeof createSupabaseClient> | undefined;

export function createRecoverySender() {
  sender ??= createSupabaseClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      flowType: "implicit",
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      storageKey: "sb-recovery-sender",
    },
  });
  return sender;
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
let receiver: ReturnType<typeof createSupabaseClient> | undefined;

export function createRecoveryReceiver() {
  receiver ??= createSupabaseClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      flowType: "implicit",
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: true,
      storageKey: "sb-recovery-receiver",
    },
  });
  return receiver;
}
