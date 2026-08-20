#!/bin/bash
# Mutation suite for the basecamp security boundary.
#
# WHAT IT PROVES. Each case breaks exactly ONE thing in a throwaway mirror of
# this schema and requires the boundary assertions to REFUSE. The control case
# requires an unbroken schema to COMMIT — a file that fails on everything proves
# nothing either.
#
# WHY IT IS COMMITTED. Every "PROVEN" claim in `0002_security_boundary.sql`
# rests on these cases. Uncommitted, those claims are unfalsifiable and the next
# person to edit the boundary cannot re-prove them. Twelve of these cases exist
# because a review defeated an assertion that had already shipped in a draft;
# each is labelled at the check it motivated.
#
# WHAT PASSING DOES NOT MEAN. 73/73 says the assertions catch the 72 mutations
# BELOW (71 distinct — one case is deliberately run twice, under two different
# provenance labels). It does not say they catch everything: a later review
# defeated several of `0002`'s stated invariants with mutations this file does
# not contain. They are enumerated in issues.md under "Known gaps in the security
# boundary". Read that before treating a green run as a clean bill of health.
#
# TWO TRANSPORTS, AND THE SECOND ONE IS THE CLIENT'S. Parts 1-11 apply the
# files with `psql -f` on LF endings. Part 12 applies the same two files the way
# a client does — pasted, CRLF, whole-file — because a green psql run said
# nothing about that route and a client's provision died on it. Keep both. The
# totals are printed per transport for the same reason.
#
# YOU DO NOT NEED THIS FILE TO USE THE TEMPLATE. It proves the boundary is
# enforced; provisioning only needs the two files in `supabase/migrations/`. Run
# it if you edit `0002`, or if you want the proof for yourself rather than on
# trust.
#
# REQUIREMENTS. A throwaway PostgreSQL 16 or 17 cluster you do not care about,
# plus `perl` on PATH — PART 12 uses it to build the CRLF fixtures, and the
# preflight stops the run if it is missing.
# NEVER point this at production — it drops and recreates databases.
#
#   export LC_ALL=C
#   initdb -U postgres -A trust /tmp/bcpg
#   mkdir -p /tmp/bc17
#   pg_ctl -D /tmp/bcpg -o "-p 55440 -k /tmp/bc17 -c listen_addresses=''" -l /tmp/bcpg.log start
#   bash supabase/tests/boundary_mutations.sh
#
# Override the socket/port with BC_SOCK and BC_PORT.
#
# For each mutation: rebuild a mirror of the schema, break ONE thing, re-run
# `0002`, require it to REFUSE. Plus a control on an unbroken schema, which must
# COMMIT — a file that fails on everything proves nothing either.
#
# The mirror is built from supabase/migrations/0001_baseline.sql, a pg_dump of a
# real database, so what is being mutated is the real shape and not a fixture.
# Self-locating: REPO is this script's grandparent, SP its own directory.
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SP="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export LC_ALL=C
# Override with BC_SOCK / BC_PORT to point at your own throwaway cluster.
SOCK="${BC_SOCK:-/tmp/bc17}"
PORT="${BC_PORT:-55440}"
TPL="$REPO/supabase/migrations/0002_security_boundary.sql"
# The throwaway database this suite drops and recreates 73 times. Per-process by
# default: a shared name lets two concurrent runs on one cluster drop each
# other's database mid-case. That happened during review — one run reported
# 11 passed, 62 failed, and only the setup checks below made it visible rather
# than silently green.
# Lower case only. `create database FooBar` folds to `foobar` while `-d FooBar`
# does not, so an upper-case override makes every case die at `setup failed
# [stub]` with nothing pointing at the name.
DB="${BC_DB:-mut_$$}"

BASE="psql -h $SOCK -p $PORT -U postgres -X -q -v ON_ERROR_STOP=1"

pass=0; fail=0; ran=0; whitelist_hits=0

# How many cases the two expect-COMMIT lists below should match between them.
# A whitelist entry that matches NOTHING is silent — the run stays green while a
# reader believes a case is accounted for, and a rename is exactly how that
# happens (one of these cases was renamed a day after it was written). Asserted
# at the end, same discipline as EXPECTED_CASES.
EXPECTED_WHITELIST_HITS=6

# How many cases this file is supposed to run: 72 mutations plus 1 control.
# Asserted at the end, because "69 passed, 0 failed" and "72 passed, 0 failed"
# both print green and exit 0. Losing cases to a three-way merge is the same
# silent-reversion failure the whole boundary is defended against, applied to
# the artifact that is its only proof. Change this number in the same commit as
# a case, never to make a run go quiet.
EXPECTED_CASES=96

# Cases `0002` is expected to COMMIT rather than refuse, because it ASSIGNS as
# well as asserts: sections 1-2 pin ownership and fix EXECUTE grants, so
# re-running it repairs these mutations before the assertions read them. That is
# correct behaviour for a provisioning file — it is what makes a fresh install
# self-correcting — and it is NOT a coverage gap.
#
# The list is a WHITELIST, not a fallback: a case not named here must be
# REFUSED. Adding a name to it silently converts a real hole into a pass, so
# each entry must be a mutation section 1 or 2 demonstrably repairs.
#
# ONE REASON PER LIST. A sixth case also expects COMMITTED, but for a completely
# different reason — nothing repairs it, it simply is not an error. Conflating
# "0002 fixed it" with "0002 does not care" in one list is how a real hole gets
# whitelisted later behind a plausible-looking name, so they are kept apart.
repairs_before_asserting () {
  case "$1" in
    "authenticated lost EXECUTE on the access gate"|\
    "PUBLIC granted execute on a CALLABLE definer"|\
    "table ownership changed away from postgres"|\
    "PUBLIC EXECUTE restored on a definer trigger fn"|\
    "EXECUTE on log_access_change to authenticated") return 0 ;;
  esac
  return 1
}

# Not repaired — not an error. There is no digest pin on the policy SET, so a
# policy that ADDS a rule while still consulting the access model is a
# legitimate extension. Note the narrowness: this is only true because the added
# policy's predicate calls a helper. A permit-all addition is still refused, and
# a client's own-row policy on their own new table is ALSO refused today — see
# issues.md, "Known gaps in the security boundary".
not_an_error_here () {
  case "$1" in
    "a policy ADDED naming the access model") return 0 ;;
  esac
  return 1
}

