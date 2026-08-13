/** A grantable subject, from basecamp.list_people(). */
export type Person = {
  id: string;
  email: string;
};

/** An entry as the admin screens need it — identity and label only. */
export type GrantTarget = {
  id: string;
  display_name: string;
};

export type GrantCategory = {
  id: string;
  slug: string;
  name: string;
  entries: GrantTarget[];
};

/**
 * One row of basecamp.access_grants. Exactly one of entry_id / category_id is
 * set — enforced by a CHECK in the database, not by this type.
 */
export type Grant = {
  id: string;
  user_id: string;
  entry_id: string | null;
  category_id: string | null;
};

/**
 * What a toggle is acting on. Exactly one id is set, mirroring the database's
 * `check ((entry_id is null) <> (category_id is null))`.
 *
 * Lives here beside `Grant` rather than in AccessAdmin.tsx — both children that
 * consume it already import their other types from this module, and exporting
 * it from their own parent made the graph AccessAdmin -> AccessMatrix ->
 * AccessAdmin.
 */
export type ToggleTarget = { entryId: string } | { categoryId: string };

// The functions that operate on these shapes live in src/lib/adminAccess.ts —
// this module is types only, so `src/lib/` stays the single place CLAUDE.md's
// "run the tests after touching it" rule has to name.

// ---------------------------------------------------------------------------
// User types (basecamp.member_types / members / type_grants)
// ---------------------------------------------------------------------------

/** A Basecamp-owned user type. NOT a an external role table role. */
export type MemberType = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  is_admin: boolean;
  /** Seeded types the app refers to by slug; the database refuses to delete them. */
  is_system: boolean;
  sort_order: number;
};

/** One person's type assignment. Absence of a row means "no type". */
export type Member = {
  id: string;
  user_id: string;
  member_type_id: string;
  department: string | null;
};

/** What a type can see. Same shape as `Grant`, keyed to a type. */
export type TypeGrant = {
  id: string;
  member_type_id: string;
  entry_id: string | null;
  category_id: string | null;
};

/**
 * How a person came to see an entry.
 *
 *   none        no path to it
 *   type        their type grants it — changing this means changing the type,
 *               so a per-person control must not offer to toggle it
 *   individual  granted to them personally in access_grants
 *
 * `viaCategory` says the individual grant is a CATEGORY grant, not an entry
 * grant. This field is load-bearing, not informational: a per-entry toggle
 * cannot revoke a category grant — it would insert a redundant entry row while
 * the person keeps access — so any control that offers "revoke" has to check it
 * and render inert instead. It was dropped when this type replaced
 * entryVisibility, and the matrix shipped able to *report* a successful revoke
 * that never happened.
 *
 * `alsoViaType` marks the other redundant case: an individual grant on
 * something their type already covers. There the toggle IS live — it controls a
 * real row — but flipping it changes nothing the person sees, and the UI has to
 * say so rather than look broken.
 */
export type AccessSource = "none" | "type" | "individual";

export type CellAccess = {
  source: AccessSource;
  /** The individual grant is on the whole category — a per-entry toggle cannot revoke it. */
  viaCategory: boolean;
  alsoViaType: boolean;
};

/** Sidebar grouping. Presentation only — confers no access. */
export type NavGroup = "marketing" | "sales" | "deal_sourcing" | "operations" | "external";

/**
 * The sidebar order. Groups render in this sequence.
 *
 * The first four are the design handoff's. `deal_sourcing` is not from the
 * handoff — it was added 2026-08-05 (the maintainer) when a new app got a live URL,
 * ahead of government-grant work landing in that app. It sits after Sales
 * because sourcing precedes selling; the enum in
 * 20260805100000_add_deal_sourcing_nav_group.sql declares the same position, so
 * this array and `order by nav_group` cannot disagree.
 *
 * This is the render order, not the source of truth for which groups exist —
 * that is basecamp.nav_group. A group named here with no readable entries
 * renders nothing at all, which is how `sales` has behaved since day one.
 */
export const NAV_GROUP_ORDER: readonly NavGroup[] = [
  "marketing",
  "sales",
  "deal_sourcing",
  "operations",
  "external",
] as const;

export const NAV_GROUP_LABEL: Record<NavGroup, string> = {
  marketing: "Marketing",
  sales: "Sales",
  deal_sourcing: "Deal Sourcing",
  operations: "Operations",
  external: "External",
};
