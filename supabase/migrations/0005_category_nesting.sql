-- ---------------------------------------------------------------------------
-- 0005_category_nesting.sql — one level of subcategories under a category.
--
-- WHAT THIS ADDS. `basecamp.categories.parent_id`, a self-reference. A category
-- with a NULL parent is top level; a category with a parent is a subcategory of
-- it. Entries are unchanged: `entries.category_id` already points at any
-- category row, so a tile can sit directly in a top-level category or inside a
-- subcategory without touching that table.
--
-- WHAT THIS ADDS NO PRIVILEGE FOR, DELIBERATELY. `authenticated` already holds
-- SELECT/INSERT/UPDATE/DELETE on `basecamp.categories` from 0001, and the
-- super_admin-scoped policies already govern all four. `parent_id` is an
-- ordinary column on a table whose access model is already decided, so nesting
-- needs no new grant and no new policy — which is the point: adding a category,
-- with or without a parent, is settled by a policy rather than by a check in
-- application code.
--
-- THE DEPTH CAP IS ONE LEVEL, AND THE DATABASE IS WHAT ENFORCES IT.
--
-- Why cap it at all: every consumer of this data assumes a fixed shape. The
-- home page renders category → entries, the access matrix has a column per
-- category, and `category_has_grant()` answers a flat question. Arbitrary depth
-- would silently break each of those in a different way — a grant that does not
-- reach three levels down, a matrix wider than the screen, a home page that
-- recurses. One level is the depth the UI can actually draw and the access model
-- can actually express.
--
-- Why in the database: a cap that lives only in the dialog is not a cap. This
-- app writes categories straight from the browser on the caller's token, so
-- anything the policy allows is reachable from a console, and the shape the
-- readers depend on has to hold regardless of which client wrote the row.
--
-- A CHECK constraint cannot express it — the rule is about ANOTHER ROW (is my
-- parent itself a child?) and CHECK sees only the row being written. So it is a
-- trigger, for the reason `prevent_system_type_delete` gives: only a trigger
-- can refuse with a message that says why.
--
-- DELETING A CATEGORY THAT STILL HOLDS SOMETHING IS REFUSED, not cascaded.
-- `entries.category_id` was already ON DELETE RESTRICT in 0001; `parent_id`
-- matches it. A category is a container, and taking its contents with it is
-- never what somebody clicking "delete" on a container meant.
--
-- Atomic and idempotent, like 0002 and 0004: a failing post-condition must
-- leave nothing behind.
-- ---------------------------------------------------------------------------

begin;

-- ---------------------------------------------------------------------------
-- 1. The column.
--
-- ON DELETE RESTRICT, matching entries. NOT `SET NULL`: silently promoting a
-- subcategory to top level when its parent is deleted would move somebody's
-- content without saying so.
-- ---------------------------------------------------------------------------
alter table basecamp.categories
  add column if not exists parent_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint c
      join pg_class t on t.oid = c.conrelid
      join pg_namespace ns on ns.oid = t.relnamespace
     where ns.nspname = 'basecamp' and t.relname = 'categories'
       and c.conname = 'basecamp_categories_parent_id_fkey'
  ) then
    alter table basecamp.categories
      add constraint basecamp_categories_parent_id_fkey
      foreign key (parent_id) references basecamp.categories(id) on delete restrict;
  end if;

  -- A row cannot be its own parent. This one IS expressible as a CHECK, because
  -- it only looks at the row being written — so it is a CHECK, and the trigger
  -- below is left to the part a CHECK cannot see.
  if not exists (
    select 1 from pg_constraint c
      join pg_class t on t.oid = c.conrelid
      join pg_namespace ns on ns.oid = t.relnamespace
     where ns.nspname = 'basecamp' and t.relname = 'categories'
       and c.conname = 'basecamp_categories_parent_not_self'
  ) then
    alter table basecamp.categories
      add constraint basecamp_categories_parent_not_self check (parent_id is distinct from id);
  end if;
end $$;

comment on column basecamp.categories.parent_id is
  'The category this one sits under, or NULL for a top-level category. Nesting is capped at ONE level by basecamp.enforce_category_depth(): a category whose parent already has a parent is refused, and so is giving a parent to a category that already has children. The cap exists because every reader of this table assumes a fixed shape — the home page, the access matrix and category_has_grant() are all flat or one-deep. ON DELETE RESTRICT, like entries.category_id: a container does not take its contents with it.';