run_case () {
  local name="$1" expect="$2" mutation="$3"
  if repairs_before_asserting "$name" || not_an_error_here "$name"; then
    expect=COMMITTED
    whitelist_hits=$((whitelist_hits+1))
  fi
  ran=$((ran+1))

  # EVERY setup step is checked. Unchecked, a failed step makes each
  # REFUSED-expecting case pass for the wrong reason — 0002 refuses because the
  # schema was never built, not because it caught the mutation — and 72 of the
  # 73 cases would report PASS on an empty database. Only the CONTROL would
  # notice, which is one case guarding all the others.
  #
  # `drop database` failing matters most: it leaves the PREVIOUS case's mutation
  # in place, so the next case tests a schema broken two ways.
  # First arg is a label, not psql input — three of the four steps are
  # `-d $DB -f <file>`, so printing the first two arguments named all three
  # identically and could not answer the one question the message exists for.
  setup () {
    local step="$1"; shift
    $BASE "$@" >/dev/null 2>&1 && return 0
    echo "  ERROR   setup failed [$step]: $name"; fail=$((fail+1)); return 1
  }
  setup "create db"  -c "drop database if exists $DB;" -c "create database $DB;" || return
  setup "stub"       -d $DB -f "$SP/_supabase_surface_stub.sql"                  || return
  setup "0001"       -d $DB -f "$REPO/supabase/migrations/0001_baseline.sql"     || return
  # `0002` ASSIGNS as well as asserts (it pins ownership and fixes EXECUTE
  # grants), so it must run BEFORE the mutation — otherwise it would repair the
  # very thing under test and the case would prove nothing.
  setup "0002 first" -d $DB -f "$TPL"                                          || return

  if [ -n "$mutation" ]; then
    if ! $BASE -d $DB -c "$mutation" >/dev/null 2>&1; then
      echo "  ERROR   mutation did not apply: $name"; fail=$((fail+1)); return
    fi
  fi
  if $BASE -d $DB -f "$TPL" >/dev/null 2>&1; then got=COMMITTED; else got=REFUSED; fi
  if [ "$got" = "$expect" ]; then
    echo "  PASS  [$got] $name"; pass=$((pass+1))
  else
    echo "  FAIL  [got $got, wanted $expect] $name"; fail=$((fail+1))
  fi
}

# A missing artifact makes every case ERROR at the mutation step or, worse, pass
# vacuously — fail loudly instead.
for f in "$SP/_supabase_surface_stub.sql" "$REPO/supabase/migrations/0001_baseline.sql" "$TPL"; do
  [ -r "$f" ] || { echo "missing or unreadable: $f" >&2; exit 2; }
done
if ! $BASE -c "select 1" >/dev/null 2>&1; then
  echo "no PostgreSQL at $SOCK:$PORT — start a throwaway cluster (see the header) or set BC_SOCK/BC_PORT" >&2
  exit 2
fi

# PART 12's fixtures, built and checked HERE rather than at PART 12 itself.
# Everything below `exit 2`s, and by PART 12 the psql arm has already run 96
# cases and printed them — exiting there would throw that away and never reach
# the TOTAL line. A dependency problem should stop the run before it starts.
command -v perl >/dev/null 2>&1 || {
  echo "perl is required to build the Editor-path fixtures (PART 12)" >&2; exit 2; }
EDIR="$(mktemp -d "${TMPDIR:-/tmp}/bc-editor.XXXXXX")"
trap 'rm -rf "$EDIR"' EXIT
perl -pe 's/\n/\r\n/' "$REPO/supabase/migrations/0001_baseline.sql" > "$EDIR/0001.crlf.sql"
perl -pe 's/\n/\r\n/' "$TPL"                                       > "$EDIR/0002.crlf.sql"
# Each file is passed as ONE `-c` argument, so it must fit in one. Two different
# limits apply and the smaller one is not the famous one: Linux caps a SINGLE
# argument at MAX_ARG_STRLEN, a fixed 128 KiB, independent of the much larger
# ARG_MAX that governs the whole vector. macOS has no per-argument cap, so a
# file that is fine on the maintainer's laptop can fail with E2BIG on the Linux
# throwaway cluster the header sends people to. 0001 is a pg_dump of a schema
# clients are told to extend, so this is a live ceiling, not a formality — and
# without the check every case reports "setup failed [0001 via editor path]",
# which sends the reader hunting a boundary regression that is not there.
# The cap is MAX_ARG_STRLEN (a fixed 128 KiB on Linux), or ARG_MAX where that is
# somehow smaller, less room for the rest of the command line. Deriving it from
# ARG_MAX alone was wrong in both directions: a fraction of it is unrelated to
# the real per-argument limit, and on a host reporting ARG_MAX=131072 a quarter
# of it would refuse a setup that works fine.
EDITOR_ARM_BLOCKED=""
lim=131072
[ "$(getconf ARG_MAX)" -lt "$lim" ] && lim=$(getconf ARG_MAX)
lim=$(( lim - 4096 ))
for f in "$EDIR/0001.crlf.sql" "$EDIR/0002.crlf.sql"; do
  sz=$(wc -c < "$f")
  if [ "$sz" -gt "$lim" ]; then
    # NOT `exit 2`. This is PART 12's problem alone, and exiting here would throw
    # away 96 psql cases that were about to run and report perfectly well.
    # Appended, not assigned: with both fixtures over the limit, overwriting would
    # name only the second and send the reader after half the problem. `$((sz))`
    # strips the padding macOS `wc -c` adds.
    EDITOR_ARM_BLOCKED="${EDITOR_ARM_BLOCKED:+$EDITOR_ARM_BLOCKED; }$f is $((sz)) bytes, over the $lim byte limit for one -c argument"
  fi
done
# The CRLF-ing must have actually happened. `perl` exiting 0 says nothing: a
# perl that did nothing would leave the arm testing the LF path a second time
# and reporting seven green cases for a route it never touched — the exact
# failure mode PART 12 exists to end, so it is asserted, not assumed.
#
# The threshold is a floor, not a count: 0001 is 1735 lines and 0002 is 968, so
# a CR count under 100 means the conversion did not happen rather than that it
# half-happened. An exact count would have to be maintained against the files and
# would fail on every edit.
for f in "$EDIR/0001.crlf.sql" "$EDIR/0002.crlf.sql"; do
  if [ "$(LC_ALL=C tr -cd '\r' < "$f" | wc -c)" -lt 100 ]; then
    echo "editor arm: $f has no carriage returns — the CRLF fixture was not built" >&2
    exit 2
  fi
done

