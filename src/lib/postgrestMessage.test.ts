import assert from "node:assert/strict";
import test from "node:test";

import { EXPOSED_SCHEMAS_LOCATION, explainReadError } from "./postgrestMessage.ts";

/**
 * `PGRST106` is the error a correctly provisioned database still produces until
 * somebody adds `basecamp` to a setting in the Supabase dashboard. It is the
 * first thing a brand-new administrator sees and it stops the app dead, so the
 * message has to carry the code (what they will search for), the location (what
 * they must change) and the reassurance that the database itself is fine.
 */

test("PGRST106 is explained in words, and names both the code and the setting", () => {
  const got = explainReadError({ code: "PGRST106", message: "The schema must be one of the following" });
  assert.ok(got, "PGRST106 must be explained");
  // The code stays in the sentence: it is what a client searches for and what
  // the walkthrough names from the other side.
  assert.match(got, /PGRST106/);
  assert.match(got, /Exposed schemas/i);
  assert.match(got, /basecamp/);
  // It must say this is not a broken database, because that is the wrong
  // conclusion a client otherwise draws and acts on.
  assert.match(got, /hard-refresh/i);
});

test("every other code falls through to the caller's bare-code fallback", () => {
  // Returning a sentence for these would disclose more than the pages that call
  // this are willing to put in front of an arbitrary project tenant.
  assert.equal(explainReadError({ code: "42501" }), null);
  assert.equal(explainReadError({ code: "PGRST301" }), null);
  assert.equal(explainReadError({ code: "" }), null);
  assert.equal(explainReadError(null), null);
  assert.equal(explainReadError(undefined), null);
});

test("the message points at the same place supabase/README.md step 0 does", () => {
  // A client following the error to a menu that does not exist is worse off than
  // one following a bare code, so the location is a shared constant rather than
  // prose typed twice.
  const got = explainReadError({ code: "PGRST106" })!;
  assert.ok(got.includes(EXPOSED_SCHEMAS_LOCATION));
});
