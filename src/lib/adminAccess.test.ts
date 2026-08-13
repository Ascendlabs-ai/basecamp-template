import assert from "node:assert/strict";
import { test } from "node:test";

import type { Grant, GrantCategory, Member, TypeGrant } from "../types/admin.ts";


import {
  CREATE_TYPE_KEY,
  deleteTypeKey,
  describeError,
  effectiveEntryCount,
  grantKey,
  indexGrants,
  indexMembers,
  indexTypeGrants,
  initialsFromEmail,
  isTransportFailure,
  memberKey,
  pendingKey,
  resolveAccess,
  typeGrantKey,
} from "./adminAccess.ts";

/**
 * These functions decide what the admin screens SHOW. They do not decide
 * access — the RLS policies do, via `basecamp.has_grant`, and it is probed against the live
 * database in supabase/tests/. What is tested here is that the UI's picture
 * agrees with the database's rule, because a cell that renders "off" for a
 * grant that actually exists is how an admin revokes something twice, or
 * believes they revoked something they did not.
 */

const CAT = "11111111-1111-1111-1111-111111111111";
const OTHER_CAT = "22222222-2222-2222-2222-222222222222";
const ENTRY = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const OTHER_ENTRY = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const USER = "99999999-9999-9999-9999-999999999999";
const OTHER_USER = "88888888-8888-8888-8888-888888888888";

const entryGrant = (user: string, entry: string): Grant => ({
  id: `g-${user}-${entry}`,
  user_id: user,
  entry_id: entry,
  category_id: null,
});

const categoryGrant = (user: string, category: string): Grant => ({
  id: `g-${user}-${category}`,
  user_id: user,
  entry_id: null,
  category_id: category,
});

/**
 * The individual-grant half of `resolveAccess`, with no types in play. The
 * assertions below predate user types and are still exactly right — a grant on
 * an entry, a grant on its category, and the difference between them. They just
 * have to run against the function the matrix actually calls, so this narrows
 * the 3-field result to the two fields these cases are about.
 */
const vis = (index: Map<string, Grant>, userId: string, entryId: string, categoryId: string) => {
  const a = resolveAccess(index, indexTypeGrants([]), indexMembers([]), userId, entryId, categoryId);
  return { on: a.source !== "none", viaCategory: a.viaCategory };
};

test("no grants means no visibility", () => {
  const index = indexGrants([]);
  assert.deepEqual(vis(index, USER, ENTRY, CAT), { on: false, viaCategory: false });
});

test("a direct entry grant turns exactly that entry on", () => {
  const index = indexGrants([entryGrant(USER, ENTRY)]);
  assert.deepEqual(vis(index, USER, ENTRY, CAT), { on: true, viaCategory: false });
  // Same category, different entry — must stay off.
  assert.deepEqual(vis(index, USER, OTHER_ENTRY, CAT), {
    on: false,
    viaCategory: false,
  });
});

test("a category grant turns on every entry in that category, flagged as inherited", () => {
  const index = indexGrants([categoryGrant(USER, CAT)]);
  assert.deepEqual(vis(index, USER, ENTRY, CAT), { on: true, viaCategory: true });
  assert.deepEqual(vis(index, USER, OTHER_ENTRY, CAT), { on: true, viaCategory: true });
  // A different category is untouched.
  assert.deepEqual(vis(index, USER, OTHER_ENTRY, OTHER_CAT), {
    on: false,
    viaCategory: false,
  });
});

test("a direct grant inside a granted category is NOT reported as inherited", () => {
  // This is the case the disabled-switch rule depends on. If viaCategory were
  // true here the UI would disable a switch that does control a real row, and
  // the admin could never delete the redundant direct grant.
  const index = indexGrants([categoryGrant(USER, CAT), entryGrant(USER, ENTRY)]);
  assert.deepEqual(vis(index, USER, ENTRY, CAT), { on: true, viaCategory: false });
});

test("grants belong to one person only", () => {
  const index = indexGrants([entryGrant(USER, ENTRY), categoryGrant(USER, CAT)]);
  assert.deepEqual(vis(index, OTHER_USER, ENTRY, CAT), {
    on: false,
    viaCategory: false,
  });
});