echo "### target: supabase/migrations/0002_security_boundary.sql"
echo
echo "=== CONTROL — an unbroken schema must commit ==="
run_case "clean mirror of the live schema" COMMITTED ""

echo
echo "=== PART 1: COMPLETENESS — the schema is actually there. Each must be REFUSED ==="
run_case "a required table is missing"                    REFUSED "drop table basecamp.access_audit cascade;"
run_case "a different required table is missing"          REFUSED "drop table basecamp.type_grants cascade;"
run_case "an RLS policy was dropped"                      REFUSED "drop policy basecamp_access_audit_select_super_admin on basecamp.access_audit;"
run_case "a definer function was dropped"                 REFUSED "drop function basecamp.can_read_category(uuid);"
run_case "a trigger was dropped"                          REFUSED "drop trigger basecamp_members_set_updated_at on basecamp.members;"
run_case "the TABLES default-ACL row never existed"       REFUSED "alter default privileges for role postgres in schema basecamp revoke all on tables from service_role;"

echo
echo "=== PART 2: POSITIVE GRANTS — the other half. Each must be REFUSED ==="
run_case "authenticated lost USAGE on the schema"         REFUSED "revoke usage on schema basecamp from authenticated;"
run_case "authenticated lost SELECT on the catalog"       REFUSED "revoke select on basecamp.entries from authenticated;"
run_case "authenticated lost SELECT on the audit log"     REFUSED "revoke select on basecamp.access_audit from authenticated;"
run_case "authenticated lost INSERT on access_grants"     REFUSED "revoke insert on basecamp.access_grants from authenticated;"
run_case "authenticated lost DELETE on type_grants"       REFUSED "revoke delete on basecamp.type_grants from authenticated;"
run_case "authenticated lost UPDATE on members"           REFUSED "revoke update on basecamp.members from authenticated;"
run_case "authenticated lost INSERT on entries"           REFUSED "revoke insert on basecamp.entries from authenticated;"
run_case "authenticated lost EXECUTE on the access gate"  REFUSED "revoke execute on function basecamp.is_super_admin() from authenticated;"

echo
echo "=== PART 3: NEGATIVE ASSERTIONS re-run. Each must be REFUSED ==="
run_case "anon granted USAGE on the schema"               REFUSED "grant usage on schema basecamp to anon;"
run_case "authenticated granted INSERT on trust root"     REFUSED "grant insert on basecamp.super_admins to authenticated;"
run_case "service_role re-granted UPDATE on trust root"   REFUSED "grant update on basecamp.super_admins to service_role;"
run_case "authenticated granted UPDATE on a grant table"  REFUSED "grant update on basecamp.access_grants to authenticated;"
run_case "authenticated granted INSERT on the audit log"  REFUSED "grant insert on basecamp.access_audit to authenticated;"
run_case "service_role can erase the audit log"           REFUSED "grant delete on basecamp.access_audit to service_role;"
run_case "last-admin guard disabled (definition kept)"    REFUSED "alter table basecamp.super_admins disable trigger basecamp_super_admins_keep_last;"
run_case "audit append-only guard disabled"               REFUSED "alter table basecamp.access_audit disable trigger basecamp_access_audit_no_mutation;"
run_case "an audit writer detached"                       REFUSED "drop trigger basecamp_type_grants_audit on basecamp.type_grants;"
run_case "a TRUNCATE guard on an audited table detached"  REFUSED "drop trigger basecamp_members_no_truncate on basecamp.members;"
run_case "definer stripped of its search_path"            REFUSED "alter function basecamp.is_super_admin() reset search_path;"
run_case "definer flipped to SECURITY INVOKER"            REFUSED "alter function basecamp.is_super_admin() security invoker;"
run_case "PUBLIC granted execute on a CALLABLE definer"   REFUSED "grant execute on function basecamp.is_super_admin() to public;"
run_case "RLS disabled on a table"                        REFUSED "alter table basecamp.entries disable row level security;"
run_case "FORCE RLS set (breaks definer owner-bypass)"    REFUSED "alter table basecamp.super_admins force row level security;"
run_case "table ownership changed away from postgres"     REFUSED "do \$\$ begin if not exists (select 1 from pg_roles where rolname='interloper') then create role interloper nologin; end if; end \$\$; alter table basecamp.entries owner to interloper;"
run_case "audit writer body gutted, triggers intact"      REFUSED "create or replace function basecamp.log_access_change() returns trigger language plpgsql security definer set search_path='' as \$\$ begin return null; end \$\$;"
run_case "default ACL re-arms TRUNCATE on future tables"  REFUSED "alter default privileges for role postgres in schema basecamp grant all on tables to service_role;"
run_case "a view added without security_invoker"          REFUSED "create view basecamp.leak as select * from basecamp.entries;"
run_case "an UPDATE policy restored on a grant table"     REFUSED "create policy p_upd on basecamp.access_grants for update to authenticated using (true);"

echo
echo "=== PART 4: REVIEW REGRESSIONS — assertions a review defeated. Each must be REFUSED ==="
# A5: a bare prosecdef COUNT is defeated by a compensating hardened addition, so
# the access gate itself can be de-hardened while the count holds.
run_case "access gate flipped to INVOKER, count held by a filler definer" REFUSED "alter function basecamp.is_super_admin() security invoker; create function basecamp.filler() returns int language sql security definer set search_path='' as 'select 1'; revoke execute on function basecamp.filler() from public; grant execute on function basecamp.filler() to authenticated, service_role;"
# A4: an unfiltered default-ACL COUNT is satisfied by the wrong row types while
# the TABLES row PART 3 actually reads is absent.
run_case "TABLES default-ACL row absent, count held by a FUNCTIONS row" REFUSED "alter default privileges for role postgres in schema basecamp revoke all on tables from service_role; alter default privileges for role postgres in schema basecamp grant execute on functions to service_role;"
run_case "SEQUENCES default-ACL row absent"                REFUSED "alter default privileges for role postgres in schema basecamp revoke all on sequences from service_role;"
# A7: break-glass depends on service_role POSITIVES that only negatives guarded.
run_case "service_role lost INSERT on trust root (break-glass dead)" REFUSED "revoke insert on basecamp.super_admins from service_role;"
run_case "service_role lost SELECT on trust root"          REFUSED "revoke select on basecamp.super_admins from service_role;"
run_case "service_role lost DELETE on trust root"          REFUSED "revoke delete on basecamp.super_admins from service_role;"
# A5 corollary: each named definer function individually.
run_case "a SECOND named definer (has_grant) flipped to INVOKER" REFUSED "alter function basecamp.has_grant(uuid, uuid) security invoker; create function basecamp.filler2() returns int language sql security definer set search_path='' as 'select 1'; revoke execute on function basecamp.filler2() from public; grant execute on function basecamp.filler2() to authenticated, service_role;"

