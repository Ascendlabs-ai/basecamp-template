-- Basecamp template — the security boundary the generated baseline cannot carry
--
-- HAND-WRITTEN, and one of only two files in this directory that is. It is on
-- the §6 diff allowlist for exactly that reason: the equivalence check between
-- the migrations lineage and the template set must expect this file to differ.
--
-- WHY IT EXISTS. `0001_baseline.sql` is produced by `pg_dump --schema-only
-- --no-owner`. `--no-owner` is necessary — a client project's roles are not
-- the client project's own — but it drops every `alter ... owner to postgres`, and ownership
-- is not cosmetic here:
--
--   * A SECURITY DEFINER function runs as its OWNER. `is_super_admin()`,
--     `has_grant()` and friends must read `basecamp.access_grants` and
--     `basecamp.super_admins` past RLS, which is precisely what being owned by
--     `postgres` buys. Owned by anyone else, they read as that role.
--   * The trust-root policies call `is_super_admin()`, which reads the trust
--     root. That is safe ONLY because the table owner bypasses RLS. Probed on a
--     mirror: with the definer owned by a role that neither owns the table nor
--     holds BYPASSRLS, an authenticated read gives `54001 stack depth limit
--     exceeded` — infinite policy recursion, presenting as a server error
--     rather than an auth failure.
--
-- So functions and tables must be owned by the SAME superuser role. Pinning one
-- and not the other is worse than pinning neither.
--
-- APPLY THIS IMMEDIATELY AFTER 0001_baseline.sql, before creating any user.
--
-- Idempotent: run it as many times as you like.

begin;

-- ---------------------------------------------------------------------------
-- 1. Ownership. Everything in `basecamp`, in one sweep, so a table or function
--    added later cannot be missed by a hand-maintained list.
-- ---------------------------------------------------------------------------
do $$
declare
  obj record;
begin
  for obj in
    select 'table' as kind, format('%I.%I', schemaname, tablename) as ident
      from pg_tables where schemaname = 'basecamp'
    union all
    select 'function', format('%I.%I(%s)', ns.nspname, p.proname, pg_get_function_identity_arguments(p.oid))
      from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'basecamp'
  loop
    execute format('alter %s %s owner to postgres', obj.kind, obj.ident);
  end loop;
end $$;

alter schema basecamp owner to postgres;

-- ---------------------------------------------------------------------------
-- 2. EXECUTE grants. `--no-owner` keeps GRANTs, so the baseline should already
--    carry these — but a `revoke ... from public` that was never dumped, or a
--    function created fresh rather than replaced, defaults to PUBLIC=EXECUTE,
--    and PUBLIC includes `anon`. Re-asserted rather than assumed.
-- ---------------------------------------------------------------------------
do $$
declare
  fn record;
begin
  for fn in
    select format('%I.%I(%s)', ns.nspname, p.proname,
                  pg_get_function_identity_arguments(p.oid)) as ident
      from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'basecamp' and p.prosecdef
  loop
    execute format('revoke execute on function %s from public', fn.ident);
    execute format('grant execute on function %s to authenticated, service_role', fn.ident);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Post-conditions. The point of this file is that the boundary is ASSERTED,
--    not described — the README used to promise post-conditions that did not
--    exist anywhere.
-- ---------------------------------------------------------------------------
do $$
declare
  n integer; detail text := '';
  bad record;
begin
  -- Every basecamp table: postgres-owned, RLS on, FORCE off (FORCE would make
  -- the definer helpers recurse against their own policies).
  for bad in
    select c.relname,
           c.relowner <> 'postgres'::regrole as wrong_owner,
           not c.relrowsecurity              as rls_off,
           c.relforcerowsecurity             as force_on
      from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
     where ns.nspname = 'basecamp' and c.relkind = 'r'
       and (c.relowner <> 'postgres'::regrole or not c.relrowsecurity or c.relforcerowsecurity)
  loop
    detail := detail || format(E'\n    %s: wrong_owner=%s rls_off=%s force_on=%s',
                               bad.relname, bad.wrong_owner, bad.rls_off, bad.force_on);
  end loop;
  if detail <> '' then
    raise exception 'basecamp tables are not correctly secured:%', detail;
  end if;

  -- Every definer function: postgres-owned, search_path pinned, no PUBLIC exec.
  for bad in
    select p.proname,
           p.proowner <> 'postgres'::regrole                as wrong_owner,
           not (p.proconfig @> array['search_path=""'])     as unpinned,
           has_function_privilege('public', p.oid, 'execute') as public_exec
      from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'basecamp' and p.prosecdef
       and (p.proowner <> 'postgres'::regrole
            or not (p.proconfig @> array['search_path=""'])
            or has_function_privilege('public', p.oid, 'execute'))
  loop
    detail := detail || format(E'\n    %s: wrong_owner=%s unpinned_search_path=%s public_execute=%s',
                               bad.proname, bad.wrong_owner, bad.unpinned, bad.public_exec);
  end loop;
  if detail <> '' then
    raise exception 'basecamp definer functions are not correctly secured:%', detail;
  end if;

  -- anon must hold nothing anywhere in the schema.
  if has_schema_privilege('anon', 'basecamp', 'usage') then
    raise exception 'anon holds USAGE on schema basecamp';
  end if;
  select count(*) into n from pg_policies
   where schemaname = 'basecamp' and roles && array['anon','public']::name[];
  if n <> 0 then
    raise exception '% basecamp policies name anon or public', n;
  end if;

  -- The app role must actually be able to reach the schema, or the install is
  -- dead on arrival — this is the failure `--no-privileges` used to cause.
  if not has_schema_privilege('authenticated', 'basecamp', 'usage') then
    raise exception 'authenticated has no USAGE on schema basecamp — every request would fail permission denied';
  end if;
  if not has_table_privilege('authenticated', 'basecamp.entries', 'select') then
    raise exception 'authenticated cannot SELECT basecamp.entries — the catalog would never render';
  end if;

  raise notice 'security boundary asserted: owners pinned, definers hardened, anon shut out, app role able to reach the schema';
end $$;

commit;

-- NEXT: create the first administrator. There is no bootstrap function — see
-- supabase/template/README.md, "The first administrator on a client project".
