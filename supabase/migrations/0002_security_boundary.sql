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
-- added audit trigger, a gutted guard body, and a rewrite rule that voids the
-- audit log. None is reachable by an ordinary signed-in user or a service-role
-- API key. They are enumerated in issues.md, "Known gaps in the security
-- boundary". A clean run means every check below passed, not that the boundary
-- is airtight.

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
  -- escalation, not a convenience, and it was PROVEN end to end: holding EXECUTE
  -- on one of them was enough for an ordinary signed-in role to get that function
  -- to run with its owner's rights and write rows into the append-only audit log
  -- AS `postgres` — while a direct INSERT from the same session is refused.
  -- `CREATE TRIGGER` exercises EXECUTE, and that privilege check is the only
  -- thing standing in the way. The steps are deliberately not written out here:
  -- this is a public template, and the technique is not specific to it.
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

  -- THE SCHEMA BOUNDARY IS NOT THE SECURITY BOUNDARY. Every other check in this
  -- file filters `nspname = 'basecamp'`, which quietly assumes an attacker's
  -- object would be inside the schema it protects. It need not be, and the most
  -- likely case is not hostile at all:
  --
  --   create function public.all_entries() returns setof basecamp.entries
  --     language sql security definer set search_path='' as
  --     $x$ select * from basecamp.entries $x$;
  --   grant execute on function public.all_entries() to authenticated;
  --
  -- PROVEN on PG16 and PG17: a signed-in user with ZERO grants reads 0 rows from
  -- `basecamp.entries` directly and the whole catalog through that helper, while
  -- this file printed "security boundary asserted". A definer helper is the
  -- standard advice for policy recursion, and the SQL Editor creates it owned by
  -- `postgres` — the very role section 1 pins as owner of every basecamp table,
  -- so it bypasses RLS by construction. Views are the same story: a plain
  -- `create view public.x as select * from basecamp.entries` runs with owner
  -- rights, and a MATERIALIZED view cannot carry security_invoker at all.
  --
  -- HOW IT LOOKS, and why each clause is there. The first draft of this check
  -- used `prosrc ~ 'basecamp'` plus an EXECUTE test, and review defeated it FIVE
  -- ways, every one proven end to end with a zero-grant signed-in user reading
  -- the catalog while this file printed "security boundary asserted":
  --
  --   1. `BEGIN ATOMIC` bodies. prosrc is EMPTY for a SQL-standard-body function
  --      — the body lives in prosqlbody — so the regex saw nothing. This is the
  --      worst of the five: BEGIN ATOMIC is the MODERN RECOMMENDED form, immune
  --      to search_path attacks, so the most careful author evaded the check.
  --      Caught now by pg_depend, which only these functions record.
  --   2. `set search_path='basecamp'` with an unqualified body (`from entries`).
  --      The text never contains the word. Caught now by reading proconfig.
  --   3. `BASECAMP.entries`. prosrc keeps raw text and `~` is case-sensitive.
  --      Hence `~*`.
  --   4. An owner that merely INHERITS from postgres. The RLS owner-exemption
  --      uses has_privs_of_role, so a member bypasses without being superuser or
  --      BYPASSRLS. Hence pg_has_role rather than `= 'postgres'::regrole`.
  --   5. Indirection and trigger functions. The reachability test was
  --      `has_function_privilege(...,'execute')`, which is wrong twice over: a
  --      wrapper reachable by authenticated can read a NO-GRANT view that reads
  --      basecamp, and the trigger machinery does not consult EXECUTE at all —
  --      a fact section 2 of this very file already states in prose. Both
  --      filters are gone. An owner-rights object that reads basecamp is a
  --      finding whether or not today's grants make it reachable, because a
  --      grant is one statement away.
  --
  -- The view arm no longer text-matches pg_get_viewdef either. That function
  -- deparses against the CALLER's search_path, so one `alter role postgres set
  -- search_path = basecamp, public` printed `FROM entries` and silently disabled
  -- the whole arm — no attacker required. pg_depend is search_path-independent.
  --
  -- SCOPE, STATED HONESTLY — and narrower than the first draft claimed. Three
  -- kinds of object are still missed: a body that builds the reference with
  -- dynamic SQL (`execute 'select * from basecamp.entries'`), which records no
  -- dependency and need not contain the word; a definer INSIDE basecamp beyond
  -- the digest-pinned seven, because this block excludes that schema and nothing
  -- else enumerates it; and anything reached through a chain this file cannot
  -- see. The first draft said "no catalog query can close that" about the whole
  -- class, which was false — four of the five defeats above were closed by
  -- catalog queries. Only genuine dynamic SQL is out of reach.
  --
  -- Deliberately FAIL-CLOSED on text: a definer merely mentioning `basecamp` in
  -- a comment or a string literal is reported. That is a false positive by
  -- design; the message says so and tells the reader how to clear it.
  -- FOLLOW THE DATA, NOT THE OBJECT KIND. A second review round defeated the
  -- kind-by-kind version three more times, each a single hop in `public` with no
  -- access to `basecamp` at all:
  --
  --   * a definer function selecting from a `security_invoker` VIEW over
  --     basecamp. The view is safe alone — and was a NEGATIVE CONTROL in the
  --     suite, so the harness blessed the enabling step. It stops being safe the
  --     instant an owner-rights caller reads it, because `security_invoker`
  --     resolves as the CURRENT user and inside a definer that user is postgres;
  --   * a MATERIALIZED view over that same invoker view — its only rewrite edge
  --     points at the view, not at basecamp;
  --   * a REWRITE RULE on an ordinary TABLE. `relkind in ('v','m')` threw that
  --     row away, and the dependency edge proving it was already being computed
  --     by the query doing the throwing;
  --   * legacy table INHERITANCE — a child's RLS is not applied when it is
  --     scanned through the parent.
  --
  -- Enumerating shapes loses to whoever thinks of the next shape. So this walks
  -- the DEPENDENCY GRAPH transitively instead: seed with every relation in
  -- basecamp, then close over rewrite-rule edges (which cover views, matviews
  -- AND rules on plain tables, uniformly) and inheritance edges. Anything the
  -- closure reaches outside basecamp can surface basecamp rows, whatever kind of
  -- object it happens to be.
  --
  -- `security_invoker` is deliberately NOT an exemption any more, and that is a
  -- real trade-off: an invoker view over basecamp is genuinely safe on its own,
  -- and a client who adds one for convenience now gets refused. It is reported
  -- because safety depends on every future caller, which this file cannot see.
  --
  -- SCOPE, STATED HONESTLY — measured, not asserted. Still missed: a body that
  -- builds the reference with DYNAMIC SQL; a FOREIGN TABLE, which names its
  -- target remotely rather than through the catalog; and any definer INSIDE
  -- basecamp beyond the digest-pinned seven, since this block excludes that
  -- schema and section 2 grants such a function EXECUTE to `authenticated`.
  -- All three are recorded in issues.md.
  --
  -- Two earlier drafts of THIS paragraph each claimed a smaller gap than the
  -- code had, and both claims were falsified within minutes of being written —
  -- the first said no catalog query could close the class (four of five defeats
  -- were closed by catalog queries), the second said only dynamic SQL was out of
  -- reach (three more one-hop indirections were not). Treat the list above as
  -- what survived attack on the day it was written, not as a proof of
  -- completeness, and re-attack it before trusting it.
  detail := '';
  for bad in
    with recursive edges(src, dst) as (
        -- `dst` can surface rows of `src`: any rewrite rule of dst reads src.
        -- Covers views, matviews and rules on ordinary tables in one shape.
        select d.refobjid, rw.ev_class
          from pg_depend d
          join pg_rewrite rw on rw.oid = d.objid
         where d.classid = 'pg_rewrite'::regclass
           and d.refclassid = 'pg_class'::regclass
           and rw.ev_class <> d.refobjid
      union all
        select i.inhrelid, i.inhparent from pg_inherits i
    ),
    tainted(oid) as (
        select c.oid from pg_class c
          join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'basecamp'
      union
        select e.dst from edges e join tainted t on t.oid = e.src
    ),
    -- FUNCTIONS carry the taint too, and this is the third round's lesson. The
    -- relation closure alone missed a definer that reaches basecamp through
    -- ANOTHER FUNCTION: `public.rows_()` (plain INVOKER, names basecamp) wrapped
    -- by `public.catalog_()` (definer, names only `rows_`). Arm A skipped the
    -- inner one for not being a definer and the outer one for not naming
    -- basecamp. PROVEN, and not depth-limited — a 3-hop chain worked.
    --
    -- The second leg is a NAME fixpoint, not a dependency one, because non-atomic
    -- `sql` and `plpgsql` bodies record no pg_depend rows at all — the same fact
    -- that made prosrc necessary alongside pg_depend in arm A. It is therefore a
    -- heuristic: it over-matches a function whose body merely contains a tainted
    -- function's NAME. Measured on a realistic Supabase surface plus a client app
    -- schema: zero false positives.
    tfn(oid, nm) as (
        select p.oid, p.proname
          from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname not in ('pg_catalog', 'information_schema')
           and (p.prosrc ~* '\mbasecamp\M'
             or exists (select 1 from pg_depend d
                         where d.classid = 'pg_proc'::regclass and d.objid = p.oid
                           and d.refclassid = 'pg_class'::regclass
                           and d.refobjid in (select oid from tainted)))
      union
        select p2.oid, p2.proname
          from pg_proc p2 join pg_namespace n2 on n2.oid = p2.pronamespace
          join tfn on p2.prosrc ~* ('\m' || tfn.nm || '\M')
         where n2.nspname not in ('pg_catalog', 'information_schema')
           and p2.oid <> tfn.oid
    )
    select ns.nspname || '.' || p.proname as obj,
           case p.prokind when 'p' then 'SECURITY DEFINER procedure'
                                   else 'SECURITY DEFINER function' end as kind,
           p.proowner::regrole::text as owner
      from pg_proc p
      join pg_namespace ns on ns.oid = p.pronamespace
      join pg_roles r on r.oid = p.proowner
     where ns.nspname not in ('basecamp', 'pg_catalog')
       and p.prosecdef
       and (pg_has_role(p.proowner, 'postgres', 'USAGE') or r.rolbypassrls or r.rolsuper)
       and (p.prosrc ~* '\mbasecamp\M'
         or exists (select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) cfg
                     where cfg ~ '^search_path=' and cfg ~* '\mbasecamp\M')
         or exists (select 1 from pg_depend d
                     where d.classid = 'pg_proc'::regclass and d.objid = p.oid
                       and d.refclassid = 'pg_class'::regclass
                       and d.refobjid in (select oid from tainted))
         -- UNPINNED search_path + a bare basecamp table name. This one needs no
         -- DDL from the attacker at all: a definer with no `SET search_path`
         -- runs with the CALLER's, and an ordinary signed-in user may set their
         -- own. PROVEN — a plpgsql SECURITY DEFINER in `public` whose body is
         -- `return query select * from entries;` (unqualified, no SET
         -- search_path) resolves to nothing under a default search_path, but the
         -- caller does `set search_path = basecamp` and reads the whole catalog.
         --
         -- NOTE for whoever edits this comment next: do NOT paste a dollar-quoted
         -- function body into any comment in this file. The whole assertion
         -- section is one dollar-quoted DO block, so a literal pair of dollar
         -- signs — even inside a comment — closes it early and the file dies
         -- with a syntax error hundreds of lines further down, pointing at
         -- innocent SQL. That happened twice while writing this paragraph: once
         -- for the example, and once for the warning about the example.
         --
         -- Narrow on purpose. "Any unpinned definer" is the textbook posture and
         -- was measured too expensive here: it flags `public.handle_new_user()`,
         -- Supabase's own documented auth-trigger pattern, so it would refuse a
         -- large share of real projects and get this file deleted. Requiring a
         -- bare basecamp TABLE name as well brought false positives on a
         -- realistic surface to zero while still catching the attack. A client
         -- table that happens to share a name with one of ours is a fail-closed
         -- false positive; the message covers it.
         or p.oid in (select oid from tfn)
         or (not exists (select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) cfg
                          where cfg ~ '^search_path=')
             and exists (select 1 from pg_class bc
                           join pg_namespace bn on bn.oid = bc.relnamespace
                          where bn.nspname = 'basecamp'
                            and bc.relkind in ('r','p','v','m')
                            -- NOT `\m<name>\M`. `\m` is a word-START boundary and
                            -- `.` is a non-word character, so that form matches a
                            -- fully QUALIFIED `app.members` too — and `members`,
                            -- `entries` and `categories` are among the commonest
                            -- table names in any application. Measured: three
                            -- textbook-careful, fully-qualified client definers
                            -- were refused, none of them exploitable. This form
                            -- requires the name to be genuinely unqualified.
                            and p.prosrc ~* ('(^|[^."[:alnum:]_])"?' || bc.relname || '\M'))))
    union all
    select ns.nspname || '.' || c.relname,
           case c.relkind when 'm' then 'materialized view'
                          when 'v' then 'view'
                          when 'r' then 'table carrying a rewrite rule or inheriting basecamp'
                          when 'p' then 'partitioned table reaching basecamp'
                          when 'f' then 'foreign table reaching basecamp'
                          else 'relation reaching basecamp' end,
           c.relowner::regrole::text
      from tainted t
      join pg_class c on c.oid = t.oid
      join pg_namespace ns on ns.oid = c.relnamespace
     where ns.nspname not in ('basecamp', 'pg_catalog')
       -- NO OWNER FILTER, deliberately. It used to require an owner that bypasses
       -- RLS, and re-owning the intermediate `security_invoker` view to any
       -- unprivileged role skipped it — while a postgres-owned definer reading
       -- that view still resolved it as postgres. PROVEN. The taint closure has
       -- already restricted this to relations that reach basecamp, so ownership
       -- adds nothing here except a bypass. Measured: zero false positives.
  loop
    detail := detail || format(E'\n    %s (%s, owned by %s)', bad.obj, bad.kind, bad.owner);
  end loop;
  if detail <> '' then
    raise exception 'an object OUTSIDE basecamp can surface its rows with owner rights — every policy in this file is bypassed through it:%',
                    detail || E'\n  A view, matview, rule or inheritance parent reaching basecamp: drop it, or move the read inside basecamp behind a policy-respecting function.'
                           || E'\n  WITH (security_invoker = true) is NOT sufficient on its own: an invoker view resolves as the CURRENT user, and inside any SECURITY DEFINER caller that user is postgres.'
                           || E'\n  A definer function reported here may be a FALSE POSITIVE: if it only MENTIONS basecamp in a comment or a string, rename the mention. That case is fail-closed by design.'
                           || E'\n  NOTE: moving a helper INTO basecamp is not a fix — this block excludes that schema, and section 2 grants definers there EXECUTE to authenticated.';
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
  -- Unlike the policy set — which you legitimately change — these bodies
  -- ship IDENTICALLY to every stamp of this template, from its own 0001.
  -- So pinning them is exact here too, and any change fails until someone
  -- re-derives the digest, which forces the new body to be read.
  --
  -- `list_people` was NOT on this list, and the mention-only check above was all
  -- that guarded it. That is the weakest place to be lenient: it is the one
  -- access-model function that returns PII. PROVEN — a body keeping
  -- `from auth.users` and dropping ONLY the `where basecamp.is_super_admin()`
  -- line satisfies the mention test, commits, and hands every user's id, email
  -- and signup date to any signed-in caller, because section 2 grants it EXECUTE
  -- to `authenticated`. Pinned now, like the rest.
  --
  -- If you deliberately change one, re-derive with:
  --   select proname, md5(prosrc) from pg_proc p
  --     join pg_namespace n on n.oid = p.pronamespace
  --    where n.nspname = 'basecamp' and proname = '<fn>';
  -- `not exists (… proname = fn AND md5 = expected)` pins *a* function of that
  -- name, not the callable SURFACE. PROVEN: add an OVERLOAD —
  -- `basecamp.list_people(p int)` returning `select u.id, u.email … from
  -- auth.users u` with no admin gate — and the original still satisfies its
  -- digest, so this loop is content. Worse, section 2 of this very file then
  -- GRANTS `authenticated` EXECUTE on the overload, and PostgREST resolves
  -- overloads by argument name, so `/rest/v1/rpc/list_people?p=1` is a live
  -- route returning every user's email.
  --
  -- So the arity is pinned too. Each of these names ships exactly once; a second
  -- signature is not an extension, it is a second implementation of a decision
  -- this file exists to pin.
  detail := '';
  for bad in
    select f.fn, count(p.oid) as n from (values
      ('is_super_admin',    '86dc2c53cadb930549083637a031e613'),
      ('has_grant',         '38ada0b645e837604441d462ed96c17e'),
      ('category_has_grant','6397e2fecbe9717e46473fdddd163ab9'),
      ('can_read_entry',    'b725d5ed56514e1b7d4946d4afa5e926'),
      ('can_read_category', '77ac78aa90567fcd5ac6891451605dfa'),
      ('log_access_change', '41d5a7b6ab0dc5b4cda44d794d729a7e'),
      ('list_people',       '3651a3f932019281566ebfadda9d0708')
    ) as f(fn, expected)
    left join (pg_proc p join pg_namespace ns on ns.oid = p.pronamespace and ns.nspname = 'basecamp')
      on p.proname = f.fn
    group by f.fn, f.expected
    having count(p.oid) <> 1
        or count(*) filter (where md5(p.prosrc) = f.expected) <> 1
  loop
    detail := detail || format(E'\n    %s (%s definition(s) in basecamp)', bad.fn, bad.n);
  end loop;
  if detail <> '' then
    raise exception 'an access-model function body differs from the one this template ships, or has gained an overload — READ the new body before re-deriving its digest:%', detail;
  end if;

  -- `auth.uid` is deliberately absent from this alternation: a policy rewritten
  -- `using (auth.uid() is not null)` names it and grants every signed-in user
  -- everything. No digest pin on the policy SET, unlike the function bodies
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