echo
echo "=== PART 5: BEHAVIOUR — the boundary holds, the logic does not. Each must be REFUSED ==="
# D2: a stubbed access gate makes everyone an administrator.
run_case "is_super_admin() stubbed to 'select true'"      REFUSED "create or replace function basecamp.is_super_admin() returns boolean language sql stable security definer set search_path='' as \$\$ select true \$\$;"
# Names the trust root and reads it, but ignores the answer: `exists(...) and true`
# is true for every caller the moment the roster is non-empty. A body test that
# only looks for the table name passes this.
run_case "is_super_admin() reads the trust root, ignores the answer" REFUSED "create or replace function basecamp.is_super_admin() returns boolean language sql stable security definer set search_path='' as \$\$ select exists(select 1 from basecamp.super_admins) and true \$\$;"
run_case "has_grant() stubbed to 'select true'"           REFUSED "create or replace function basecamp.has_grant(p_entry_id uuid, p_category_id uuid) returns boolean language sql stable security definer set search_path='' as \$\$ select true \$\$;"
# D1: a permit-all policy keeps the count and grants everything.
run_case "entries SELECT policy rewritten using(true)"    REFUSED "alter policy basecamp_entries_select_granted on basecamp.entries using (true);"
run_case "trust-root SELECT policy rewritten using(true)" REFUSED "alter policy basecamp_super_admins_select_super_admin on basecamp.super_admins using (true);"
run_case "audit SELECT policy rewritten using(true)"      REFUSED "alter policy basecamp_access_audit_select_super_admin on basecamp.access_audit using (true);"
# D3: column-level grants are invisible to has_table_privilege.
run_case "column-level UPDATE on the trust root"          REFUSED "grant update (user_id) on basecamp.super_admins to authenticated;"
run_case "column-level UPDATE on access_grants"           REFUSED "grant update (user_id) on basecamp.access_grants to authenticated;"
run_case "an UPDATE policy on the trust root"             REFUSED "create policy p_tr_upd on basecamp.super_admins for update to authenticated using (true) with check (true);"
# D4: the exact PG16 failure this change was written to detect.
run_case "service_role loses SELECT on three tables"      REFUSED "revoke select on basecamp.access_grants, basecamp.members, basecamp.type_grants from service_role;"
# D5: a principal outside the expected set.
run_case "a new role granted ALL on the trust root"       REFUSED "do \$\$ begin if not exists (select 1 from pg_roles where rolname='attacker3') then create role attacker3 nologin; end if; end \$\$; grant usage on schema basecamp to attacker3; grant all on basecamp.super_admins to attacker3;"
run_case "authenticated granted CREATE on the schema"     REFUSED "grant create on schema basecamp to authenticated;"
# D6: matviews cannot carry security_invoker at all.
run_case "a materialized view over entries"               REFUSED "create materialized view basecamp.mv_entries as select * from basecamp.entries;"
# D8: default privileges armed for the wrong grantee.
run_case "default privileges granted to anon"             REFUSED "alter default privileges for role postgres in schema basecamp grant all on tables to anon;"
run_case "default privileges granted to PUBLIC"           REFUSED "alter default privileges for role postgres in schema basecamp grant select on tables to public;"

echo
echo "=== PART 6: SUBSTRING AND ALLOWLIST DEFEATS — each must be REFUSED ==="
# A13: substring matching is defeated by naming an allowed token while permitting all.
run_case "policy -> using(auth.uid() is not null)"        REFUSED "alter policy basecamp_entries_select_granted on basecamp.entries using (auth.uid() is not null);"
run_case "trust-root policy -> using(auth.uid() is not null)" REFUSED "alter policy basecamp_super_admins_select_super_admin on basecamp.super_admins using (auth.uid() is not null);"
run_case "policy -> using(is_super_admin() OR true)"      REFUSED "alter policy basecamp_entries_select_granted on basecamp.entries using (basecamp.is_super_admin() or true);"
run_case "a policy ADDED naming the access model"          REFUSED "create policy extra_open on basecamp.entries for select to authenticated using (basecamp.is_super_admin());"
# A12: function and schema ACLs were allowlist-shaped, not enumerated.
run_case "EXECUTE on is_super_admin to an unexpected role" REFUSED "do \$\$ begin if not exists (select 1 from pg_roles where rolname='atk6') then create role atk6 nologin; end if; end \$\$; grant execute on function basecamp.is_super_admin() to atk6;"
run_case "USAGE on schema basecamp to an unexpected role"  REFUSED "do \$\$ begin if not exists (select 1 from pg_roles where rolname='atk7') then create role atk7 nologin; end if; end \$\$; grant usage on schema basecamp to atk7;"
run_case "PUBLIC EXECUTE restored on a definer trigger fn" REFUSED "grant execute on function basecamp.log_access_change() to public;"

echo
echo "=== PART 7: COMMENT-HIDING AND TRIGGER-FUNCTION ESCALATION — each must be REFUSED ==="
# D16: a SQL comment defeats every substring body test.
run_case "is_super_admin stubbed, tokens hidden in a COMMENT" REFUSED "create or replace function basecamp.is_super_admin() returns boolean language sql stable security definer set search_path='' as \$\$ select true /* basecamp.super_admins auth.uid() */ \$\$;"
run_case "has_grant stubbed, token hidden in a COMMENT"       REFUSED "create or replace function basecamp.has_grant(p_entry_id uuid, p_category_id uuid) returns boolean language sql stable security definer set search_path='' as \$\$ select true /* basecamp.access_grants */ \$\$;"
run_case "can_read_entry drops its has_grant half"            REFUSED "create or replace function basecamp.can_read_entry(p_entry_id uuid, p_category_id uuid) returns boolean language sql stable security definer set search_path='' as \$\$ select basecamp.is_super_admin() \$\$;"
run_case "log_access_change body altered"                     REFUSED "create or replace function basecamp.log_access_change() returns trigger language plpgsql security definer set search_path='' as \$\$ begin insert into basecamp.access_audit (action, source_table) values ('grant','members'); return null; end \$\$;"
# D15: `or true` names an allowed helper and permits everything.
run_case "policy -> using(is_super_admin() OR true)"          REFUSED "alter policy basecamp_entries_select_granted on basecamp.entries using (basecamp.is_super_admin() or true);"
# D19: a definer TRIGGER function granted to a named role.
run_case "EXECUTE on log_access_change to authenticated"      REFUSED "grant execute on function basecamp.log_access_change() to authenticated;"
run_case "EXECUTE on log_access_change to a rogue role"       REFUSED "do \$\$ begin if not exists (select 1 from pg_roles where rolname='rogue1') then create role rogue1 nologin; end if; end \$\$; grant execute on function basecamp.log_access_change() to rogue1;"
# D20: column ACL and schema ACL by principal.
run_case "column SELECT on the trust root to a rogue role"    REFUSED "do \$\$ begin if not exists (select 1 from pg_roles where rolname='rogue2') then create role rogue2 nologin; end if; end \$\$; grant select (user_id, note) on basecamp.super_admins to rogue2;"
run_case "USAGE+CREATE on the schema to a rogue role"         REFUSED "do \$\$ begin if not exists (select 1 from pg_roles where rolname='rogue3') then create role rogue3 nologin; end if; end \$\$; grant usage, create on schema basecamp to rogue3;"

