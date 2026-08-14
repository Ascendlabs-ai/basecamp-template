-- GENERATED — DO NOT EDIT BY HAND.
--
-- Schema-only baseline for a fresh instance, squashed with pg_dump from an
-- upstream migration lineage that is not part of this template. It is applied
-- once at provisioning; see supabase/README.md.
--
-- Contains NO data: no catalog seed, no backfills, no rows at all. It is
-- the shape of the schema, not its contents.
--
-- The stamp below is PROVENANCE ONLY in this template: it records which
-- upstream migration this schema was squashed from. Nothing in this repository
-- verifies it — the staleness guard that does lives in the private upstream and
-- does not run here. Do not read it as a checked invariant.
--
-- Hand edits applied to this generated file, which must be RE-APPLIED on any
-- regeneration: the PG17-only `SET transaction_timeout` was removed and the
-- PG17-only `MAINTAIN` privilege was stripped from four GRANTs (both abort on
-- PG15/16 -- `unrecognized privilege type "maintain"`), two enum labels naming
-- the originating organisation's own
-- infrastructure were renamed to `platform_auth`/`external_auth`, and COMMENT
-- strings naming that organisation, its issue tracker or its migration versions
-- were rewritten. See supabase/README.md -> "Regenerating this baseline".
--
-- SOURCE-MIGRATION-VERSION: 20260813100600
-- GENERATED-ON: 2026-08-14
--
-- PostgreSQL database dump
--


-- Dumped from database version 17.4
-- Dumped by pg_dump version 17.10 (Homebrew)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: basecamp; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA basecamp;


--
-- Name: entry_auth_boundary; Type: TYPE; Schema: basecamp; Owner: -
--

CREATE TYPE basecamp.entry_auth_boundary AS ENUM (
    'platform_auth',
    'external_auth',
    'cloudflare',
    'none',
    'unknown'
);


--
-- Name: TYPE entry_auth_boundary; Type: COMMENT; Schema: basecamp; Owner: -
--

COMMENT ON TYPE basecamp.entry_auth_boundary IS 'Which auth system gates the entry. platform_auth = this project''s own Supabase Auth; external_auth = a different auth system; cloudflare = gated at the edge; none = genuinely ungated; unknown = not established. Extend with ALTER TYPE ... ADD VALUE as your estate needs.';


--
-- Name: entry_host; Type: TYPE; Schema: basecamp; Owner: -
--

CREATE TYPE basecamp.entry_host AS ENUM (
    'vercel',
    'cloudflare',
    'supabase_edge',
    'launchd',
    'wordpress',
    'claude_artifact',
    'n8n',
    'none',
    'unknown'
);


--
-- Name: TYPE entry_host; Type: COMMENT; Schema: basecamp; Owner: -
--

COMMENT ON TYPE basecamp.entry_host IS 'Where the entry runs. Single-valued by design: an entry spanning two hosts (e.g. app routes plus a database schema) cannot be fully represented, and scheduled jobs running inside the database have no value here. Extend as needed.';


--
-- Name: entry_status; Type: TYPE; Schema: basecamp; Owner: -
--

CREATE TYPE basecamp.entry_status AS ENUM (
    'active',
    'coming_soon',
    'unverified',
    'retiring',
    'orphaned',
    'wind_down'
);


--
-- Name: TYPE entry_status; Type: COMMENT; Schema: basecamp; Owner: -
--

COMMENT ON TYPE basecamp.entry_status IS 'Mixed-axis by design of the original spec: active/coming_soon/retiring/wind_down are lifecycle, orphaned is an ownership fact, unverified is confidence in the catalog row itself. An entry that is simultaneously active, orphaned and unverified cannot be represented.';


--
-- Name: entry_trigger_type; Type: TYPE; Schema: basecamp; Owner: -
--

CREATE TYPE basecamp.entry_trigger_type AS ENUM (
    'user',
    'cron',
    'slack',
    'webhook',
    'manual'
);


--
-- Name: TYPE entry_trigger_type; Type: COMMENT; Schema: basecamp; Owner: -
--

COMMENT ON TYPE basecamp.entry_trigger_type IS 'What causes the entry to run. Single-valued by design of the original spec; things that are both webhook- and manually-triggered cannot be fully represented.';


--
-- Name: entry_type; Type: TYPE; Schema: basecamp; Owner: -
--

CREATE TYPE basecamp.entry_type AS ENUM (
    'launchable',
    'reference_only',
    'catalog_only'
);


--
-- Name: TYPE entry_type; Type: COMMENT; Schema: basecamp; Owner: -
--

COMMENT ON TYPE basecamp.entry_type IS 'How you interact with the entry: launchable = has a URL you can open; reference_only = documentation, nothing to launch; catalog_only = tracked but not reachable from Basecamp.';


--
-- Name: nav_group; Type: TYPE; Schema: basecamp; Owner: -
--

CREATE TYPE basecamp.nav_group AS ENUM (
    'marketing',
    'sales',
    'deal_sourcing',
    'operations',
    'external'
);


--
-- Name: TYPE nav_group; Type: COMMENT; Schema: basecamp; Owner: -
--

COMMENT ON TYPE basecamp.nav_group IS 'Sidebar section for a launchable entry. Presentation only — confers no access. Order is marketing, sales, deal_sourcing, operations, external — keep src/types/admin.ts NAV_GROUP_ORDER in the same sequence.';


--
-- Name: can_read_category(uuid); Type: FUNCTION; Schema: basecamp; Owner: -
--

