import assert from "node:assert/strict";
import { test } from "node:test";

import { MIN_PASSWORD_LENGTH, PASSWORD_HINT, checkPassword } from "./passwordPolicy.ts";

test("a long enough, matching pair is accepted", () => {
  assert.equal(checkPassword("correct horse battery", "correct horse battery"), null);
});

test("a short password is refused, and the message names the requirement", () => {
  const message = checkPassword("short", "short");
  assert.ok(message);
  assert.match(message, new RegExp(String(MIN_PASSWORD_LENGTH)));
});

test("exactly the minimum is accepted — the boundary is not off by one", () => {
  const atMinimum = "x".repeat(MIN_PASSWORD_LENGTH);
  assert.equal(checkPassword(atMinimum, atMinimum), null);
  const belowMinimum = "x".repeat(MIN_PASSWORD_LENGTH - 1);
  assert.ok(checkPassword(belowMinimum, belowMinimum));
});

test("a mismatch is refused even when both halves are long enough", () => {
  const message = checkPassword("a-long-enough-password", "a-different-password");
  assert.equal(message, "Those two passwords do not match.");
});

test("length is checked before the match, so a short mismatched pair names length", () => {
  // Both rules fail here. Reporting the mismatch would send someone hunting for
  // a typo when the real problem is that the password is too short.
  const message = checkPassword("abc", "xyz");
  assert.ok(message);
  assert.match(message, /at least/i);
});

test("the hint shown under the field agrees with the rule that is enforced", () => {
  // Two screens render PASSWORD_HINT and both call checkPassword. If these ever
  // disagree, the form tells people one thing and refuses another.
  assert.match(PASSWORD_HINT, new RegExp(String(MIN_PASSWORD_LENGTH)));
});
