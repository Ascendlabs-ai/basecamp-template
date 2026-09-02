import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

type ContractManifest = {
  contractVersion: number;
  profile: string;
  schemaThrough: string;
  features: string[];
};

test("the stamped template publishes the complete Basecamp contract", () => {
  const manifest = JSON.parse(
    readFileSync(path.join(process.cwd(), "basecamp.contract.json"), "utf8"),
  ) as ContractManifest;

  assert.equal(manifest.contractVersion, 2);
  assert.equal(manifest.profile, "standalone-template");
  assert.equal(manifest.schemaThrough, "0007_branding_settings.sql");
  assert.deepEqual(
    new Set(manifest.features),
    new Set([
      "catalog-crud",
      "one-level-category-nesting",
      "membership-and-access-admin",
      "member-onboarding",
      "everyone-or-selected-app-access",
      "active-app-gate",
      "oauth-2.1-pkce",
      "token-time-entitlement",
      "configuration-audit",
      "administrator-branding",
      "full-form-app-creation",
    ]),
  );
});
