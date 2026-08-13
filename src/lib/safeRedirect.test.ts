import assert from "node:assert/strict";
import { test } from "node:test";

import { sameOriginPath } from "./safeRedirect.ts";

const ORIGIN = "http://localhost:3000";

/**
 * The `?next=` value is attacker-controlled: anyone can send a team member a
 * link to /login?next=<anything>. If it can escape the origin, the sign-in page
 * becomes a redirector that launders a hostile URL behind a trusted domain.
 *
 * Every payload below defeated the first version of this guard
 * (`startsWith("/") && !startsWith("//")`), which is why the check is now a
 * URL parse. Run: npm test
 */

test("keeps ordinary same-origin paths", () => {
  assert.equal(sameOriginPath("/", ORIGIN), "/");
  assert.equal(sameOriginPath("/entries", ORIGIN), "/entries");
  assert.equal(sameOriginPath("/entries?q=1#top", ORIGIN), "/entries?q=1#top");
});

test("falls back to / when there is no next", () => {
  assert.equal(sameOriginPath(null, ORIGIN), "/");
  assert.equal(sameOriginPath(undefined, ORIGIN), "/");
  assert.equal(sameOriginPath("", ORIGIN), "/");
});

test("blocks every off-origin payload", () => {
  for (const payload of [
    "//evil.com", // protocol-relative
    "///evil.com",
    "https://evil.com",
    "http://evil.com",
    "\\\\/evil.com",
    "/\\evil.com", // browsers fold "\" to "/" -> "//evil.com"
    "/\t/evil.com", // tab is stripped during URL parsing
    "/\n/evil.com",
    "javascript:alert(1)",
    "https://localhost:3000.evil.com/", // suffix, not the same host
  ]) {
    assert.equal(
      sameOriginPath(payload, ORIGIN),
      "/",
      `payload escaped the origin guard: ${JSON.stringify(payload)}`,
    );
  }
});

/**
 * The four payloads below are the ones that defeated the SECOND version of this
 * guard, which checked the origin and then returned `url.pathname` unflattened.
 * "/..//evil.com" needs no host at all — a bare relative path was enough.
 *
 * They are asserted against the SECURITY PROPERTY, not against a literal "/".
 * The guard collapses them to "/evil.com", which is a path on our own host and
 * is therefore safe — it 404s locally, it does not leave the origin. Demanding
 * exactly "/" here would be asserting an implementation detail and would fail a
 * correct implementation, which is precisely what it did on first writing.
 */
test("payloads that survive sanitisation stay on our own origin", () => {
  for (const payload of [
    "/..//evil.com",
    `${ORIGIN}//evil.com`,
    `${ORIGIN}/\\/evil.com`,
    "//localhost:3000//evil.com",
  ]) {
    const result = sameOriginPath(payload, ORIGIN);
    const landing = new URL(result, ORIGIN);
    assert.equal(
      landing.origin,
      ORIGIN,
      `payload escaped the origin: ${JSON.stringify(payload)} -> ${result} -> ${landing.href}`,
    );
    assert.ok(!result.startsWith("//"), `protocol-relative result: ${result}`);
  }
});

// This assertion was vacuous when first written: it ran only over payloads the
// origin check already rejected, so it could not have caught the "/..//evil.com"
// class it exists to catch. The list below now includes every known escape.
test("never returns anything that could leave the origin", () => {
  for (const payload of [
    "//evil.com",
    "/\\evil.com",
    "https://evil.com",
    "/..//evil.com",
    `${ORIGIN}//evil.com`,
    `${ORIGIN}/\\/evil.com`,
    "//localhost:3000//evil.com",
    "/ok",
  ]) {
    const result = sameOriginPath(payload, ORIGIN);
    assert.ok(result.startsWith("/"), `not a path: ${result}`);
    assert.ok(!result.startsWith("//"), `protocol-relative: ${result}`);
  }
});

test("a same-origin absolute URL is reduced to its path", () => {
  assert.equal(sameOriginPath("http://localhost:3000/entries", ORIGIN), "/entries");
});
