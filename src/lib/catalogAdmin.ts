// Type-only import. It must STAY type-only: `npm test` runs these modules
// through node's --experimental-strip-types, which erases type imports but does
// NOT resolve tsconfig `paths`. A value import via "@/..." here compiles fine
// and then fails at test time with ERR_MODULE_NOT_FOUND.
import type { EntryStatus, EntryType } from "@/types/catalog";
import type { NavGroup } from "@/types/admin";

/**
 * Catalog-administration logic: slugs, the shape of an entry before it is
 * written, and reordering.
 *
 * WHAT THIS IS AND IS NOT. Everything here is a USER-EXPERIENCE layer over
 * constraints that live in `0001_baseline.sql`. The database is the authority
 * on every rule restated below, and it is the thing that actually refuses. This
 * module exists so the common mistakes come back as a sentence naming the field
 * instead of `23514`, not so the app can decide what is legal.
 *
 * THAT MAKES IT A DRIFT RISK, AND THE DIRECTION MATTERS. If a CHECK is
 * tightened in the schema and not here, the write is refused by Postgres and
 * the user sees a raw SQLSTATE — ugly, but nothing wrong is stored. If a CHECK
 * is LOOSENED in the schema and not here, this module refuses something the
 * database would have accepted — annoying, but still nothing wrong is stored.
 * Neither direction can write a row the database would reject, because this
 * code never gets a vote on that. Do not "optimise" that property away by
 * moving a rule out of the schema and into here.
 *
 * It lives in `src/lib/` because the repo convention is that executable
 * behaviour with tests goes there, and because a slug generator and a reorder
 * are exactly the things worth testing without a database.
 */

/**
 * `entries.slug` carries `CONSTRAINT basecamp_entries_slug_length CHECK
 * (length(slug) <= 128)`. `categories.slug` has no length constraint at all —
 * the same ceiling is applied to both anyway, because a category slug longer
 * than this is a data-entry accident rather than an intention, and one rule is
 * easier to keep true than two.
 */
export const SLUG_MAX_LENGTH = 128;

/**
 * Both tables: `CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$')`.
 *
 * Exported as its SOURCE so a test can compare it against the pattern
 * `0001_baseline.sql` actually ships, rather than against a copy of itself.
 */
export const SLUG_FORMAT_SOURCE = "^[a-z0-9]+(-[a-z0-9]+)*$";
const SLUG_FORMAT = new RegExp(SLUG_FORMAT_SOURCE);

/**
 * The URL shape both `launch_url` and its siblings must satisfy:
 * `CHECK (length(...) <= 2048 AND ... ~* '^https?://[^[:space:]]+$')`.
 *
 * `[^[:space:]]` is POSIX for "no whitespace of any kind", which is `\S` here —
 * NOT `[^ ]`. A tab or a newline pasted into the middle of a URL is refused by
 * Postgres, and matching that exactly is the whole point of restating it.
 */
const URL_FORMAT = /^https?:\/\/\S+$/i;

/**
 * The POSIX pattern the three URL CHECKs actually carry, kept as text so a test
 * can compare it against `0001_baseline.sql` rather than against a copy of
 * itself. `[^[:space:]]` is POSIX for "no whitespace of any kind"; `\S` above is
 * its JavaScript equivalent. If this string stops matching the schema, the
 * translation above has to be re-derived — which is exactly what the test says.
 */
export const URL_FORMAT_SOURCE = "^https?://[^[:space:]]+$";
export const URL_MAX_LENGTH = 2048;

/**
 * Turn a human name into a slug, without ever asking the client for kebab-case.
 *
 * Returns `null` when the name contains nothing a slug can be built from — an
 * emoji-only or punctuation-only name — so the caller can say that in words
 * rather than sending an empty string to a format CHECK.
 *
 * The re-trim after truncation is load-bearing rather than tidiness: cutting
 * "release-notes" at 8 characters yields "release-", whose trailing hyphen fails
 * `^[a-z0-9]+(-[a-z0-9]+)*$`. Truncation happens BEFORE deduplication so that
 * the `-2` suffix cannot push the result back over the ceiling.
 */
export function slugify(name: string, maxLength: number = SLUG_MAX_LENGTH): string | null {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!base) return null;
  const cut = base.slice(0, maxLength).replace(/-+$/g, "");
  return cut || null;
}

