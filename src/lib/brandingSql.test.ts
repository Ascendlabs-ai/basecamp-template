import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const migration = readFileSync(
  path.join(process.cwd(), "supabase/migrations/0007_branding_settings.sql"),
  "utf8",
);

test("branding uses a fixed public projection while its table stays outside anonymous reach", () => {
  assert.match(migration, /alter table basecamp\.branding_settings enable row level security/);
  assert.match(migration, /for select to authenticated using \(true\)/);
  assert.doesNotMatch(migration, /grant select on basecamp\.branding_settings to anon/);
  assert.match(migration, /function public\.basecamp_public_branding\(\)/);
  assert.match(migration, /returns table\(display_name text, logo_path text\)/);
  assert.match(migration, /grant execute on function public\.basecamp_public_branding\(\) to anon, authenticated/);
});

test("branding writes stay behind the administrator gate", () => {
  assert.match(
    migration,
    /basecamp_branding_settings_update_admin[\s\S]*?using \(\(select basecamp\.is_super_admin\(\)\)\)[\s\S]*?with check \(\(select basecamp\.is_super_admin\(\)\)\)/,
  );
  assert.match(migration, /if not basecamp\.is_super_admin\(\) then/);
  assert.match(migration, /revoke all on function basecamp\.configure_branding\(text, text\) from public, anon/);
});

test("branding changes have an append-only administrator-readable audit", () => {
  assert.match(migration, /after insert or update or delete on basecamp\.branding_settings/);
  assert.match(migration, /auth\.uid\(\), lower\(tg_op\)/);
  assert.match(migration, /branding audit is append-only/);
  assert.match(migration, /basecamp_branding_audit_select_admin[\s\S]*?is_super_admin/);
  assert.match(migration, /revoke insert, update, delete, truncate on basecamp\.branding_audit/);
});

test("the login logo bucket is public but constrained and administrator-written", () => {
  assert.match(migration, /'basecamp-branding',[\s\S]*?true,[\s\S]*?2097152/);
  assert.match(migration, /array\['image\/png', 'image\/jpeg', 'image\/webp'\]/);
  assert.match(migration, /basecamp_branding_objects_insert_admin[\s\S]*?basecamp\.is_super_admin/);
  assert.match(migration, /basecamp_branding_objects_delete_admin[\s\S]*?basecamp\.is_super_admin/);
  assert.ok(migration.includes("name ~ '^logos/[0-9a-f-]{36}"));
});

test("the source migration is transactional and contains its release assertions", () => {
  assert.match(migration, /^--[\s\S]*?\nbegin;/);
  assert.match(migration, /anonymous clients must reach branding only through the fixed public projection/);
  assert.match(migration, /branding bucket must be public and limited to 2 MB/);
  assert.match(migration, /\ncommit;\s*$/);
});
