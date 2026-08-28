import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import type { CatalogCategory } from "../types/catalog.ts";
import { ENTRY_COLUMNS } from "../types/catalog.ts";

import { filterCatalog, visibleCategories } from "./catalog.ts";

/**
 * The fixture is a neutral example catalog, shaped exactly like a real
 * PostgREST payload: every column `ENTRY_COLUMNS` selects, all three
 * entry_types, and a spread of statuses including `coming_soon`, `unverified`,
 * `retiring` and `orphaned`, so the status branches stay exercised.
 *
 * Replace it with a capture of your own catalog if you prefer. The first test
 * below fails if a re-capture drops columns, which is what keeps the fixture
 * honest about being a real payload rather than a skeleton.
 */
const fixture = JSON.parse(
  readFileSync(new URL("./__fixtures__/catalog.json", import.meta.url), "utf8"),
) as CatalogCategory[];

/**
 * Guards the docstring above. The FIRST version of this fixture carried three
 * of the seventeen columns in ENTRY_COLUMNS — every entry had `status:
 * undefined` — while the docstring claimed it was "the REAL payload... the
 * shape the database actually produces". Nothing checked that claim, so it read
 * as coverage while being a skeleton. If the fixture is ever re-captured with a
 * narrower select, this fails loudly instead.
 */
test("the fixture carries every column ENTRY_COLUMNS selects", () => {
  const expected = ENTRY_COLUMNS.split(",").map((c) => c.trim()).sort();
  for (const category of fixture) {
    for (const entry of category.entries) {
      assert.deepEqual(
        Object.keys(entry).sort(),
        expected,
        `fixture drifted from ENTRY_COLUMNS at ${category.slug}/${(entry as { slug: string }).slug} — re-capture it`,
      );
    }
  }
});

test("the example catalog shapes to 4 categories and 12 entries", () => {
  const { visible, categoryCount, entryCount } = visibleCategories(fixture);
  assert.equal(categoryCount, 4, "category count the page announces");
  assert.equal(entryCount, 12, "entry count the page announces");
  assert.equal(visible.length, 4);
});

test("entryCount equals the sum actually rendered, not the sum fetched", () => {
  const { visible, entryCount } = visibleCategories(fixture);
  const rendered = visible.flatMap((c) => c.entries).length;
  assert.equal(entryCount, rendered);
});

/**
 * The security-relevant case. A category the viewer can see but whose entries
 * they cannot must not render at all — otherwise a grant on an empty category
 * discloses that category's name and description. The database enforces this
 * via category_has_grant; this is the app-side half of the same invariant.
 */
test("a category with zero visible entries is dropped entirely", () => {
  const withEmpty: CatalogCategory[] = [
    ...fixture,
    {
      id: "empty-id",
      slug: "secret-category",
      name: "Secret Category",
      description: "Should never reach the DOM",
      sort_order: 99,
      parent_id: null,
      entries: [],
    },
  ];
  const { visible, categoryCount, entryCount } = visibleCategories(withEmpty);
  assert.equal(categoryCount, 4, "the empty category must not be counted");
  assert.equal(entryCount, 12, "and must not change the entry count");
  assert.ok(
    !visible.some((c) => c.slug === "secret-category"),
    "empty category leaked into the rendered set",
  );
});

test("survives null, undefined and a missing entries array", () => {
  assert.deepEqual(visibleCategories(null), { visible: [], categoryCount: 0, entryCount: 0 });
  assert.deepEqual(visibleCategories(undefined), { visible: [], categoryCount: 0, entryCount: 0 });
  const malformed = [{ id: "x", slug: "x", name: "x", description: null, sort_order: 0 }];
  assert.equal(visibleCategories(malformed as unknown as CatalogCategory[]).categoryCount, 0);
});

test("a user with no grants shapes to the empty state, not an error", () => {
  const { visible, categoryCount, entryCount } = visibleCategories([]);
  assert.equal(categoryCount, 0);
  assert.equal(entryCount, 0);
  assert.deepEqual(visible, []);
});

/**
 * filterCatalog — the sidebar search, applied to the catalog.
 *
 * Tested against the same real fixture, and specifically for the invariant it
 * shares with visibleCategories: a search must never leave a category rendering
 * as a bare heading, because that would disclose the name of a category whose
 * entries the viewer cannot see.
 */
test("a blank or whitespace query returns the input untouched", () => {
  assert.equal(filterCatalog(fixture, ""), fixture);
  assert.equal(filterCatalog(fixture, "   "), fixture);
  assert.equal(filterCatalog(fixture, null), fixture);
  assert.equal(filterCatalog(fixture, undefined), fixture);
});

test("matches display_name, case-insensitively", () => {
  const hit = fixture.flatMap((c) => c.entries)[0];
  const out = filterCatalog(fixture, hit.display_name.toUpperCase());
  const names = out.flatMap((c) => c.entries).map((e) => e.display_name);
  assert.ok(names.includes(hit.display_name), "the entry searched for must survive");
});

test("matches each of the five searched fields", () => {
  const all = fixture.flatMap((c) => c.entries);
  for (const field of ["display_name", "description", "slug", "owner"] as const) {
    const sample = all.find((e) => e[field] && String(e[field]).length > 6);
    if (!sample) continue;
    const needle = String(sample[field]).slice(2, 8);
    const found = filterCatalog(fixture, needle).flatMap((c) => c.entries);
    assert.ok(found.length > 0, `a substring of ${field} should match something`);
  }
  // technical_name is nullable on real rows; matching it must not throw.
  const withTechnical = all.find((e) => e.technical_name);
  if (withTechnical?.technical_name) {
    const out = filterCatalog(fixture, withTechnical.technical_name);
    assert.ok(out.flatMap((c) => c.entries).length > 0);
  }
});