-- ---------------------------------------------------------------------------
-- 2. The depth cap.
--
-- Two directions, and BOTH are needed. Checking only the first lets you build a
-- three-level tree from the bottom up: create A, create B under A, then give A
-- a parent. The row being written is legal in isolation each time; the tree is
-- not.
--
-- SECURITY DEFINER with a pinned search_path, like every other guard here. It
-- reads `basecamp.categories` to answer a question about a row other than the
-- one being written, which is exactly what a CHECK cannot do.
-- ---------------------------------------------------------------------------
create or replace function basecamp.enforce_category_depth() returns trigger
  language plpgsql
  security definer
  set search_path to ''
as $$
declare
  v_parent_has_parent boolean;
  v_has_children      boolean;
begin
  if new.parent_id is not null then
    -- SELF FIRST, and before the FK probe. The CHECK constraint catches this on
    -- INSERT, but on UPDATE the two guards do NOT overlap: `set parent_id = id`
    -- reads the row's OLD parent (null → downward passes) and asks whether any
    -- row already names this one as parent (not yet true → upward passes). So
    -- without this the trigger waves through a 1-cycle — a row that is its own
    -- parent, which every parent-join loops on and which ON DELETE RESTRICT
    -- makes permanently undeletable.
    --
    -- It also has to come before the probe below, or the FK lookup reports
    -- "no category with id X to nest under" about the very row being written.
    if new.parent_id = new.id then
      raise exception 'a category cannot be its own parent'
        using errcode = 'restrict_violation';
    end if;

    -- DOWNWARD: my parent must be top level.
    --
    -- `FOR SHARE`, and it is load-bearing. Under READ COMMITTED two concurrent
    -- transactions — one inserting a child under A, one giving A a parent —
    -- both read pre-commit state, both see a legal row, and both commit,
    -- leaving a three-level tree past a cap every reader assumes holds. The
    -- share lock makes the second wait: giving A a parent takes a row lock on
    -- A, so this SELECT blocks and then re-reads on a fresh snapshot.
    --
    -- SHARE, not UPDATE: two children being added under the same parent are not
    -- in conflict with each other and must not serialise.
    select (c.parent_id is not null) into v_parent_has_parent
      from basecamp.categories c where c.id = new.parent_id for share;

    if v_parent_has_parent is null then
      -- The FK will refuse this too, but a trigger firing first would otherwise
      -- report "null" as the answer to a question about a row that is not there.
      raise exception 'no category with id % to nest under', new.parent_id
        using errcode = 'foreign_key_violation';
    end if;

    if v_parent_has_parent then
      raise exception
        'cannot nest "%" under a subcategory — categories go one level deep, because the catalog and the access matrix both render a flat or one-deep shape',
        new.name
        using errcode = 'restrict_violation';
    end if;

    -- UPWARD: I must not already have children. Only reachable on UPDATE, and
    -- only when a top-level category with subcategories is given a parent.
    select exists (select 1 from basecamp.categories c where c.parent_id = new.id)
      into v_has_children;

    if v_has_children then
      raise exception
        'cannot move "%" under another category while it still has subcategories of its own — categories go one level deep',
        new.name
        using errcode = 'restrict_violation';
    end if;
  end if;

  return new;
end $$;

comment on function basecamp.enforce_category_depth() IS
  'Caps category nesting at one level, in both directions: a category may not be nested under one that already has a parent, and a category that already has children may not be given one. A trigger rather than a CHECK because the rule is about another row — CHECK sees only the row being written. SECURITY DEFINER so it can read basecamp.categories past RLS; the answer must not depend on what the writer happens to be able to see.';

revoke execute on function basecamp.enforce_category_depth() from public;
revoke execute on function basecamp.enforce_category_depth() from authenticated, service_role;

drop trigger if exists basecamp_categories_depth_cap on basecamp.categories;
-- `UPDATE OF parent_id` plus a WHEN clause is precision, not micro-optimisation:
-- without them every rename and every sibling reorder of a subcategory
-- re-answers a question about a column that did not change, taking a share lock
-- each time. `UPDATE OF` fires when the column appears in the SET list at all —
-- conservative in the safe direction — and `tg_op` is deliberately not used
-- here because it is not available to a WHEN clause.
--
-- Safe in both directions. A row that is legal can only be made illegal by a
-- CHILD appearing beneath it, and that child's own insert runs the downward
-- check — so nothing slips through by not re-checking an untouched parent_id.
create trigger basecamp_categories_depth_cap
  before insert or update of parent_id on basecamp.categories
  for each row
  when (new.parent_id is not null)
  execute function basecamp.enforce_category_depth();