echo "=== PART 8: THE SCHEMA BOUNDARY IS NOT THE SECURITY BOUNDARY ==="
# Every other assertion in both artifacts filters nspname='basecamp', which
# assumes an attacker's object is inside the schema being protected. PROVEN with
# a behavioural control: a signed-in user holding zero grants read 0 rows from
# basecamp.entries directly and the whole catalog through a helper in `public`,
# while the file printed "security boundary asserted".
#
# The first case is the one that happens by ACCIDENT — a definer helper is the
# standard advice for policy recursion, the SQL Editor creates it owned by
# postgres, and PostgreSQL grants PUBLIC EXECUTE on a new function by default,
# so it is reachable by `authenticated` and `anon` even with no GRANT written.
run_case "a SECURITY DEFINER helper in public reads basecamp" REFUSED "create function public.all_entries() returns setof basecamp.entries language sql security definer set search_path='' as \$x\$ select * from basecamp.entries \$x\$; grant execute on function public.all_entries() to authenticated;"
run_case "an owner-rights VIEW in public reads basecamp"      REFUSED "create view public.leak as select * from basecamp.entries; grant select on public.leak to authenticated;"
run_case "a MATERIALIZED VIEW in public reads basecamp"       REFUSED "create materialized view public.mv_leak as select * from basecamp.entries; grant select on public.mv_leak to authenticated;"
# The negative controls. Over-refusing here would fail every ordinary Supabase
# project, which is how a security file gets removed from a pipeline.
# WAS a negative control expecting COMMITTED, until review proved it was
# blessing the enabling half of a real leak: an invoker view is safe alone, and
# stops being safe the moment any SECURITY DEFINER reads it, because it then
# resolves as postgres. Flipped deliberately — see PART 10.
run_case "an INVOKER view in public over basecamp"         REFUSED "create view public.ok with (security_invoker = true) as select * from basecamp.entries; grant select on public.ok to authenticated;"
run_case "a definer in public not naming basecamp is fine"    COMMITTED "create function public.unrelated() returns int language sql security definer set search_path='' as \$x\$ select 1 \$x\$; grant execute on function public.unrelated() to authenticated;"
# list_people is the one access-model function returning PII, and it was guarded
# only by a mention test. This body keeps `from auth.users` — satisfying that
# test — and drops ONLY the admin gate.
run_case "list_people() keeps auth.users but drops its admin gate" REFUSED "create or replace function basecamp.list_people() returns table(id uuid, email text, created_at timestamptz, is_super_admin boolean) language sql stable security definer set search_path='' as \$x\$ select u.id, u.email::text, u.created_at, exists (select 1 from basecamp.super_admins s where s.user_id = u.id) from auth.users u where u.email is not null order by u.email \$x\$;"

echo
echo "=== PART 9: EVASIONS OF PART 8's FIRST DRAFT — each PROVEN to leak ==="
# Every one of these read the catalog as a zero-grant signed-in user while the
# first draft of the cross-schema block printed "security boundary asserted".
# They are the reason that block reads pg_depend and proconfig rather than only
# prosrc, matches case-insensitively, uses pg_has_role, and no longer filters on
# EXECUTE/SELECT reachability.
#
# BEGIN ATOMIC has an EMPTY prosrc — and is the modern recommended form, so the
# most careful author evaded the first draft completely.
run_case "definer in public with a BEGIN ATOMIC body"      REFUSED "create function public.leak_atomic() returns setof basecamp.entries language sql security definer begin atomic select * from basecamp.entries; end; grant execute on function public.leak_atomic() to authenticated;"
# search_path names the schema; the body never spells it.
run_case "definer in public with search_path=basecamp"     REFUSED "create function public.leak_sp() returns setof basecamp.entries language sql security definer set search_path='basecamp' as \$x\$ select * from entries \$x\$; grant execute on function public.leak_sp() to authenticated;"
# prosrc keeps raw text and `~` is case-sensitive.
run_case "definer in public naming BASECAMP in upper case" REFUSED "create function public.leak_up() returns setof basecamp.entries language sql security definer set search_path='' as \$x\$ select * from BASECAMP.entries \$x\$; grant execute on function public.leak_up() to authenticated;"
# The RLS owner-exemption follows role inheritance, so a member of postgres
# bypasses without being superuser or BYPASSRLS.
run_case "definer owned by an inheriting member of postgres" REFUSED "do \$\$ begin if not exists (select 1 from pg_roles where rolname='deputy_ev') then create role deputy_ev nologin inherit in role postgres; end if; end \$\$; create function public.leak_dep() returns setof basecamp.entries language sql security definer set search_path='' as \$x\$ select * from basecamp.entries \$x\$; alter function public.leak_dep() owner to deputy_ev; grant execute on function public.leak_dep() to authenticated;"
# The wrapper never names basecamp; the view it reads holds no grants at all, so
# a reachability filter excluded both halves.
run_case "reachable wrapper over a no-grant view on basecamp" REFUSED "create view public.hidden_v as select * from basecamp.entries; create function public.wrapper() returns table(display_name text, launch_url text) language sql security definer set search_path='' as \$x\$ select h.display_name, h.launch_url from public.hidden_v h \$x\$; grant execute on function public.wrapper() to authenticated;"
# The trigger machinery does not consult EXECUTE — a fact section 2 of 0002
# already states — so revoking it proves nothing.
run_case "definer TRIGGER fn in public siphoning basecamp" REFUSED "create table public.spill (display_name text, launch_url text); create table public.inbox (id serial primary key); create function public.siphon() returns trigger language plpgsql security definer set search_path='' as \$x\$ begin insert into public.spill select e.display_name, e.launch_url from basecamp.entries e; return new; end \$x\$; revoke execute on function public.siphon() from public; create trigger t_siphon after insert on public.inbox for each row execute function public.siphon();"
# pg_get_viewdef deparses against the CALLER's search_path, so this one needed
# no attacker at all — one convenience setting disabled the whole view arm.
run_case "leaky view hidden by search_path on the postgres role" REFUSED "create view public.leak_sp_v as select * from basecamp.entries; grant select on public.leak_sp_v to authenticated; alter role postgres in database $DB set search_path = basecamp, public;"
# An overload is a second implementation of a pinned decision, and section 2
# grants it EXECUTE. PostgREST routes to it by argument name.
run_case "list_people gains an ungated overload"           REFUSED "create function basecamp.list_people(p int) returns table(id uuid, email text, created_at timestamptz) language sql stable security definer set search_path='' as \$x\$ select u.id, u.email::text, u.created_at from auth.users u \$x\$;"

