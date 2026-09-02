import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const migration = readFileSync(
  path.join(process.cwd(), "supabase/migrations/0006_product_contract.sql"),
  "utf8",
);

test("inactive apps fail closed for OAuth token issuance", () => {
  const accessHelper = migration.match(
    /create or replace function basecamp\.can_access_app_for_user[\s\S]*?\n\$\$;/,
  )?.[0];

  assert.ok(accessHelper, "the app-access helper must exist");
  assert.match(accessHelper, /from basecamp\.app_settings s[\s\S]*?s\.is_active/);
  assert.match(accessHelper, /s\.is_active[\s\S]*?basecamp\.super_admins/);

  const tokenHook = migration.match(
    /create or replace function basecamp\.custom_access_token_hook[\s\S]*?\n\$\$;/,
  )?.[0];
  assert.ok(tokenHook, "the custom access-token hook must exist");
  assert.match(tokenHook, /basecamp\.can_access_app_for_user\(v_user_id_text::uuid, c\.entry_id\)/);
});

test("app settings, grants, OAuth mapping and activation save atomically", () => {
  const configure = migration.match(
    /create or replace function basecamp\.configure_app[\s\S]*?\n\$\$;/,
  )?.[0];
  assert.ok(configure, "the atomic app-configuration RPC must exist");
  assert.match(configure, /insert into basecamp\.app_settings/);
  assert.match(configure, /delete from basecamp\.access_grants/);
  assert.match(configure, /insert into basecamp\.oauth_clients/);
  assert.match(configure, /update basecamp\.app_settings set is_active = true/);
});

test("superadmins can still configure and inspect inactive catalog entries", () => {
  assert.match(
    migration,
    /create policy basecamp_entries_select_granted[\s\S]*?using \(\(select basecamp\.is_super_admin\(\)\) or basecamp\.can_read_basecamp_entry\(id\)\);/,
  );
});
