import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  AUTH_BOUNDARIES,
  ENTRY_DEFAULTS,
  ENTRY_HOSTS,
  ENTRY_STATUSES,
  ENTRY_TYPES,
  SLUG_FORMAT_SOURCE,
  URL_FORMAT_SOURCE,
  URL_MAX_LENGTH,
  SLUG_MAX_LENGTH,
  TRIGGER_TYPES,
  enumLabel,
  explainWriteError,
  unsluggable,
  withCurrent,
  inRenderOrder,
  isValidSlug,
  nextSortOrder,
  reorder,
  slugify,
  uniqueSlug,
  validateEntry,
  type EntryDraft,
} from "./catalogAdmin.ts";
import { NAV_GROUP_ORDER } from "../types/admin.ts";

/**
 * These tests exist because the catalog admin generates values the client never
 * sees before they reach a CHECK constraint. A slug that fails
 * `^[a-z0-9]+(-[a-z0-9]+)*$` surfaces at the client's keyboard as `23514` on a
 * form that looks correctly filled in, and the two ways to produce one —
 * truncation leaving a trailing hyphen, and a deduplication suffix — are both
 * invisible until they happen.
 *
 * The reorder tests are here for a different reason: the all-zero case is the
 * DEFAULT state of a fresh install, and the obvious implementation of "move up"
 * is silently inert in exactly that case.
 */

// ---------------------------------------------------------------------------
// slugify
// ---------------------------------------------------------------------------

test("slugify lowercases and joins on a single hyphen", () => {
  assert.equal(slugify("Release Notes"), "release-notes");
  assert.equal(slugify("HubSpot"), "hubspot");
  assert.equal(slugify("Time  Tracker"), "time-tracker");
});

test("slugify collapses punctuation rather than emitting a run of hyphens", () => {
  // "a--b" fails the format CHECK: the pattern allows single hyphens only.
  assert.equal(slugify("Sales & Marketing"), "sales-marketing");
  assert.equal(slugify("Q4 / 2026 — plan"), "q4-2026-plan");
  assert.ok(isValidSlug(slugify("Sales & Marketing")!));
});

test("slugify trims hyphens from both ends", () => {
  assert.equal(slugify("  Onboarding  "), "onboarding");
  assert.equal(slugify("!!! urgent !!!"), "urgent");
});

test("slugify returns null when there is nothing to build a slug from", () => {
  // The caller says this in words. An empty string would reach the format CHECK.
  assert.equal(slugify("🎉🎉🎉"), null);
  assert.equal(slugify("---"), null);
  assert.equal(slugify(""), null);
});

test("slugify truncates without leaving a trailing hyphen", () => {
  // "release-notes" cut at 8 is "release-", which fails the format CHECK.
  assert.equal(slugify("release notes", 8), "release");
  assert.ok(isValidSlug(slugify("release notes", 8)!));
});

test("slugify respects the database's 128-character ceiling by default", () => {
  const long = slugify("a".repeat(200));
  assert.equal(long!.length, SLUG_MAX_LENGTH);
  assert.ok(isValidSlug(long!));
});

// ---------------------------------------------------------------------------
// uniqueSlug
// ---------------------------------------------------------------------------

test("uniqueSlug returns the plain slug when nothing has taken it", () => {
  assert.equal(uniqueSlug("Notion", []), "notion");
  assert.equal(uniqueSlug("Notion", ["figma", "linear"]), "notion");
});

test("uniqueSlug suffixes past a collision", () => {
  assert.equal(uniqueSlug("Notion", ["notion"]), "notion-2");
  assert.equal(uniqueSlug("Notion", ["notion", "notion-2"]), "notion-3");
});

test("uniqueSlug keeps the result inside the length ceiling", () => {
  const taken = ["a".repeat(SLUG_MAX_LENGTH)];
  const got = uniqueSlug("a".repeat(200), taken)!;
  assert.ok(got.length <= SLUG_MAX_LENGTH, `${got.length} > ${SLUG_MAX_LENGTH}`);
  assert.ok(isValidSlug(got));
  assert.match(got, /-2$/);
});

