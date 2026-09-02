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
   * WRITABLE from the roster since 0004, which granted `authenticated` the
   * INSERT and DELETE privileges whose policies 0001 had already written. The
   * write goes straight from the browser on the administrator's own token, like
   * every other write on this screen: the INSERT policy's WITH CHECK gates on
   * the CALLER, so a non-administrator cannot promote themselves, and the
   * last-row trigger refuses the demotion that would empty the table.
   */
  is_super_admin: boolean;
  /**
   * When their sign-in ban expires, or null if they are not banned. From
   * `auth.users.banned_until`, super_admin-gated like the rest of this shape.
   *
   * A ban is a far-future timestamp rather than a boolean because GoTrue models
   * it as a duration; anything non-null and in the future means banned. Read it
   * through `isBanned()` rather than testing it inline.
   */
  banned_until: string | null;
  /**
   * The type they hold, or null. Scalar because `basecamp.members` carries
   * UNIQUE (user_id) — a person holds at most one type, asserted in 0004 so the
   * roster cannot silently become the wrong shape.
   */
  member_type_id: string | null;
};

/** One row of basecamp.access_audit. Append-only; the app never writes it. */
export type AuditRow = {
  id: number;
  occurred_at: string;
  actor_email: string | null;
  /**
   * grant/revoke come from the four audit triggers. The four account-lifecycle
   * verbs are written only by `basecamp.log_privileged_action`, the definer RPC
   * the admin API routes call — no client role holds INSERT on this table.
   */
  action: "grant" | "revoke" | "invite" | "reissue_link" | "ban" | "unban" | "adopt";
  source_table:
    | "access_grants"
    | "type_grants"
    | "super_admins"
    | "members"
    /** Supabase Auth, not a basecamp table: the account-lifecycle events. */
    | "auth_admin"
    | "unknown";
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
  /**
   * The category this one sits under, or null.
   *
   * GRANTS DO NOT INHERIT. `category_has_grant()` is flat: granting a parent
   * grants nothing about its subcategories, and each is its own column in the
   * matrix. This field exists so the screens can LABEL a subcategory with its
   * parent — not so anything infers access from it.
   */
  parent_id: string | null;
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
  /**
   * Structural types the database refuses to DELETE — the trigger
   * `basecamp_member_types_no_system_delete` enforces it. `0004` seeds three
   * (staff, contractor, client) and marks them, because Add person needs at
   * least one type and a stamp with none ships a screen that cannot be used.
   * Renaming is deliberately still allowed: the label is cosmetic and grants
   * attach to the row. Nothing in this app looks a type up by slug.
   */
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

// ---------------------------------------------------------------------------
// Catalog administration (basecamp.categories / basecamp.entries)
// ---------------------------------------------------------------------------

/**
 * A category as the Catalog admin screen needs it: every column a person can
 * edit, plus the identity.
 *
 * Deliberately NOT `CatalogCategory` from types/catalog.ts. That type nests the
 * entries inside the category because the home page renders them that way; this
 * screen holds the two lists side by side so an entry can be moved between
 * categories, and nesting would mean rebuilding the tree on every such move.
 *
 * `description` is `string` and not `string | null` because the column is NOT
 * NULL with a not-blank CHECK. (`CatalogCategory` widens it to nullable, which
 * has always been looser than the schema.)
 */
export type AdminCategory = {
  id: string;
  slug: string;
  name: string;
  description: string;
  sort_order: number;
  /**
   * The category this one sits under, or null for a top-level category.
   *
   * Nesting is one level deep and the DATABASE is what enforces that —
   * `basecamp.enforce_category_depth()` in 0005, in both directions. This field
   * is the shape the screen renders; it is not the rule.
   */
  parent_id: string | null;
};

/**
 * An entry as the Catalog admin screen needs it — `CatalogEntry` plus the
 * `category_id` that says where it sits.
 *
 * The home page's `ENTRY_COLUMNS` deliberately omits `category_id`: there the
 * entries arrive already nested inside their category, so the column would be
 * redundant. Here it is the field being edited.
 */
export type AdminEntry = import("@/types/catalog").CatalogEntry & {
  category_id: string;
  app_settings: import("@/lib/appConfig").AppSettings | null;
  oauth_clients: import("@/lib/appConfig").OAuthClientConfig[];
  access_grants: Grant[];
  /**
   * Which sidebar group the entry sits in, or NULL for "not in the sidebar".
   *
   * `CatalogEntry` and its `ENTRY_COLUMNS` deliberately omit this: the home page
   * never reads it, and the shell layout fetches it in a query of its own. The
   * admin screen needs it because it is the ONLY control over whether a
   * launchable entry appears in the sidebar at all — an entry with no group is
   * invisible there however launchable it is, which is the first thing to check
   * when something is "missing". Added here rather than to `ENTRY_COLUMNS`, so
   * the home page keeps fetching exactly what it renders.
   */
  nav_group: NavGroup | null;
  /**
   * The concurrency token for an edit, maintained by the `set_updated_at`
   * trigger on `basecamp.entries`.
   *
   * The edit dialog freezes a whole row when it opens and writes all of it back
   * on save. Matching on this column means a save that would have silently
   * overwritten somebody else's change — or undone a reorder made while the
   * dialog sat open — instead writes nothing and returns zero rows, which the
   * screen already knows how to report. Never written by the app.
   */
  updated_at: string;
};

/**
 * The Access screen's view segments: the design's two, plus Types and the
 * append-only Audit log.
 *
 * Here rather than in `ViewSwitch.tsx`, which is now generic over its segments
 * and knows nothing about access administration — a screen-agnostic control
 * should not be the home of one screen's vocabulary.
 */
export type AdminView = "person" | "matrix" | "types" | "audit";