echo
echo "=== PART 10: ONE-HOP INDIRECTION — kind-by-kind checking lost to each ==="
# Every case: DDL in `public` only, no access to basecamp, and each read the
# catalog as a zero-grant signed-in user while the previous draft committed.
# The fix stopped enumerating object KINDS and started walking the dependency
# graph, so all four fall out of one closure.
run_case "definer fn over a security_invoker view on basecamp" REFUSED "create view public.iv with (security_invoker = true) as select * from basecamp.entries; create function public.wrap() returns table(display_name text, launch_url text) language sql security definer set search_path='' as \$x\$ select v.display_name, v.launch_url from public.iv v \$x\$; grant execute on function public.wrap() to authenticated;"
run_case "matview over a security_invoker view on basecamp"    REFUSED "create view public.iv2 with (security_invoker = true) as select * from basecamp.entries; create materialized view public.mv2 as select display_name, launch_url from public.iv2; grant select on public.mv2 to authenticated;"
# The dependency edge proving this one was already computed by the previous
# draft's own query, then discarded by `relkind in ('v','m')`.
run_case "REWRITE RULE on a plain public table reading basecamp" REFUSED "create table public.inbox (id serial primary key); create table public.spill (display_name text, launch_url text); create rule r_siphon as on insert to public.inbox do also insert into public.spill select e.display_name, e.launch_url from basecamp.entries e;"
# A child's RLS is not applied when it is scanned through the parent.
run_case "public table made an inheritance parent of basecamp.entries" REFUSED "create table public.allapps (like basecamp.entries); alter table basecamp.entries inherit public.allapps;"
# Needs NO DDL from the attacker: a definer with no SET search_path runs with the
# CALLER's, and an ordinary signed-in user sets their own.
run_case "unpinned plpgsql definer resolving a bare basecamp table" REFUSED "create function public.leak_plsp() returns setof basecamp.entries language plpgsql security definer as \$x\$ begin return query select * from entries; end \$x\$; grant execute on function public.leak_plsp() to authenticated;"
# information_schema was on the exclusion list; authenticated already holds USAGE
# on it via PUBLIC, so it was a free hiding place.
run_case "owner-rights view in information_schema on basecamp" REFUSED "create view information_schema.leak_is as select * from basecamp.entries; grant select on information_schema.leak_is to authenticated;"

echo
echo "=== PART 11: THE THIRD ROUND'S TWO — one hop further out ==="
# A definer reaching basecamp through ANOTHER FUNCTION. The inner one is plain
# INVOKER so arm A skipped it; the outer names only the inner, so arm A skipped
# that too. Non-atomic bodies record no pg_depend rows, which is why the function
# taint needs a NAME fixpoint and not just a dependency one. Narrow return type
# is load-bearing: `returns setof basecamp.entries` would record a rowtype
# dependency and be caught for the wrong reason.
run_case "definer reaching basecamp through another function" REFUSED "create function public.rows_() returns setof basecamp.entries language sql stable as \$x\$ select * from basecamp.entries \$x\$; revoke execute on function public.rows_() from public; create function public.catalog_() returns table(display_name text, launch_url text) language sql stable security definer set search_path='' as \$x\$ select r.display_name, r.launch_url from public.rows_() r \$x\$; grant execute on function public.catalog_() to authenticated;"
# Three hops, to show the closure is not depth-limited.
run_case "definer reaching basecamp through a 3-hop chain" REFUSED "create function public.h3() returns setof basecamp.entries language sql stable as \$x\$ select * from basecamp.entries \$x\$; create function public.h2() returns setof basecamp.entries language sql stable as \$x\$ select * from public.h3() \$x\$; create function public.h1() returns setof basecamp.entries language sql stable as \$x\$ select * from public.h2() \$x\$; create function public.deep() returns table(display_name text) language sql stable security definer set search_path='' as \$x\$ select d.display_name from public.h1() d \$x\$; grant execute on function public.deep() to authenticated;"
# Re-owning the intermediate invoker view to an unprivileged role skipped the
# relation arm's owner filter, while a postgres-owned definer reading it still
# resolved it as postgres. The owner filter is gone.
run_case "security_invoker view re-owned to an unprivileged role" REFUSED "do \$\$ begin if not exists (select 1 from pg_roles where rolname='zmal2') then create role zmal2 nologin; end if; end \$\$; create view public.iv3 with (security_invoker = true) as select * from basecamp.entries; alter view public.iv3 owner to zmal2; grant select on public.iv3 to postgres; create function public.tiles3() returns table(display_name text) language sql stable security definer set search_path='' as \$x\$ select v.display_name from public.iv3 v \$x\$; grant execute on function public.tiles3() to authenticated;"

