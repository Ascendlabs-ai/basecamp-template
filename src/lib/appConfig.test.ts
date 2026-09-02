import assert from "node:assert/strict";
import test from "node:test";

import {
  isAllowedRedirectUri,
  parseRedirectUris,
  ssoReadiness,
  validateOAuthClient,
} from "./appConfig.ts";

const ready = {
  entry_id: "11111111-1111-4111-8111-111111111111",
  client_id: "22222222-2222-4222-8222-222222222222",
  redirect_uris: ["https://sales.example.org/auth/callback"],
  enabled: true,
};

test("redirect URIs require HTTPS except for a local reference client", () => {
  assert.equal(isAllowedRedirectUri("https://sales.example.org/auth/callback"), true);
  assert.equal(isAllowedRedirectUri("http://localhost:3000/sso/reference/callback"), true);
  assert.equal(isAllowedRedirectUri("http://sales.example.org/auth/callback"), false);
  assert.equal(isAllowedRedirectUri("https://user:pass@sales.example.org/callback"), false);
});
test("redirect URI input is trimmed, de-duplicated and accepts lines or commas", () => {
  assert.deepEqual(
    parseRedirectUris("https://a.example/cb, https://b.example/cb\nhttps://a.example/cb"),
    ["https://a.example/cb", "https://b.example/cb"],
  );
});

test("SSO readiness fails closed", () => {
  assert.equal(ssoReadiness("basecamp_sso", null), "not_configured");
  assert.equal(ssoReadiness("basecamp_sso", { ...ready, enabled: false }), "failing");
  assert.equal(ssoReadiness("basecamp_sso", ready), "ready");
  assert.equal(ssoReadiness("link_only", ready), "not_configured");
  assert.match(validateOAuthClient({ ...ready, client_id: "made-up" }) ?? "", /UUID/);
});