-- ---------------------------------------------------------------------------
-- 2b. The READ model has to learn about nesting too.
--
-- `category_has_grant()` opens with "does this category hold at least one entry
-- of its own". Before nesting that was complete. It is not any more: the
-- arrangement this migration exists to enable — a parent used purely as a
-- container, with the tiles in its subcategories — holds no direct entries, so
-- the parent is invisible while its child is visible. The client then receives
-- a row whose `parent_id` names a category it cannot read: a dangling
-- reference, and a catalog where the grouping the administrator built does not
-- appear.
--
-- WHAT THIS DOES AND DOES NOT WIDEN. The original rule exists so that a grant
-- on an EMPTY category cannot disclose its name and description to somebody who
-- can see nothing inside it. That threat is untouched: a category with no
-- entries and no granted children is still invisible. What is added is
-- narrower — a parent becomes visible when the viewer can already see a tile
-- inside one of its children. They are already in that branch; the parent's
-- name is one more string about a place they are standing.
--
-- Bounded by the depth cap: exactly one extra level, no recursion, one join.
-- A definer because a policy on `basecamp.categories` that reads
-- `basecamp.categories` would recurse against its own RLS.
-- ---------------------------------------------------------------------------
create or replace function basecamp.category_or_child_has_grant(p_category_id uuid)
  returns boolean
  language sql
  stable
  security definer
  set search_path to ''
as $$
  select basecamp.category_has_grant(p_category_id)
      or exists (
           select 1 from basecamp.categories ch
            where ch.parent_id = p_category_id
              and basecamp.category_has_grant(ch.id)
         );
$$;

comment on function basecamp.category_or_child_has_grant(uuid) is
  'category_has_grant(), widened by exactly one level: true when the viewer can see a tile in this category OR in one of its direct subcategories. Exists so a parent used purely as a container is not invisible while its children are visible, which would leave the client holding a parent_id it cannot resolve. Bounded by the one-level depth cap — no recursion. Does NOT widen the original rule that an empty category with no granted children stays hidden.';

revoke execute on function basecamp.category_or_child_has_grant(uuid) from public;
grant execute on function basecamp.category_or_child_has_grant(uuid) to authenticated, service_role;

drop policy if exists basecamp_categories_select_granted on basecamp.categories;
create policy basecamp_categories_select_granted on basecamp.categories
  for select to authenticated
  using (
    (select basecamp.is_super_admin())
    or basecamp.category_or_child_has_grant(id)
  );

-- ---------------------------------------------------------------------------
-- 3. Ordering support.
--
-- Subcategories are ordered within their parent, so the index that serves the
-- read path is on (parent_id, sort_order). Not unique: `sort_order` is not
-- unique anywhere in this schema and every reader tie-breaks on slug.
-- ---------------------------------------------------------------------------
create index if not exists basecamp_categories_parent_id_idx
  on basecamp.categories using btree (parent_id, sort_order);

-- ---------------------------------------------------------------------------
-- 4. Post-conditions. Same discipline as 0002 and 0004: asserted, not
--    described. Duplicated into 0002 where they can fail on a re-run — the
--    copies here run directly after the statements that create what they check,
--    so on their own they would be tautologies.
-- ---------------------------------------------------------------------------
do $$
declare
  n integer;