test("uniqueSlug never produces a trailing hyphen when making room for a suffix", () => {
  // The base is "ab-cd" (5 = maxLength) and it is taken, so a "-2" suffix needs
  // 3 characters of stem: "ab-". That trailing hyphen fails the format CHECK, so
  // it has to be trimmed to "ab" before the suffix goes on. Without the trim
  // this returns "ab--2", which the database refuses.
  const got = uniqueSlug("ab cd", ["ab-cd"], 5)!;
  assert.equal(got, "ab-2");
  assert.ok(isValidSlug(got));
});

test("uniqueSlug returns null for a name with nothing to slug", () => {
  assert.equal(uniqueSlug("🎉", ["x"]), null);
});

// ---------------------------------------------------------------------------
// isValidSlug — the shape the database actually enforces
// ---------------------------------------------------------------------------

test("isValidSlug matches the CHECK constraint's own pattern", () => {
  assert.ok(isValidSlug("useful-tools"));
  assert.ok(isValidSlug("a"));
  assert.ok(isValidSlug("q4-2026"));
  assert.ok(!isValidSlug("Useful-Tools"), "uppercase is refused");
  assert.ok(!isValidSlug("useful--tools"), "a double hyphen is refused");
  assert.ok(!isValidSlug("-useful"), "a leading hyphen is refused");
  assert.ok(!isValidSlug("useful-"), "a trailing hyphen is refused");
  assert.ok(!isValidSlug("useful tools"), "a space is refused");
  assert.ok(!isValidSlug("a".repeat(SLUG_MAX_LENGTH + 1)), "over the ceiling is refused");
});

// ---------------------------------------------------------------------------
// validateEntry
// ---------------------------------------------------------------------------

function draft(over: Partial<EntryDraft> = {}): EntryDraft {
  return {
    category_id: "11111111-1111-1111-1111-111111111111",
    display_name: "Notion",
    slug: "notion",
    description: "",
    entry_type: "launchable",
    status: "active",
    host: "unknown",
    auth_boundary: "unknown",
    trigger_type: "user",
    owner: "",
    launch_url: "https://notion.so",
    repo_url: "",
    runbook_url: "",
    technical_name: "",
    source_of_truth_note: "",
    nav_group: "",
    sort_order: 10,
    fallbackOwner: "admin@example.com",
    updated_at: "2026-08-18T00:00:00Z",
    ...over,
  };
}

test("validateEntry accepts the simple add-by-URL path", () => {
  const got = validateEntry(draft());
  assert.ok(got.ok, got.ok ? "" : got.message);
  assert.equal(got.row.display_name, "Notion");
  assert.equal(got.row.launch_url, "https://notion.so");
  assert.equal(got.row.entry_type, "launchable");
});

test("validateEntry fills the two NOT NULL text columns the simple form does not ask about", () => {
  const got = validateEntry(draft());
  assert.ok(got.ok);
  // Both carry `CHECK (length(btrim(x)) > 0)`, so neither may be "".
  assert.equal(got.row.description, ENTRY_DEFAULTS.description);
  assert.equal(got.row.owner, "admin@example.com");
  assert.ok(got.row.description.trim().length > 0);
  assert.ok(got.row.owner.trim().length > 0);
});

test("validateEntry prefers what the client typed over either default", () => {
  const got = validateEntry(draft({ description: "  Our wiki. ", owner: " Ops team " }));
  assert.ok(got.ok);
  assert.equal(got.row.description, "Our wiki.");
  assert.equal(got.row.owner, "Ops team");
});

test("validateEntry refuses a blank name and a missing category", () => {
  const noName = validateEntry(draft({ display_name: "   " }));
  assert.ok(!noName.ok);
  assert.match(noName.message, /name/i);

  const noCat = validateEntry(draft({ category_id: "" }));
  assert.ok(!noCat.ok);
  assert.match(noCat.message, /category/i);
});

test("validateEntry enforces launchable-requires-launch-url", () => {
  const got = validateEntry(draft({ launch_url: "  " }));
  assert.ok(!got.ok);
  assert.match(got.message, /launchable/i);
});

test("validateEntry lets a non-launchable entry carry no URL", () => {
  const got = validateEntry(draft({ entry_type: "reference_only", launch_url: "" }));
  assert.ok(got.ok, got.ok ? "" : got.message);
  assert.equal(got.row.launch_url, null);
});

