import { redirect } from "next/navigation";

import AppShell from "@/components/shell/AppShell";
import { createClient } from "@/lib/supabase/server";
import { isSuperAdmin } from "@/lib/isSuperAdmin";
import { initialsFromEmail } from "@/lib/adminAccess";
import type { NavGroup } from "@/types/admin";
import type { ShellNavItem } from "@/types/shell";

/**
 * The persistent shell. Everything signed-in renders inside it; /login does not
 * (it sits outside this route group).
 *
 * Per-user by RLS, so never cached across requests — the same reason the
 * catalog page carries this.
 */
export const dynamic = "force-dynamic";

/**
 * Sidebar navigation is driven by `entries.nav_group`, NOT by category.
 *
 * Grouping the sidebar by `basecamp.categories` is the obvious alternative and
 * it is deliberately not what happens: categories are a taxonomy of what things
 * ARE, and a launcher wants a taxonomy of what people DO. `nav_group` exists so
 * the two can disagree without either being wrong.
 *
 * Only LAUNCHABLE entries with a `nav_group` appear. Everything else — the
 * reference rows, the catalog-only rows, and any launchable you have not placed
 * in a group — lives in the home catalog and nowhere else. A sidebar of things
 * you cannot open is a table of contents, not navigation.
 *
 * Consequence worth knowing on a fresh install: an entry with no `nav_group` is
 * invisible here no matter how launchable it is. If something is missing from
 * the sidebar, that column is the first thing to check.
 */
export default async function ShellLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Middleware already redirects unauthenticated requests; this is the
  // defence-in-depth copy, matching the catalog page.
  if (!user) redirect("/login");

  // RLS-filtered: the viewer receives only entries they can already read, so
  // this list is per-user without the query knowing anything about who they are.
  //
  // Promise.all: the nav read and the role predicate have no data dependency,
  // and every page in the app paid them SEQUENTIALLY before its own queries
  // even started. That serial latency is what made the loading skeleton
  // visible. admin/access/page.tsx already used this shape.
  const [{ data, error, count }, role] = await Promise.all([
    supabase
      .from("entries")
      .select("id, slug, display_name, launch_url, nav_group, sort_order", { count: "exact" })
      .eq("entry_type", "launchable")
      .not("nav_group", "is", null)
      .order("sort_order", { ascending: true })
      .order("slug", { ascending: true }),
    // Request-scoped and deduplicated: the home page and the Catalog admin ask
    // the same question, and this is the one call all three share.
    isSuperAdmin(),
  ]);

  if (error) {
    // The shell must still render — a failed nav query should not blank the
    // page the user asked for. Log it and fall back to an empty nav.
    console.error("[basecamp] shell nav query failed:", error.code, error.message);
  } else if (count !== null && count > (data?.length ?? 0)) {
    // Detected by COUNT, not by comparing against our own ceiling: PostgREST
    // caps at its own `max-rows` (1000 on this project) before any app limit
    // applies, so a length-vs-limit check is blind to the cap that actually
    // bites. Unlike the admin screen a short nav is degraded rather than wrong
    // — the shell must still render — so this logs and carries on.
    console.error(`[basecamp] shell nav truncated: ${data?.length ?? 0} of ${count} items`);
  }

  const rows = (data ?? []) as Array<{
    id: string;
    slug: string;
    display_name: string;
    launch_url: string | null;
    nav_group: NavGroup | null;
  }>;

  const navItems: ShellNavItem[] = rows
    // launch_url cannot be null on a launchable entry — a CHECK constraint
    // enforces it — but the column is nullable in the type, and a nav item
    // without an href would render as a link to nowhere.
    .filter((e): e is typeof e & { launch_url: string; nav_group: NavGroup } =>
      Boolean(e.launch_url) && e.nav_group !== null)
    .map((e) => ({
      id: e.id,
      slug: e.slug,
      name: e.display_name,
      href: e.launch_url,
      navGroup: e.nav_group,
      // Everything in the sidebar is a separate deployment on its own origin,
      // so every one of these leaves the shell. The design marks the External
      // group specifically; the rest still open in a new tab because losing
      // the catalog to navigate to another app is the thing the shell exists to
      // prevent.
      external: true,
    }));

  // The database's own predicate — the same one every write policy calls — not
  // a role string read here and interpreted. Used for two presentational
  // decisions (show the Admin row, label the identity block); it is NOT the
  // access control. That lives in the policies on access_grants and in
  // list_people(), both of which refuse a non-super_admin regardless of what
  // this returns.
  // Fails closed (canAdmin stays false, the Admin rows hide), which is the right
  // direction; `isSuperAdmin` does the logging so the failure is not silent.
  const canAdmin = role.value;

  const email = user.email ?? "";

  return (
    <AppShell
      navItems={navItems}
      canAdmin={canAdmin}
      identity={{
        email,
        initials: initialsFromEmail(email),
        roleLabel: canAdmin ? "Super admin" : "Team member",
      }}
    >
      {children}
    </AppShell>
  );
}