/**
 * A slug that is not already taken.
 *
 * Deduplication is a CONVENIENCE, not a correctness mechanism, and the
 * distinction matters: `slug` is UNIQUE in the database, two administrators can
 * be adding "Notion" at the same moment, and this function reads a list that
 * was fetched some time ago. So a caller must still handle `23505` — this only
 * means the client does not have to hit it to discover that "Notion" exists.
 *
 * The suffix is appended after truncating the base far enough to make room for
 * it, so the result respects `maxLength` no matter how many collisions there
 * are. A trailing hyphen cannot survive, for the same reason as above.
 */
export function uniqueSlug(
  name: string,
  taken: Iterable<string>,
  maxLength: number = SLUG_MAX_LENGTH,
): string | null {
  const base = slugify(name, maxLength);
  if (!base) return null;

  const used = new Set(taken);
  if (!used.has(base)) return base;

  for (let n = 2; n < 10_000; n += 1) {
    const suffix = `-${n}`;
    const room = maxLength - suffix.length;
    const stem = base.slice(0, room).replace(/-+$/g, "");
    // `stem` can only be empty if maxLength is smaller than the suffix itself,
    // which no caller does — but an empty stem would produce "-2", and that
    // fails the format CHECK rather than merely looking odd.
    if (!stem) return null;
    const candidate = `${stem}${suffix}`;
    if (!used.has(candidate)) return candidate;
  }
  return null;
}

/** Does this string satisfy the database's slug format? Used to assert, not to fix. */
export function isValidSlug(slug: string): boolean {
  return SLUG_FORMAT.test(slug) && slug.length <= SLUG_MAX_LENGTH;
}

/** The result of any validate* function here: a row to write, or the reason not to. */
export type Validated<T> = { ok: true; row: T } | { ok: false; message: string };

/**
 * What goes in a `description` nobody filled in.
 *
 * Shared by categories and entries because the reasoning is identical: the
 * column is NOT NULL with a not-blank CHECK, so SOMETHING has to be written, and
 * the only honest something is a sentence admitting the description is missing.
 * Deriving prose from the name — "Tools for sales" — would put a fact in the
 * catalog that nobody asserted, in an app whose entire purpose is recording what
 * is actually true about the things an organisation runs.
 */
export const DEFAULT_DESCRIPTION = "No description yet.";

/**
 * What the simple "add by URL" path fills in for the columns it does not ask
 * about.
 *
 * Four of these columns are NOT NULL with a not-blank CHECK, so there is no
 * such thing as leaving them out: `description` and `owner` must carry text,
 * and `entry_type`/`status`/`host`/`auth_boundary`/`trigger_type` must each
 * carry an enum member. The simple form's job is to make the *client's* work
 * small, not to pretend the columns are optional.
 *
 * Each default is chosen to be TRUE rather than merely valid:
 *
 *   entry_type     `launchable` — the simple path collects a URL, and a URL is
 *                  what launchable means. It also drags in
 *                  `launchable_requires_launch_url`, which is why that path
 *                  cannot skip the URL field.
 *   status         `active` — they are adding something they use.
 *   host           `unknown` — the enum HAS an honest "not established" member.
 *                  Guessing `vercel` from a URL would be inventing a fact.
 *   auth_boundary  `unknown` — same reasoning, same enum member.
 *   trigger_type   `user` — a person clicks it. `entry_trigger_type` has no
 *                  `unknown`, and of the five members this is the only one that
 *                  describes a thing you open from a launcher.
 *   description    A sentence that says it is missing. Inventing a description
 *                  from the name would put a fabricated fact in the catalog,
 *                  which is the failure this whole app exists to avoid.
 *   owner          The signed-in administrator's email. They added it; until
 *                  they say otherwise, they are the honest answer, and it is
 *                  the one field here whose default is genuinely likely right.
 */
export const ENTRY_DEFAULTS = {
  entry_type: "launchable" as EntryType,
  status: "active" as EntryStatus,
  host: "unknown",
  auth_boundary: "unknown",
  trigger_type: "user",
  description: DEFAULT_DESCRIPTION,
} as const;

/** What the category form collects. Both fields arrive untrimmed. */
export type CategoryDraft = { name: string; description: string };

