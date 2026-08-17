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
# YOU DO NOT NEED THIS FILE TO USE THE TEMPLATE. It proves the boundary is
# enforced; provisioning only needs the two files in `supabase/migrations/`. Run
# it if you edit `0002`, or if you want the proof for yourself rather than on
# trust.
#
# REQUIREMENTS. A throwaway PostgreSQL 16 or 17 cluster you do not care about.
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
EXPECTED_CASES=73

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

echo
echo "=== TOTAL: $pass passed, $fail failed (of $EXPECTED_CASES expected) ==="
if [ "$ran" -ne "$EXPECTED_CASES" ]; then
  echo "CASE COUNT CHANGED: ran $ran, expected $EXPECTED_CASES." >&2
  echo "A case was added or lost. If deliberate, update EXPECTED_CASES in the same commit." >&2
  exit 1
fi
if [ "$whitelist_hits" -ne "$EXPECTED_WHITELIST_HITS" ]; then
  echo "WHITELIST DRIFT: $whitelist_hits case(s) matched an expect-COMMIT list, expected $EXPECTED_WHITELIST_HITS." >&2
  echo "An entry names a case that no longer exists (a rename?), or a new case matched one." >&2
  exit 1
fi
[ "$fail" -eq 0 ] || exit 1
