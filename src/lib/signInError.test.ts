import assert from "node:assert/strict";
import test from "node:test";

import { classifySignInError } from "./signInError.ts";

/**
 * These two modules exist because the app blamed the user for the app's own
 * misconfiguration. The tests below are mostly about the DIRECTION of a
 * mistake: reporting a configuration failure as a wrong password sends somebody
 * to delete and recreate accounts until a rate limit stops them, while
 * reporting a wrong password as a configuration failure merely annoys. Every
 * unknown case must therefore fall on the configuration side.
 */

// ---------------------------------------------------------------------------
// classifySignInError
// ---------------------------------------------------------------------------

test("an invalid API key is a configuration failure, never a bad password", () => {
  // THE case that cost half a day: 401 from GoTrue with no anon key.
  const got = classifySignInError({ name: "AuthApiError", status: 401, message: "Invalid API key" });
  assert.equal(got.kind, "configuration");
  assert.doesNotMatch(got.message, /password/i);
  assert.match(got.message, /api key/i);
});

test("a message naming an API key is a configuration failure whatever the status", () => {
  const got = classifySignInError({ status: 403, message: "No API key found in request" });
  assert.equal(got.kind, "configuration");
});

test("an unreachable project is a configuration failure", () => {
  for (const error of [
    { name: "AuthRetryableFetchError", message: "Failed to fetch" },
    { status: 0, message: "Failed to fetch" },
    { message: "Network request failed" },
  ]) {
    const got = classifySignInError(error);
    assert.equal(got.kind, "configuration", JSON.stringify(error));
    assert.doesNotMatch(got.message, /combination did not work/i);
  }
});

test("a genuine wrong password is reported as credentials", () => {
  const got = classifySignInError({
    name: "AuthApiError",
    status: 400,
    code: "invalid_credentials",
    message: "Invalid login credentials",
  });
  assert.equal(got.kind, "credentials");
  assert.match(got.message, /email and password/i);
});

test("the credentials message does not say which half was wrong", () => {
  // Distinguishing "no such user" from "wrong password" would turn this form
  // into an account-enumeration oracle on a shared Supabase project.
  const wrongPassword = classifySignInError({ status: 400, code: "invalid_credentials" });
  const noSuchUser = classifySignInError({ status: 400, code: "user_not_found" });
  const unconfirmed = classifySignInError({ status: 400, code: "email_not_confirmed" });
  assert.equal(wrongPassword.message, noSuchUser.message);
  assert.equal(wrongPassword.message, unconfirmed.message);
});

test("a server-side fault is not the user's fault", () => {
  const got = classifySignInError({ status: 503, message: "upstream connect error" });
  assert.equal(got.kind, "configuration");
  assert.doesNotMatch(got.message, /combination did not work/i);
});

test("an unrecognized failure defaults to configuration, not to blaming the user", () => {
  // The whole point. A future status this file has never seen must not come back
  // as "your password is wrong".
  const got = classifySignInError({ status: 418, message: "something new" });
  assert.equal(got.kind, "configuration");

  const nothing = classifySignInError(null);
  assert.equal(nothing.kind, "configuration");
});

test("a rate limit is the one failure where trying again IS the fix", () => {
  // 429 must not inherit either standard message: "signing in again will not
  // help" is the opposite of the truth here, and "that combination did not work"
  // blames details that were probably correct.
  const got = classifySignInError({ status: 429, message: "Request rate limit reached" });
  assert.match(got.message, /wait/i);
  assert.doesNotMatch(got.message, /will not help/i);
  assert.doesNotMatch(got.message, /combination did not work/i);
});
