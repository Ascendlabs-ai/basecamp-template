import assert from "node:assert/strict";
import test from "node:test";
import { pkceChallenge } from "./oauthReference.ts";

test("pkceChallenge matches the RFC 7636 example", async () => {
  assert.equal(await pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
});
