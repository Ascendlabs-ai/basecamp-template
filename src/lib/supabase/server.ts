import { cookies } from "next/headers";

import { createServerClient } from "@supabase/ssr";

import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./env";

/**
 * Server-side Supabase client, bound to the request's cookie jar.
 *
 * Uses the ANON key, never service_role. The whole access model lives in RLS
 * (`basecamp.has_grant` / `category_has_grant`, over `access_grants` UNION `type_grants`), and
 * service_role bypasses RLS entirely — reading the catalog with it would return
 * every row to every signed-in user and silently defeat the matrix.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    db: { schema: "basecamp" },
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // Server Components cannot set cookies. This is expected and safe:
          // the middleware refreshes the session on every request, so the
          // refreshed cookie is written there instead of here.
        }
      },
    },
  });
}
