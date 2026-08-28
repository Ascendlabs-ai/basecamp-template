-- ---------------------------------------------------------------------------
-- 0004_admin_write_paths.sql — open the two write paths the admin UI consumes.
--
-- WHAT THIS OPENS, AND WHAT IT DELIBERATELY DOES NOT.
--
-- 1. `authenticated` gains INSERT and DELETE on basecamp.super_admins. The
--    POLICIES for both already existed in 0001 and are correct; only the table
--    privileges were withheld, on purpose, until a screen consumed them. This
--    is that screen. UPDATE and TRUNCATE stay withheld and 0002 still asserts
--    it: there is no UPDATE policy and no BEFORE UPDATE trigger on the trust
--    root, so one UPDATE could re-point the roster without changing the row
--    count, and the last-row guard would never fire.
--
--    SELF-PROMOTION IS NOT OPENED BY THIS. The INSERT policy's WITH CHECK is
--    `basecamp.is_super_admin()`, which evaluates the CALLER against the trust
--    root — not the row being written. A non-admin gets false and the insert is
--    refused whatever user_id they put in it. Verified before this file was
--    written; asserted at the bottom of it; exercised by
--    supabase/tests/boundary_mutations.sh, which is the actual gate.
--
-- 2. A new definer RPC, basecamp.log_privileged_action(), lets the admin API
--    routes record account-lifecycle events in the audit log.
--
--    NOTE WHAT THIS IS NOT: it is NOT an INSERT privilege on the audit log and
--    NOT an INSERT policy on it. `authenticated` still holds SELECT and nothing
--    else, access_audit still has no write policy, and 0002's assertions to
--    that effect are untouched. Handing a client role raw INSERT would let any
--    super admin forge arbitrary rows — including plausible grant/revoke rows
--    about tables they never touched — in the one table that exists to be the
--    record of what happened. The RPC writes past RLS as a definer instead, and
--    pins every field a forger would want to control: the actor is auth.uid(),
--    the source is 'auth_admin', and the action must be one of four literals.
--
-- 3. Three starter member types are seeded — staff, contractor, client — and
--    marked is_system so they cannot be deleted. Add person requires a type,
--    and before this file seeded them a freshly provisioned Basecamp had none,
--    which made the screen this migration ships unusable on a clean install.
--    Section 5 has the full reasoning, including why renaming is left open.
--
-- Applies after 0002. Its post-conditions are re-asserted at the bottom of this
-- file as well as being folded into 0002, so that a database which already has
-- 0002 applied still gets the new invariants checked rather than only a freshly
-- stamped one.
--
-- IDEMPOTENT, like 0002 and for the same reason. An earlier draft used bare
-- `create function` and an unconditional `drop constraint`, which aborted on a
-- second apply — BEFORE reaching the post-conditions at the bottom. That split
-- the invariants into two tiers without saying so: the ones folded into 0002
-- were re-checked on every run and by all 97 mutation cases, while 5a, 5d-bis
-- and 5g were checked once at stamp time and never again. The digest pin on the
-- audit writer — the thing that pins `actor_id` to `auth.uid()` — was in the
-- checked-once tier. Run this file as many times as you like.
-- ---------------------------------------------------------------------------

-- ATOMIC, and that is not decoration. An earlier draft had no transaction
-- wrapper, and a review PROVED the consequence: with UNIQUE (user_id) dropped
-- from basecamp.members so post-condition 5g would fail, this file reported
-- failure and STILL left `authenticated` holding INSERT and DELETE on the trust
-- root — every statement had autocommitted before the assertions ran. An
-- assertion that runs after commit refuses nothing. 0002 wraps itself for the
-- same reason; this is the only other file that opens a write path on the trust
-- root, and it must be able to roll itself back.
begin;

-- ---------------------------------------------------------------------------
-- 1. The trust root's write privileges.
-- ---------------------------------------------------------------------------
grant insert, delete on table basecamp.super_admins to authenticated;