test("validateEntry refuses URLs the database's format CHECK would refuse", () => {
  for (const bad of ["notion.so", "ftp://notion.so", "https://notion so", "https://a\tb"]) {
    const got = validateEntry(draft({ launch_url: bad }));
    assert.ok(!got.ok, `expected ${JSON.stringify(bad)} to be refused`);
    assert.match(got.message, /http/i);
  }
});

test("validateEntry checks the optional URLs too, and names which one is wrong", () => {
  const got = validateEntry(draft({ repo_url: "github.com/acme/app" }));
  assert.ok(!got.ok);
  assert.match(got.message, /repository/i);

  const runbook = validateEntry(draft({ runbook_url: "notaurl" }));
  assert.ok(!runbook.ok);
  assert.match(runbook.message, /runbook/i);
});

test("validateEntry enforces nav-group-launchable-only", () => {
  const got = validateEntry(draft({ entry_type: "catalog_only", launch_url: "", nav_group: "sales" }));
  assert.ok(!got.ok);
  assert.match(got.message, /sidebar group/i);
});

test("validateEntry turns blank optional text into NULL, never an empty string", () => {
  // These columns are nullable but carry `CHECK (x IS NULL OR btrim(x) <> '')`,
  // so "" is refused outright — clearing the field has to write NULL.
  const got = validateEntry(draft({ technical_name: "   ", source_of_truth_note: "" }));
  assert.ok(got.ok);
  assert.equal(got.row.technical_name, null);
  assert.equal(got.row.source_of_truth_note, null);
  assert.equal(got.row.repo_url, null);
});

test("validateEntry refuses when neither the owner field nor the fallback has anything", () => {
  const got = validateEntry(draft({ owner: "", fallbackOwner: "  " }));
  assert.ok(!got.ok);
  assert.match(got.message, /owns/i);
});

test("validateEntry keeps sort_order an integer", () => {
  const got = validateEntry(draft({ sort_order: 12.7 }));
  assert.ok(got.ok);
  assert.equal(got.row.sort_order, 12);

  const nan = validateEntry(draft({ sort_order: Number.NaN }));
  assert.ok(nan.ok);
  assert.equal(nan.row.sort_order, 0);
});

// ---------------------------------------------------------------------------
// ordering
// ---------------------------------------------------------------------------

test("inRenderOrder breaks a sort_order tie by slug, as the app's queries do", () => {
  const rows = [
    { id: "b", slug: "beta", sort_order: 0 },
    { id: "a", slug: "alpha", sort_order: 0 },
    { id: "c", slug: "gamma", sort_order: -5 },
  ];
  assert.deepEqual(inRenderOrder(rows).map((r) => r.id), ["c", "a", "b"]);
});

test("nextSortOrder puts a new row after everything that exists", () => {
  assert.equal(nextSortOrder([]), 10);
  assert.equal(nextSortOrder([{ sort_order: 10 }, { sort_order: 40 }]), 50);
  // Negative positions must not drag a new row above the list.
  assert.equal(nextSortOrder([{ sort_order: -30 }]), 10);
});

test("reorder moves a row up through an all-zero list — the fresh-install case", () => {
  // THE case a swap implementation gets wrong: every seeded row is 0 until
  // someone reorders, so swapping 0 with 0 is a no-op and the arrow looks dead.
  const rows = [
    { id: "s", slug: "sales", sort_order: 0 },
    { id: "m", slug: "marketing", sort_order: 0 },
    { id: "o", slug: "operations", sort_order: 0 },
  ];
  // Render order is by slug here: marketing, operations, sales.
  const updates = reorder(rows, "o", "up");
  assert.ok(updates.length > 0, "an all-zero list must still produce writes");

  const applied = rows.map((r) => ({
    ...r,
    sort_order: updates.find((u) => u.id === r.id)?.sort_order ?? r.sort_order,
  }));
  assert.deepEqual(inRenderOrder(applied).map((r) => r.id), ["o", "m", "s"]);
});