test("does NOT match on the URL columns", () => {
  // "https://" appears in launch_url and repo_url and in no searched field, so
  // a filter that leaked those columns would return most of the catalog here.
  const withUrl = fixture.flatMap((c) => c.entries).find((e) => e.launch_url?.includes("https://"));
  assert.ok(withUrl, "fixture should contain at least one launchable with a URL");
  assert.deepEqual(filterCatalog(fixture, "https://"), []);
});

test("does NOT match on source_of_truth_note", () => {
  // The needle matters. An earlier version of this test reused "https://" for
  // the note column too — but no fixture row has a URL in its note, so the
  // assertion held even against a filter that DID search the note. It passed
  // for the wrong reason, which is worse than not existing.
  //
  // "provenance" appears in most notes and in none of the five searched fields,
  // so this assertion fails loudly the moment the note is added to the search
  // list.
  const notesWithNeedle = fixture
    .flatMap((c) => c.entries)
    .filter((e) => e.source_of_truth_note?.toLowerCase().includes("provenance"));
  assert.ok(
    notesWithNeedle.length > 5,
    "the needle must actually be present in many notes, or this test cannot fail",
  );
  assert.deepEqual(filterCatalog(fixture, "provenance"), []);
});

test("a category whose entries all filter out is dropped, not left as a bare heading", () => {
  const out = filterCatalog(fixture, "zzzz-no-such-entry-zzzz");
  assert.deepEqual(out, [], "no category may survive with zero entries");
  // And on a real query, every surviving category must carry at least one entry.
  const real = filterCatalog(fixture, "a");
  for (const c of real) {
    assert.ok(c.entries.length > 0, `${c.slug} survived with zero entries`);
  }
});

test("nullable columns do not throw", () => {
  const nulled: CatalogCategory[] = [
    {
      ...fixture[0],
      entries: [
        {
          ...fixture[0].entries[0],
          technical_name: null,
          launch_url: null,
          repo_url: null,
          runbook_url: null,
          source_of_truth_note: null,
          last_verified_at: null,
        },
      ],
    },
  ];
  assert.doesNotThrow(() => filterCatalog(nulled, "anything"));
});

test("filtering never mutates the input", () => {
  const before = JSON.stringify(fixture);
  filterCatalog(fixture, "engine");
  assert.equal(JSON.stringify(fixture), before);
});

test("a container parent survives when a subcategory of it is visible", () => {
  // The arrangement nesting exists for: tiles live in the child, the parent is
  // a grouping. Dropping the parent here would render its children as unrelated
  // top-level blocks and make the grouping invisible — and the database (0005's
  // category_or_child_has_grant) now returns the parent for the same reason.
  const parent: CatalogCategory = {
    id: "p", slug: "finance", name: "Finance", description: "Container",
    sort_order: 10, parent_id: null, entries: [],
  };
  const child: CatalogCategory = { ...fixture[0], id: "c", slug: "fin-rep", parent_id: "p" };
  const { visible } = visibleCategories([parent, child]);
  assert.deepEqual(visible.map((c) => c.id), ["p", "c"]);
});

test("a category with nothing visible inside it is STILL dropped", () => {
  // The invariant visibleCategories exists for, and the one the container rule
  // must not break: an empty category with no visible children would otherwise
  // disclose its name and description to somebody granted nothing in it.
  const empty: CatalogCategory = {
    id: "e", slug: "secret", name: "Secret", description: "Must not reach the DOM",
    sort_order: 99, parent_id: null, entries: [],
  };
  const alsoEmptyChild: CatalogCategory = { ...empty, id: "ec", slug: "secret-sub", parent_id: "e" };
  const { visible } = visibleCategories([empty, alsoEmptyChild]);
  assert.deepEqual(visible, []);
});

test("an empty parent is not rescued by an empty child", () => {
  const parent: CatalogCategory = {
    id: "p2", slug: "hollow", name: "Hollow", description: "x",
    sort_order: 1, parent_id: null, entries: [],
  };
  const child: CatalogCategory = { ...parent, id: "c2", slug: "hollow-sub", parent_id: "p2" };
  assert.equal(visibleCategories([parent, child]).visible.length, 0);
});

test("searching does not collapse a container parent out of the results", () => {
  // N3: a container has no entries of its own EVER, so a plain
  // `entries.length > 0` filter dropped it the moment anyone typed — the
  // grouping was present and then vanished on the first keystroke, with its
  // subcategory promoted to an un-nested heading.
  const parent: CatalogCategory = {
    id: "p", slug: "finance", name: "Finance", description: "Container",
    sort_order: 10, parent_id: null, entries: [],
  };
  const child: CatalogCategory = { ...fixture[0], id: "c", slug: "fin-rep", parent_id: "p" };
  const needle = child.entries[0].display_name.slice(0, 4);
  const got = filterCatalog([parent, child], needle);
  assert.ok(got.some((c) => c.id === "p"), "the container parent was dropped by the search");
  assert.ok(got.some((c) => c.id === "c"));
});

test("a container parent whose children match nothing is still dropped", () => {
  const parent: CatalogCategory = {
    id: "p", slug: "finance", name: "Finance", description: "Container",
    sort_order: 10, parent_id: null, entries: [],
  };
  const child: CatalogCategory = { ...fixture[0], id: "c", slug: "fin-rep", parent_id: "p" };
  assert.deepEqual(filterCatalog([parent, child], "zzzznomatchzzzz"), []);
});