export type CategoryFields = { name: string; description: string };

/**
 * Trim a category draft into the two columns, or say why it is not one.
 *
 * `slug` is deliberately absent: it is generated once when the category is
 * created and never changes afterwards. That mirrors what `entries.slug`
 * documents about itself — "survives a display_name rename" — and it is what
 * makes renaming safe. A slug that followed the name would break every grant,
 * link and generated document keyed to the old one, and renaming a category is
 * the first customisation the guided walkthrough asks a client to make.
 */
export function validateCategory(draft: CategoryDraft): Validated<CategoryFields> {
  const name = draft.name.trim();
  if (!name) return { ok: false, message: "Give the category a name." };
  return {
    ok: true,
    row: { name, description: draft.description.trim() || DEFAULT_DESCRIPTION },
  };
}

/** The row this module hands to the caller to insert or update. */
export type EntryRow = {
  category_id: string;
  display_name: string;
  slug: string;
  description: string;
  entry_type: EntryType;
  status: EntryStatus;
  host: string;
  auth_boundary: string;
  trigger_type: string;
  owner: string;
  launch_url: string | null;
  repo_url: string | null;
  runbook_url: string | null;
  technical_name: string | null;
  source_of_truth_note: string | null;
  nav_group: NavGroup | null;
  sort_order: number;
};

/** What the form collects. Every text field arrives untrimmed. */
export type EntryDraft = {
  category_id: string;
  display_name: string;
  slug: string;
  description: string;
  entry_type: EntryType;
  status: EntryStatus;
  host: string;
  auth_boundary: string;
  trigger_type: string;
  owner: string;
  launch_url: string;
  repo_url: string;
  runbook_url: string;
  technical_name: string;
  source_of_truth_note: string;
  nav_group: NavGroup | "";
  sort_order: number;
  /** Fills `owner` when the field is left blank — the signed-in administrator. */
  fallbackOwner: string;
  /**
   * The `updated_at` this draft was taken from, used as the concurrency token on
   * save. Empty string on the create path, where there is no row to be stale
   * against. Never written — the database's trigger owns the column, and
   * `validateEntry` deliberately leaves it out of `EntryRow`.
   */
  updated_at: string;
};


/**
 * An optional text column: blank becomes NULL rather than an empty string.
 *
 * Not cosmetic. `technical_name` and `source_of_truth_note` are nullable but
 * carry `CHECK (x IS NULL OR length(btrim(x)) > 0)`, so writing "" to either is
 * refused outright. A form that cleared a field would otherwise fail the save.
 */