test("reorder moves down, and the result is what the app would then render", () => {
  const rows = [
    { id: "a", slug: "alpha", sort_order: 10 },
    { id: "b", slug: "beta", sort_order: 20 },
    { id: "c", slug: "gamma", sort_order: 30 },
  ];
  const updates = reorder(rows, "a", "down");
  const applied = rows.map((r) => ({
    ...r,
    sort_order: updates.find((u) => u.id === r.id)?.sort_order ?? r.sort_order,
  }));
  assert.deepEqual(inRenderOrder(applied).map((r) => r.id), ["b", "a", "c"]);
});

test("reorder returns only the rows whose position actually changes", () => {
  const rows = [
    { id: "a", slug: "alpha", sort_order: 10 },
    { id: "b", slug: "beta", sort_order: 20 },
    { id: "c", slug: "gamma", sort_order: 30 },
  ];
  // Swapping the first two leaves gamma at 30, which is already correct.
  const updates = reorder(rows, "b", "up");
  assert.deepEqual(updates.map((u) => u.id).sort(), ["a", "b"]);
});

test("reorder off either end is a no-op rather than an error", () => {
  const rows = [
    { id: "a", slug: "alpha", sort_order: 10 },
    { id: "b", slug: "beta", sort_order: 20 },
  ];
  assert.deepEqual(reorder(rows, "a", "up"), []);
  assert.deepEqual(reorder(rows, "b", "down"), []);
  assert.deepEqual(reorder(rows, "nonexistent", "up"), []);
});

// ---------------------------------------------------------------------------
// enum choices
// ---------------------------------------------------------------------------

test("withCurrent keeps a value the known list does not contain", () => {
  // The case that matters: `ALTER TYPE basecamp.entry_host ADD VALUE 'fly'`
  // lands in the database, this list has not been extended, and someone edits
  // an entry hosted on fly. Without this the select would not offer "fly", so
  // saving would silently rewrite the row to whichever option rendered first.
  const got = withCurrent(ENTRY_HOSTS, "fly");
  assert.ok(got.includes("fly"));
  assert.equal(got[got.length - 1], "fly", "an unknown value goes last, not first");
  assert.equal(got.length, ENTRY_HOSTS.length + 1);
});

test("withCurrent does not duplicate a value already in the list", () => {
  const got = withCurrent(ENTRY_HOSTS, "vercel");
  assert.equal(got.length, ENTRY_HOSTS.length);
  assert.equal(got.filter((h) => h === "vercel").length, 1);
});

test("the restated enum lists match what the form defaults to", () => {
  // A default that is not a member of its own enum is refused by Postgres, and
  // the simple add path would fail on every entry.
  assert.ok(ENTRY_TYPES.includes(ENTRY_DEFAULTS.entry_type));
  assert.ok(ENTRY_STATUSES.includes(ENTRY_DEFAULTS.status));
  assert.ok(ENTRY_HOSTS.includes(ENTRY_DEFAULTS.host));
  assert.ok(AUTH_BOUNDARIES.includes(ENTRY_DEFAULTS.auth_boundary));
  assert.ok(TRIGGER_TYPES.includes(ENTRY_DEFAULTS.trigger_type));
});

test("enumLabel makes a member readable without a parallel map", () => {
  assert.equal(enumLabel("reference_only"), "Reference only");
  assert.equal(enumLabel("user"), "User");
  assert.equal(enumLabel("supabase_edge"), "Supabase edge");
  // A member this file has never seen still gets a label rather than a blank.
  assert.equal(enumLabel("brand_new_thing"), "Brand new thing");
});

// ---------------------------------------------------------------------------
// The pin: these constants must not drift from the schema they mirror
// ---------------------------------------------------------------------------

/**
 * `catalogAdmin.ts` restates six enums and a regex that live in
 * `0001_baseline.sql`. Its own header argues — correctly — that a divergence
 * cannot write a row Postgres would reject, because this code never gets a vote
 * on that. What a divergence CAN do is quieter: a dropdown that stops offering a
 * member the database accepts, or a slug validator that refuses a shape the
 * database allows.
 *
 * Nothing failed when they diverged, so nothing stopped them diverging. These
 * tests read the baseline off disk and compare, the same way
 * `templateHygiene.test.ts` already does at eight call sites. They need no
 * database.
 */