test("entry and category keys cannot collide", () => {
  // Both id spaces are uuids from different tables, so without the e:/c:
  // discriminator an entry id equal to a category id would alias. Contrived,
  // but the cost of preventing it is one character.
  assert.notEqual(
    grantKey(USER, { entryId: ENTRY }),
    grantKey(USER, { categoryId: ENTRY }),
  );
});

test("indexGrants keeps the row so it can be deleted by id", () => {
  const g = entryGrant(USER, ENTRY);
  const index = indexGrants([g]);
  assert.equal(index.get(grantKey(USER, { entryId: ENTRY }))?.id, g.id);
});

test("initials come from the email local part", () => {
  assert.equal(initialsFromEmail("first.last@example.com"), "FL");
  assert.equal(initialsFromEmail("first_last@example.com"), "FL");
  assert.equal(initialsFromEmail("first-last@example.com"), "FL");
  assert.equal(initialsFromEmail("jordanmiller@example.com"), "JO");
});

test("initials degrade instead of throwing", () => {
  assert.equal(initialsFromEmail("a@example.com"), "A");
  assert.equal(initialsFromEmail("@example.com"), "?");
  assert.equal(initialsFromEmail(""), "?");
  // Punctuation-only local part: no letters to take, must not index undefined.
  assert.equal(initialsFromEmail("..@example.com"), "?");
});

test("effectiveEntryCount resolves category inheritance the same way the cells do", () => {
  // The invariant behind the C5 fix: the roster number and the by-person header
  // are the SAME rollup. Both now call this function, and this asserts the rule
  // it implements — a category grant counts every entry inside it.
  const cats: GrantCategory[] = [
    {
      id: CAT,
      slug: "cat",
      name: "Cat",
      entries: [
        { id: ENTRY, display_name: "One" },
        { id: OTHER_ENTRY, display_name: "Two" },
      ],
    },
    {
      id: OTHER_CAT,
      slug: "other",
      name: "Other",
      entries: [{ id: "cccccccc-cccc-cccc-cccc-cccccccccccc", display_name: "Three" }],
    },
  ];

  assert.equal(effectiveEntryCount(indexGrants([]), indexTypeGrants([]), indexMembers([]), USER, cats), 0);
  assert.equal(effectiveEntryCount(indexGrants([entryGrant(USER, ENTRY)]), indexTypeGrants([]), indexMembers([]), USER, cats), 1);
  // One category grant, two entries -> 2, NOT 1. Counting grant rows instead of
  // entries is exactly what made the roster disagree with the header.
  assert.equal(effectiveEntryCount(indexGrants([categoryGrant(USER, CAT)]), indexTypeGrants([]), indexMembers([]), USER, cats), 2);
  // A redundant direct grant inside a granted category must not double-count.
  assert.equal(
    effectiveEntryCount(indexGrants([categoryGrant(USER, CAT), entryGrant(USER, ENTRY)]), indexTypeGrants([]), indexMembers([]), USER, cats),
    2,
  );
  // Another person's grants contribute nothing.
  assert.equal(effectiveEntryCount(indexGrants([categoryGrant(OTHER_USER, CAT)]), indexTypeGrants([]), indexMembers([]), USER, cats), 0);
});

test("describeError never renders an empty parenthetical", () => {
  // postgrest sets code to "" on a fetch failure; `?? "unknown"` does not fire
  // on an empty string, which produced "Could not grant access ()." twice in
  // this codebase before the logic was shared.
  assert.equal(describeError({ code: "23505" }), "23505");
  assert.equal(describeError({ code: "" }), "network error");
  assert.equal(describeError({ code: undefined, message: "boom" }), "network error");
  assert.equal(describeError(null), "unknown error");
});

// ---------------------------------------------------------------------------
// Type-aware resolution — the UI's mirror of basecamp.has_grant
// ---------------------------------------------------------------------------

const TYPE = "77777777-7777-7777-7777-777777777777";
const OTHER_TYPE = "66666666-6666-6666-6666-666666666666";

const typeEntryGrant = (t: string, e: string): TypeGrant => ({
  id: `tg-${t}-${e}`, member_type_id: t, entry_id: e, category_id: null,
});
const typeCategoryGrant = (t: string, c: string): TypeGrant => ({
  id: `tg-${t}-${c}`, member_type_id: t, entry_id: null, category_id: c,
});
const member = (u: string, t: string): Member => ({
  id: `m-${u}`, user_id: u, member_type_id: t, department: null,
});