-- PROVENANCE IS PINNED, NOT ACCEPTED. Before this migration only service_role
-- could insert here, so `granted_by` being free-form mattered little. Now a
-- browser token can write the row, and a review PROVED an administrator could
-- name a colleague as the grantor of an administrator they never granted. The
-- audit trigger records the true actor independently, so this was a misleading
-- second record rather than an escalation — but the trust root is the last
-- table that should carry a field anyone can write anything into.
-- `auth.uid()` bare, not `(select auth.uid())`: a DEFAULT expression cannot
-- contain a subquery. The `(select ...)` wrapper is an initplan optimisation
-- that belongs in policies, which is where 0001 uses it.
alter table basecamp.super_admins
  alter column granted_by set default auth.uid();

drop policy if exists basecamp_super_admins_insert_super_admin on basecamp.super_admins;
create policy basecamp_super_admins_insert_super_admin on basecamp.super_admins
  for insert to authenticated
  with check (
    (select basecamp.is_super_admin())
    -- `=` would behave identically here and the null-tolerance below is NOT
    -- about out-of-band inserts: those come from service_role or postgres,
    -- which bypass RLS and never reach this predicate at all. Tested: an
    -- administrator explicitly sending `granted_by = null` is REFUSED, because
    -- auth.uid() is non-null whenever is_super_admin() is true. The form is
    -- kept for its null-safety under a future policy change rather than for a
    -- caller that exists today. NULL still arises legitimately — the FK is
    -- ON DELETE SET NULL — just never on insert.
    and granted_by is not distinct from (select auth.uid())
  );

comment on table basecamp.super_admins is
  'The trust root: membership = super_admin. Owned by this schema, so the role is not borrowed from any table outside it. Rows are add/remove only (no UPDATE policy and no UPDATE privilege for any client role), the last row cannot be deleted, and TRUNCATE is refused. Administrators add and remove each other through /admin/access on their own token; the INSERT policy checks the CALLER against this table, so a non-admin cannot promote themselves.';

-- ---------------------------------------------------------------------------
-- 2. The audit log's vocabulary.
--
-- The account-lifecycle events have no natural spelling in the existing
-- grant/revoke vocabulary. "Re-issued a sign-in link" is neither a grant nor a
-- revoke, and forcing it into one would make the log claim something that did
-- not happen — the specific failure describeAuditRow() exists to avoid.
--
-- source_table names the SURFACE the change came from, and these come from the
-- Supabase Auth admin API rather than any basecamp table, so 'auth_admin' is
-- the honest value. Not 'unknown': that value means "a trigger fired on a table
-- this app does not model", which the UI renders as a warning to go and check
-- the triggers. These events are modelled and expected.
-- ---------------------------------------------------------------------------
-- ONE statement per constraint, not a DROP followed by an ADD. Between two
-- statements the table has no CHECK at all, and if the ADD then fails — a lock
-- timeout, a dropped connection — that is the permanent state. Postgres applies
-- multiple actions in a single ALTER TABLE atomically.
alter table basecamp.access_audit
  drop constraint if exists basecamp_access_audit_action_check,
  add constraint basecamp_access_audit_action_check
  check (action = any (array[
    'grant'::text, 'revoke'::text,
    -- Account lifecycle, written only by log_privileged_action().
    'invite'::text, 'reissue_link'::text, 'ban'::text, 'unban'::text,
    -- 'adopt' is NOT a smaller 'invite'. It records giving an account that
    -- already existed elsewhere on this Supabase project a member type here,
    -- WITHOUT issuing any credential — which is exactly what distinguishes it,
    -- and exactly what an auditor asking "which of these actually minted a
    -- sign-in link?" needs to be able to see.
    'adopt'::text
  ]));

alter table basecamp.access_audit
  drop constraint if exists basecamp_access_audit_source_check,
  add constraint basecamp_access_audit_source_check
  check (source_table = any (array[
    'access_grants'::text, 'type_grants'::text, 'super_admins'::text,
    'members'::text, 'auth_admin'::text, 'unknown'::text
  ]));