begin
  -- 4a. The column, the FK and its delete behaviour. `confdeltype = 'r'` is
  -- RESTRICT; 'c' would be CASCADE, which is the outcome this migration exists
  -- to prevent.
  if not exists (
    select 1 from pg_attribute a
      join pg_class c on c.oid = a.attrelid
      join pg_namespace ns on ns.oid = c.relnamespace
     where ns.nspname = 'basecamp' and c.relname = 'categories'
       and a.attname = 'parent_id' and not a.attisdropped
  ) then
    raise exception 'basecamp.categories.parent_id is missing — nesting cannot work';
  end if;
  if not exists (
    select 1 from pg_constraint c
      join pg_class t on t.oid = c.conrelid
      join pg_namespace ns on ns.oid = t.relnamespace
     where ns.nspname = 'basecamp' and t.relname = 'categories'
       and c.conname = 'basecamp_categories_parent_id_fkey'
       and c.confdeltype = 'r'
  ) then
    raise exception 'categories.parent_id is not ON DELETE RESTRICT — deleting a parent would take its subcategories with it';
  end if;
  -- The same question for entries, which 0001 set and nothing here changes.
  -- Asserted anyway: "deleting a category does not delete its contents" is the
  -- promise this screen makes, and half of it lives in another migration.
  if not exists (
    select 1 from pg_constraint c
      join pg_class t on t.oid = c.conrelid
      join pg_namespace ns on ns.oid = t.relnamespace
     where ns.nspname = 'basecamp' and t.relname = 'entries'
       and c.conname = 'basecamp_entries_category_id_fkey'
       and c.confdeltype = 'r'
  ) then
    raise exception 'entries.category_id is not ON DELETE RESTRICT — deleting a category would take its entries with it';
  end if;

  -- 4b DELETED, deliberately. It asserted that enforce_category_depth exists,
  -- is a definer, and that its trigger is attached and enabled — directly after
  -- an unconditional `create or replace function` and `drop/create trigger` in
  -- this same transaction. Nothing between them could change either fact, so it
  -- was a check that could not fire, which is the trap 0004's post-conditions
  -- fell into. The twin that CAN fail lives in 0002 (D20) and in D16, both of
  -- which are re-run by the mutation suite.

  -- 4b-bis. The read path knows about nesting. Without this a granted viewer
  -- receives a subcategory whose parent_id names a row they cannot read.
  if not exists (
    select 1 from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'basecamp' and p.proname = 'category_or_child_has_grant' and p.prosecdef
  ) then
    raise exception 'category_or_child_has_grant is missing or is not SECURITY DEFINER';
  end if;
  if not exists (
    select 1 from pg_policies
     where schemaname = 'basecamp' and tablename = 'categories' and cmd = 'SELECT'
       and qual like '%category_or_child_has_grant%'
  ) then
    raise exception 'the categories SELECT policy no longer consults category_or_child_has_grant — a container parent is invisible while its children are not';
  end if;

  -- 4b-ter. THE GATE'S BODY, PINNED. Existence, prosecdef and the policy's
  -- mention are all satisfied by `select true`, which discloses every category
  -- to a user with no grants — the same defeat 0002 records for
  -- `category_has_grant`, and PROVEN against this file before the pin was added.
  --
  -- The digest is over LINE-ENDING-NORMALIZED text, exactly as 0002's pins are.
  -- A raw `md5(prosrc)` would refuse every SQL-Editor install of this file; the
  -- mutation suite's preflight greps for that shape, and its Editor-path arm
  -- would catch it too.
  --
  -- The twin lives in 0002, guarded on this function's existence because 0002
  -- runs before this file on a fresh stamp. Edit both or neither.
  if not exists (
    select 1 from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'basecamp' and p.proname = 'category_or_child_has_grant'
       and md5(replace(replace(p.prosrc, chr(13) || chr(10), chr(10)),
                       chr(13), chr(10))) = '0f7bc3e3f3d517c82dba18b84b508f7a'
  ) then
    raise exception 'category_or_child_has_grant''s body differs from the one this migration ships — READ the new body before re-deriving its digest';
  end if;

  -- 4c. NO NEW PRIVILEGE was granted. This migration adds a column to a table
  -- whose access model 0001 already settled; if it has quietly widened
  -- anything, that is the thing to catch.
  if has_table_privilege('anon', 'basecamp.categories', 'select')
     or has_table_privilege('anon', 'basecamp.categories', 'insert') then
    raise exception 'anon gained access to basecamp.categories';
  end if;
  if has_any_column_privilege('authenticated', 'basecamp.categories', 'update')
     and not exists (select 1 from pg_policies
                      where schemaname = 'basecamp' and tablename = 'categories'
                        and cmd = 'UPDATE' and qual like '%is_super_admin()%') then
    raise exception 'authenticated can UPDATE categories without a super_admin policy deciding it';
  end if;

  -- 4d. No existing row is nested deeper than the cap allows. Unreachable on a
  -- first apply (every row is top level) and the point of the check on a
  -- re-run: it is what stops the cap being added AFTER data already broke it.
  if exists (
    select 1 from basecamp.categories c
      join basecamp.categories p on p.id = c.parent_id
     where p.parent_id is not null
  ) then
    raise exception 'a category is nested more than one level deep — the depth cap was added after the data broke it';
  end if;
end $$;

commit;
