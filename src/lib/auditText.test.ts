import assert from "node:assert/strict";
import test from "node:test";

import { describeAuditActor, describeAuditRow, formatAuditTime } from "./auditText.ts";
import type { AuditRow } from "../types/admin.ts";

/**
 * The audit surface's job is to say what happened. A wrong branch here does not
 * render badly — it renders a DIFFERENT EVENT, convincingly. So these tests are
 * about meaning, not formatting: each one pins a phrase that must not be
 * confusable with another row's.
 */

function row(over: Partial<AuditRow> = {}): AuditRow {
  return {
    id: 1,
    occurred_at: "2026-03-12T09:30:00+00:00",
    actor_email: "admin@example.com",
    action: "grant",
    source_table: "access_grants",
    subject_label: "person@example.com",
    object_kind: "entry",
    object_label: "Analytics Dashboard",
    ...over,
  };
}

test("an individual entry grant names the entry and the person", () => {
  assert.equal(
    describeAuditRow(row()),
    "granted Analytics Dashboard to person@example.com",
  );
});

test("a revoke flips both the verb and the preposition", () => {
  assert.equal(
    describeAuditRow(row({ action: "revoke" })),
    "revoked Analytics Dashboard from person@example.com",
  );
});

test("a category grant says so — 'the whole category' is the difference between one app and all of them", () => {
  assert.equal(
    describeAuditRow(row({ object_kind: "category", object_label: "Operations" })),
    "granted the whole category Operations to person@example.com",
  );
});

test("a type grant is attributed to the TYPE, not to a person", () => {
  // Without this, granting a type reads exactly like granting one person, and
  // the blast radius of the two is completely different.
  assert.equal(
    describeAuditRow(row({ source_table: "type_grants", subject_label: "Staff" })),
    "granted Analytics Dashboard to the Staff type",
  );
});

test("membership changes read as membership, never as an entry grant", () => {
  // The regression this guards: 'members' falling through to the generic branch
  // renders "granted Staff to someone", indistinguishable from granting an app
  // that happens to be called Staff.
  assert.equal(
    describeAuditRow(
      row({ source_table: "members", object_kind: "type", object_label: "Staff" }),
    ),
    "put person@example.com on the Staff type",
  );
  assert.equal(
    describeAuditRow(
      row({ source_table: "members", action: "revoke", object_kind: "type", object_label: "Staff" }),
    ),
    "removed person@example.com from the Staff type",
  );
});

test("trust-root changes are described as administrator changes", () => {
  assert.equal(
    describeAuditRow(row({ source_table: "super_admins", object_kind: null, object_label: null })),
    "made person@example.com an administrator",
  );
  assert.equal(
    describeAuditRow(
      row({ source_table: "super_admins", action: "revoke", object_kind: null, object_label: null }),
    ),
    "removed person@example.com as an administrator",
  );
});

test("an unrecognised source table is flagged, not rendered as an ordinary grant", () => {
  // The database CHECK allows 'unknown' so that a trigger on an unmodelled
  // table is RECORDED rather than rejected. That only helps if it is visible.
  const text = describeAuditRow(row({ source_table: "unknown" }));
  assert.match(text, /unrecognised table/);
  assert.doesNotMatch(text, /^granted/);
});

test("a deleted referent degrades to a phrase, never to a blank or 'null'", () => {
  // access_audit has no foreign keys on purpose, so labels can outlive what they
  // name — and a cascade delete can leave them NULL. The row must still read as
  // a sentence, because a half-empty audit line is worse than an explicit one.
  const text = describeAuditRow(row({ subject_label: null, object_label: null }));
  assert.equal(text, "granted something that no longer exists to someone");
  assert.doesNotMatch(text, /null|undefined/);
});

test("no rendered phrase collapses whitespace incorrectly", () => {
  // `kind` is empty for an entry grant; without the collapse this carries a
  // double space mid-sentence.
  assert.doesNotMatch(describeAuditRow(row()), /\s{2,}/);
  assert.doesNotMatch(describeAuditRow(row({ object_kind: "category" })), /\s{2,}/);
});