-- ---------------------------------------------------------------------------
-- 3. The privileged-action writer.
--
-- SECURITY DEFINER for the same two reasons log_access_change() is: it must
-- insert past the audit table's RLS, and it must read auth.users to snapshot
-- the actor's email. It is NOT a trigger function, so 0002's loop would grant
-- EXECUTE to authenticated — but 0002 has already run by the time this file
-- applies, so the grant is issued explicitly below in the same shape.
--
-- FAIL-CLOSED IS THE CALLER'S JOB TOO. This function raises rather than
-- returning quietly when the caller is not an administrator or the action is
-- not recognised. src/lib/supabase/admin.ts calls it BEFORE the privileged
-- operation and abandons the request if it raises, so an unlogged ban is not
-- possible: either the audit row exists or the ban never happened.
-- ---------------------------------------------------------------------------
create or replace function basecamp.log_privileged_action(
  p_action          text,
  p_subject_user_id uuid
) returns void
  language plpgsql
  security definer
  set search_path to ''
as $$
declare
  v_actor         uuid := auth.uid();
  v_actor_email   text;
  v_subject_email text;
begin
  -- The gate is here, in the database, not in the route handler that calls it.
  -- A role check in TypeScript is not a second lock (see CLAUDE.md); this one
  -- consults the same trust root every RLS policy consults.
  if not basecamp.is_super_admin() then
    raise exception 'only an administrator may record a privileged action'
      using errcode = 'insufficient_privilege';
  end if;

  -- Allowlist, not passthrough. The CHECK constraint on the column would catch
  -- an unknown value too, but it also admits 'grant' and 'revoke' — and a
  -- forged 'grant' row attributed to a real table is exactly the row this
  -- function must not be able to write.
  -- `p_action is null` FIRST: `null not in (...)` is NULL, not true, so a null
  -- action fell through this guard entirely and failed later on the column's NOT
  -- NULL — a constraint violation where the caller should have been told which
  -- vocabulary it broke. Not reachable from this app (the TypeScript union
  -- forbids it), which is exactly why the guard has to state it rather than rely
  -- on the caller.
  if p_action is null or p_action not in ('invite', 'reissue_link', 'ban', 'unban', 'adopt') then
    raise exception 'unrecognised privileged action: %', p_action
      using errcode = 'invalid_parameter_value';
  end if;

  -- A SUBJECT IS REQUIRED. An earlier draft accepted null and wrote a row
  -- asserting a ban that named nobody — an audit entry that records that
  -- something happened to someone unspecified is worse than no entry, because
  -- it looks like a record.
  if p_subject_user_id is null then
    raise exception 'a privileged action must name its subject'
      using errcode = 'invalid_parameter_value';
  end if;

  -- BOTH LABELS ARE LOOKED UP, never taken from the caller. This is the pattern
  -- log_access_change() already follows at each of its four branches, and an
  -- earlier draft of this function broke it by accepting `p_subject_email` as
  -- text: an administrator could record a ban of one person labelled with
  -- another's address, and because this table is append-only by trigger the
  -- false label could never be corrected. The header claims this function pins
  -- every field a forger would want to control; the label is such a field.
  select u.email into v_actor_email   from auth.users u where u.id = v_actor;
  select u.email into v_subject_email from auth.users u where u.id = p_subject_user_id;

  -- THE SUBJECT MUST RESOLVE. access_audit deliberately carries no foreign key
  -- — the record has to survive deletion of everything it names — so a
  -- nonexistent id would otherwise be accepted and written with a null label,
  -- producing exactly what the null-subject guard above exists to prevent: an
  -- entry that records something happening to someone unspecified, which looks
  -- like a record. A caller naming an id with no account is a bug, not a
  -- historical row.
  if v_subject_email is null then
    raise exception 'no account with id % — a privileged action must name a real subject', p_subject_user_id
      using errcode = 'invalid_parameter_value';
  end if;

  insert into basecamp.access_audit
    (actor_id, actor_email, action, source_table,
     subject_id, subject_label, object_kind, object_id, object_label)
  values
    (v_actor, v_actor_email, p_action, 'auth_admin',
     p_subject_user_id, v_subject_email, null, null, null);
end $$;

comment on function basecamp.log_privileged_action(text, uuid) is
  'Records an account-lifecycle event (invite, reissue_link, ban, unban, adopt) in basecamp.access_audit. SECURITY DEFINER so it can write past the audit table''s RLS without any client role holding INSERT on it — the audit log stays definer-written-only. Pins actor_id to auth.uid() and source_table to ''auth_admin'', allowlists the action, requires a subject, and LOOKS UP both email labels rather than accepting them — so a caller cannot forge a row naming someone else as actor, mislabelling the subject, or claiming a grant on a table they never touched. Raises for a non-administrator; the API routes treat that as fatal and skip the privileged operation, so an unlogged account change is not reachable.';