# ============================================================================
# PART 12: THE EDITOR PATH. Everything above this line reached the database
# through `psql -f` on files with LF endings — the maintainer's route, not the
# client's. A client pastes these two files into the Supabase SQL Editor, and
# 96/96 on the psql route said nothing whatsoever about that. It could not: on
# 2026-08-19 a client ran 0001 clean in the Editor and 0002 refused on the
# `is_super_admin` digest, with this suite green on that same commit.
#
# WHAT THIS ARM REPRODUCES, and it is two things, both of which matter:
#   1. CRLF line endings. A Windows clipboard, a `core.autocrlf` checkout or a
#      browser download turns every LF into CRLF. `prosrc` stores a function
#      body byte-for-byte, so all seven pinned bodies gain carriage returns the
#      template's own file does not have and every digest misses. THIS is what
#      bit the client; normalizing the digest input in 0002 is the fix.
#   2. The whole file as ONE query string, how the Editor submits a buffer.
#      `psql -f` splits on `;` and sends statements one at a time. Be precise
#      about what this buys: 0002 wraps itself in an explicit `begin;`/`commit;`,
#      so both transports give IT the same transaction shape, and this arm does
#      NOT test 0002's transaction handling. It differs for 0001, which is a
#      pg_dump with no explicit transaction and therefore runs as 207 separate
#      statements under `-f` and as one implicit transaction here.
#
# WHAT IT DOES NOT REPRODUCE. There is no browser, no HTTP, no pg_meta and no
# Supabase role switching here. This is a faithful transport mimic, not the
# Editor. It catches the byte-level and transaction-shape classes; it would not
# catch something that depends on the dashboard's own session setup.
#
# WHY THESE MUTATIONS. Two jobs, and they are not the same job.
#   - The clean-CRLF-install case is the REGRESSION GUARD. That one case is the
#     client's failure, and it is the whole reason this PART exists.
#   - The lone-CR-in-a-string-literal case is the DESIGN PIN. It is the only
#     case in this file that distinguishes the normalization that shipped from
#     the shorter one that looks equivalent and is not. Its comment explains it.
#   - The remaining five are TRANSPORT COVERAGE: digest-only catches from the
#     psql arm, re-run through the CRLF route to show the pin still bites once
#     bodies arrive carrying carriage returns. They do not discriminate between
#     normalizations and are not claimed to.
EXPECTED_EDITOR_CASES=7
eran=0

# Same shape as run_case, and deliberately so — it recycles ONE database name
# the same way, for the same reason, so the two arms cannot drift in how they
# isolate a case. The single difference is the transport: every apply below goes
# through the Editor-equivalent path, the mutation included.
#
# `ED_DB` is per-process like `DB` is, so two concurrent runs on one cluster
# cannot drop each other's database mid-case — the failure the header records at
# `DB`, which once reported 11 passed / 62 failed.
ED_DB="${BC_ED_DB:-edmut_$$}"

run_editor_case () {
  local name="$1" expect="$2" mutation="$3"
  # Set by the preflight when a fixture is too large to pass as one argument.
  # The arm cannot run; `eran` deliberately stays behind EXPECTED_EDITOR_CASES so
  # the count assertion at the end exits 1 rather than letting a silently absent
  # arm read as a pass.
  [ -n "$EDITOR_ARM_BLOCKED" ] && return
  eran=$((eran+1))

  esetup () {
    local step="$1"; shift
    $BASE "$@" >/dev/null 2>&1 && return 0
    echo "  ERROR   setup failed [$step]: $name"; fail=$((fail+1)); return 1
  }
  esetup "create db" -c "drop database if exists $ED_DB;" -c "create database $ED_DB;" || return
  esetup "stub"      -d "$ED_DB" -f "$SP/_supabase_surface_stub.sql"                   || return
  # 0001 and 0002 as the Editor delivers them: CRLF, whole file, one statement.
  esetup "0001 via editor path" -d "$ED_DB" -c "$(cat "$EDIR/0001.crlf.sql")"          || return
  esetup "0002 first via editor path" -d "$ED_DB" -c "$(cat "$EDIR/0002.crlf.sql")"    || return

  # THE ROUTE ITSELF IS ASSERTED, not assumed. Everything this PART claims rests
  # on the carriage returns surviving the wire into `prosrc`. If a future psql,
  # libpq or driver ever normalized them in transit, every case below would go
  # green while quietly re-testing the LF path a second time — green for the
  # wrong reason, which is the exact failure this PART exists to end. Checking
  # the FIXTURE has CRs (above) does not check that the DATABASE stored them.
  if ! $BASE -d "$ED_DB" -t -c "select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'basecamp' and position(chr(13) in p.prosrc) > 0" 2>/dev/null | grep -qE '^ *[1-9]'; then
    echo "  ERROR   editor path stored NO carriage returns in any basecamp body: $name"
    fail=$((fail+1)); return
  fi

  if [ -n "$mutation" ]; then
    # Delivered through the same route. Note that most mutations below are
    # written as a single line, so the CRLF conversion is a no-op on them and
    # says nothing — the case that actually depends on carriage returns
    # surviving builds them explicitly, in SQL, rather than trusting this.
    printf '%s' "$mutation" | perl -pe 's/\n/\r\n/' > "$EDIR/mut.sql"
    if ! $BASE -d "$ED_DB" -c "$(cat "$EDIR/mut.sql")" >/dev/null 2>&1; then
      echo "  ERROR   mutation did not apply: $name"; fail=$((fail+1)); return
    fi
  fi
  if $BASE -d "$ED_DB" -c "$(cat "$EDIR/0002.crlf.sql")" >/dev/null 2>&1; then got=COMMITTED; else got=REFUSED; fi
  if [ "$got" = "$expect" ]; then
    echo "  PASS  [$got] $name"; pass=$((pass+1))
  else
    echo "  FAIL  [got $got, wanted $expect] $name"; fail=$((fail+1))
  fi
}

echo
echo "=== PART 12: THE EDITOR PATH — both files pasted CRLF, whole-file, one statement ==="
if [ -n "$EDITOR_ARM_BLOCKED" ]; then
  echo "  ERROR   the editor arm cannot run: $EDITOR_ARM_BLOCKED"
  echo "  ERROR   split the file, or apply it with a transport that does not pass it as one argument"
  fail=$((fail+1))
