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
--
-- THIS FILE HAS KNOWN GAPS. It commits on several database states that break
-- invariants it claims to hold — among them a widened policy, a repointed or
-- added audit trigger, a gutted guard body, an ungated `list_people()`, a
-- rewrite rule that voids the audit log, and an owner-rights object in another
-- schema that reads straight past every policy here. None is reachable by an
-- ordinary signed-in user or a service-role API key. They are enumerated in
-- issues.md, "Known gaps in the security boundary". A clean run means every
-- check below passed, not that the boundary is airtight.

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
  -- REVOKE from PUBLIC on ALL definer functions; GRANT to `authenticated` only
  -- on the CALLABLE ones.
  --
  -- Granting the six definer TRIGGER functions to `authenticated` was an
  -- escalation, not a convenience, and it was PROVEN end to end: a role holding
  -- `authenticated` plus CREATE on any schema could create its own table named
  -- `type_grants`, attach `basecamp.log_access_change()` to it, and have forged
  -- rows written into the append-only audit log AS `postgres` — while a direct
  -- INSERT from the same session is refused. `CREATE TRIGGER` exercises EXECUTE,
  -- and that privilege check is the only thing standing in the way.
  --
  -- Nothing needs to call a trigger function by name: PostgreSQL refuses direct
  -- invocation ("trigger functions can only be called as triggers"), and the
  -- trigger machinery does not consult EXECUTE — verified by firing every guard
  -- after the revoke.
  for fn in
    select format('%I.%I(%s)', ns.nspname, p.proname,
                  pg_get_function_identity_arguments(p.oid)) as ident,
           p.prorettype = 'pg_catalog.trigger'::regtype as is_trigger_fn
      from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'basecamp' and p.prosecdef
  loop
    execute format('revoke execute on function %s from public', fn.ident);
    if fn.is_trigger_fn then
      execute format('revoke execute on function %s from authenticated, service_role', fn.ident);
    else
      execute format('grant execute on function %s to authenticated, service_role', fn.ident);
    end if;
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
     where ns.nspname = 'basecamp' and c.relkind in ('r','p')  -- pg_tables counts partitioned tables too
       and (c.relowner <> 'postgres'::regrole or not c.relrowsecurity or c.relforcerowsecurity)
  loop
    detail := detail || format(E'\n    %s: wrong_owner=%s rls_off=%s force_on=%s',
                               bad.relname, bad.wrong_owner, bad.rls_off, bad.force_on);
  end loop;
  if detail <> '' then
    raise exception 'basecamp tables are not correctly secured:%', detail;
  end if;

  -- Every definer function: postgres-owned, search_path pinned, no PUBLIC exec.
  detail := '';
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
  if has_any_column_privilege('authenticated', 'basecamp.super_admins', 'insert')
     or has_any_column_privilege('authenticated', 'basecamp.super_admins', 'update')
     or has_table_privilege('authenticated', 'basecamp.super_admins', 'delete')
     or has_table_privilege('authenticated', 'basecamp.super_admins', 'truncate') then
    raise exception 'authenticated holds a WRITE privilege on the trust root';
  end if;
  if has_table_privilege('service_role', 'basecamp.super_admins', 'truncate')
     or has_any_column_privilege('service_role', 'basecamp.super_admins', 'update') then
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
    if has_any_column_privilege('authenticated', 'basecamp.access_audit', 'insert')
       or has_any_column_privilege('authenticated', 'basecamp.access_audit', 'update')
       or has_table_privilege('authenticated', 'basecamp.access_audit', 'delete')
       or has_table_privilege('authenticated', 'basecamp.access_audit', 'truncate') then
      raise exception 'authenticated holds a WRITE privilege on the audit log';
    end if;
    if has_any_column_privilege('service_role', 'basecamp.access_audit', 'update')
       or has_table_privilege('service_role', 'basecamp.access_audit', 'delete')
       or has_table_privilege('service_role', 'basecamp.access_audit', 'truncate') then
      raise exception 'service_role can rewrite or erase the audit log';
    end if;
    if exists (select 1 from pg_policies
                where schemaname='basecamp' and tablename='access_audit'
                  and cmd in ('INSERT','UPDATE','DELETE','ALL')) then
      raise exception 'access_audit has a write policy — it must be trigger-written only';
    end if;
  end if;

  -- Guard triggers must EXIST, be ATTACHED TO THE RIGHT TABLE, and be ENABLED
  -- FOR ORIGIN traffic. All three, because the weaker forms were PROVEN
  -- defeatable: `tgenabled <> 'D'` accepted 'R' (replica), which fires only
  -- under session_replication_role='replica' — never for application traffic;
  -- and counting `tgname` without the table let a same-named decoy on another
  -- table restore the count while the real guard was gone.
  detail := '';
  for bad in
    select t.tbl, t.trg from (values
      ('super_admins','basecamp_super_admins_keep_last'),
      ('super_admins','basecamp_super_admins_no_truncate'),
      ('access_audit','basecamp_access_audit_no_mutation'),
      ('access_audit','basecamp_access_audit_no_truncate'),
      ('access_grants','basecamp_access_grants_audit'),
      ('type_grants','basecamp_type_grants_audit'),
      ('members','basecamp_members_audit'),
      ('super_admins','basecamp_super_admins_audit'),
      ('access_grants','basecamp_access_grants_no_truncate'),
      ('type_grants','basecamp_type_grants_no_truncate'),
      ('members','basecamp_members_no_truncate')
    ) as t(tbl, trg)
  loop
    if not exists (
      select 1 from pg_trigger tg
        join pg_class c on c.oid = tg.tgrelid
        join pg_namespace ns on ns.oid = c.relnamespace
       where ns.nspname = 'basecamp' and not tg.tgisinternal
         and c.relname = bad.tbl and tg.tgname = bad.trg
         and tg.tgenabled in ('O','A')
    ) then
      detail := detail || format(E'\n    %s on %s', bad.trg, bad.tbl);
    end if;
  end loop;
  if detail <> '' then
    raise exception 'guard trigger(s) missing, attached to the wrong table, or not enabled for origin traffic:%', detail;
  end if;

  -- The audit's coverage decisions, asserted so a regeneration cannot lose them.
  if has_any_column_privilege('authenticated','basecamp.access_grants','update')
     or has_any_column_privilege('authenticated','basecamp.type_grants','update') then
    raise exception 'authenticated holds UPDATE on a grant table — an unaudited re-target path';
  end if;
  if exists (select 1 from pg_policies where schemaname='basecamp'
              and tablename in ('access_grants','type_grants') and cmd in ('UPDATE','ALL')) then
    raise exception 'an UPDATE policy survives on a grant table';
  end if;
  if has_table_privilege('service_role','basecamp.access_grants','truncate')
     or has_table_privilege('service_role','basecamp.type_grants','truncate')
     or has_table_privilege('service_role','basecamp.members','truncate')
     or has_any_column_privilege('service_role','basecamp.access_audit','insert') then
    raise exception 'service_role can mass-revoke without a trace, or forge audit rows';
  end if;
  if to_regclass('basecamp.access_audit') is not null then
    -- All FOUR writers plus the three TRUNCATE guards. A count, not a spot check:
    -- losing one writer is exactly the silent regression this file exists to stop.
    select count(*) into n from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      join pg_namespace ns on ns.oid = c.relnamespace
     where ns.nspname='basecamp' and not t.tgisinternal and t.tgenabled in ('O','A')
       and t.tgname in ('basecamp_access_grants_audit','basecamp_type_grants_audit',
                        'basecamp_members_audit','basecamp_super_admins_audit');
    if n <> 4 then
      raise exception 'expected 4 enabled audit writers, found % — an access-changing table is unaudited', n;
    end if;
    select count(*) into n from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      join pg_namespace ns on ns.oid = c.relnamespace
     where ns.nspname='basecamp' and not t.tgisinternal and t.tgenabled in ('O','A')
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
  if has_any_column_privilege('service_role','basecamp.access_grants','update')
     or has_any_column_privilege('service_role','basecamp.type_grants','update')
     or has_any_column_privilege('service_role','basecamp.members','update') then
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
                                  'prevent_last_super_admin_delete','prevent_super_admins_truncate',
                                  -- The five that were missing. PROVEN: flipping
                                  -- has_grant to INVOKER passed this check while
                                  -- the helper lost its RLS bypass and vanished
                                  -- from every prosecdef-filtered check above.
                                  'prevent_system_type_delete','has_grant',
                                  'category_has_grant','can_read_entry',
                                  'can_read_category')) then
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

  -- Each of these gaps was PROVEN by execution against an earlier draft of THIS
  -- file — see supabase/tests/boundary_mutations.sh, which re-proves them.
  if not (has_table_privilege('service_role', 'basecamp.access_grants', 'select')
      and has_table_privilege('service_role', 'basecamp.type_grants',   'select')
      and has_table_privilege('service_role', 'basecamp.members',       'select')
      and has_table_privilege('service_role', 'basecamp.super_admins',  'select')
      and has_table_privilege('service_role', 'basecamp.super_admins',  'insert')
      and has_table_privilege('service_role', 'basecamp.super_admins',  'delete')) then
    raise exception 'service_role is missing SELECT on an access table, or the INSERT/DELETE the break-glass path needs on the trust root — 0001 did not fully apply';
  end if;

  if not exists (
    select 1 from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'basecamp' and p.proname = 'is_super_admin'
       and position('basecamp.super_admins' in p.prosrc) > 0
       and position('auth.uid()'            in p.prosrc) > 0
  ) then
    raise exception 'is_super_admin() no longer reads basecamp.super_admins keyed on auth.uid() — the trust root has moved or been stubbed';
  end if;

  -- COUNT FLOORS + NAMED OBJECTS. An earlier version of this file
  -- had NO completeness floors at all, so a dropped policy, function or trigger
  -- passed silently — and every negative privilege assertion below it passed
  -- vacuously, which is the founding defect this whole file was revised to fix.
  select count(*) into n from pg_tables where schemaname = 'basecamp';
  if n < 8 then
    raise exception 'basecamp has % table(s), expected at least 8 — 0001 did not fully apply. On PostgreSQL 15/16, check first for PG17-only constructs in 0001 (MAINTAIN grants, SET transaction_timeout); then re-run with: psql -v ON_ERROR_STOP=1 --single-transaction', n;
  end if;
  select count(*) into n from pg_policies where schemaname = 'basecamp';
  if n < 26 then
    raise exception 'basecamp has % RLS policies, expected at least 26 — access is enforced ENTIRELY by policy, so a missing policy is a missing access rule', n;
  end if;
  select count(*) into n from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'basecamp';
  if n < 13 then
    raise exception 'basecamp has % function(s), expected at least 13', n;
  end if;
  select count(*) into n from pg_trigger tg
    join pg_class c on c.oid = tg.tgrelid
    join pg_namespace ns on ns.oid = c.relnamespace
   where ns.nspname = 'basecamp' and not tg.tgisinternal;
  if n < 16 then
    raise exception 'basecamp has % trigger(s), expected at least 16', n;
  end if;

  detail := '';
  for bad in
    select unnest(array['access_audit','access_grants','categories','entries',
                        'member_types','members','super_admins','type_grants']) as t
  loop
    if to_regclass('basecamp.' || quote_ident(bad.t)) is null then
      detail := detail || format(E'\n    %s', bad.t);
    end if;
  end loop;
  if detail <> '' then
    raise exception 'basecamp is missing required table(s):%', detail;
  end if;

  -- Both default-ACL rows, BY OBJECT TYPE. A bare count of 2 is satisfied by a
  -- SEQUENCES row plus a FUNCTIONS row while the TABLES row — the only one the
  -- TRUNCATE assertion reads — is absent, so that assertion passes on nothing.
  if not exists (select 1 from pg_default_acl d join pg_namespace ns on ns.oid = d.defaclnamespace
                  where ns.nspname = 'basecamp' and d.defaclobjtype = 'r') then
    raise exception 'the basecamp TABLES default-ACL row is absent — the TRUNCATE default-privilege assertion would pass vacuously';
  end if;
  if not exists (select 1 from pg_default_acl d join pg_namespace ns on ns.oid = d.defaclnamespace
                  where ns.nspname = 'basecamp' and d.defaclobjtype = 'S') then
    raise exception 'the basecamp SEQUENCES default-ACL row is absent';
  end if;

  -- Default privileges by GRANTEE and PRIVILEGE. Only service_role may hold a
  -- default here, and never TRUNCATE on tables.
  detail := '';
  for bad in
    select d.defaclobjtype,
           case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end as who,
           a.privilege_type
      from pg_default_acl d
      join pg_namespace ns on ns.oid = d.defaclnamespace
      cross join lateral aclexplode(d.defaclacl) a
     where ns.nspname = 'basecamp'
       and (a.grantee = 0
            or a.grantee::regrole::text <> 'service_role'
            or (d.defaclobjtype = 'r' and a.privilege_type = 'TRUNCATE'))
  loop
    detail := detail || format(E'\n    objtype=%s: %s would hold %s on every future object',
                               bad.defaclobjtype, bad.who, bad.privilege_type);
  end loop;
  if detail <> '' then
    raise exception 'a basecamp default privilege would arm an unintended grant on objects nobody has created yet:%', detail;
  end if;

  -- POSITIVE write grants the admin screens need. Without these the app fails
  -- at runtime with `permission denied`, which reads as a code bug.
  if not (has_table_privilege('authenticated', 'basecamp.access_grants', 'insert')
      and has_table_privilege('authenticated', 'basecamp.access_grants', 'delete')
      and has_table_privilege('authenticated', 'basecamp.type_grants',   'insert')
      and has_table_privilege('authenticated', 'basecamp.type_grants',   'delete')
      and has_table_privilege('authenticated', 'basecamp.members',       'insert')
      and has_table_privilege('authenticated', 'basecamp.members',       'update')
      and has_table_privilege('authenticated', 'basecamp.members',       'delete')
      and has_table_privilege('authenticated', 'basecamp.categories',    'insert')
      and has_table_privilege('authenticated', 'basecamp.entries',       'insert')
      and has_table_privilege('authenticated', 'basecamp.member_types',  'insert')) then
    raise exception 'authenticated is missing a write privilege the admin screens need — granting access would fail with permission denied';
  end if;

  -- FUNCTION ACLs by principal. PUBLIC only matters on a definer function
  -- (an invoker function runs as the caller, and PUBLIC EXECUTE is the language
  -- default); any NAMED principal outside the three roles matters always.
  detail := '';
  for bad in
    select p.proname,
           case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end as who,
           a.privilege_type
      from pg_proc p
      join pg_namespace ns on ns.oid = p.pronamespace
      cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
     where ns.nspname = 'basecamp'
       and ((a.grantee = 0 and p.prosecdef)
            or (a.grantee <> 0
                and a.grantee::regrole::text not in ('postgres','authenticated','service_role')))
  loop
    detail := detail || format(E'\n    %s: %s holds %s', bad.proname, bad.who, bad.privilege_type);
  end loop;
  if detail <> '' then
    raise exception 'an unexpected principal holds EXECUTE inside basecamp:%', detail;
  end if;

  -- ACCESS-HELPER BODIES. An earlier version of this file asserted NOTHING
  -- about five of the six functions that decide
  -- access — and `category_has_grant -> select true` alone makes the entire
  -- catalog readable by any signed-in user while this file prints "boundary
  -- asserted". PROVEN against an earlier draft of this file.
  detail := '';
  for bad in
    select p.proname, p.prosrc
      from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'basecamp'
       and p.proname in ('has_grant','category_has_grant','can_read_entry',
                         'can_read_category','list_people')
  loop
    if bad.prosrc !~ 'basecamp\.(access_grants|type_grants|members|entries|categories|super_admins)'
       and bad.prosrc !~ 'basecamp\.(is_super_admin|has_grant|category_has_grant|can_read_entry|can_read_category)'
       and bad.prosrc !~ 'auth\.users' then
      detail := detail || format(E'\n    %s', bad.proname);
    end if;
  end loop;
  if detail <> '' then
    raise exception 'access helper(s) no longer read any access table — a stubbed body returns a constant for every caller:%', detail;
  end if;

  -- BODY DIGESTS. A substring test is defeated by a SQL COMMENT: PROVEN,
  -- `is_super_admin` rewritten `select true /* basecamp.super_admins auth.uid() */`
  -- satisfies every position() check and makes EVERY caller an administrator.
  --
  -- Unlike the policy set — which you legitimately change — these six bodies
  -- ship IDENTICALLY to every stamp of this template, from its own 0001.
  -- So pinning them is exact here too, and any change fails until someone
  -- re-derives the digest, which forces the new body to be read.
  --
  -- If you deliberately change one, re-derive with:
  --   select proname, md5(prosrc) from pg_proc p
  --     join pg_namespace n on n.oid = p.pronamespace
  --    where n.nspname = 'basecamp' and proname = '<fn>';
  detail := '';
  for bad in
    select f.fn from (values
      ('is_super_admin',    '86dc2c53cadb930549083637a031e613'),
      ('has_grant',         '38ada0b645e837604441d462ed96c17e'),
      ('category_has_grant','6397e2fecbe9717e46473fdddd163ab9'),
      ('can_read_entry',    'b725d5ed56514e1b7d4946d4afa5e926'),
      ('can_read_category', '77ac78aa90567fcd5ac6891451605dfa'),
      ('log_access_change', '41d5a7b6ab0dc5b4cda44d794d729a7e')
    ) as f(fn, expected)
    where not exists (
      select 1 from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
       where ns.nspname = 'basecamp' and p.proname = f.fn and md5(p.prosrc) = f.expected)
  loop
    detail := detail || format(E'\n    %s', bad.fn);
  end loop;
  if detail <> '' then
    raise exception 'an access-model function body differs from the one this template ships — READ the new body before re-deriving its digest:%', detail;
  end if;

  -- `auth.uid` is deliberately absent from this alternation: a policy rewritten
  -- `using (auth.uid() is not null)` names it and grants every signed-in user
  -- everything. No digest pin on the policy SET, unlike the six function bodies
  -- above — your policy set legitimately differs, so this is a floor, not an
  -- equality.
  --
  -- READ THIS BEFORE ADDING A POLICY. The floor applies to EVERY policy in the
  -- schema, including ones on tables you add yourself. A textbook own-row rule —
  -- `using (user_id = auth.uid())` on your own new table — names none of these
  -- helpers and is REFUSED, with a message calling your strictest predicate a
  -- permit-all. That is wrong and it is a known defect, not a rule you should
  -- work around: see issues.md, "Known gaps in the security boundary". The
  -- floor is also weaker than it looks in the other direction — appending
  -- `or auth.uid() is not null` to a policy that already names a helper passes
  -- here and opens the whole catalog. Both are recorded there.
  select count(*) into n
    from pg_policies
   where schemaname = 'basecamp'
     and (coalesce(qual, '') || coalesce(with_check, '')
          !~ 'is_super_admin|category_has_grant|has_grant|can_read_entry|can_read_category'
          -- `or true` names an allowed helper and still permits everything, so
          -- a mention test alone is not enough.
          --
          -- NOTE THE SINGLE BACKSLASH. An earlier version of this line wrote
          -- '\\mtrue\\M', which in a standard-conforming string literal is a
          -- literal backslash followed by 'm' — so the regex searched for the
          -- TEXT `\mtrue\M` and never matched anything. It shipped looking
          -- correct and asserting nothing, and was caught only by executing it.
          or coalesce(qual, '') || coalesce(with_check, '') ~ '\mtrue\M');
  if n <> 0 then
    raise exception '% basecamp polic(ies) do not consult the access model — a permit-all predicate', n;
  end if;

  if exists (select 1 from pg_policies
              where schemaname = 'basecamp' and tablename = 'super_admins'
                and cmd in ('UPDATE','ALL')) then
    raise exception 'an UPDATE policy exists on the trust root — the roster must be add/remove only';
  end if;

  -- No role other than the owner may hold EXECUTE on a definer TRIGGER function.
  detail := '';
  for bad in
    select p.proname,
           case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end as who
      from pg_proc p
      join pg_namespace ns on ns.oid = p.pronamespace
      cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
     where ns.nspname = 'basecamp' and p.prosecdef
       and p.prorettype = 'pg_catalog.trigger'::regtype
       and a.privilege_type = 'EXECUTE'
       and a.grantee <> p.proowner
  loop
    detail := detail || format(E'\n    %s: %s holds EXECUTE', bad.proname, bad.who);
  end loop;
  if detail <> '' then
    raise exception 'a definer TRIGGER function is executable by someone other than its owner — CREATE TRIGGER would exercise that grant and run it as the owner:%', detail;
  end if;

  detail := '';
  for bad in
    select c.relname || '.' || att.attname as obj,
           case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end as who,
           a.privilege_type
      from pg_attribute att
      join pg_class c on c.oid = att.attrelid
      join pg_namespace ns on ns.oid = c.relnamespace
      cross join lateral aclexplode(att.attacl) a
     where ns.nspname = 'basecamp' and att.attacl is not null
       and (a.grantee = 0
            or a.grantee::regrole::text not in ('postgres','authenticated','service_role'))
    union all
    select 'schema basecamp',
           case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end,
           a.privilege_type
      from pg_namespace ns
      cross join lateral aclexplode(coalesce(ns.nspacl, acldefault('n', ns.nspowner))) a
     where ns.nspname = 'basecamp'
       and (a.grantee = 0
            or a.grantee::regrole::text not in ('postgres','authenticated','service_role')
            or (a.privilege_type = 'CREATE' and a.grantee <> ns.nspowner))
  loop
    detail := detail || format(E'\n    %s: %s holds %s', bad.obj, bad.who, bad.privilege_type);
  end loop;
  if detail <> '' then
    raise exception 'an unexpected principal holds a COLUMN or SCHEMA privilege inside basecamp:%', detail;
  end if;

  select count(*) into n
    from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
   where ns.nspname = 'basecamp' and c.relkind = 'm';
  if n <> 0 then
    raise exception '% materialized view(s) in basecamp — a matview cannot carry security_invoker, so it is an unconditional RLS bypass', n;
  end if;

  raise notice 'security boundary asserted: owners pinned, definers hardened, anon shut out, trust-root and audit privileges and guards verified, no owner-rights views, app role able to reach the schema';
end $$;

commit;

-- NEXT: create the first administrator. There is no bootstrap function — see
-- supabase/README.md, steps 2 and 3.