CREATE FUNCTION basecamp.can_read_category(p_category_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select basecamp.is_super_admin()
      or exists (
           select 1 from basecamp.entries e
            where e.category_id = p_category_id
              and basecamp.has_grant(e.id, e.category_id)
         );
$$;


--
-- Name: FUNCTION can_read_category(p_category_id uuid); Type: COMMENT; Schema: basecamp; Owner: -
--

COMMENT ON FUNCTION basecamp.can_read_category(p_category_id uuid) IS 'A category is visible only if it contains at least one entry the caller can read. NOTE: not referenced by any policy — the policies call category_has_grant() instead. Kept as a readable statement of the rule and for RPC use; if you change the union rule, change it here too.';


--
-- Name: can_read_entry(uuid, uuid); Type: FUNCTION; Schema: basecamp; Owner: -
--

CREATE FUNCTION basecamp.can_read_entry(p_entry_id uuid, p_category_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select basecamp.is_super_admin() or basecamp.has_grant(p_entry_id, p_category_id);
$$;


--
-- Name: FUNCTION can_read_entry(p_entry_id uuid, p_category_id uuid); Type: COMMENT; Schema: basecamp; Owner: -
--

COMMENT ON FUNCTION basecamp.can_read_entry(p_entry_id uuid, p_category_id uuid) IS 'Effective read: super_admin, OR granted individually in access_grants, OR granted to the caller''s type in type_grants. A union — neither source can subtract from the other, and there is no deny.';


--
-- Name: category_has_grant(uuid); Type: FUNCTION; Schema: basecamp; Owner: -
--

CREATE FUNCTION basecamp.category_has_grant(p_category_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  -- The entry existence test is the rule, not an optimisation: no visible
  -- entry, no visible category. Keeping it as a separate EXISTS preserves the
  -- set-based shape that made this fast — the definer barrier is still crossed
  -- once per category, not once per entry.
  select exists (select 1 from basecamp.entries e where e.category_id = p_category_id)
     and (
           exists (
             select 1 from basecamp.access_grants g
              where g.user_id = auth.uid()
                and (g.category_id = p_category_id
                     or g.entry_id in (select e.id from basecamp.entries e
                                        where e.category_id = p_category_id))
           )
        or exists (
             select 1
               from basecamp.members m
               join basecamp.type_grants tg on tg.member_type_id = m.member_type_id
              where m.user_id = auth.uid()
                and (tg.category_id = p_category_id
                     or tg.entry_id in (select e.id from basecamp.entries e
                                         where e.category_id = p_category_id))
           )
         );
$$;


--
-- Name: FUNCTION category_has_grant(p_category_id uuid); Type: COMMENT; Schema: basecamp; Owner: -
--

COMMENT ON FUNCTION basecamp.category_has_grant(p_category_id uuid) IS 'Set-based sibling of has_grant: does this category contain at least one entry the caller may read, individually or through their type? The entry-existence test is load-bearing — a grant on an empty category must show nothing. No role check; the policy supplies that as an InitPlan. MIRRORED IN src/lib/adminAccess.ts — change both.';


--
-- Name: has_grant(uuid, uuid); Type: FUNCTION; Schema: basecamp; Owner: -
--

CREATE FUNCTION basecamp.has_grant(p_entry_id uuid, p_category_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select exists (
           select 1 from basecamp.access_grants g
            where g.user_id = auth.uid()
              and (g.entry_id = p_entry_id or g.category_id = p_category_id)
         )
      or exists (
           select 1
             from basecamp.members m
             join basecamp.type_grants tg on tg.member_type_id = m.member_type_id
            where m.user_id = auth.uid()
              and (tg.entry_id = p_entry_id or tg.category_id = p_category_id)
         );
$$;


--
-- Name: FUNCTION has_grant(p_entry_id uuid, p_category_id uuid); Type: COMMENT; Schema: basecamp; Owner: -
--

COMMENT ON FUNCTION basecamp.has_grant(p_entry_id uuid, p_category_id uuid) IS 'The union — individual grant OR type grant — with NO role check. The single definition of what a grant means. MIRRORED IN src/lib/adminAccess.ts resolveAccess() for the admin display; if a third source is ever added here, that function is wrong until it is changed too.';


--
-- Name: is_super_admin(); Type: FUNCTION; Schema: basecamp; Owner: -
--

CREATE FUNCTION basecamp.is_super_admin() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select exists (
    select 1
    from basecamp.super_admins
    where user_id = auth.uid()
  );
$$;


--
-- Name: FUNCTION is_super_admin(); Type: COMMENT; Schema: basecamp; Owner: -
--

COMMENT ON FUNCTION basecamp.is_super_admin() IS 'The admin gate. Reads basecamp.super_admins, the trust root this schema owns. Membership in that table IS the super_admin role: there is no external role table and no enum to keep in step. Add and remove administrators there.';


--
-- Name: list_people(); Type: FUNCTION; Schema: basecamp; Owner: -
--

CREATE FUNCTION basecamp.list_people() RETURNS TABLE(id uuid, email text, created_at timestamp with time zone, is_super_admin boolean)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select u.id,
         u.email::text,
         u.created_at,
         exists (select 1 from basecamp.super_admins s where s.user_id = u.id)
    from auth.users u
   where basecamp.is_super_admin()
     -- auth.users.email is nullable (phone- and SSO-only accounts exist) and
     -- this function returns id + email, so a row with no email cannot be
     -- rendered. NOT a confirmation filter: unconfirmed accounts ARE returned,
     -- which is correct for a roster whose job is showing who has signed up.
     and u.email is not null
   order by u.email;
$$;


--
-- Name: FUNCTION list_people(); Type: COMMENT; Schema: basecamp; Owner: -
--

COMMENT ON FUNCTION basecamp.list_people() IS 'Roster for the admin screens: id, email, signup time and Basecamp admin status, super_admin only. Returns zero rows for everyone else — the empty result IS the authorization answer. is_super_admin reflects basecamp.super_admins, this schema''s own trust root, and says nothing about any other app on the project. Deliberately does not expose last_sign_in_at or any other auth.users column.';


--
-- Name: log_access_change(); Type: FUNCTION; Schema: basecamp; Owner: -
--

CREATE FUNCTION basecamp.log_access_change() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_actor       uuid := auth.uid();
  v_actor_email text;
  v_action      text := case when tg_op = 'INSERT' then 'grant' else 'revoke' end;
  v_source      text := tg_table_name;
  v_subject_id  uuid;
  v_subject_lbl text;
  v_object_kind text;
  v_object_id   uuid;
  v_object_lbl  text;
begin
  select u.email into v_actor_email from auth.users u where u.id = v_actor;

  if tg_table_name = 'members' then
    -- Both columns, not just the type. A row moved to a different person is a
    -- revoke and a grant even when the type is untouched — that is the whole
    -- defect this migration exists to close.
    if tg_op = 'UPDATE'
       and new.member_type_id is not distinct from old.member_type_id
       and new.user_id        is not distinct from old.user_id then
      return null;  -- department-only edit: changes no access
    end if;

    if tg_op in ('UPDATE', 'DELETE') then
      select u.email into v_subject_lbl from auth.users u where u.id = old.user_id;
      select t.name  into v_object_lbl  from basecamp.member_types t where t.id = old.member_type_id;
      insert into basecamp.access_audit
        (actor_id, actor_email, action, source_table,
         subject_id, subject_label, object_kind, object_id, object_label)
      values (v_actor, v_actor_email, 'revoke', 'members',
              old.user_id, v_subject_lbl, 'type', old.member_type_id, v_object_lbl);
    end if;

    if tg_op in ('INSERT', 'UPDATE') then
      select u.email into v_subject_lbl from auth.users u where u.id = new.user_id;
      select t.name  into v_object_lbl  from basecamp.member_types t where t.id = new.member_type_id;
      insert into basecamp.access_audit
        (actor_id, actor_email, action, source_table,
         subject_id, subject_label, object_kind, object_id, object_label)
      values (v_actor, v_actor_email, 'grant', 'members',
              new.user_id, v_subject_lbl, 'type', new.member_type_id, v_object_lbl);
    end if;

    return null;
  end if;

  if tg_table_name = 'access_grants' then
    v_subject_id := case when tg_op = 'INSERT' then new.user_id else old.user_id end;
    select u.email into v_subject_lbl from auth.users u where u.id = v_subject_id;
    v_object_id := case when tg_op = 'INSERT'
                        then coalesce(new.entry_id, new.category_id)
                        else coalesce(old.entry_id, old.category_id) end;
    v_object_kind := case when tg_op = 'INSERT'
                          then case when new.entry_id is not null then 'entry' else 'category' end
                          else case when old.entry_id is not null then 'entry' else 'category' end end;

  elsif tg_table_name = 'type_grants' then
    v_subject_id := case when tg_op = 'INSERT' then new.member_type_id else old.member_type_id end;
    select t.name into v_subject_lbl from basecamp.member_types t where t.id = v_subject_id;
    v_object_id := case when tg_op = 'INSERT'
                        then coalesce(new.entry_id, new.category_id)
                        else coalesce(old.entry_id, old.category_id) end;
    v_object_kind := case when tg_op = 'INSERT'
                          then case when new.entry_id is not null then 'entry' else 'category' end
                          else case when old.entry_id is not null then 'entry' else 'category' end end;

  elsif tg_table_name = 'super_admins' then
    v_subject_id := case when tg_op = 'INSERT' then new.user_id else old.user_id end;
    select u.email into v_subject_lbl from auth.users u where u.id = v_subject_id;

  else
    v_source := 'unknown';
  end if;

  if v_object_kind = 'entry' then
    select e.display_name into v_object_lbl from basecamp.entries e where e.id = v_object_id;
  elsif v_object_kind = 'category' then
    select c.name into v_object_lbl from basecamp.categories c where c.id = v_object_id;
  end if;

  insert into basecamp.access_audit
    (actor_id, actor_email, action, source_table,
     subject_id, subject_label, object_kind, object_id, object_label)
  values (v_actor, v_actor_email, v_action, v_source,
          v_subject_id, v_subject_lbl, v_object_kind, v_object_id, v_object_lbl);

  return null;
end $$;


--
-- Name: FUNCTION log_access_change(); Type: COMMENT; Schema: basecamp; Owner: -
--

COMMENT ON FUNCTION basecamp.log_access_change() IS 'Writes basecamp.access_audit from AFTER triggers on access_grants, type_grants, members and super_admins — the four surfaces that decide what a person can see. SECURITY DEFINER so it can insert past the audit table''s RLS and read auth.users for label snapshots. A member type change emits two rows (revoke old, grant new); a department-only edit emits none.';


--
-- Name: prevent_access_truncate(); Type: FUNCTION; Schema: basecamp; Owner: -
--

CREATE FUNCTION basecamp.prevent_access_truncate() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  raise exception
    'refusing to TRUNCATE basecamp.% — TRUNCATE does not fire the audit trigger, so a mass revoke would leave no record. Use DELETE, which is audited row by row.',
    tg_table_name
    using errcode = 'restrict_violation';
end $$;


--
-- Name: prevent_audit_mutation(); Type: FUNCTION; Schema: basecamp; Owner: -
--

CREATE FUNCTION basecamp.prevent_audit_mutation() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  raise exception
    'basecamp.access_audit is append-only — % is refused. To prune deliberately, disable this trigger inside a transaction, delete, and re-enable it.',
    tg_op
    using errcode = 'restrict_violation';
end $$;


--
-- Name: prevent_last_super_admin_delete(); Type: FUNCTION; Schema: basecamp; Owner: -
--

CREATE FUNCTION basecamp.prevent_last_super_admin_delete() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  -- The count below must see the OTHER session's committed delete. Under
  -- REPEATABLE READ it would not: the second session's count uses its
  -- transaction snapshot, still sees two rows, allows its delete, and the table
  -- ends empty — and because the two deletes touch different rows there is no
  -- serialization failure to save it. PostgREST runs READ COMMITTED (no
  -- isolation override in pg_db_role_setting, verified), but an operator or a
  -- script can open an RR transaction, so refuse rather than silently rely on it.
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception
      'the last-super_admin guard requires READ COMMITTED (got %) — under a snapshot isolation level its count is stale and the table could be emptied',
      current_setting('transaction_isolation')
      using errcode = 'restrict_violation';
  end if;

  -- Serialize concurrent deletes so two sessions cannot each observe "two
  -- remain" and jointly empty the table. Self-conflicting lock mode, so the
  -- second transaction waits; if two deadlock, Postgres aborts one, which is
  -- the safe direction for this operation. It does not conflict with ACCESS
  -- SHARE, so pg_dump and every is_super_admin() read are unaffected.
  lock table basecamp.super_admins in share row exclusive mode;
  if (select count(*) from basecamp.super_admins) <= 1 then
    raise exception
      'refusing to delete the last super_admin (%) — the catalog would be left with no administrator and no in-app recovery',
      old.user_id
      using errcode = 'restrict_violation';
  end if;
  return old;
end $$;


--
-- Name: prevent_super_admins_truncate(); Type: FUNCTION; Schema: basecamp; Owner: -
--

CREATE FUNCTION basecamp.prevent_super_admins_truncate() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  raise exception
    'refusing to TRUNCATE basecamp.super_admins — it is the trust root, and TRUNCATE does not fire the last-admin guard. Remove rows with DELETE, which cannot remove the last one.'
    using errcode = 'restrict_violation';
end $$;


--
-- Name: prevent_system_type_delete(); Type: FUNCTION; Schema: basecamp; Owner: -
--

CREATE FUNCTION basecamp.prevent_system_type_delete() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if old.is_system then
    raise exception 'member type "%" is a system type and cannot be deleted', old.slug
      using errcode = 'restrict_violation';
  end if;
  return old;
end $$;


--
-- Name: FUNCTION prevent_system_type_delete(); Type: COMMENT; Schema: basecamp; Owner: -
--

COMMENT ON FUNCTION basecamp.prevent_system_type_delete() IS 'Blocks DELETE on is_system member types. A trigger rather than a policy: RLS can hide a row from a DELETE, but only a trigger can refuse it with a message that says why.';


--
-- Name: set_updated_at(); Type: FUNCTION; Schema: basecamp; Owner: -
--

CREATE FUNCTION basecamp.set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
  new.updated_at := now();
  return new;
end;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: access_audit; Type: TABLE; Schema: basecamp; Owner: -
--

CREATE TABLE basecamp.access_audit (
    id bigint NOT NULL,
    occurred_at timestamp with time zone DEFAULT now() NOT NULL,
    actor_id uuid,
    actor_email text,
    action text NOT NULL,
    source_table text NOT NULL,
    subject_id uuid,
    subject_label text,
    object_kind text,
    object_id uuid,
    object_label text,
    CONSTRAINT basecamp_access_audit_action_check CHECK ((action = ANY (ARRAY['grant'::text, 'revoke'::text]))),
    CONSTRAINT basecamp_access_audit_object_kind_check CHECK (((object_kind IS NULL) OR (object_kind = ANY (ARRAY['entry'::text, 'category'::text, 'type'::text])))),
    CONSTRAINT basecamp_access_audit_source_check CHECK ((source_table = ANY (ARRAY['access_grants'::text, 'type_grants'::text, 'super_admins'::text, 'members'::text, 'unknown'::text])))
);


--
-- Name: TABLE access_audit; Type: COMMENT; Schema: basecamp; Owner: -
--

COMMENT ON TABLE basecamp.access_audit IS 'Append-only record of access changes. Written by AFTER triggers on access_grants, type_grants, members and super_admins — never by the application, which has no way to skip it. No foreign keys and snapshotted labels on purpose: the record must survive deletion of everything it names.';


--
-- Name: COLUMN access_audit.actor_id; Type: COMMENT; Schema: basecamp; Owner: -
--

COMMENT ON COLUMN basecamp.access_audit.actor_id IS 'auth.uid() at write time. NULL means an out-of-band change (SQL Editor, migration) — a real distinction, recorded rather than invented.';


--
-- Name: access_audit_id_seq; Type: SEQUENCE; Schema: basecamp; Owner: -
--

ALTER TABLE basecamp.access_audit ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME basecamp.access_audit_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: access_grants; Type: TABLE; Schema: basecamp; Owner: -
--

CREATE TABLE basecamp.access_grants (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    entry_id uuid,
    category_id uuid,
    granted_by uuid,
    note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT basecamp_access_grants_exactly_one_target CHECK (((entry_id IS NULL) <> (category_id IS NULL))),
    CONSTRAINT basecamp_access_grants_note_not_blank CHECK (((note IS NULL) OR (length(btrim(note)) > 0)))
);


--
-- Name: TABLE access_grants; Type: COMMENT; Schema: basecamp; Owner: -
--

COMMENT ON TABLE basecamp.access_grants IS 'Per-user visibility grants. A grant names either one entry or one whole category, never both and never neither. super_admin bypasses this table entirely.';


--
-- Name: COLUMN access_grants.granted_by; Type: COMMENT; Schema: basecamp; Owner: -
--

COMMENT ON COLUMN basecamp.access_grants.granted_by IS 'Nullable by design: ON DELETE SET NULL, so deleting the granter never revokes what they granted.';


--
-- Name: categories; Type: TABLE; Schema: basecamp; Owner: -
--

CREATE TABLE basecamp.categories (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    slug text NOT NULL,
    name text NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    description text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT basecamp_categories_description_not_blank CHECK ((length(btrim(description)) > 0)),
    CONSTRAINT basecamp_categories_name_not_blank CHECK ((length(btrim(name)) > 0)),
    CONSTRAINT basecamp_categories_slug_format CHECK ((slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'::text))
);


--
-- Name: TABLE categories; Type: COMMENT; Schema: basecamp; Owner: -
--

COMMENT ON TABLE basecamp.categories IS 'Groupings used to organise catalog entries in the Basecamp UI.';


--
-- Name: COLUMN categories.sort_order; Type: COMMENT; Schema: basecamp; Owner: -
--

COMMENT ON COLUMN basecamp.categories.sort_order IS 'Not unique and defaults to 0. Always order by (sort_order, slug).';


--
-- Name: entries; Type: TABLE; Schema: basecamp; Owner: -
--

CREATE TABLE basecamp.entries (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    category_id uuid NOT NULL,
    display_name text NOT NULL,
    technical_name text,
    description text NOT NULL,
    entry_type basecamp.entry_type NOT NULL,
    status basecamp.entry_status NOT NULL,
    host basecamp.entry_host NOT NULL,
    auth_boundary basecamp.entry_auth_boundary NOT NULL,
    trigger_type basecamp.entry_trigger_type NOT NULL,
    owner text NOT NULL,
    launch_url text,
    repo_url text,
    runbook_url text,
    source_of_truth_note text,
    sort_order integer DEFAULT 0 NOT NULL,
    last_verified_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    slug text NOT NULL,
    nav_group basecamp.nav_group,
    CONSTRAINT basecamp_entries_description_not_blank CHECK ((length(btrim(description)) > 0)),
    CONSTRAINT basecamp_entries_display_name_not_blank CHECK ((length(btrim(display_name)) > 0)),
    CONSTRAINT basecamp_entries_launch_url_format CHECK (((launch_url IS NULL) OR ((length(launch_url) <= 2048) AND (launch_url ~* '^https?://[^[:space:]]+$'::text)))),
    CONSTRAINT basecamp_entries_launchable_requires_launch_url CHECK (((entry_type <> 'launchable'::basecamp.entry_type) OR ((launch_url IS NOT NULL) AND (launch_url ~* '^https?://[^[:space:]]+$'::text)))),
    CONSTRAINT basecamp_entries_nav_group_launchable_only CHECK (((nav_group IS NULL) OR (entry_type = 'launchable'::basecamp.entry_type))),
    CONSTRAINT basecamp_entries_owner_not_blank CHECK ((length(btrim(owner)) > 0)),
    CONSTRAINT basecamp_entries_repo_url_format CHECK (((repo_url IS NULL) OR ((length(repo_url) <= 2048) AND (repo_url ~* '^https?://[^[:space:]]+$'::text)))),
    CONSTRAINT basecamp_entries_runbook_url_format CHECK (((runbook_url IS NULL) OR ((length(runbook_url) <= 2048) AND (runbook_url ~* '^https?://[^[:space:]]+$'::text)))),
    CONSTRAINT basecamp_entries_slug_format CHECK ((slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'::text)),
    CONSTRAINT basecamp_entries_slug_length CHECK ((length(slug) <= 128)),
    CONSTRAINT basecamp_entries_source_of_truth_note_not_blank CHECK (((source_of_truth_note IS NULL) OR (length(btrim(source_of_truth_note)) > 0))),
    CONSTRAINT basecamp_entries_technical_name_not_blank CHECK (((technical_name IS NULL) OR (length(btrim(technical_name)) > 0)))
);


--
-- Name: TABLE entries; Type: COMMENT; Schema: basecamp; Owner: -
--

COMMENT ON TABLE basecamp.entries IS 'The catalog: one row per app, tool, or automation.';


--
-- Name: COLUMN entries.owner; Type: COMMENT; Schema: basecamp; Owner: -
--

COMMENT ON COLUMN basecamp.entries.owner IS 'Free text: the person or team responsible. Deliberately not a foreign key — there is no profiles table in this schema to point at, so decide what it references before promoting it.';


--
-- Name: COLUMN entries.sort_order; Type: COMMENT; Schema: basecamp; Owner: -
--

COMMENT ON COLUMN basecamp.entries.sort_order IS 'Not unique and defaults to 0, so it is not a total order on its own. Always order by (sort_order, slug) — an unstable sort makes any generated inventory diff spuriously on every run.';


--
-- Name: COLUMN entries.last_verified_at; Type: COMMENT; Schema: basecamp; Owner: -
--

COMMENT ON COLUMN basecamp.entries.last_verified_at IS 'When this row was last confirmed against reality. Null means never confirmed. Related to but independent of entry_status = unverified: a row can have been verified once and later re-flagged. Neither implies the other, and nothing enforces a relationship between them.';


--
-- Name: COLUMN entries.slug; Type: COMMENT; Schema: basecamp; Owner: -
--

COMMENT ON COLUMN basecamp.entries.slug IS 'Stable kebab-case identifier. Survives a display_name rename; the upsert conflict target for seeding, and the natural join key for anything generated from this catalog.';


--
-- Name: COLUMN entries.nav_group; Type: COMMENT; Schema: basecamp; Owner: -
--

COMMENT ON COLUMN basecamp.entries.nav_group IS 'Which sidebar group this entry appears under. NULL = not placed by the design and not yet decided; the entry still shows in the home catalog. Only meaningful for entry_type = launchable.';


--
-- Name: CONSTRAINT basecamp_entries_launchable_requires_launch_url ON entries; Type: COMMENT; Schema: basecamp; Owner: -
--

COMMENT ON CONSTRAINT basecamp_entries_launchable_requires_launch_url ON basecamp.entries IS 'A launchable entry must carry a non-null, well-formed http(s) URL. Proves shape, not reachability. Non-launchable entries may still carry a launch_url.';


--
-- Name: member_types; Type: TABLE; Schema: basecamp; Owner: -
--

CREATE TABLE basecamp.member_types (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    slug text NOT NULL,
    name text NOT NULL,
    description text,
    is_admin boolean DEFAULT false NOT NULL,
    is_system boolean DEFAULT false NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT basecamp_member_types_description_length CHECK (((description IS NULL) OR (length(description) <= 1024))),
    CONSTRAINT basecamp_member_types_description_not_blank CHECK (((description IS NULL) OR (length(btrim(description)) > 0))),
    CONSTRAINT basecamp_member_types_name_length CHECK ((length(name) <= 128)),
    CONSTRAINT basecamp_member_types_name_not_blank CHECK ((length(btrim(name)) > 0)),
    CONSTRAINT basecamp_member_types_slug_format CHECK (((slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'::text) AND (length(slug) <= 128)))
);


--
-- Name: TABLE member_types; Type: COMMENT; Schema: basecamp; Owner: -
--

COMMENT ON TABLE basecamp.member_types IS 'User types owned by this schema. Effective access is the union of what a person''s type is granted and what they are granted individually.';


--
-- Name: COLUMN member_types.is_admin; Type: COMMENT; Schema: basecamp; Owner: -
--

COMMENT ON COLUMN basecamp.member_types.is_admin IS 'Marks a type as administrative. NOTE: the live admin gate is basecamp.is_super_admin(), not this flag — this records intent for a future widening and must not be read as if it already grants admin.';


--
-- Name: COLUMN member_types.is_system; Type: COMMENT; Schema: basecamp; Owner: -
--

COMMENT ON COLUMN basecamp.member_types.is_system IS 'Marks a type as structural, so a trigger refuses to delete it. Rename is not blocked, since display names are cosmetic. NOTE: this template seeds no types at all, so nothing is is_system until you set it.';


--
-- Name: members; Type: TABLE; Schema: basecamp; Owner: -
--

CREATE TABLE basecamp.members (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    member_type_id uuid NOT NULL,
    department text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    assigned_by uuid,
    CONSTRAINT basecamp_members_department_length CHECK (((department IS NULL) OR (length(department) <= 128))),
    CONSTRAINT basecamp_members_department_not_blank CHECK (((department IS NULL) OR (length(btrim(department)) > 0)))
);


--
-- Name: TABLE members; Type: COMMENT; Schema: basecamp; Owner: -
--

COMMENT ON TABLE basecamp.members IS 'One row per person: which Basecamp type they hold and which department they sit in. Absence of a row means no type — the person falls back to their individual access_grants alone.';


--
-- Name: COLUMN members.assigned_by; Type: COMMENT; Schema: basecamp; Owner: -
--

COMMENT ON COLUMN basecamp.members.assigned_by IS 'Who assigned this type. Same nullable-by-design reasoning as type_grants.granted_by.';


--
-- Name: super_admins; Type: TABLE; Schema: basecamp; Owner: -
--

CREATE TABLE basecamp.super_admins (
    user_id uuid NOT NULL,
    granted_by uuid,
    note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT basecamp_super_admins_note_not_blank CHECK (((note IS NULL) OR (length(btrim(note)) > 0)))
);


--
-- Name: TABLE super_admins; Type: COMMENT; Schema: basecamp; Owner: -
--

COMMENT ON TABLE basecamp.super_admins IS 'The trust root: membership = super_admin. Owned by this schema, so the role is not borrowed from any table outside it. Rows are add/remove only (no UPDATE policy), the last row cannot be deleted, and TRUNCATE is refused.';


--
-- Name: type_grants; Type: TABLE; Schema: basecamp; Owner: -
--

CREATE TABLE basecamp.type_grants (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    member_type_id uuid NOT NULL,
    entry_id uuid,
    category_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    granted_by uuid,
    CONSTRAINT basecamp_type_grants_exactly_one_target CHECK (((entry_id IS NULL) <> (category_id IS NULL)))
);


--
-- Name: TABLE type_grants; Type: COMMENT; Schema: basecamp; Owner: -
--

COMMENT ON TABLE basecamp.type_grants IS 'What a type can see. Same shape as access_grants but keyed to a type. Effective access is the union of the two.';


--
-- Name: COLUMN type_grants.granted_by; Type: COMMENT; Schema: basecamp; Owner: -
--

COMMENT ON COLUMN basecamp.type_grants.granted_by IS 'Who added this type grant. Nullable by design: ON DELETE SET NULL, so deleting the granter never revokes what they granted.';


--
-- Name: access_audit basecamp_access_audit_pkey; Type: CONSTRAINT; Schema: basecamp; Owner: -
--

ALTER TABLE ONLY basecamp.access_audit
    ADD CONSTRAINT basecamp_access_audit_pkey PRIMARY KEY (id);


--
-- Name: access_grants basecamp_access_grants_pkey; Type: CONSTRAINT; Schema: basecamp; Owner: -
--

ALTER TABLE ONLY basecamp.access_grants
    ADD CONSTRAINT basecamp_access_grants_pkey PRIMARY KEY (id);


--
-- Name: categories basecamp_categories_pkey; Type: CONSTRAINT; Schema: basecamp; Owner: -
--

ALTER TABLE ONLY basecamp.categories
    ADD CONSTRAINT basecamp_categories_pkey PRIMARY KEY (id);


--
-- Name: categories basecamp_categories_slug_key; Type: CONSTRAINT; Schema: basecamp; Owner: -
--

ALTER TABLE ONLY basecamp.categories
    ADD CONSTRAINT basecamp_categories_slug_key UNIQUE (slug);


--
-- Name: entries basecamp_entries_pkey; Type: CONSTRAINT; Schema: basecamp; Owner: -
--

ALTER TABLE ONLY basecamp.entries
    ADD CONSTRAINT basecamp_entries_pkey PRIMARY KEY (id);


--
-- Name: entries basecamp_entries_slug_key; Type: CONSTRAINT; Schema: basecamp; Owner: -
--

ALTER TABLE ONLY basecamp.entries
    ADD CONSTRAINT basecamp_entries_slug_key UNIQUE (slug);


--
-- Name: member_types basecamp_member_types_pkey; Type: CONSTRAINT; Schema: basecamp; Owner: -
--

ALTER TABLE ONLY basecamp.member_types
    ADD CONSTRAINT basecamp_member_types_pkey PRIMARY KEY (id);


--
-- Name: member_types basecamp_member_types_slug_key; Type: CONSTRAINT; Schema: basecamp; Owner: -
--

ALTER TABLE ONLY basecamp.member_types
    ADD CONSTRAINT basecamp_member_types_slug_key UNIQUE (slug);


--
-- Name: members basecamp_members_pkey; Type: CONSTRAINT; Schema: basecamp; Owner: -
--

ALTER TABLE ONLY basecamp.members
    ADD CONSTRAINT basecamp_members_pkey PRIMARY KEY (id);


--
-- Name: members basecamp_members_user_id_key; Type: CONSTRAINT; Schema: basecamp; Owner: -
--

ALTER TABLE ONLY basecamp.members
    ADD CONSTRAINT basecamp_members_user_id_key UNIQUE (user_id);


--
-- Name: super_admins basecamp_super_admins_pkey; Type: CONSTRAINT; Schema: basecamp; Owner: -
--

ALTER TABLE ONLY basecamp.super_admins
    ADD CONSTRAINT basecamp_super_admins_pkey PRIMARY KEY (user_id);


--
-- Name: type_grants basecamp_type_grants_pkey; Type: CONSTRAINT; Schema: basecamp; Owner: -
--

ALTER TABLE ONLY basecamp.type_grants
    ADD CONSTRAINT basecamp_type_grants_pkey PRIMARY KEY (id);


--
-- Name: basecamp_access_audit_occurred_at_idx; Type: INDEX; Schema: basecamp; Owner: -
--

CREATE INDEX basecamp_access_audit_occurred_at_idx ON basecamp.access_audit USING btree (occurred_at DESC);


--
-- Name: basecamp_access_audit_subject_id_idx; Type: INDEX; Schema: basecamp; Owner: -
--

CREATE INDEX basecamp_access_audit_subject_id_idx ON basecamp.access_audit USING btree (subject_id);


--
-- Name: basecamp_access_grants_user_category_key; Type: INDEX; Schema: basecamp; Owner: -
--

CREATE UNIQUE INDEX basecamp_access_grants_user_category_key ON basecamp.access_grants USING btree (user_id, category_id) WHERE (category_id IS NOT NULL);


--
-- Name: basecamp_access_grants_user_entry_key; Type: INDEX; Schema: basecamp; Owner: -
--

CREATE UNIQUE INDEX basecamp_access_grants_user_entry_key ON basecamp.access_grants USING btree (user_id, entry_id) WHERE (entry_id IS NOT NULL);


--
-- Name: basecamp_access_grants_user_id_idx; Type: INDEX; Schema: basecamp; Owner: -
--

CREATE INDEX basecamp_access_grants_user_id_idx ON basecamp.access_grants USING btree (user_id);


--
-- Name: basecamp_entries_category_id_idx; Type: INDEX; Schema: basecamp; Owner: -
--

CREATE INDEX basecamp_entries_category_id_idx ON basecamp.entries USING btree (category_id);


--
-- Name: basecamp_members_member_type_id_idx; Type: INDEX; Schema: basecamp; Owner: -
--

CREATE INDEX basecamp_members_member_type_id_idx ON basecamp.members USING btree (member_type_id);


--
-- Name: basecamp_type_grants_member_type_id_idx; Type: INDEX; Schema: basecamp; Owner: -
--

CREATE INDEX basecamp_type_grants_member_type_id_idx ON basecamp.type_grants USING btree (member_type_id);


--
-- Name: basecamp_type_grants_type_category_key; Type: INDEX; Schema: basecamp; Owner: -
--

CREATE UNIQUE INDEX basecamp_type_grants_type_category_key ON basecamp.type_grants USING btree (member_type_id, category_id) WHERE (category_id IS NOT NULL);


--
-- Name: basecamp_type_grants_type_entry_key; Type: INDEX; Schema: basecamp; Owner: -
--

CREATE UNIQUE INDEX basecamp_type_grants_type_entry_key ON basecamp.type_grants USING btree (member_type_id, entry_id) WHERE (entry_id IS NOT NULL);


--
-- Name: access_audit basecamp_access_audit_no_mutation; Type: TRIGGER; Schema: basecamp; Owner: -
--

CREATE TRIGGER basecamp_access_audit_no_mutation BEFORE DELETE OR UPDATE ON basecamp.access_audit FOR EACH ROW EXECUTE FUNCTION basecamp.prevent_audit_mutation();


--
-- Name: access_audit basecamp_access_audit_no_truncate; Type: TRIGGER; Schema: basecamp; Owner: -
--

CREATE TRIGGER basecamp_access_audit_no_truncate BEFORE TRUNCATE ON basecamp.access_audit FOR EACH STATEMENT EXECUTE FUNCTION basecamp.prevent_audit_mutation();


--
-- Name: access_grants basecamp_access_grants_audit; Type: TRIGGER; Schema: basecamp; Owner: -
--

CREATE TRIGGER basecamp_access_grants_audit AFTER INSERT OR DELETE ON basecamp.access_grants FOR EACH ROW EXECUTE FUNCTION basecamp.log_access_change();


--
-- Name: access_grants basecamp_access_grants_no_truncate; Type: TRIGGER; Schema: basecamp; Owner: -
--

CREATE TRIGGER basecamp_access_grants_no_truncate BEFORE TRUNCATE ON basecamp.access_grants FOR EACH STATEMENT EXECUTE FUNCTION basecamp.prevent_access_truncate();


--
-- Name: categories basecamp_categories_set_updated_at; Type: TRIGGER; Schema: basecamp; Owner: -
--

CREATE TRIGGER basecamp_categories_set_updated_at BEFORE UPDATE ON basecamp.categories FOR EACH ROW EXECUTE FUNCTION basecamp.set_updated_at();


--
-- Name: entries basecamp_entries_set_updated_at; Type: TRIGGER; Schema: basecamp; Owner: -
--

CREATE TRIGGER basecamp_entries_set_updated_at BEFORE UPDATE ON basecamp.entries FOR EACH ROW EXECUTE FUNCTION basecamp.set_updated_at();


--
-- Name: member_types basecamp_member_types_no_system_delete; Type: TRIGGER; Schema: basecamp; Owner: -
--

CREATE TRIGGER basecamp_member_types_no_system_delete BEFORE DELETE ON basecamp.member_types FOR EACH ROW EXECUTE FUNCTION basecamp.prevent_system_type_delete();


--
-- Name: member_types basecamp_member_types_set_updated_at; Type: TRIGGER; Schema: basecamp; Owner: -
--

CREATE TRIGGER basecamp_member_types_set_updated_at BEFORE UPDATE ON basecamp.member_types FOR EACH ROW EXECUTE FUNCTION basecamp.set_updated_at();


--
-- Name: members basecamp_members_audit; Type: TRIGGER; Schema: basecamp; Owner: -
--

CREATE TRIGGER basecamp_members_audit AFTER INSERT OR DELETE OR UPDATE ON basecamp.members FOR EACH ROW EXECUTE FUNCTION basecamp.log_access_change();


--
-- Name: members basecamp_members_no_truncate; Type: TRIGGER; Schema: basecamp; Owner: -
--

CREATE TRIGGER basecamp_members_no_truncate BEFORE TRUNCATE ON basecamp.members FOR EACH STATEMENT EXECUTE FUNCTION basecamp.prevent_access_truncate();


--
-- Name: members basecamp_members_set_updated_at; Type: TRIGGER; Schema: basecamp; Owner: -
--

CREATE TRIGGER basecamp_members_set_updated_at BEFORE UPDATE ON basecamp.members FOR EACH ROW EXECUTE FUNCTION basecamp.set_updated_at();


--
-- Name: super_admins basecamp_super_admins_audit; Type: TRIGGER; Schema: basecamp; Owner: -
--

CREATE TRIGGER basecamp_super_admins_audit AFTER INSERT OR DELETE ON basecamp.super_admins FOR EACH ROW EXECUTE FUNCTION basecamp.log_access_change();


--
-- Name: super_admins basecamp_super_admins_keep_last; Type: TRIGGER; Schema: basecamp; Owner: -
--

CREATE TRIGGER basecamp_super_admins_keep_last BEFORE DELETE ON basecamp.super_admins FOR EACH ROW EXECUTE FUNCTION basecamp.prevent_last_super_admin_delete();


--
-- Name: super_admins basecamp_super_admins_no_truncate; Type: TRIGGER; Schema: basecamp; Owner: -
--

CREATE TRIGGER basecamp_super_admins_no_truncate BEFORE TRUNCATE ON basecamp.super_admins FOR EACH STATEMENT EXECUTE FUNCTION basecamp.prevent_super_admins_truncate();


--
-- Name: type_grants basecamp_type_grants_audit; Type: TRIGGER; Schema: basecamp; Owner: -
--

CREATE TRIGGER basecamp_type_grants_audit AFTER INSERT OR DELETE ON basecamp.type_grants FOR EACH ROW EXECUTE FUNCTION basecamp.log_access_change();


--
-- Name: type_grants basecamp_type_grants_no_truncate; Type: TRIGGER; Schema: basecamp; Owner: -
--

CREATE TRIGGER basecamp_type_grants_no_truncate BEFORE TRUNCATE ON basecamp.type_grants FOR EACH STATEMENT EXECUTE FUNCTION basecamp.prevent_access_truncate();


--
-- Name: access_grants basecamp_access_grants_category_id_fkey; Type: FK CONSTRAINT; Schema: basecamp; Owner: -
--

ALTER TABLE ONLY basecamp.access_grants
    ADD CONSTRAINT basecamp_access_grants_category_id_fkey FOREIGN KEY (category_id) REFERENCES basecamp.categories(id) ON DELETE CASCADE;


--
-- Name: access_grants basecamp_access_grants_entry_id_fkey; Type: FK CONSTRAINT; Schema: basecamp; Owner: -
--

ALTER TABLE ONLY basecamp.access_grants
    ADD CONSTRAINT basecamp_access_grants_entry_id_fkey FOREIGN KEY (entry_id) REFERENCES basecamp.entries(id) ON DELETE CASCADE;


--
-- Name: access_grants basecamp_access_grants_granted_by_fkey; Type: FK CONSTRAINT; Schema: basecamp; Owner: -
--

ALTER TABLE ONLY basecamp.access_grants
    ADD CONSTRAINT basecamp_access_grants_granted_by_fkey FOREIGN KEY (granted_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: access_grants basecamp_access_grants_user_id_fkey; Type: FK CONSTRAINT; Schema: basecamp; Owner: -
--

ALTER TABLE ONLY basecamp.access_grants
    ADD CONSTRAINT basecamp_access_grants_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: entries basecamp_entries_category_id_fkey; Type: FK CONSTRAINT; Schema: basecamp; Owner: -
--

ALTER TABLE ONLY basecamp.entries
    ADD CONSTRAINT basecamp_entries_category_id_fkey FOREIGN KEY (category_id) REFERENCES basecamp.categories(id) ON DELETE RESTRICT;


--
-- Name: members basecamp_members_assigned_by_fkey; Type: FK CONSTRAINT; Schema: basecamp; Owner: -
--

ALTER TABLE ONLY basecamp.members
    ADD CONSTRAINT basecamp_members_assigned_by_fkey FOREIGN KEY (assigned_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: members basecamp_members_member_type_id_fkey; Type: FK CONSTRAINT; Schema: basecamp; Owner: -
--

ALTER TABLE ONLY basecamp.members
    ADD CONSTRAINT basecamp_members_member_type_id_fkey FOREIGN KEY (member_type_id) REFERENCES basecamp.member_types(id) ON DELETE RESTRICT;


--
-- Name: members basecamp_members_user_id_fkey; Type: FK CONSTRAINT; Schema: basecamp; Owner: -
--

ALTER TABLE ONLY basecamp.members
    ADD CONSTRAINT basecamp_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: super_admins basecamp_super_admins_granted_by_fkey; Type: FK CONSTRAINT; Schema: basecamp; Owner: -
--

ALTER TABLE ONLY basecamp.super_admins
    ADD CONSTRAINT basecamp_super_admins_granted_by_fkey FOREIGN KEY (granted_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: super_admins basecamp_super_admins_user_id_fkey; Type: FK CONSTRAINT; Schema: basecamp; Owner: -
--

ALTER TABLE ONLY basecamp.super_admins
    ADD CONSTRAINT basecamp_super_admins_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE RESTRICT;


--
-- Name: type_grants basecamp_type_grants_category_id_fkey; Type: FK CONSTRAINT; Schema: basecamp; Owner: -
--

ALTER TABLE ONLY basecamp.type_grants
    ADD CONSTRAINT basecamp_type_grants_category_id_fkey FOREIGN KEY (category_id) REFERENCES basecamp.categories(id) ON DELETE CASCADE;


--
-- Name: type_grants basecamp_type_grants_entry_id_fkey; Type: FK CONSTRAINT; Schema: basecamp; Owner: -
--

ALTER TABLE ONLY basecamp.type_grants
    ADD CONSTRAINT basecamp_type_grants_entry_id_fkey FOREIGN KEY (entry_id) REFERENCES basecamp.entries(id) ON DELETE CASCADE;


--
-- Name: type_grants basecamp_type_grants_granted_by_fkey; Type: FK CONSTRAINT; Schema: basecamp; Owner: -
--

ALTER TABLE ONLY basecamp.type_grants
    ADD CONSTRAINT basecamp_type_grants_granted_by_fkey FOREIGN KEY (granted_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: type_grants basecamp_type_grants_member_type_id_fkey; Type: FK CONSTRAINT; Schema: basecamp; Owner: -
--

ALTER TABLE ONLY basecamp.type_grants
    ADD CONSTRAINT basecamp_type_grants_member_type_id_fkey FOREIGN KEY (member_type_id) REFERENCES basecamp.member_types(id) ON DELETE CASCADE;


--
-- Name: access_audit; Type: ROW SECURITY; Schema: basecamp; Owner: -
--

ALTER TABLE basecamp.access_audit ENABLE ROW LEVEL SECURITY;

--
-- Name: access_grants; Type: ROW SECURITY; Schema: basecamp; Owner: -
--

ALTER TABLE basecamp.access_grants ENABLE ROW LEVEL SECURITY;

--
-- Name: access_audit basecamp_access_audit_select_super_admin; Type: POLICY; Schema: basecamp; Owner: -
--

CREATE POLICY basecamp_access_audit_select_super_admin ON basecamp.access_audit FOR SELECT TO authenticated USING (( SELECT basecamp.is_super_admin() AS is_super_admin));


--
-- Name: access_grants basecamp_access_grants_delete_super_admin; Type: POLICY; Schema: basecamp; Owner: -
--

CREATE POLICY basecamp_access_grants_delete_super_admin ON basecamp.access_grants FOR DELETE TO authenticated USING (( SELECT basecamp.is_super_admin() AS is_super_admin));


--
-- Name: access_grants basecamp_access_grants_insert_super_admin; Type: POLICY; Schema: basecamp; Owner: -
--

CREATE POLICY basecamp_access_grants_insert_super_admin ON basecamp.access_grants FOR INSERT TO authenticated WITH CHECK (( SELECT basecamp.is_super_admin() AS is_super_admin));


--
-- Name: access_grants basecamp_access_grants_select_super_admin; Type: POLICY; Schema: basecamp; Owner: -
--

CREATE POLICY basecamp_access_grants_select_super_admin ON basecamp.access_grants FOR SELECT TO authenticated USING (( SELECT basecamp.is_super_admin() AS is_super_admin));


--
-- Name: categories basecamp_categories_delete_super_admin; Type: POLICY; Schema: basecamp; Owner: -
--

CREATE POLICY basecamp_categories_delete_super_admin ON basecamp.categories FOR DELETE TO authenticated USING (( SELECT basecamp.is_super_admin() AS is_super_admin));


--
-- Name: categories basecamp_categories_insert_super_admin; Type: POLICY; Schema: basecamp; Owner: -
--

CREATE POLICY basecamp_categories_insert_super_admin ON basecamp.categories FOR INSERT TO authenticated WITH CHECK (( SELECT basecamp.is_super_admin() AS is_super_admin));


--
-- Name: categories basecamp_categories_select_granted; Type: POLICY; Schema: basecamp; Owner: -
--

CREATE POLICY basecamp_categories_select_granted ON basecamp.categories FOR SELECT TO authenticated USING ((( SELECT basecamp.is_super_admin() AS is_super_admin) OR basecamp.category_has_grant(id)));


--
-- Name: categories basecamp_categories_update_super_admin; Type: POLICY; Schema: basecamp; Owner: -
--

CREATE POLICY basecamp_categories_update_super_admin ON basecamp.categories FOR UPDATE TO authenticated USING (( SELECT basecamp.is_super_admin() AS is_super_admin)) WITH CHECK (( SELECT basecamp.is_super_admin() AS is_super_admin));


--
-- Name: entries basecamp_entries_delete_super_admin; Type: POLICY; Schema: basecamp; Owner: -
--

CREATE POLICY basecamp_entries_delete_super_admin ON basecamp.entries FOR DELETE TO authenticated USING (( SELECT basecamp.is_super_admin() AS is_super_admin));


--
-- Name: entries basecamp_entries_insert_super_admin; Type: POLICY; Schema: basecamp; Owner: -
--

CREATE POLICY basecamp_entries_insert_super_admin ON basecamp.entries FOR INSERT TO authenticated WITH CHECK (( SELECT basecamp.is_super_admin() AS is_super_admin));


--
-- Name: entries basecamp_entries_select_granted; Type: POLICY; Schema: basecamp; Owner: -
--

CREATE POLICY basecamp_entries_select_granted ON basecamp.entries FOR SELECT TO authenticated USING ((( SELECT basecamp.is_super_admin() AS is_super_admin) OR basecamp.has_grant(id, category_id)));


--
-- Name: entries basecamp_entries_update_super_admin; Type: POLICY; Schema: basecamp; Owner: -
--

CREATE POLICY basecamp_entries_update_super_admin ON basecamp.entries FOR UPDATE TO authenticated USING (( SELECT basecamp.is_super_admin() AS is_super_admin)) WITH CHECK (( SELECT basecamp.is_super_admin() AS is_super_admin));


--
-- Name: member_types basecamp_member_types_delete_super_admin; Type: POLICY; Schema: basecamp; Owner: -
--

CREATE POLICY basecamp_member_types_delete_super_admin ON basecamp.member_types FOR DELETE TO authenticated USING (( SELECT basecamp.is_super_admin() AS is_super_admin));


--
-- Name: member_types basecamp_member_types_insert_super_admin; Type: POLICY; Schema: basecamp; Owner: -
--

CREATE POLICY basecamp_member_types_insert_super_admin ON basecamp.member_types FOR INSERT TO authenticated WITH CHECK (( SELECT basecamp.is_super_admin() AS is_super_admin));


--
-- Name: member_types basecamp_member_types_select_scoped; Type: POLICY; Schema: basecamp; Owner: -
--

CREATE POLICY basecamp_member_types_select_scoped ON basecamp.member_types FOR SELECT TO authenticated USING ((( SELECT basecamp.is_super_admin() AS is_super_admin) OR (id = ( SELECT m.member_type_id
   FROM basecamp.members m
  WHERE (m.user_id = ( SELECT auth.uid() AS uid))))));


--
-- Name: member_types basecamp_member_types_update_super_admin; Type: POLICY; Schema: basecamp; Owner: -
--

CREATE POLICY basecamp_member_types_update_super_admin ON basecamp.member_types FOR UPDATE TO authenticated USING (( SELECT basecamp.is_super_admin() AS is_super_admin)) WITH CHECK (( SELECT basecamp.is_super_admin() AS is_super_admin));


--
-- Name: members basecamp_members_delete_super_admin; Type: POLICY; Schema: basecamp; Owner: -
--

CREATE POLICY basecamp_members_delete_super_admin ON basecamp.members FOR DELETE TO authenticated USING (( SELECT basecamp.is_super_admin() AS is_super_admin));


--
-- Name: members basecamp_members_insert_super_admin; Type: POLICY; Schema: basecamp; Owner: -
--

CREATE POLICY basecamp_members_insert_super_admin ON basecamp.members FOR INSERT TO authenticated WITH CHECK (( SELECT basecamp.is_super_admin() AS is_super_admin));


--
-- Name: members basecamp_members_select_self_or_super_admin; Type: POLICY; Schema: basecamp; Owner: -
--

CREATE POLICY basecamp_members_select_self_or_super_admin ON basecamp.members FOR SELECT TO authenticated USING ((( SELECT basecamp.is_super_admin() AS is_super_admin) OR (user_id = ( SELECT auth.uid() AS uid))));


--
-- Name: members basecamp_members_update_super_admin; Type: POLICY; Schema: basecamp; Owner: -
--

CREATE POLICY basecamp_members_update_super_admin ON basecamp.members FOR UPDATE TO authenticated USING (( SELECT basecamp.is_super_admin() AS is_super_admin)) WITH CHECK (( SELECT basecamp.is_super_admin() AS is_super_admin));


--
-- Name: super_admins basecamp_super_admins_delete_super_admin; Type: POLICY; Schema: basecamp; Owner: -
--

CREATE POLICY basecamp_super_admins_delete_super_admin ON basecamp.super_admins FOR DELETE TO authenticated USING (( SELECT basecamp.is_super_admin() AS is_super_admin));


--
-- Name: super_admins basecamp_super_admins_insert_super_admin; Type: POLICY; Schema: basecamp; Owner: -
--

CREATE POLICY basecamp_super_admins_insert_super_admin ON basecamp.super_admins FOR INSERT TO authenticated WITH CHECK (( SELECT basecamp.is_super_admin() AS is_super_admin));


--
-- Name: super_admins basecamp_super_admins_select_super_admin; Type: POLICY; Schema: basecamp; Owner: -
--

CREATE POLICY basecamp_super_admins_select_super_admin ON basecamp.super_admins FOR SELECT TO authenticated USING (( SELECT basecamp.is_super_admin() AS is_super_admin));


--
-- Name: type_grants basecamp_type_grants_delete_super_admin; Type: POLICY; Schema: basecamp; Owner: -
--

CREATE POLICY basecamp_type_grants_delete_super_admin ON basecamp.type_grants FOR DELETE TO authenticated USING (( SELECT basecamp.is_super_admin() AS is_super_admin));


--
-- Name: type_grants basecamp_type_grants_insert_super_admin; Type: POLICY; Schema: basecamp; Owner: -
--

CREATE POLICY basecamp_type_grants_insert_super_admin ON basecamp.type_grants FOR INSERT TO authenticated WITH CHECK (( SELECT basecamp.is_super_admin() AS is_super_admin));


--
-- Name: type_grants basecamp_type_grants_select_super_admin; Type: POLICY; Schema: basecamp; Owner: -
--

CREATE POLICY basecamp_type_grants_select_super_admin ON basecamp.type_grants FOR SELECT TO authenticated USING (( SELECT basecamp.is_super_admin() AS is_super_admin));


--
-- Name: categories; Type: ROW SECURITY; Schema: basecamp; Owner: -
--

ALTER TABLE basecamp.categories ENABLE ROW LEVEL SECURITY;

--
-- Name: entries; Type: ROW SECURITY; Schema: basecamp; Owner: -
--

ALTER TABLE basecamp.entries ENABLE ROW LEVEL SECURITY;

--
-- Name: member_types; Type: ROW SECURITY; Schema: basecamp; Owner: -
--

ALTER TABLE basecamp.member_types ENABLE ROW LEVEL SECURITY;

--
-- Name: members; Type: ROW SECURITY; Schema: basecamp; Owner: -
--

ALTER TABLE basecamp.members ENABLE ROW LEVEL SECURITY;

--
-- Name: super_admins; Type: ROW SECURITY; Schema: basecamp; Owner: -
--

ALTER TABLE basecamp.super_admins ENABLE ROW LEVEL SECURITY;

--
-- Name: type_grants; Type: ROW SECURITY; Schema: basecamp; Owner: -
--

ALTER TABLE basecamp.type_grants ENABLE ROW LEVEL SECURITY;

--
-- Name: SCHEMA basecamp; Type: ACL; Schema: -; Owner: -
--

GRANT USAGE ON SCHEMA basecamp TO service_role;
GRANT USAGE ON SCHEMA basecamp TO authenticated;


--
-- Name: FUNCTION can_read_category(p_category_id uuid); Type: ACL; Schema: basecamp; Owner: -
--

REVOKE ALL ON FUNCTION basecamp.can_read_category(p_category_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION basecamp.can_read_category(p_category_id uuid) TO authenticated;
GRANT ALL ON FUNCTION basecamp.can_read_category(p_category_id uuid) TO service_role;


--
-- Name: FUNCTION can_read_entry(p_entry_id uuid, p_category_id uuid); Type: ACL; Schema: basecamp; Owner: -
--

REVOKE ALL ON FUNCTION basecamp.can_read_entry(p_entry_id uuid, p_category_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION basecamp.can_read_entry(p_entry_id uuid, p_category_id uuid) TO authenticated;
GRANT ALL ON FUNCTION basecamp.can_read_entry(p_entry_id uuid, p_category_id uuid) TO service_role;


--
-- Name: FUNCTION category_has_grant(p_category_id uuid); Type: ACL; Schema: basecamp; Owner: -
--

REVOKE ALL ON FUNCTION basecamp.category_has_grant(p_category_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION basecamp.category_has_grant(p_category_id uuid) TO authenticated;
GRANT ALL ON FUNCTION basecamp.category_has_grant(p_category_id uuid) TO service_role;


--
-- Name: FUNCTION has_grant(p_entry_id uuid, p_category_id uuid); Type: ACL; Schema: basecamp; Owner: -
--

REVOKE ALL ON FUNCTION basecamp.has_grant(p_entry_id uuid, p_category_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION basecamp.has_grant(p_entry_id uuid, p_category_id uuid) TO authenticated;
GRANT ALL ON FUNCTION basecamp.has_grant(p_entry_id uuid, p_category_id uuid) TO service_role;


--
-- Name: FUNCTION is_super_admin(); Type: ACL; Schema: basecamp; Owner: -
--

REVOKE ALL ON FUNCTION basecamp.is_super_admin() FROM PUBLIC;
GRANT ALL ON FUNCTION basecamp.is_super_admin() TO authenticated;
GRANT ALL ON FUNCTION basecamp.is_super_admin() TO service_role;


--
-- Name: FUNCTION list_people(); Type: ACL; Schema: basecamp; Owner: -
--

REVOKE ALL ON FUNCTION basecamp.list_people() FROM PUBLIC;
GRANT ALL ON FUNCTION basecamp.list_people() TO authenticated;
GRANT ALL ON FUNCTION basecamp.list_people() TO service_role;


--
-- Name: TABLE access_audit; Type: ACL; Schema: basecamp; Owner: -
--

GRANT SELECT ON TABLE basecamp.access_audit TO service_role;
GRANT SELECT ON TABLE basecamp.access_audit TO authenticated;


--
-- Name: SEQUENCE access_audit_id_seq; Type: ACL; Schema: basecamp; Owner: -
--

GRANT ALL ON SEQUENCE basecamp.access_audit_id_seq TO service_role;


--
-- Name: TABLE access_grants; Type: ACL; Schema: basecamp; Owner: -
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER ON TABLE basecamp.access_grants TO service_role;
GRANT SELECT,INSERT,DELETE ON TABLE basecamp.access_grants TO authenticated;


--
-- Name: TABLE categories; Type: ACL; Schema: basecamp; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE basecamp.categories TO authenticated;
GRANT ALL ON TABLE basecamp.categories TO service_role;


--
-- Name: TABLE entries; Type: ACL; Schema: basecamp; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE basecamp.entries TO authenticated;
GRANT ALL ON TABLE basecamp.entries TO service_role;


--
-- Name: TABLE member_types; Type: ACL; Schema: basecamp; Owner: -
--

GRANT ALL ON TABLE basecamp.member_types TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE basecamp.member_types TO authenticated;


--
-- Name: TABLE members; Type: ACL; Schema: basecamp; Owner: -
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER ON TABLE basecamp.members TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE basecamp.members TO authenticated;


--
-- Name: TABLE super_admins; Type: ACL; Schema: basecamp; Owner: -
--

GRANT SELECT,INSERT,DELETE ON TABLE basecamp.super_admins TO service_role;
GRANT SELECT ON TABLE basecamp.super_admins TO authenticated;


--
-- Name: TABLE type_grants; Type: ACL; Schema: basecamp; Owner: -
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER ON TABLE basecamp.type_grants TO service_role;
GRANT SELECT,INSERT,DELETE ON TABLE basecamp.type_grants TO authenticated;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: basecamp; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA basecamp GRANT ALL ON SEQUENCES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: basecamp; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA basecamp GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,UPDATE ON TABLES TO service_role;


--
-- PostgreSQL database dump complete
--