test("a null actor becomes System — the absence of a signed-in user is information", () => {
  assert.equal(describeAuditActor(null), "System");
  assert.equal(describeAuditActor("admin@example.com"), "admin@example.com");
});

test("timestamps are pinned to en-GB/UTC so server and client agree", () => {
  // The actual hydration guard. If this ever depends on the host's zone, the
  // audit list mismatches between the server pass and the browser pass.
  assert.equal(formatAuditTime("2026-03-12T09:30:00+00:00"), "12 Mar 2026, 09:30");
  // Same instant, expressed in another offset, must render identically.
  assert.equal(
    formatAuditTime("2026-03-12T09:30:00+00:00"),
    formatAuditTime("2026-03-12T11:30:00+02:00"),
  );
  // And a near-midnight instant must not drift a day.
  assert.equal(formatAuditTime("2026-03-12T23:45:00+00:00"), "12 Mar 2026, 23:45");
});

// ---------------------------------------------------------------------------
// Account lifecycle (source_table 'auth_admin') — added with 0004
// ---------------------------------------------------------------------------

/** A lifecycle row. These carry no object: they are about a person, not access. */
function lifecycle(over: Partial<AuditRow> = {}): AuditRow {
  return row({
    source_table: "auth_admin",
    object_kind: null,
    object_label: null,
    ...over,
  });
}

test("adding a person reads as adding a person, not as granting something", () => {
  assert.equal(
    describeAuditRow(lifecycle({ action: "invite" })),
    "added person@example.com and issued a sign-in link",
  );
});

test("a re-issued link is distinguishable from the original invite", () => {
  // These two are the pair most likely to be confused when reading a log to
  // answer "how did this person get in?".
  const invited = describeAuditRow(lifecycle({ action: "invite" }));
  const reissued = describeAuditRow(lifecycle({ action: "reissue_link" }));
  assert.notEqual(invited, reissued);
  assert.equal(reissued, "issued person@example.com a new sign-in link");
});

test("suspend and restore are opposites, and say so", () => {
  assert.equal(
    describeAuditRow(lifecycle({ action: "ban" })),
    "suspended person@example.com's sign-in",
  );
  assert.equal(
    describeAuditRow(lifecycle({ action: "unban" })),
    "restored person@example.com's sign-in",
  );
});

test("a lifecycle row never renders as a grant sentence", () => {
  // The regression this branch exists to prevent: falling through to the
  // generic tail, which assumes grant/revoke and would describe a suspension as
  // "granted something that no longer exists to someone".
  for (const action of ["invite", "reissue_link", "ban", "unban"] as const) {
    const text = describeAuditRow(lifecycle({ action }));
    assert.doesNotMatch(text, /granted|revoked|no longer exists/, action);
  }
});

test("a lifecycle row with no subject still reads as a sentence", () => {
  assert.equal(
    describeAuditRow(lifecycle({ action: "ban", subject_label: null })),
    "suspended someone's sign-in",
  );
});

test("a super_admins row is still about administrators, not about accounts", () => {
  // The two sources are adjacent in meaning and must not blur: 'super_admins'
  // is a promotion, 'auth_admin' is an account action.
  assert.equal(
    describeAuditRow(row({ source_table: "super_admins", action: "grant" })),
    "made person@example.com an administrator",
  );
});

test("adoption is distinguishable from an invite — it must not claim a link was issued", () => {
  // The distinction an auditor needs: which rows actually minted a credential.
  // Adoption gives an existing account access to this app and issues nothing.
  const adopted = describeAuditRow(lifecycle({ action: "adopt" }));
  assert.doesNotMatch(adopted, /link/i);
  assert.notEqual(adopted, describeAuditRow(lifecycle({ action: "invite" })));
  assert.match(adopted, /already had an account/i);
});