const NO_G = indexGrants([]);
const NO_TG = indexTypeGrants([]);
const NO_M = indexMembers([]);

test("no grants and no type means no access", () => {
  assert.deepEqual(resolveAccess(NO_G, NO_TG, NO_M, USER, ENTRY, CAT), {
    source: "none", viaCategory: false, alsoViaType: false,
  });
});

test("a type grant shows as type access, not individual", () => {
  const r = resolveAccess(
    NO_G, indexTypeGrants([typeEntryGrant(TYPE, ENTRY)]), indexMembers([member(USER, TYPE)]),
    USER, ENTRY, CAT,
  );
  assert.deepEqual(r, { source: "type", viaCategory: false, alsoViaType: true });
});

test("a type CATEGORY grant covers every entry in that category", () => {
  const tg = indexTypeGrants([typeCategoryGrant(TYPE, CAT)]);
  const m = indexMembers([member(USER, TYPE)]);
  assert.equal(resolveAccess(NO_G, tg, m, USER, ENTRY, CAT).source, "type");
  assert.equal(resolveAccess(NO_G, tg, m, USER, OTHER_ENTRY, CAT).source, "type");
  assert.equal(resolveAccess(NO_G, tg, m, USER, OTHER_ENTRY, OTHER_CAT).source, "none");
});

test("a type grant reaches ONLY people who hold that type", () => {
  const tg = indexTypeGrants([typeEntryGrant(TYPE, ENTRY)]);
  // Holds a different type.
  assert.equal(
    resolveAccess(NO_G, tg, indexMembers([member(USER, OTHER_TYPE)]), USER, ENTRY, CAT).source,
    "none",
  );
  // Holds no type at all — the join finds nothing, it must not match everything.
  assert.equal(resolveAccess(NO_G, tg, NO_M, USER, ENTRY, CAT).source, "none");
});

test("individual and type are a UNION — either alone grants access", () => {
  const onlyIndividual = resolveAccess(
    indexGrants([entryGrant(USER, ENTRY)]), NO_TG, NO_M, USER, ENTRY, CAT);
  assert.deepEqual(onlyIndividual, { source: "individual", viaCategory: false, alsoViaType: false });

  const onlyType = resolveAccess(
    NO_G, indexTypeGrants([typeEntryGrant(TYPE, ENTRY)]), indexMembers([member(USER, TYPE)]),
    USER, ENTRY, CAT);
  assert.equal(onlyType.source, "type");
});

test("an individual grant on top of a type grant is labelled individual but flagged redundant", () => {
  // This is the case the UI has to explain: the toggle is live, but flipping it
  // off changes nothing the person sees, because the type still covers it.
  const r = resolveAccess(
    indexGrants([entryGrant(USER, ENTRY)]),
    indexTypeGrants([typeEntryGrant(TYPE, ENTRY)]),
    indexMembers([member(USER, TYPE)]),
    USER, ENTRY, CAT,
  );
  assert.deepEqual(r, { source: "individual", viaCategory: false, alsoViaType: true });
});

test("neither source can subtract from the other", () => {
  // There is no deny anywhere in this model. Holding a type that does NOT grant
  // an entry must never cancel an individual grant on it.
  const r = resolveAccess(
    indexGrants([entryGrant(USER, ENTRY)]),
    indexTypeGrants([typeEntryGrant(TYPE, OTHER_ENTRY)]),
    indexMembers([member(USER, TYPE)]),
    USER, ENTRY, CAT,
  );
  assert.equal(r.source, "individual");
});

test("effectiveEntryCount counts each entry once across both sources", () => {
  const cats: GrantCategory[] = [{
    id: CAT, slug: "cat", name: "Cat",
    entries: [{ id: ENTRY, display_name: "One" }, { id: OTHER_ENTRY, display_name: "Two" }],
  }];
  const m = indexMembers([member(USER, TYPE)]);

  assert.equal(effectiveEntryCount(NO_G, NO_TG, NO_M, USER, cats), 0);
  // Type covers both entries in the category.
  assert.equal(
    effectiveEntryCount(NO_G, indexTypeGrants([typeCategoryGrant(TYPE, CAT)]), m, USER, cats), 2);
  // Individual grant duplicating one of them must NOT double-count.
  assert.equal(
    effectiveEntryCount(
      indexGrants([entryGrant(USER, ENTRY)]),
      indexTypeGrants([typeCategoryGrant(TYPE, CAT)]), m, USER, cats),
    2);
  // Individual grant on something the type does not cover adds to the total.
  assert.equal(
    effectiveEntryCount(
      indexGrants([entryGrant(USER, OTHER_ENTRY)]),
      indexTypeGrants([typeEntryGrant(TYPE, ENTRY)]), m, USER, cats),
    2);
});

