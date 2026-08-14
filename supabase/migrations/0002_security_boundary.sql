-- Basecamp template — the security boundary the generated baseline cannot carry
--
-- HAND-WRITTEN — the only file here that is. Apply it immediately after
-- 0001_baseline.sql, which is a generated pg_dump squash: this file restores
-- what that dump cannot carry.
--
-- WHY IT EXISTS. `0001_baseline.sql` is produced by `pg_dump --schema-only
-- --no-owner`. `--no-owner` is necessary — your project's roles are not the
-- ones the dump was taken from — but it drops every `alter ... owner to
-- postgres`, and ownership is not cosmetic here:
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
    -- Views too. Since PG15 a view without security_invoker runs with its
    -- OWNER's rights, and the SQL Editor creates objects as postgres — so a
    -- read model added later would read straight past every policy here.
    select 'view', format('%I.%I', schemaname, viewname)
      from pg_views where schemaname = 'basecamp'
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
           not coalesce(p.proconfig @> array['search_path=""'], false) as unpinned,
           has_function_privilege('public', p.oid, 'execute') as public_exec
      from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'basecamp' and p.prosecdef
       and (p.proowner <> 'postgres'::regrole
            or not coalesce(p.proconfig @> array['search_path=""'], false)
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

  -- The trust root's own privileges. UPDATE matters as much as DELETE: there is
  -- no UPDATE policy and no BEFORE UPDATE trigger on super_admins, so one
  -- statement could reassign the roster without changing the row count — which
  -- means the last-row guard would never fire.
  if has_table_privilege('authenticated', 'basecamp.super_admins', 'insert')
     or has_table_privilege('authenticated', 'basecamp.super_admins', 'update')
     or has_table_privilege('authenticated', 'basecamp.super_admins', 'delete')
     or has_table_privilege('authenticated', 'basecamp.super_admins', 'truncate') then
    raise exception 'authenticated holds a WRITE privilege on the trust root';
  end if;
  if has_table_privilege('service_role', 'basecamp.super_admins', 'truncate')
     or has_table_privilege('service_role', 'basecamp.super_admins', 'update') then
    raise exception 'service_role holds UPDATE or TRUNCATE on the trust root';
  end if;

  -- The audit log is append-only, and that is a privilege fact as well as a
  -- trigger fact. `authenticated` must hold SELECT and nothing else: the rows
  -- are written by definer triggers, so no client ever needs INSERT.
  -- NOT wrapped in `if to_regclass(...) is not null`. 0001 always creates this
  -- table, so the conditional's only effect would be that a baseline which LOST
  -- the audit log passes silently — the assertion unable to fire in exactly the
  -- case that needs it.
  if to_regclass('basecamp.access_audit') is null then
    raise exception 'basecamp.access_audit is missing — the baseline is incomplete';
  end if;
  if true then
    if has_table_privilege('authenticated', 'basecamp.access_audit', 'insert')
       or has_table_privilege('authenticated', 'basecamp.access_audit', 'update')
       or has_table_privilege('authenticated', 'basecamp.access_audit', 'delete')
       or has_table_privilege('authenticated', 'basecamp.access_audit', 'truncate') then
      raise exception 'authenticated holds a WRITE privilege on the audit log';
    end if;
    if has_table_privilege('service_role', 'basecamp.access_audit', 'update')
       or has_table_privilege('service_role', 'basecamp.access_audit', 'delete')
       or has_table_privilege('service_role', 'basecamp.access_audit', 'truncate') then
      raise exception 'service_role can rewrite or erase the audit log';
    end if;
    if exists (select 1 from pg_policies
                where schemaname='basecamp' and tablename='access_audit'
                  and cmd in ('INSERT','UPDATE','DELETE')) then
      raise exception 'access_audit has a write policy — it must be trigger-written only';
    end if;
  end if;

  -- Guard triggers must EXIST and be ENABLED. Asserting their source text would
  -- prove nothing: `alter table ... disable trigger` leaves the definition in
  -- place while removing the protection.
  select count(*) into n from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace ns on ns.oid = c.relnamespace
   where ns.nspname='basecamp' and not t.tgisinternal and t.tgenabled <> 'D'
     and t.tgname in ('basecamp_super_admins_keep_last','basecamp_super_admins_no_truncate');
  if n <> 2 then
    raise exception 'the trust-root guards are missing or disabled (% of 2 enabled)', n;
  end if;
  if to_regclass('basecamp.access_audit') is not null then
    select count(*) into n from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      join pg_namespace ns on ns.oid = c.relnamespace
     where ns.nspname='basecamp' and not t.tgisinternal and t.tgenabled <> 'D'
       and t.tgname in ('basecamp_access_audit_no_mutation','basecamp_access_audit_no_truncate');
    if n <> 2 then
      raise exception 'the audit append-only guards are missing or disabled (% of 2 enabled)', n;
    end if;
  end if;

  -- The audit's coverage decisions, asserted so a regeneration cannot lose them.
  if has_table_privilege('authenticated','basecamp.access_grants','update')
     or has_table_privilege('authenticated','basecamp.type_grants','update') then
    raise exception 'authenticated holds UPDATE on a grant table — an unaudited re-target path';
  end if;
  if exists (select 1 from pg_policies where schemaname='basecamp'
              and tablename in ('access_grants','type_grants') and cmd='UPDATE') then
    raise exception 'an UPDATE policy survives on a grant table';
  end if;
  if has_table_privilege('service_role','basecamp.access_grants','truncate')
     or has_table_privilege('service_role','basecamp.type_grants','truncate')
     or has_table_privilege('service_role','basecamp.members','truncate')
     or has_table_privilege('service_role','basecamp.access_audit','insert') then
    raise exception 'service_role can mass-revoke without a trace, or forge audit rows';
  end if;
  if to_regclass('basecamp.access_audit') is not null then
    -- All FOUR writers plus the three TRUNCATE guards. A count, not a spot check:
    -- losing one writer is exactly the silent regression this file exists to stop.
    select count(*) into n from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      join pg_namespace ns on ns.oid = c.relnamespace
     where ns.nspname='basecamp' and not t.tgisinternal and t.tgenabled <> 'D'
       and t.tgname in ('basecamp_access_grants_audit','basecamp_type_grants_audit',
                        'basecamp_members_audit','basecamp_super_admins_audit');
    if n <> 4 then
      raise exception 'expected 4 enabled audit writers, found % — an access-changing table is unaudited', n;
    end if;
    select count(*) into n from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      join pg_namespace ns on ns.oid = c.relnamespace
     where ns.nspname='basecamp' and not t.tgisinternal and t.tgenabled <> 'D'
       and t.tgname in ('basecamp_access_grants_no_truncate','basecamp_type_grants_no_truncate',
                        'basecamp_members_no_truncate');
    if n <> 3 then
      raise exception 'expected 3 TRUNCATE guards on the audited tables, found %', n;
    end if;
    if not has_table_privilege('authenticated','basecamp.access_audit','select') then
      raise exception 'authenticated cannot SELECT the audit log — the Audit tab would never render';
    end if;
  end if;

  -- D14 — the DEFAULT ACL, not just today's tables. Naming tables can only
  -- protect the ones that exist when this file is written; the schema-wide
  -- default is what silently arms the next one. Proven: with service_role
  -- re-granted UPDATE on access_grants, a single statement re-points a grant
  -- and writes no audit row, and this file used to commit clean.
  if has_table_privilege('service_role','basecamp.access_grants','update')
     or has_table_privilege('service_role','basecamp.type_grants','update')
     or has_table_privilege('service_role','basecamp.members','update') then
    raise exception 'service_role holds UPDATE on an access table — an unaudited re-target path';
  end if;
  if exists (select 1 from pg_default_acl d
              where d.defaclnamespace = 'basecamp'::regnamespace
                and d.defaclobjtype = 'r'
                and array_to_string(d.defaclacl, ',') ~ 'service_role=[^/]*D') then
    raise exception 'the basecamp default ACL grants service_role TRUNCATE on every future table';
  end if;

  -- D16 — the definer checks above all filter on `prosecdef`, so flipping a
  -- helper to SECURITY INVOKER makes it vanish from every one of them rather
  -- than fail them. Name the functions that must be definers.
  if exists (select 1 from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
              where ns.nspname = 'basecamp' and not p.prosecdef
                and p.proname in ('is_super_admin','list_people','log_access_change',
                                  'prevent_access_truncate','prevent_audit_mutation',
                                  'prevent_last_super_admin_delete','prevent_super_admins_truncate')) then
    raise exception 'a helper that must be SECURITY DEFINER is not — it would silently escape every check above';
  end if;

  -- D17 — the writer must still WRITE. Enablement was asserted; a gutted body
  -- (`begin return null; end`) left all four triggers present and enabled while
  -- every grant went unaudited, and this file committed clean. A substring test
  -- is weak, but it is strictly better than asserting nothing about the body.
  if to_regclass('basecamp.access_audit') is not null
     and (select p.prosrc from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
           where ns.nspname = 'basecamp' and p.proname = 'log_access_change')
         not like '%insert into basecamp.access_audit%' then
    raise exception 'log_access_change no longer writes access_audit — the triggers fire and record nothing';
  end if;

  -- No view may run with owner rights.
  select count(*) into n
    from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
   -- 'v' only: a MATERIALIZED view cannot carry security_invoker at all, so
     -- including 'm' would make this assertion permanently unsatisfiable the
     -- first time anyone adds one. Matviews need their own decision, not a
     -- check nobody can pass.
   where ns.nspname = 'basecamp' and c.relkind = 'v'
     and not coalesce((select option_value::boolean from pg_options_to_table(c.reloptions)
                        where option_name = 'security_invoker'), false);
  if n <> 0 then
    raise exception '% view(s) in basecamp bypass RLS — create them WITH (security_invoker = true)', n;
  end if;

  -- ---------------------------------------------------------------------
  -- COMPLETENESS. Everything above this point asserts NEGATIVE facts —
  -- `anon` holds nothing, `service_role` does not hold UPDATE, no view runs
  -- with owner rights. Negative facts all pass vacuously on a schema that was
  -- never fully created, which is not a theoretical concern:
  --
  --   0001 shipped for a while with a PG17-only privilege in four GRANTs. On
  --   PG16 those four statements failed. psql without ON_ERROR_STOP kept going,
  --   and THIS FILE then committed and printed "security boundary asserted"
  --   against a database where service_role could not read three tables and the
  --   default ACL did not exist. Proven by execution on PostgreSQL 16.15.
  --
  -- The file's whole claim is "if it commits, the boundary holds". That claim
  -- was false whenever a 0001 statement failed silently. These checks close it:
  -- count what must exist, and assert the POSITIVE grants the app cannot run
  -- without.
  --
  -- Counts are floors (>=), not equalities. A client who adds a table should not
  -- have to edit this file; a client who is MISSING one has a broken install.
  -- ---------------------------------------------------------------------
  select count(*) into n from pg_tables where schemaname = 'basecamp';
  if n < 8 then
    raise exception 'basecamp has % table(s), expected at least 8 — 0001 did not fully apply. Re-run it with: psql -v ON_ERROR_STOP=1 --single-transaction', n;
  end if;

  select count(*) into n from pg_policies where schemaname = 'basecamp';
  if n < 26 then
    raise exception 'basecamp has % RLS policies, expected at least 26 — 0001 did not fully apply', n;
  end if;

  select count(*) into n
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'basecamp';
  if n < 13 then
    raise exception 'basecamp has % function(s), expected at least 13 — 0001 did not fully apply', n;
  end if;

  select count(*) into n
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace ns on ns.oid = c.relnamespace
   where ns.nspname = 'basecamp' and not t.tgisinternal;
  if n < 16 then
    raise exception 'basecamp has % trigger(s), expected at least 16 — 0001 did not fully apply', n;
  end if;

  -- The positive grants. Without these the app fails at runtime with
  -- `permission denied`, which reads as a code bug rather than a bad install.
  -- `authenticated` is the only role the app ever connects as.
  if not (has_table_privilege('authenticated', 'basecamp.categories',   'select')
      and has_table_privilege('authenticated', 'basecamp.member_types', 'select')
      and has_table_privilege('authenticated', 'basecamp.members',      'select')
      and has_table_privilege('authenticated', 'basecamp.access_grants','select')
      and has_table_privilege('authenticated', 'basecamp.type_grants',  'select')
      and has_table_privilege('authenticated', 'basecamp.access_audit', 'select')) then
    raise exception 'authenticated is missing SELECT on one or more basecamp tables — the admin screens cannot render';
  end if;

  -- The admin screens issue these writes directly from the browser under RLS.
  if not (has_table_privilege('authenticated', 'basecamp.access_grants', 'insert')
      and has_table_privilege('authenticated', 'basecamp.access_grants', 'delete')
      and has_table_privilege('authenticated', 'basecamp.type_grants',   'insert')
      and has_table_privilege('authenticated', 'basecamp.type_grants',   'delete')
      and has_table_privilege('authenticated', 'basecamp.members',       'insert')
      and has_table_privilege('authenticated', 'basecamp.members',       'update')
      and has_table_privilege('authenticated', 'basecamp.members',       'delete')) then
    raise exception 'authenticated is missing a write privilege the admin screens need — granting access will fail with permission denied';
  end if;

  -- Both default-ACL rows (TABLES and SEQUENCES). The TRUNCATE assertion above
  -- reads the TABLES row; if that row is absent the assertion passes on nothing.
  select count(*) into n
    from pg_default_acl d join pg_namespace ns on ns.oid = d.defaclnamespace
   where ns.nspname = 'basecamp';
  if n < 2 then
    raise exception 'basecamp has % default-ACL row(s), expected 2 — 0001 did not fully apply, and the TRUNCATE default-privilege assertion above passed vacuously', n;
  end if;

  raise notice 'security boundary asserted: schema complete, owners pinned, definers hardened, anon shut out, app grants present, trust-root and audit privileges and guards verified, no owner-rights views';
end $$;

commit;

-- NEXT: create the first administrator. There is no bootstrap function — see
-- supabase/README.md, steps 2 and 3.
