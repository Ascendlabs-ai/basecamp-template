import { createBrowserClient } from "@supabase/ssr";

import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./env";

/**
 * Browser-side Supabase client. Used by the login form and by the admin access
 * screens, which write `access_grants` directly from the browser.
 *
 * Writing from the client is deliberate under this app's Pattern C posture: RLS
 * is the gate no matter who issues the statement, and the anon key carries the
 * signed-in user's JWT, so a super_admin-only policy is enforced identically
 * here and on the server. Routing these writes through a Next route handler
 * would add a hop without adding a check. Catalog READS still happen
 * server-side, so the session cookie remains the source of truth for rendering.
 *
 * `db.schema` is pinned to `basecamp`: this app owns no tables in `public`, and
 * defaulting to `public` would make a mistyped table name silently query a
 * shared schema on a project that other apps may also use.
 */
export function createClient() {
  return createBrowserClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    db: { schema: "basecamp" },
  });
}
