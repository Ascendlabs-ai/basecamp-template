import assert from "node:assert/strict";
import { test } from "node:test";

import { readAdminResponse } from "./adminApi.ts";

/** A Response-alike. Only the three members readAdminResponse touches. */
function reply(status: number, body: unknown, opts: { html?: boolean } = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => {
      if (opts.html) throw new SyntaxError("Unexpected token < in JSON at position 0");
      return body;
    },
  } as Response;
}

test("a successful reply hands back the parsed body", async () => {
  const result = await readAdminResponse<{ link: string }>(reply(201, { link: "https://x/y" }));
  assert.deepEqual(result, { data: { link: "https://x/y" } });
});

test("a route's own error sentence is preferred over any status text", async () => {
  // The routes write these for the person reading them; a status code never
  // beats "That member type no longer exists."
  const result = await readAdminResponse(reply(400, { error: "That member type no longer exists." }));
  assert.deepEqual(result, { message: "That member type no longer exists." });
});

test("an HTML body at 401 becomes a session message, not a parse error", async () => {
  // THE REGRESSION THIS EXISTS FOR. A middleware redirect followed by fetch
  // delivers the login page's HTML; res.json() throws, and reporting
  // "Unexpected token <" tells the administrator nothing about what happened.
  const result = await readAdminResponse(reply(401, null, { html: true }));
  assert.ok("message" in result);
  assert.match(result.message, /session has expired/i);
  assert.doesNotMatch(result.message, /token|JSON/i);
});

test("an HTML body at any other status names the status rather than guessing", async () => {
  const result = await readAdminResponse(reply(502, null, { html: true }));
  assert.ok("message" in result);
  assert.match(result.message, /unexpected response \(502\)/);
});

test("an error reply with no usable error field still yields a sentence", async () => {
  for (const body of [{}, { error: 42 }, null, "plain text"]) {
    const result = await readAdminResponse(reply(500, body));
    assert.ok("message" in result, JSON.stringify(body));
    assert.match(result.message, /did not work \(500\)/);
  }
});
