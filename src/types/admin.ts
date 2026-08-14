/** A grantable subject, from basecamp.list_people(). */
export type Person = {
  id: string;
  email: string;
  /** When the account signed up. From auth.users.created_at, super_admin-gated. */
  created_at: string;
  /**
   * Whether this person is in `basecamp.super_admins` — this schema's own trust
   * root, so it says nothing about any other app sharing the project.
   *
   * READ-ONLY in the UI, deliberately. There is no path here that writes the
   * trust root: promoting or demoting an administrator is a SQL statement, and
   * the roster surfaces the fact without offering to change it.
   */
  is_super_admin: boolean;
};

/** One row of basecamp.access_audit. Append-only; the app never writes it. */
export type AuditRow = {
  id: number;
  occurred_at: string;
  actor_email: string | null;
  action: "grant" | "revoke";
  source_table: "access_grants" | "type_grants" | "super_admins" | "members" | "unknown";
  subject_label: string | null;
  object_kind: "entry" | "category" | "type" | null;
  object_label: string | null;
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
// this module is types only, so `src/lib/` stays the single place the
// "run the tests after touching it" rule has to name.

// ---------------------------------------------------------------------------
// User types (basecamp.member_types / members / type_grants)
// ---------------------------------------------------------------------------

/** A user type owned by this schema. NOT a role from an external role table. */
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
 * `deal_sourcing` sits after Sales because sourcing precedes selling; the enum
 * in 0001_baseline.sql declares the same position, so this array and
 * `order by nav_group` cannot disagree.
 *
 * These are defaults, not a fixed taxonomy. To change them, edit the enum with
 * `ALTER TYPE basecamp.nav_group ...` and keep this array in the same order.
 *
 * This is the render order, not the source of truth for which groups exist —
 * that is basecamp.nav_group. A group named here with no readable entries
 * renders nothing at all rather than an empty heading, so on a fresh install
 * every group is silent until you place entries in it.
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