test("a CATEGORY-level individual grant is flagged as not-per-entry-revocable", () => {
  // The regression this pins: resolveAccess used to collapse entry and category
  // grants into one `individual` boolean. A per-entry toggle then offered to
  // revoke a category grant, inserted a redundant entry row, left access
  // intact, and reported success. Any control that renders "revoke" must be
  // able to see the difference.
  const r = resolveAccess(
    indexGrants([categoryGrant(USER, CAT)]), NO_TG, NO_M, USER, ENTRY, CAT);
  assert.deepEqual(r, { source: "individual", viaCategory: true, alsoViaType: false });
});

test("a direct entry grant is revocable even inside a granted category", () => {
  // The other half. A redundant entry grant alongside a category grant IS a
  // real row a per-entry toggle can delete, so it must stay live — flagging it
  // inert would make the redundant row impossible to clean up.
  const r = resolveAccess(
    indexGrants([categoryGrant(USER, CAT), entryGrant(USER, ENTRY)]), NO_TG, NO_M, USER, ENTRY, CAT);
  assert.deepEqual(r, { source: "individual", viaCategory: false, alsoViaType: false });
});

test("a type grant is never reported as viaCategory", () => {
  const r = resolveAccess(
    NO_G, indexTypeGrants([typeCategoryGrant(TYPE, CAT)]), indexMembers([member(USER, TYPE)]),
    USER, ENTRY, CAT);
  // Inert for a different reason — the row belongs to the type, not the
  // category — so the two flags must not be conflated.
  assert.deepEqual(r, { source: "type", viaCategory: false, alsoViaType: true });
});

/**
 * The key namespace. These five moved into this module precisely because four
 * call sites had hand-built their keys and one writer/reader pair had to be
 * checked character-by-character during review. The property that makes the
 * extraction worth anything is that the namespaces cannot collide — so that is
 * what gets asserted, rather than the spelling of any one key.
 */
test("no two key namespaces can collide on the same id", () => {
  const id = USER;
  const keys = [
    pendingKey(id, { entryId: ENTRY }),
    pendingKey(id, { categoryId: ENTRY }),
    typeGrantKey(id, { entryId: ENTRY }),
    typeGrantKey(id, { categoryId: ENTRY }),
    grantKey(id, { entryId: ENTRY }),
    memberKey(id),
    deleteTypeKey(id),
    CREATE_TYPE_KEY,
  ];
  // `pendingKey` IS `grantKey` — an individual grant's in-flight key and its
  // index key are deliberately the same string, so that pair collides by
  // design. Every OTHER pair must be distinct.
  const distinct = new Set(keys);
  assert.equal(distinct.size, keys.length - 1);
  assert.equal(grantKey(id, { entryId: ENTRY }), pendingKey(id, { entryId: ENTRY }));
});

test("a pending key for a type is never a pending key for a person", () => {
  // Both take a uuid first. Without the prefix, granting entry X to type T and
  // granting entry X to person T would claim the same in-flight slot.
  assert.notEqual(typeGrantKey(USER, { entryId: ENTRY }), pendingKey(USER, { entryId: ENTRY }));
  assert.notEqual(memberKey(USER), deleteTypeKey(USER));
});

test("isTransportFailure separates 'the database refused' from 'we do not know'", () => {
  // A real SQLSTATE is evidence of a refusal and needs no resync.
  assert.equal(isTransportFailure({ code: "23505" }), false);
  assert.equal(isTransportFailure({ code: "42501" }), false);
  // postgrest-js sets code to "" on a fetch failure — the write may have
  // committed before the connection died.
  assert.equal(isTransportFailure({ code: "" }), true);
  // No error and no row is the MOST ambiguous outcome, and an earlier version
  // routed exactly this case to the no-resync branch.
  assert.equal(isTransportFailure(null), true);
  assert.equal(isTransportFailure({}), true);
});
