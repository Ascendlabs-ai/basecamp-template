import assert from "node:assert/strict";
import { test } from "node:test";

import {
  banDuration,
  buildSignInUrl,
  isAlreadyRegistered,
  isEmailShaped,
  normaliseEmail,
  parseSignInFragment,
} from "./adminLink.ts";

// ---------------------------------------------------------------------------
// buildSignInUrl — the one that hands someone a credential
// ---------------------------------------------------------------------------

test("the sign-in link points at our own confirm page, not Supabase's verify endpoint", () => {
  const url = buildSignInUrl("https://basecamp.example.org", "abc123", "invite");
  const parsed = new URL(url);
  assert.equal(parsed.origin, "https://basecamp.example.org");
  // THE WHOLE POINT. Supabase's own action_link verifies on GET, so a preview
  // fetch consumes the single-use token before its owner ever clicks. Ours
  // renders a button and verifies on click.
  assert.equal(parsed.pathname, "/auth/confirm");
});

test("the token is in the FRAGMENT, never the query string", () => {
  // THE POINT: a query string is sent to the server on every request, so a
  // token there is written into the host's access logs each time the link is
  // opened. Fragments never leave the browser.
  const parsed = new URL(buildSignInUrl("https://x.test", "tok-value", "recovery"));
  assert.equal(parsed.search, "", "a token in the query string reaches server logs");
  assert.equal(parsed.searchParams.get("token_hash"), null);
  const round = parseSignInFragment(parsed.hash);
  assert.deepEqual(round, { token: "tok-value", kind: "recovery" });
});

test("a token containing URL metacharacters survives the round trip", () => {
  // Built with URLSearchParams rather than a template string. A raw `&` or `#`
  // in a hashed token would otherwise truncate the fragment and hand over a
  // link that silently fails to verify.
  const parsed = new URL(buildSignInUrl("https://x.test", "a&b=c#d e", "invite"));
  assert.deepEqual(parseSignInFragment(parsed.hash), { token: "a&b=c#d e", kind: "invite" });
});

test("a fragment with no token, or an unknown type, is refused rather than guessed", () => {
  // A link truncated on its way through a chat client, or hand-edited. Guessing
  // a type here would call verifyOtp with the wrong one and burn the token.
  assert.equal(parseSignInFragment(""), null);
  assert.equal(parseSignInFragment("#type=invite"), null);
  assert.equal(parseSignInFragment("#token_hash=t&type=magiclink"), null);
  assert.equal(parseSignInFragment("#token_hash=t"), null);
});

test("parseSignInFragment accepts the hash with or without its leading #", () => {
  assert.deepEqual(parseSignInFragment("#token_hash=t&type=invite"), {
    token: "t",
    kind: "invite",
  });
  assert.deepEqual(parseSignInFragment("token_hash=t&type=invite"), { token: "t", kind: "invite" });
});

test("the origin the administrator is on is the origin in the link", () => {
  // So a link generated from a preview deployment points back at that preview,
  // rather than at production where the account may not even exist yet.
  const parsed = new URL(buildSignInUrl("https://preview-42.vercel.app", "t", "invite"));
  assert.equal(parsed.origin, "https://preview-42.vercel.app");
});

// ---------------------------------------------------------------------------
// isEmailShaped — a courtesy check, deliberately permissive
// ---------------------------------------------------------------------------

test("ordinary addresses pass", () => {
  for (const value of [
    "sam@example.org",
    "first.last@sub.domain.co.uk",
    "plus+tag@example.com",
    "  padded@example.com  ",
  ]) {
    assert.equal(isEmailShaped(value), true, value);
  }
});

test("the shapes that are certainly typos are refused", () => {
  for (const value of [
    "",
    "   ",
    "no-at-sign.example.com",
    "@example.com",
    "two@@example.com",
    "trailing@dot.",
    "nodot@localhost",
    "has space@example.com",
  ]) {
    assert.equal(isEmailShaped(value), false, value);
  }
});

test("an absurdly long address is refused before it reaches the network", () => {
  assert.equal(isEmailShaped(`${"a".repeat(250)}@example.com`), false);
});

test("normalising lowercases and trims, because GoTrue does too", () => {
  assert.equal(normaliseEmail("  Sam@Example.ORG "), "sam@example.org");
});

// ---------------------------------------------------------------------------
// isAlreadyRegistered — the difference between onboarding working and a 422
// ---------------------------------------------------------------------------

test("the already-registered case is recognised by code", () => {
  assert.equal(isAlreadyRegistered({ code: "email_exists" }), true);
  assert.equal(isAlreadyRegistered({ code: "user_already_exists" }), true);
});

test("the already-registered case is recognised by message when the code changes", () => {
  // Not belt-and-braces for its own sake: this branch is the difference between
  // "add an existing person" working and an administrator seeing an opaque 422,
  // so it does not rest on one field surviving a Supabase upgrade.
  assert.equal(
    isAlreadyRegistered({ message: "A user with this email address has already been registered" }),
    true,
  );
});

test("an unrelated failure is NOT read as already-registered", () => {
  // Getting this wrong would silently downgrade a real error into a recovery
  // link for an account that was never created.
  assert.equal(isAlreadyRegistered({ code: "over_email_send_rate_limit" }), false);
  assert.equal(isAlreadyRegistered({ message: "Database error creating new user" }), false);
  assert.equal(isAlreadyRegistered(null), false);
});

// ---------------------------------------------------------------------------
// banDuration
// ---------------------------------------------------------------------------

test("banning uses a duration nobody outlives; unbanning uses the documented clear value", () => {
  assert.equal(banDuration(true), "876000h");
  // 'none' specifically. The empty string and null both LEAVE THE BAN IN PLACE,
  // which would make the restore button silently do nothing.
  assert.equal(banDuration(false), "none");
});