revoke execute on function basecamp.log_privileged_action(text, uuid) from public;
-- `authenticated` only. This function's gate IS auth.uid(), which a service_role
-- session never has, so granting it there would advertise a server-side path
-- that always raises. Verified: as service_role it refuses.
grant execute on function basecamp.log_privileged_action(text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. The roster gains ban state and member type.
--
-- DROP then CREATE, not CREATE OR REPLACE: the return type changes, and
-- PostgreSQL refuses to replace a function's OUT columns in place. The grants
-- are re-issued because DROP takes them with it.
--
-- Everything that made the old function safe is carried over verbatim and is
-- asserted below: SECURITY DEFINER, search_path TO '', the
-- `where basecamp.is_super_admin()` gate whose empty result IS the
-- authorisation answer, and the `email is not null` filter.
--
-- banned_until comes from auth.users. It is a ban STATE, not a sign-in time:
-- the old function's comment records the deliberate decision not to expose
-- last_sign_in_at, and that decision stands — this adds the one auth column the
-- roster cannot render without.
-- ---------------------------------------------------------------------------
drop function if exists basecamp.list_people();

create function basecamp.list_people()
  returns table (
    id             uuid,
    email          text,
    created_at     timestamp with time zone,
    is_super_admin boolean,
    banned_until   timestamp with time zone,
    member_type_id uuid
  )
  language sql
  stable
  security definer
  set search_path to ''
as $$
  select u.id,
         u.email::text,
         u.created_at,
         exists (select 1 from basecamp.super_admins s where s.user_id = u.id),
         u.banned_until,
         (select m.member_type_id from basecamp.members m where m.user_id = u.id)
    from auth.users u
   where basecamp.is_super_admin()
     -- auth.users.email is nullable (phone- and SSO-only accounts exist) and
     -- this function returns id + email, so a row with no email cannot be
     -- rendered. NOT a confirmation filter: unconfirmed accounts ARE returned,
     -- which is correct for a roster whose job is showing who has signed up.
     and u.email is not null
   order by u.email;
$$;

comment on function basecamp.list_people() is
  'Roster for the admin screens: id, email, signup time, Basecamp admin status, ban state and member type, super_admin only. Returns zero rows for everyone else — the empty result IS the authorization answer. is_super_admin reflects basecamp.super_admins, this schema''s own trust root, and says nothing about any other app on the project. member_type_id is a scalar because basecamp.members carries UNIQUE (user_id): a person holds at most one type. Deliberately does not expose last_sign_in_at or any other auth.users column beyond banned_until, which the roster needs to render a banned person as banned.';

revoke execute on function basecamp.list_people() from public;
grant execute on function basecamp.list_people() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. The starter member types, WITHOUT WHICH THIS MIGRATION'S OWN FEATURE DOES
--    NOT WORK.
--
-- Add person requires a member type — a person with none is granted nothing by
-- type and sees an empty catalog — and until this section existed a freshly
-- provisioned Basecamp had ZERO of them. Not "few", zero: no migration inserted
-- a member type anywhere, while `src/types/admin.ts` and `AccessAdmin.tsx` both
-- carried comments describing types "the app refers to by slug" as though some
-- were seeded. Both comments were wrong, `0001`'s own comment on `is_system`
-- said so plainly, and nothing in the runbook mentioned creating one. The
-- dialog handled the empty case correctly and told the administrator to go to
-- the Types tab first, which is a good error message for a state that should
-- not exist on a clean install.
--
-- WHY HERE AND NOT IN 0003. `0003_seed_categories.sql` is documented as
-- optional — a client may skip it and start from an empty catalog. These are
-- not optional: they are what makes the screen this migration ships usable at
-- all, so they belong to it. Skipping this file means skipping Add person, and
-- then the types are moot.
--
-- WHY NOT HAND-EDITED INTO 0001. `0001_baseline.sql` is a pg_dump and is
-- regenerated; hand edits to it are lost. Same reason `0003` exists as its own
-- file.
--
-- THREE, NOT FOUR. The stale comments said four and named none. These three are
-- the ones `README.md` and `CLAUDE.md` have always named in prose — staff,
-- contractor, client — so the documents and the database now agree.
--
-- is_system, AND WHAT THAT COSTS. The trigger `basecamp_member_types_no_system_delete`
-- refuses DELETE on an is_system row, so a client cannot delete their way back
-- to zero types and break Add person by accident.
--
-- BE PRECISE ABOUT THE STRENGTH OF THAT. It stops a delete, not an
-- administrator: `authenticated` holds UPDATE on this table under a
-- super-admin-only policy, so an administrator can clear the flag and then
-- delete the row in two statements. That is a deliberate act by somebody who
-- could equally drop the table, and the audit log records it — but "cannot be
-- deleted" would overstate it, so this file does not say that. What the flag
-- buys is that no ordinary use of the Types tab can reach zero types. RENAME IS NOT BLOCKED and that is the
-- release valve: `name` and `description` are cosmetic, grants attach to the
-- row rather than to its label, so a client who has no contractors renames that
-- type to whatever they do have. `is_admin` stays false on all three — the live
-- admin gate is `basecamp.is_super_admin()`, never this flag, and `0001`'s
-- comment on the column says so.
--
-- IDEMPOTENT, AND IT ADOPTS. `do update set is_system = true` rather than
-- `do nothing`, and the difference is an install that works versus one that
-- cannot be applied at all.
--
-- Before this file existed a stamp had ZERO member types, and the Add-person
-- dialog told the administrator to go and create one on the Types tab — so a
-- real upgrading install very likely already has a hand-made `staff` or `client`
-- with `is_system = false`. Under `do nothing` the seed skipped it, post-condition
-- 6g then found fewer than three is_system rows, and 0004 aborted. PROVEN: on a
-- database carrying one hand-made `staff`, applying 0004 failed at 6g and rolled
-- back the WHOLE file — including the trust-root grants, so the migration that
-- opens the admin write paths could not be applied by exactly the people who
-- had followed the previous instructions.
--
-- `name` and `description` are deliberately NOT touched, so a client who has
-- already renamed or described their type keeps it. Only the flag is claimed,
-- which is what makes the row undeletable and the dialog always able to offer
-- something.
-- ---------------------------------------------------------------------------
insert into basecamp.member_types (slug, name, description, is_admin, is_system, sort_order) values
  ('staff',      'Staff',      'People on the team. The default for anyone you are onboarding.',              false, true, 10),
  ('contractor', 'Contractor', 'Working with you for a while, but not of the organisation.',                  false, true, 20),
  ('client',     'Client',     'Outside the organisation entirely. Grant this type the least, on purpose.',   false, true, 30)
on conflict (slug) do update set is_system = true;

-- 0001's comment on this column predates the seed and said the opposite. It is
-- corrected here rather than in the baseline for the reason above: the baseline
-- is regenerated, and a regeneration taken from a database with 0004 applied
-- carries this text forward.
comment on column basecamp.member_types.is_system is
  'Marks a type as structural, so a trigger refuses to delete it. Rename is not blocked, since display names are cosmetic and grants attach to the row rather than its label. 0004 seeds three such types — staff, contractor, client — because Add person cannot be used without at least one; a type you create yourself is not is_system and stays deletable.';

-- ---------------------------------------------------------------------------
-- 6. Post-conditions. Same discipline as 0002: the boundary is ASSERTED, not
--    described. These are duplicated into 0002 so a fresh stamp checks them
--    too; they are here so that a database with 0002 already applied does not
--    silently miss them.
--
--    THE TWIN LIVES IN 0002, in the block beginning "The trust root's own
--    privileges". Edit both or neither — two copies of the same invariant that
--    drift are worse than one copy in the wrong file. The asymmetry that
--    remains is deliberate: 0002 also covers service_role UPDATE/TRUNCATE on
--    the trust root, which 0004 does not re-check because 0004 never touches
--    service_role's grants.
-- ---------------------------------------------------------------------------
do $$
declare
  n integer;
begin
  -- 6a. The trust root opened exactly two verbs, and no more.
  if not (has_table_privilege('authenticated', 'basecamp.super_admins', 'insert')
          and has_table_privilege('authenticated', 'basecamp.super_admins', 'delete')) then
    raise exception 'the trust root write path did not open — the admin screen cannot promote or demote';
  end if;
  if has_any_column_privilege('authenticated', 'basecamp.super_admins', 'update')
     or has_table_privilege('authenticated', 'basecamp.super_admins', 'truncate') then
    raise exception 'authenticated holds UPDATE or TRUNCATE on the trust root — the last-row guard can be bypassed';
  end if;

  -- 6a-bis. THE GUARDS THAT MAKE AN OPEN DELETE SAFE.
  --
  -- 6a's comment justifies granting DELETE by saying the last-row guard sees
  -- it. That guard was DESCRIBED and not asserted, in the one file that opens
  -- the privilege — and it was PROVEN to matter: with
  -- `basecamp_super_admins_keep_last` and `..._audit` disabled, this file
  -- applied clean and an administrator could then delete the final
  -- administrator, unrecorded, with no documented way back in.
  --
  -- Enabled for ORIGIN traffic specifically ('O'/'A'), the same standard 0002
  -- holds its guard triggers to: a trigger present but disabled is the shape
  -- that reads as safe and is not.
  select count(*) into n
    from pg_trigger tg
      join pg_class c on c.oid = tg.tgrelid
      join pg_namespace ns on ns.oid = c.relnamespace
   where ns.nspname = 'basecamp' and c.relname = 'super_admins'
     and not tg.tgisinternal and tg.tgenabled in ('O','A')
     and tg.tgname in ('basecamp_super_admins_keep_last',
                       'basecamp_super_admins_audit',
                       'basecamp_super_admins_no_truncate');
  if n <> 3 then
    raise exception 'the trust root is missing a guard trigger (found % of 3: keep_last, audit, no_truncate) — this migration opens DELETE and must not do so without them', n;
  end if;

  -- 6b. The policies that make 6a safe. The privilege is only half of it: with
  -- INSERT granted and the policy dropped, RLS would deny by default — but with
  -- INSERT granted and the policy REPLACED by a permissive one, self-promotion
  -- opens. Assert the WITH CHECK still consults the trust root.
  if not exists (
    select 1 from pg_policies
     where schemaname = 'basecamp' and tablename = 'super_admins'
       and cmd = 'INSERT' and with_check like '%is_super_admin()%'
  ) then
    raise exception 'the super_admins INSERT policy no longer gates on is_super_admin() — a non-admin could promote themselves';
  end if;
  if not exists (
    select 1 from pg_policies
     where schemaname = 'basecamp' and tablename = 'super_admins'
       and cmd = 'DELETE' and qual like '%is_super_admin()%'
  ) then
    raise exception 'the super_admins DELETE policy no longer gates on is_super_admin()';
  end if;
  if exists (
    select 1 from pg_policies
     where schemaname = 'basecamp' and tablename = 'super_admins'
       and cmd in ('UPDATE', 'ALL')
  ) then
    raise exception 'an UPDATE-capable policy appeared on the trust root';
  end if;

  -- 6c. The audit log did NOT become client-writable. This is the invariant
  -- this migration was designed around, so it is asserted here as well as in
  -- 0002 — the RPC exists precisely so these stay true.
  if has_any_column_privilege('authenticated', 'basecamp.access_audit', 'insert')
     or has_any_column_privilege('service_role', 'basecamp.access_audit', 'insert') then
    raise exception 'a client role gained INSERT on the audit log — privileged actions must go through log_privileged_action()';
  end if;
  if exists (
    select 1 from pg_policies
     where schemaname = 'basecamp' and tablename = 'access_audit'
       and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
  ) then
    raise exception 'access_audit has a write policy — it must be definer-written only';
  end if;

  -- 6d. The new writer is a definer and pins what it must pin. A body check,
  -- for the reason 0002's D17 gives: a gutted or loosened body leaves every
  -- structural check passing while the log records nothing, or records lies.
  if not exists (
    select 1 from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'basecamp' and p.proname = 'log_privileged_action' and p.prosecdef
  ) then
    raise exception 'log_privileged_action is missing or is not SECURITY DEFINER';
  end if;
  if (select p.prosrc from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
       where ns.nspname = 'basecamp' and p.proname = 'log_privileged_action')
      not like '%is_super_admin()%' then
    raise exception 'log_privileged_action no longer gates on is_super_admin() — any signed-in user could write the audit log';
  end if;
  if (select p.prosrc from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
       where ns.nspname = 'basecamp' and p.proname = 'log_privileged_action')
      not like '%auth.uid()%' then
    raise exception 'log_privileged_action no longer pins the actor to auth.uid() — a caller could name someone else';
  end if;

  -- 6d-bis. The new writer's body is PINNED, the same way 0002 pins the seven
  -- access-model bodies. The substring checks above prove the gate and the
  -- actor are MENTIONED; only a digest proves the body is the one this
  -- migration shipped. `is_super_admin` rewritten as
  -- `select true /* basecamp.super_admins auth.uid() */` satisfies every
  -- mention test ever written, which is the precedent 0002 records.
  --
  -- The pin lives here rather than in 0002 because 0002 runs BEFORE this file
  -- and the function does not exist yet at that point — a name it cannot find
  -- would fail the count check on every fresh stamp.
  --
  -- NORMALIZE LINE ENDINGS BEFORE HASHING, exactly as 0002 does for the seven
  -- bodies it pins, and for the same reason: `prosrc` is raw text. Pasting this
  -- file into the Supabase SQL Editor from a clipboard or a CRLF checkout stores
  -- `\r\n` where this file has `\n`, so a raw digest misses on a body that is
  -- byte-for-byte the one shipped here — and this migration would then refuse
  -- every correct Editor install of itself. That is not hypothetical: it is the
  -- failure 0002 records at its own pin, which stopped a client mid-provision.
  -- 0002's note there explains why this maps CR and CRLF to LF rather than
  -- deleting them, and `boundary_mutations.sh`'s Editor-path arm covers both.
  --
  -- Re-derive with — and hash the NORMALIZED text, or a digest re-derived on a
  -- database provisioned through a CRLF paste will refuse every clean install
  -- afterwards:
  --   select md5(replace(replace(prosrc, chr(13)||chr(10), chr(10)), chr(13), chr(10)))
  --     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  --    where n.nspname = 'basecamp' and p.proname = 'log_privileged_action';
  select count(*) into n
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'basecamp' and p.proname = 'log_privileged_action';
  if n <> 1 then
    raise exception 'expected exactly 1 basecamp.log_privileged_action, found % — an overload is a second implementation of a pinned decision', n;
  end if;
  if not exists (
    select 1 from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'basecamp' and p.proname = 'log_privileged_action'
       and md5(replace(replace(p.prosrc, chr(13) || chr(10), chr(10)),
                       chr(13), chr(10))) = 'f7a47fdfe66f5e57f8cad187b6564bdc'
  ) then
    raise exception 'log_privileged_action''s body differs from the one this migration ships — READ the new body before re-deriving its digest';
  end if;

  -- 6c-bis. The audit log's VOCABULARY survived. A review PROVED both CHECK
  -- constraints could be dropped and every other assertion in this file and in
  -- 0002 still printed "verified" — leaving the one table the design calls the
  -- record of what happened with a free-text action column.
  select count(*) into n
    from pg_constraint c
      join pg_class t on t.oid = c.conrelid
      join pg_namespace ns on ns.oid = t.relnamespace
   where ns.nspname = 'basecamp' and t.relname = 'access_audit' and c.contype = 'c'
     and c.convalidated
     and c.conname in ('basecamp_access_audit_action_check',
                       'basecamp_access_audit_source_check');
  if n <> 2 then
    raise exception 'access_audit lost a vocabulary CHECK (found % of 2) — the log can record an action or a source no code writes', n;
  end if;

  -- 6c-ter. Provenance on the trust root is pinned to the caller.
  if not exists (
    select 1 from pg_policies
     where schemaname = 'basecamp' and tablename = 'super_admins'
       and cmd = 'INSERT' and with_check like '%granted_by%'
  ) then
    raise exception 'the super_admins INSERT policy no longer pins granted_by — a caller can name anyone as the grantor';
  end if;

  -- 6e. The roster still refuses non-administrators. The gate lives in the
  -- function body, so a regeneration that drops the WHERE clause would turn the
  -- whole auth.users table into a public list.
  if (select p.prosrc from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
       where ns.nspname = 'basecamp' and p.proname = 'list_people')
      not like '%is_super_admin()%' then
    raise exception 'list_people() no longer gates on is_super_admin() — the roster is readable by any signed-in user';
  end if;
  if not exists (
    select 1 from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'basecamp' and p.proname = 'list_people' and p.prosecdef
  ) then
    raise exception 'list_people() is not SECURITY DEFINER';
  end if;

  -- 6f. No definer function in this schema is executable by PUBLIC, which
  -- includes `anon`. 0002 asserts this for the functions that existed when it
  -- was written; this file adds one and must re-prove it for the new set.
  select count(*) into n
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'basecamp' and p.prosecdef
     and has_function_privilege('public', p.oid, 'execute');
  if n <> 0 then
    raise exception '% definer function(s) in basecamp are executable by PUBLIC — anon can call them', n;
  end if;

  -- 6g. THE STARTER TYPES ARE THERE, AND STAY UNDELETABLE.
  --
  -- Not decoration. Add person requires a member type, so a database with none
  -- has this migration's own feature installed and unusable — the state every
  -- fresh stamp was in before section 5 existed, with three source comments
  -- claiming otherwise. Asserted rather than assumed because the seed is an
  -- `on conflict do nothing` insert: it cannot fail loudly, so nothing else
  -- would notice it having been deleted from this file.
  --
  -- Checked by SLUG, not by count. A count says "three rows exist" and passes on
  -- three rows a client happened to create; the slugs are what this file
  -- actually shipped. Names are deliberately NOT checked — renaming is the
  -- documented release valve for a client who has no contractors, and asserting
  -- on the label would turn that supported edit into a failed re-apply.
  select count(*) into n
    from basecamp.member_types
   where slug in ('staff', 'contractor', 'client') and is_system;
  if n <> 3 then
    raise exception 'expected 3 is_system member types (staff, contractor, client), found % — Add person cannot be used without at least one type, so a stamp without them ships a broken screen', n;
  end if;

  -- The trigger is what makes is_system mean anything. Without it the flag is a
  -- boolean nobody reads, and a client can delete their way back to zero types.
  if not exists (
    select 1 from pg_trigger tg
      join pg_class t on t.oid = tg.tgrelid
      join pg_namespace ns on ns.oid = t.relnamespace
     where ns.nspname = 'basecamp' and t.relname = 'member_types'
       and tg.tgname = 'basecamp_member_types_no_system_delete'
       -- `in ('O','A')`, not `<> 'D'`. A trigger left ENABLE REPLICA ('R') fires
       -- only for replication traffic and never for the app, so `<> 'D'` reads it
       -- as enabled while it guards nothing — the defeat 0002 records at its own
       -- trigger checks, and the strong form is already used at 6a-bis above.
       and not tg.tgisinternal and tg.tgenabled in ('O', 'A')
  ) then
    raise exception 'basecamp_member_types_no_system_delete is missing or disabled — is_system no longer protects anything and the starter types can be deleted';
  end if;

  -- 6h. A person holds at most one type. The roster renders member_type_id as a
  -- scalar column and the add-person dialog offers a single select; both are the
  -- wrong shape if this constraint is ever dropped.
  if not exists (
    select 1 from pg_constraint c
      join pg_class t on t.oid = c.conrelid
      join pg_namespace ns on ns.oid = t.relnamespace
     where ns.nspname = 'basecamp' and t.relname = 'members'
       and c.contype = 'u'
       and (select array_agg(a.attname::text order by a.attname)
              from unnest(c.conkey) k join pg_attribute a
                on a.attrelid = c.conrelid and a.attnum = k) = array['user_id']
  ) then
    raise exception 'basecamp.members lost UNIQUE (user_id) — a person can hold two types and the roster is now wrong-shaped';
  end if;
end $$;

commit;