function optional(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * Check one of the three URL columns against the format the database enforces.
 * Returns an error sentence, or null when the value is acceptable.
 */
function urlProblem(label: string, value: string | null): string | null {
  if (value === null) return null;
  if (value.length > URL_MAX_LENGTH) {
    return `The ${label} is longer than ${URL_MAX_LENGTH} characters.`;
  }
  if (!URL_FORMAT.test(value)) {
    return `The ${label} must start with http:// or https:// and contain no spaces.`;
  }
  return null;
}

/**
 * Turn a draft into a row, or into the sentence explaining why it is not one.
 *
 * The order of the checks is the order a person reads the form, so the first
 * complaint they see is about the topmost field that is wrong.
 */
export function validateEntry(draft: EntryDraft): Validated<EntryRow> {
  const display_name = draft.display_name.trim();
  if (!display_name) return { ok: false, message: "Give the entry a name." };

  if (!draft.category_id) return { ok: false, message: "Choose a category for the entry." };

  if (!isValidSlug(draft.slug)) {
    // Reachable only if a slug was carried forward from an existing row and
    // something has gone wrong upstream — the create paths generate slugs and
    // never let a person type one. Worth refusing loudly rather than sending it
    // to the format CHECK.
    return {
      ok: false,
      message: "That entry's identifier is not in the form the database accepts.",
    };
  }

  const launch_url = optional(draft.launch_url);
  const repo_url = optional(draft.repo_url);
  const runbook_url = optional(draft.runbook_url);

  for (const [label, value] of [
    ["launch URL", launch_url],
    ["repository URL", repo_url],
    ["runbook URL", runbook_url],
  ] as const) {
    const problem = urlProblem(label, value);
    if (problem) return { ok: false, message: problem };
  }

  // `basecamp_entries_launchable_requires_launch_url`. Stated in the form's own
  // vocabulary — "launchable" is a word the client just picked from a dropdown,
  // so naming it back is meaningful here in a way a constraint name is not.
  if (draft.entry_type === "launchable" && !launch_url) {
    return {
      ok: false,
      message: "A launchable entry needs a launch URL — that is what makes it launchable.",
    };
  }

  // `basecamp_entries_nav_group_launchable_only`. The form hides the sidebar
  // control for non-launchable types, so this catches the sequence where a type
  // is changed after a group was chosen rather than a person defying the UI.
  const nav_group = draft.nav_group === "" ? null : draft.nav_group;
  if (nav_group !== null && draft.entry_type !== "launchable") {
    return {
      ok: false,
      message: "Only a launchable entry can sit in a sidebar group. Clear the group, or make it launchable.",
    };
  }

  // NOT NULL and not-blank, with the documented fallbacks. `fallbackOwner` is
  // itself trimmed and checked: an administrator whose account somehow carries
  // no email must not produce a blank `owner` and a `23514` at the database.
  const description = draft.description.trim() || ENTRY_DEFAULTS.description;
  const owner = draft.owner.trim() || draft.fallbackOwner.trim();
  if (!owner) {
    return { ok: false, message: "Say who owns this entry." };
  }

  return {
    ok: true,
    row: {
      category_id: draft.category_id,
      display_name,
      slug: draft.slug,
      description,
      entry_type: draft.entry_type,
      status: draft.status,
      host: draft.host,
      auth_boundary: draft.auth_boundary,
      trigger_type: draft.trigger_type,
      owner,
      launch_url,
      repo_url,
      runbook_url,
      technical_name: optional(draft.technical_name),
      source_of_truth_note: optional(draft.source_of_truth_note),
      nav_group,
      sort_order: Number.isFinite(draft.sort_order) ? Math.trunc(draft.sort_order) : 0,
    },
  };
}

/** A category as the reorder needs it: identity and its current position. */
export type Sortable = { id: string; slug: string; sort_order: number };

/** The step between two adjacent positions. Gaps leave room to insert later. */
export const SORT_STEP = 10;

/** Where a newly created row goes: after everything that exists. */
export function nextSortOrder(existing: ReadonlyArray<{ sort_order: number }>): number {
  return existing.reduce((n, row) => Math.max(n, row.sort_order), 0) + SORT_STEP;
}

/**
 * The order the app renders in: `(sort_order, slug)`.
 *
 * Restated here rather than assumed, because every reorder below is computed
 * against it. `sort_order` is NOT unique and defaults to 0, so it is not a total
 * order on its own — the slug tiebreak is what makes the sequence the user sees
 * deterministic, and therefore what "move this one up" has to mean.
 */
export function inRenderOrder<T extends Sortable>(rows: ReadonlyArray<T>): T[] {
  return rows
    .slice()
    .sort((a, b) => a.sort_order - b.sort_order || a.slug.localeCompare(b.slug));
}

/**
 * Move one row up or down, and return only the rows whose `sort_order` must
 * change.
 *
 * RENUMBERING, NOT SWAPPING, and that is the whole design of this function.
 * Swapping two neighbours' `sort_order` values is the obvious implementation and
 * it silently does nothing in the case that matters most: `sort_order` defaults
 * to 0, so on a fresh install EVERY row is 0, ties are broken by slug, and
 * swapping 0 with 0 leaves the list exactly as it was. The user clicks the arrow
 * and watches nothing happen. Renumbering the sequence by `SORT_STEP` cannot
 * have that failure, because it makes the positions distinct as a side effect of
 * doing the move.
 *
 * Returning only the CHANGED rows keeps a move to one write in the common case
 * where positions are already spaced, while still repairing an all-zero list in
 * one go the first time anyone reorders it.
 *
 * A move off either end returns an empty list — no writes, no error. The caller
 * renders the button as unavailable, so this is the belt to that braces.
 */
export function reorder<T extends Sortable>(
  rows: ReadonlyArray<T>,
  id: string,
  direction: "up" | "down",
): Array<{ id: string; sort_order: number }> {
  const ordered = inRenderOrder(rows);
  const from = ordered.findIndex((r) => r.id === id);
  if (from === -1) return [];
  const to = direction === "up" ? from - 1 : from + 1;
  if (to < 0 || to >= ordered.length) return [];

  const moved = ordered.slice();
  const [row] = moved.splice(from, 1);
  moved.splice(to, 0, row);

  const updates: Array<{ id: string; sort_order: number }> = [];
  moved.forEach((r, index) => {
    const sort_order = (index + 1) * SORT_STEP;
    if (r.sort_order !== sort_order) updates.push({ id: r.id, sort_order });
  });
  return updates;
}

// ---------------------------------------------------------------------------
// In-flight keys
// ---------------------------------------------------------------------------

/**
 * The keys the Catalog screen claims while a write is in flight.
 *
 * ONE `Set` HOLDS ALL OF THEM, which is why every key is prefixed. That is the
 * lesson `adminAccess.ts` records at `resetKey`: without a prefix, two different
 * operations on the same uuid claim the same slot and the second is silently
 * dropped as a duplicate. A category and an entry can share neither a prefix nor
 * an id space by accident here.
 *
 * A row-level key covers EVERY write to that row — rename, reorder, delete — on
 * purpose. Those are not independent: a rename and a move racing on one category
 * would both read the same pre-write snapshot, and serialising them per row is
 * simpler than making either safe to interleave.
 */
export const CREATE_CATEGORY_KEY = "create-category";
export const CREATE_ENTRY_KEY = "create-entry";

/**
 * REORDERING IS LIST-SCOPED, SO ITS CLAIM MUST BE TOO.
 *
 * This is the exception to the row-level rule above, and it was a real bug
 * before it was an exception. `reorder()` renumbers EVERY row whose position
 * moved, not just the one that was clicked — so claiming `categoryKey(moved)`
 * left every other row's arrows live. Two arrows clicked in quick succession
 * both passed their (different) claims, both computed a renumbering from the
 * same pre-write snapshot, and the two batches interleaved per row: the list
 * settled into an order neither click asked for.
 *
 * A single key per list serialises the whole operation, which is what a write
 * that touches the whole list requires. Entries get one key PER CATEGORY,
 * because entries are reordered within their category and two categories cannot
 * renumber each other.
 */
export const REORDER_CATEGORIES_KEY = "reorder:categories";

export function reorderEntriesKey(categoryId: string): string {
  return `reorder:entries:${categoryId}`;
}

export function categoryKey(id: string): string {
  return `category:${id}`;
}

export function entryKey(id: string): string {
  return `entry:${id}`;
}

// ---------------------------------------------------------------------------
// Enum choices for the form
// ---------------------------------------------------------------------------

/**
 * The enum members `0001_baseline.sql` creates, restated so a form can offer
 * them.
 *
 * `types/catalog.ts` deliberately widens `host`, `auth_boundary` and
 * `trigger_type` to `string`, on the grounds that the UI only ever PRINTS them
 * and a value added by a later `ALTER TYPE ... ADD VALUE` should render as its
 * own text rather than crash. A dropdown changes that calculus: a list that has
 * not been extended would not merely fail to offer a new member, it would
 * silently rewrite it to something else the moment anyone saved an entry that
 * held it.
 *
 * `withCurrent` is what stops that. Every select is built from the list PLUS the
 * value the row already carries, so an unknown member is always selectable and
 * always survives a save. Extending a list here is then a nicety — it puts a new
 * member in front of people who are creating rows — rather than the thing
 * standing between a migration and data loss.
 */
export const ENTRY_TYPES: ReadonlyArray<EntryType> = [
  "launchable",
  "reference_only",
  "catalog_only",
];

export const ENTRY_STATUSES: ReadonlyArray<EntryStatus> = [
  "active",
  "coming_soon",
  "unverified",
  "retiring",
  "orphaned",
  "wind_down",
];

export const ENTRY_HOSTS: ReadonlyArray<string> = [
  "vercel",
  "cloudflare",
  "supabase_edge",
  "launchd",
  "wordpress",
  "claude_artifact",
  "n8n",
  "none",
  "unknown",
];

export const AUTH_BOUNDARIES: ReadonlyArray<string> = [
  "platform_auth",
  "external_auth",
  "cloudflare",
  "none",
  "unknown",
];

export const TRIGGER_TYPES: ReadonlyArray<string> = [
  "user",
  "cron",
  "slack",
  "webhook",
  "manual",
];

/**
 * The options a select should show: the known members, plus whatever this row
 * actually holds if that is not among them.
 *
 * The appended value goes LAST rather than first — it is an outlier, and putting
 * it at the top of the list would present it as the leading choice for every new
 * row.
 */
export function withCurrent<T extends string>(options: ReadonlyArray<T>, current: T): T[] {
  return options.includes(current) ? [...options] : [...options, current];
}

/**
 * `reference_only` -> "Reference only". A label for an enum member, derived
 * rather than kept in a parallel map — a map would need an entry for every
 * future member and would render an unlabelled blank until someone added one.
 */
export function enumLabel(value: string): string {
  const spaced = value.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

// ---------------------------------------------------------------------------
// What a failed write means, in words
// ---------------------------------------------------------------------------

/**
 * Why no slug could be built from this name.
 *
 * `uniqueSlug` returns `null` for two materially different reasons and reporting
 * both as "no letters or digits" was false for the second: a name that collided
 * ten thousand times is full of letters.
 *
 * The wording avoids claiming a name has no LETTERS, which is wrong for any
 * script this slug format cannot represent — "日本語" is all letters and none of
 * them are `a`–`z`. The constraint is the identifier alphabet, not the name.
 */
export function unsluggable(name: string): string {
  return /[a-z0-9]/i.test(name)
    ? "Could not build a unique identifier from that name — try a more distinct one."
    : "That name has no characters an identifier can use. Identifiers are built from a–z and 0–9, so a name written only in other characters needs at least one of those.";
}

/**
 * The SQLSTATEs this screen can provoke, mapped to a sentence a client can act
 * on.
 *
 * IN `src/lib/` BECAUSE THESE ARE DECISIONS, NOT GLUE. Which code means "you
 * already have one of those" and which means "the database is protecting
 * something" is exactly the kind of judgement that should be pinned by a test
 * rather than re-derived by eye inside a component. `adminAccess.ts` set the
 * precedent with `describeError` and `isTransportFailure`.
 *
 * Returns `null` for anything unrecognised, so the caller falls back to its
 * generic "could not do X (code)" wording rather than inventing an explanation
 * for a failure nobody has seen yet.
 */
export function explainWriteError(
  operation: "create-category" | "update-category" | "delete-category" | "create-entry" | "update-entry" | "delete-entry",
  error: { code?: string } | null | undefined,
  context: { slug?: string } = {},
): string | null {
  const code = error?.code;
  if (!code) return null;

  // 23505 unique_violation. Reachable on create despite client-side
  // de-duplication: the slug list was read when the page rendered, and another
  // administrator may have taken it since.
  if (code === "23505") {
    if (operation === "create-category") {
      return context.slug
        ? `A category with the identifier "${context.slug}" already exists. Try a different name.`
        : "A category with that identifier already exists. Try a different name.";
    }
    if (operation === "create-entry") {
      return context.slug
        ? `An entry with the identifier "${context.slug}" already exists. Try a different name.`
        : "An entry with that identifier already exists. Try a different name.";
    }
    return "Another row already uses that identifier.";
  }

  // 23503 foreign_key_violation on a category DELETE is
  // `entries.category_id ... ON DELETE RESTRICT` doing its job. The database is
  // refusing on purpose, so say what to do about it rather than print a
  // constraint name at somebody.
  if (code === "23503" && operation === "delete-category") {
    return "That category still has entries in it. Move them to another category, or delete them first.";
  }

  // 23503 on a create means the chosen category no longer exists — someone
  // deleted it in another tab between this page loading and this click.
  if (code === "23503" && (operation === "create-entry" || operation === "update-entry")) {
    return "That category no longer exists. Reload the page and choose another.";
  }

  // 23514 check_violation. `validateEntry` catches every CHECK it knows about
  // before the write, so reaching this means the schema is ahead of this app.
  if (code === "23514") {
    return "The database refused those values. Reload the page — this app may be out of date with the database.";
  }

  // 42501 is RLS refusing an INSERT. UPDATE and DELETE do not raise it; they
  // return zero rows, which every caller handles separately.
  if (code === "42501") {
    return "The database refused that change. Catalog editing is restricted to administrators.";
  }

  return null;
}
