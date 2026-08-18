import { cache } from "react";

import { createClient } from "@/lib/supabase/server";

/**
 * The database's own role predicate, read once per request.
 *
 * WHY THIS EXISTS. Three server components under `(shell)` need the answer: the
 * layout (whether the Admin nav renders), the home page (whether an empty
 * catalog reads as "yours is empty" or "you have no access"), and the Catalog
 * admin (the tool or the locked panel). All three are `force-dynamic`, and
 * supabase-js issues this RPC as a POST — which Next's fetch memoisation does
 * not deduplicate.
 *
 * That is three CALL SITES but TWO calls per request, because the layout renders
 * with exactly one page: `/` pays layout + home, `/admin/catalog` pays layout +
 * catalog, and `/admin/access` does not ask at all. Two is still one more than
 * the question needs.
 *
 * IT TAKES NO ARGUMENTS, DELIBERATELY. `cache()` keys on the argument list, and
 * every caller builds its own client from `createClient()`, so a `supabase`
 * parameter would be a different object at each call site and dedupe nothing —
 * the helper would look like a fix while changing nothing at all. Creating the
 * client inside keeps the key empty, which is what makes the deduplication real.
 * Cookies are read per request, so the scope is exactly one request and one
 * user; nothing is shared across either.
 *
 * WHAT THIS IS NOT. It is not access control, and no caller may treat it as
 * such. All three use it to choose WHICH SCREEN TO RENDER. The gate on every
 * write is the RLS policy in Postgres — which this app cannot bypass, having no
 * service_role key to bypass it with. A wrong answer here shows the wrong
 * screen; it cannot permit a write the database would refuse.
 *
 * Fails CLOSED and LOUDLY: an unreadable answer is `false`, the more
 * conservative screen, and it is logged — an administrator silently shown a
 * locked panel has no way to tell that is what happened. Callers that can
 * surface the failure are handed the error to do so.
 */
export const isSuperAdmin = cache(
  async (): Promise<{ value: boolean; error: { code?: string; message?: string } | null }> => {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("is_super_admin");
    if (error) {
      console.error("[basecamp] is_super_admin RPC failed:", error.code, error.message);
      return { value: false, error };
    }
    return { value: data === true, error: null };
  },
);
