import assert from "node:assert/strict";
import test from "node:test";

import { relationMany, relationOne } from "./postgrestRelations.ts";

test("a missing to-many relationship becomes an empty collection", () => {
  assert.deepEqual(relationMany(null), []);
  assert.deepEqual(relationMany(undefined), []);
});

test("a populated to-many relationship is preserved", () => {
  const rows = [{ id: "oauth-client" }];
  assert.equal(relationMany(rows), rows);
});

test("a to-one relationship accepts PostgREST object, array, and null shapes", () => {
  const row = { auth_mode: "link_only" };
  assert.equal(relationOne(row), row);
  assert.equal(relationOne([row]), row);
  assert.equal(relationOne([]), null);
  assert.equal(relationOne(null), null);
});