fi
# THE REGRESSION GUARD. This is the client's failure, reproduced. Against the
# pre-fix 0002 it goes red directly — 0002 refuses the clean CRLF install — and
# the six cases after it go red too, but for a duller reason: their "0002 first"
# setup step is that same refusal, so they report `setup failed` rather than a
# verdict. Do not read that as six independent findings; there is one bug here
# and this is the case that names it.
run_editor_case "clean CRLF paste of 0001 and 0002 must commit" COMMITTED ""
# THE CASE THAT PINS THE CHOICE OF NORMALIZATION, and it is the only one here
# that does. Read this before touching the `replace(replace(...))` in 0002.
#
# The obvious way to make a digest survive CRLF is to DELETE the carriage
# returns: `md5(replace(prosrc, chr(13), ''))`. It is shorter, it fixes the
# client's bug, and it passes every other case in this PART. It is also a hole,
# because a carriage return is only insignificant OUTSIDE a string literal.
#
# `log_access_change` decides what the audit log records with
# `case when tg_op = 'INSERT' then 'grant' else 'revoke' end`. Put a lone CR
# inside that literal and the trigger writes `gr<CR>ant` into `access_audit`
# forever — a different body, doing a different thing, on the one function that
# exists to make grants reviewable. Under delete-the-CRs it hashes IDENTICALLY
# to the shipped body and 0002 commits. Under the CR->LF mapping that shipped,
# the literal normalizes to `gr<LF>ant`, the digest misses, and it is refused.
#
# So this case is the difference between the two implementations, and nothing
# else in the suite is. The mutation is built in SQL from `pg_get_functiondef`
# rather than written out here, because the whole point is a body that differs
# from the pinned one ONLY by that one character — retyping it by hand would
# differ in a dozen other ways and prove nothing.
# The trailing assertion is what keeps this case honest. It only distinguishes
# the two normalizations while the recreated body differs from the pinned one by
# exactly that carriage return — i.e. while `pg_get_functiondef` round-trips this
# function byte-for-byte. Give the function an attribute that renders differently
# and the body would differ in other ways too, the case would stay REFUSED under
# BOTH implementations, and the one case that pins the design choice would go
# quietly vacuous. So it checks: with the carriage return removed the body must
# still hash to the shipped digest. If it does not, the mutation refuses to apply
# and the run says so, instead of passing for a reason that no longer holds.
run_editor_case "CRLF route: lone CR inside a string literal in a pinned body" REFUSED "do \$m\$ declare def text; declare got text; begin select pg_get_functiondef(p.oid) into def from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'basecamp' and p.proname = 'log_access_change'; if def is null or position('''grant''' in def) = 0 then raise exception 'mutation precondition failed: no grant-literal to perturb'; end if; def := replace(def, '''grant''', '''gr' || chr(13) || 'ant'''); execute def; select md5(replace(p.prosrc, chr(13), '')) into got from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'basecamp' and p.proname = 'log_access_change'; if got <> '41d5a7b6ab0dc5b4cda44d794d729a7e' then raise exception 'this case has gone vacuous: with carriage returns deleted the mutated body no longer matches the pinned digest, so it no longer distinguishes delete-the-CRs from map-to-LF'; end if; end \$m\$;"
# TRANSPORT COVERAGE, and no more than that. Each of the five is a wholesale
# body replacement already covered on the psql arm; none discriminates between
# the two normalizations, and none is claimed to. They are here to show the
# checks still bite once bodies arrive carrying carriage returns.
#
# Be precise about WHICH check catches each, because "digest-only" would be
# wrong for two of them: `is_super_admin -> select true` is refused upstream of
# the digest, by the mention check that requires `basecamp.super_admins` and
# `auth.uid()` in the body; `list_people gains an ungated overload` is refused by
# the arity half of the pin loop (`count(p.oid) <> 1`), not by a digest
# comparison. The other three are genuine digest-only catches. Verified by
# removing the DIGEST HALF of the pin loop and re-running: those three flip to
# COMMITTED, the other two stay REFUSED. Remove the whole loop instead and the
# overload flips too, which is the arity half showing its work.
run_editor_case "CRLF route: is_super_admin() stubbed to 'select true'" REFUSED "create or replace function basecamp.is_super_admin() returns boolean language sql stable security definer set search_path='' as \$\$ select true \$\$;"
run_editor_case "CRLF route: is_super_admin stubbed, tokens hidden in a COMMENT" REFUSED "create or replace function basecamp.is_super_admin() returns boolean language sql stable security definer set search_path='' as \$\$ select true /* basecamp.super_admins auth.uid() */ \$\$;"
run_editor_case "CRLF route: list_people keeps auth.users, drops its admin gate" REFUSED "create or replace function basecamp.list_people() returns table(id uuid, email text, created_at timestamptz, is_super_admin boolean) language sql stable security definer set search_path='' as \$x\$ select u.id, u.email::text, u.created_at, exists (select 1 from basecamp.super_admins s where s.user_id = u.id) from auth.users u where u.email is not null order by u.email \$x\$;"
run_editor_case "CRLF route: log_access_change body altered" REFUSED "create or replace function basecamp.log_access_change() returns trigger language plpgsql security definer set search_path='' as \$\$ begin insert into basecamp.access_audit (action, source_table) values ('grant','members'); return null; end \$\$;"
run_editor_case "CRLF route: list_people gains an ungated overload" REFUSED "create function basecamp.list_people(p int) returns table(id uuid, email text, created_at timestamptz) language sql stable security definer set search_path='' as \$x\$ select u.id, u.email::text, u.created_at from auth.users u \$x\$;"

echo
echo
echo "=== TOTAL: $pass passed, $fail failed (of $((EXPECTED_CASES + EXPECTED_EDITOR_CASES)) expected) ==="
echo "===   psql/LF arm: $ran case(s)    editor/CRLF arm: $eran case(s) ==="
# The two transports are counted apart on purpose. Rolled into one number, the
# editor arm could be lost to a merge and the total would still read plausibly
# beside a slightly different EXPECTED_CASES — which is how the route a client
# actually uses came to be untested in the first place.
if [ "$ran" -ne "$EXPECTED_CASES" ]; then
  echo "CASE COUNT CHANGED: psql arm ran $ran, expected $EXPECTED_CASES." >&2
  echo "A case was added or lost. If deliberate, update EXPECTED_CASES in the same commit." >&2
  exit 1
fi
if [ "$eran" -ne "$EXPECTED_EDITOR_CASES" ]; then
  echo "CASE COUNT CHANGED: editor arm ran $eran, expected $EXPECTED_EDITOR_CASES." >&2
  echo "A case was added or lost. If deliberate, update EXPECTED_EDITOR_CASES in the same commit." >&2
  exit 1
fi
if [ "$whitelist_hits" -ne "$EXPECTED_WHITELIST_HITS" ]; then
  echo "WHITELIST DRIFT: $whitelist_hits case(s) matched an expect-COMMIT list, expected $EXPECTED_WHITELIST_HITS." >&2
  echo "An entry names a case that no longer exists (a rename?), or a new case matched one." >&2
  exit 1
fi
[ "$fail" -eq 0 ] || exit 1