function baselineSql(): string {
  return readFileSync(path.join(process.cwd(), "supabase", "migrations", "0001_baseline.sql"), "utf8");
}

/**
 * EVERY migration, newest last — not just the baseline.
 *
 * `0001`'s own `COMMENT ON TYPE` tells operators to extend these enums with
 * `ALTER TYPE ... ADD VALUE`, and that statement lands in a NEW migration while
 * the baseline stays untouched. A pin that read only `0001` would therefore pass
 * for ever while the dropdowns silently stopped offering the new member — which
 * is precisely the drift these tests exist to catch.
 */
function allMigrations(): string {
  const dir = path.join(process.cwd(), "supabase", "migrations");
  return readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => readFileSync(path.join(dir, f), "utf8"))
    .join("\n");
}

/** Members added after the baseline by `ALTER TYPE ... ADD VALUE`. */
function addedMembers(name: string): string[] {
  return [
    ...allMigrations().matchAll(
      new RegExp(`ALTER TYPE basecamp\\.${name}\\s+ADD VALUE\\s+(?:IF NOT EXISTS\\s+)?'([^']+)'`, "gi"),
    ),
  ].map((m) => m[1]);
}

/** The members of `CREATE TYPE basecamp.<name> AS ENUM (...)`, in declared order. */
function enumMembers(sql: string, name: string): string[] {
  const m = new RegExp(`CREATE TYPE basecamp\\.${name} AS ENUM \\(([^)]*)\\);`).exec(sql);
  assert.ok(m, `0001_baseline.sql has no CREATE TYPE basecamp.${name}`);
  const declared = [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
  // Anything a later migration added belongs to the type just as much.
  return [...declared, ...addedMembers(name)];
}

test("the restated enums match the ones 0001_baseline.sql creates", () => {
  const sql = baselineSql();
  // Order matters for nav_group (documented) and is worth pinning for the rest:
  // these arrays drive the order options appear in a dropdown.
  assert.deepEqual([...ENTRY_TYPES], enumMembers(sql, "entry_type"));
  assert.deepEqual([...ENTRY_STATUSES], enumMembers(sql, "entry_status"));
  assert.deepEqual([...ENTRY_HOSTS], enumMembers(sql, "entry_host"));
  assert.deepEqual([...AUTH_BOUNDARIES], enumMembers(sql, "entry_auth_boundary"));
  assert.deepEqual([...TRIGGER_TYPES], enumMembers(sql, "entry_trigger_type"));
});

test("the slug pattern matches the CHECK constraint the database enforces", () => {
  const sql = baselineSql();
  // Both tables carry the same pattern; assert against both so a change to
  // either is caught.
  for (const constraint of ["basecamp_categories_slug_format", "basecamp_entries_slug_format"]) {
    const m = new RegExp(`CONSTRAINT ${constraint} CHECK \\(\\(slug ~ '([^']+)'`).exec(sql);
    assert.ok(m, `0001_baseline.sql has no ${constraint}`);
    assert.equal(
      m[1],
      SLUG_FORMAT_SOURCE,
      `${constraint} in the schema is ${m[1]} but catalogAdmin.ts uses ${SLUG_FORMAT_SOURCE}`,
    );
  }
});

test("the slug length ceiling matches the CHECK constraint", () => {
  const m = /CONSTRAINT basecamp_entries_slug_length CHECK \(\(length\(slug\) <= (\d+)\)\)/.exec(baselineSql());
  assert.ok(m, "0001_baseline.sql has no basecamp_entries_slug_length constraint");
  assert.equal(Number(m[1]), SLUG_MAX_LENGTH);
});

// ---------------------------------------------------------------------------
// explainWriteError
// ---------------------------------------------------------------------------

test("a duplicate identifier names the identifier and what to do", () => {
  const got = explainWriteError("create-category", { code: "23505" }, { slug: "sales" });
  assert.match(got!, /"sales"/);
  assert.match(got!, /already exists/i);
});

test("the RESTRICT on a category delete becomes an instruction, not a constraint name", () => {
  const got = explainWriteError("delete-category", { code: "23503" });
  assert.match(got!, /still has entries/i);
  assert.doesNotMatch(got!, /23503|fkey|constraint/i);
});

test("the same SQLSTATE means different things on different operations", () => {
  // 23503 on a category delete is the RESTRICT; on an entry create it is a
  // category that vanished. Conflating them would send people to the wrong fix.
  const onDelete = explainWriteError("delete-category", { code: "23503" });
  const onCreate = explainWriteError("create-entry", { code: "23503" });
  assert.notEqual(onDelete, onCreate);
  assert.match(onCreate!, /no longer exists/i);
});

test("an RLS refusal on insert says who may do this", () => {
  assert.match(explainWriteError("create-entry", { code: "42501" })!, /administrators/i);
});

test("an unrecognised or absent code falls through to the caller's generic wording", () => {
  assert.equal(explainWriteError("create-entry", { code: "08006" }), null);
  assert.equal(explainWriteError("create-entry", {}), null);
  assert.equal(explainWriteError("create-entry", null), null);
  assert.equal(explainWriteError("create-entry", undefined), null);
});

test("the URL rules match the three CHECK constraints that enforce them", () => {
  const sql = baselineSql();
  // launch_url, repo_url and runbook_url each carry the same pair of rules.
  for (const column of ["launch_url", "repo_url", "runbook_url"]) {
    const m = new RegExp(
      `CONSTRAINT basecamp_entries_${column}_format CHECK \\(\\(\\(${column} IS NULL\\) OR \\(\\(length\\(${column}\\) <= (\\d+)\\) AND \\(${column} ~\\* '([^']+)'`,
    ).exec(sql);
    assert.ok(m, `0001_baseline.sql has no basecamp_entries_${column}_format constraint`);
    assert.equal(Number(m[1]), URL_MAX_LENGTH, `${column} length ceiling drifted`);
    assert.equal(
      m[2],
      URL_FORMAT_SOURCE,
      `${column}'s pattern in the schema is ${m[2]} but catalogAdmin.ts mirrors ${URL_FORMAT_SOURCE} — ` +
        "re-derive the JavaScript regex before changing this constant",
    );
  }
});

test("the launchable-requires-a-URL rule is still the one validateEntry enforces", () => {
  // Matched on the BODY, not just the name. Asserting the constraint exists
  // would pass while somebody relaxed what it checks, and `validateEntry` would
  // go on refusing rows Postgres accepts — the exact failure this pin is for.
  const m = /CONSTRAINT basecamp_entries_launchable_requires_launch_url CHECK (.*)$/m.exec(
    baselineSql(),
  );
  assert.ok(m, "the constraint validateEntry mirrors is gone from the baseline");
  const body = m[1];
  assert.match(body, /entry_type <> 'launchable'/, "the rule no longer keys on entry_type = launchable");
  assert.match(body, /launch_url IS NOT NULL/, "the rule no longer requires a launch_url");
});

test("nav_group's members and order match the enum, which the schema asks us to keep in step", () => {
  // `COMMENT ON TYPE basecamp.nav_group` in 0001 explicitly says to keep
  // NAV_GROUP_ORDER in the same sequence — and this change set is the first code
  // that WRITES nav_group, so the pin matters now in a way it did not before.
  assert.deepEqual([...NAV_GROUP_ORDER], enumMembers(baselineSql(), "nav_group"));
});

// ---------------------------------------------------------------------------
// unsluggable
// ---------------------------------------------------------------------------

test("unsluggable separates a collision from an unusable name", () => {
  // `uniqueSlug` returns null for both, and reporting a collision as "no letters
  // or digits" is simply false for a name that is full of them.
  const collision = unsluggable("Notion");
  assert.match(collision, /unique/i);
  assert.doesNotMatch(collision, /no characters/i);

  const unusable = unsluggable("🎉🎉");
  assert.match(unusable, /no characters an identifier can use/i);
});

test("unsluggable does not tell a non-ASCII name it has no letters", () => {
  // "日本語" is entirely letters; none of them are a-z. The message must name the
  // identifier alphabet, not accuse the name of lacking letters.
  const got = unsluggable("日本語");
  assert.doesNotMatch(got, /no letters/i);
  assert.match(got, /a–z and 0–9/);
});
