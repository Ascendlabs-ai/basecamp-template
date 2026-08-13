import type { NavGroup } from "./admin";

/**
 * One launchable app in the sidebar.
 *
 * The sidebar lists ENTRIES now, not categories. The design's nav is a list of
 * apps you can open, grouped by department — a category like "Catalog only"
 * has nothing to launch and has no place in it. Entries with no `nav_group`
 * are absent here and appear only in the home catalog.
 *
 * Post-RLS: the viewer only ever receives rows they can already read, so this
 * list is per-user and hiding is not what makes it safe.
 */
export type ShellNavItem = {
  id: string;
  slug: string;
  name: string;
  href: string;
  navGroup: NavGroup;
  /** External apps open in a new tab and do not take the active state. */
  external: boolean;
};

export type ShellIdentity = {
  email: string;
  /** Two letters derived from the email; there is no profiles table on this Supabase project. */
  initials: string;
  /**
   * What to print under the name. Derived from the database's own
   * `basecamp.is_super_admin()` predicate — the same one the policies use — not
   * from a role string read and interpreted in app code.
   */
  roleLabel: string;
};
