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
# WHAT PASSING DOES NOT MEAN. A full-green run says the assertions catch the
# mutations BELOW. It does not say they catch everything: a later review
# defeated several of `0002`'s stated invariants with mutations this file does
# not contain. They are enumerated in issues.md under "Known gaps in the security
# boundary". Read that before treating a green run as a clean bill of health.
#
# FOUR ARMS, AND THEY ANSWER DIFFERENT QUESTIONS. Do not collapse them.
#   * Parts 1-12  — STATIC, psql transport. Break one thing in a mirror, require
#                   `0002` to refuse. Counted by EXPECTED_CASES.
#   * Part 13     — STATIC, EDITOR transport. The same migrations applied the way
#                   a client applies them: pasted, CRLF, whole-file. A green psql
#                   run said nothing about that route and a client's provision
#                   died on it. Counted by EXPECTED_EDITOR_CASES.
#   * Parts 14-15 — RUNTIME. Real sessions as `authenticated`, requiring the
#                   DATABASE to refuse rather than the assertions to notice.
#                   Counted by EXPECTED_RLS_CASES.
#   * Part 16     — `0004` as the file under test, the way 1-12 test `0002`.
#                   Counted by EXPECTED_M4_CASES.
# The totals print per arm for the same reason the counts are separate: one
# rolled-up number is where a lost arm hides.
#
# YOU DO NOT NEED THIS FILE TO USE THE TEMPLATE. It proves the boundary is
# enforced; provisioning only needs the files in `supabase/migrations/`. Run
# it if you edit `0002`, `0004`, `0005`, a policy or a definer function — or if
# you want the proof for yourself rather than on trust.
#
# REQUIREMENTS. A throwaway PostgreSQL 16 or 17 cluster you do not care about,
# plus `perl` on PATH — PART 13 uses it to build the CRLF fixtures, and the
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
# PART 16 puts this one under test rather than applying it as setup, so it needs
# a name of its own. Named here, and used in MIGRATIONS below, so the two cannot
# come to mean different files.
M4="$REPO/supabase/migrations/0004_admin_write_paths.sql"

# THE MIGRATION CHAIN, IN ONE PLACE, because it was in seven and that is exactly
# how the drift this suite exists to catch got in. The Editor arm had a SHORTER
# chain than the psql arm — it stopped at 0002 while `run_case` had grown 0004
# and 0005 — so 0004's own digest pin was proven on the maintainer's route and
# never on the client's. Nothing failed. The arm just quietly tested less, which
# is the same shape as the CRLF bug it exists to catch: green for a route nobody
# actually exercised.
#
# Every consumer reads this array: the readability preflight, the CRLF fixture
# build and its two checks, and all three schema builders. Adding 0006 is one
# line here, and an arm that forgets it becomes impossible rather than merely
# commented against.
#
# 0003 is deliberately ABSENT. It seeds categories and contains no schema, so it
# cannot affect anything the boundary asserts; a mirror without it is still a
# mirror. 0004's member-type rows are a different matter and 0004 IS here — they
# are structural, and 0004 asserts them.
#
# ORDER IS THE APPLY ORDER. Do not sort it.
MIGRATIONS=(
  "$REPO/supabase/migrations/0001_baseline.sql"
  "$TPL"
  "$M4"
  "$REPO/supabase/migrations/0005_category_nesting.sql"
)
# Labels for the per-step failure messages, index-aligned with MIGRATIONS. Kept
# beside it rather than derived from the filenames: "0002 first" says something
# basename() cannot, and the message exists to answer WHICH STEP FAILED.
MIGRATION_LABELS=("0001" "0002 first" "0004" "0005")

# ONE CHECKED SETUP STEP, shared by every arm.
#
# EVERY setup step is checked. Unchecked, a failed step makes each
# REFUSED-expecting case pass for the wrong reason — 0002 refuses because the
# schema was never built, not because it caught the mutation — and most of this
# file would report PASS on an empty database. Only the CONTROL would notice,
# which is one case guarding all the others. PROVEN on the 0004 arm too: skipping
# 0002 there left every one of its cases matching its expectation.
#
# `drop database if exists` failing matters most: it leaves the PREVIOUS case's mutation in place, so
# the next case tests a schema broken two ways.
#
# Args: <case-name> <fail-counter-var> <step-label> <psql args...>. The label is
# not psql input — most steps are `-d $DB -f <file>`, so printing the arguments
# named them all identically and could not answer the one question the message
# exists for. The counter is passed BY NAME because the arms count separately on
# purpose: one rolled-up total is where a lost arm hides.
setup_step () {
  local case_name="$1" counter="$2" step="$3"; shift 3
  $BASE "$@" >/dev/null 2>&1 && return 0
  echo "  ERROR   setup failed [$step]: $case_name"
  eval "$counter=\$(( $counter + 1 ))"
  return 1
}

# WHERE A MIGRATION'S CRLF FIXTURE LIVES. One function, because the name is
# written by the preflight that builds them and read by the arm that applies
# them and by the final assertion that re-runs 0002 — and when those three
# disagreed, the arm applied an EMPTY statement, psql returned success, and all
# nine mutation cases reported COMMITTED. Every one of them had been REFUSED a
# moment earlier. That is a whole arm passing for the wrong reason, which is the
# failure mode this file exists to make impossible, so the name gets a function.
crlf_of () { printf '%s/%s.crlf.sql' "$EDIR" "$(basename "$1" .sql)"; }

# APPLY THE CHAIN, through one of two transports.
#
# Args: <case-name> <fail-counter-var> <psql|editor> <db> <how-many>.
#
# `how-many` is a COUNT, and it is always passed explicitly so that a truncated
# chain is a visible argument at the call site rather than an invisible omission.
# Only PART 16 passes anything but the full length: it puts 0004 itself under
# test, so it must stop at 0002 and apply 0004 as the thing being measured.
#
# The `editor` transport reads the CRLF fixtures built in the preflight and
# passes each file as ONE `-c` argument, which is how the SQL Editor submits a
# buffer. That is the ONLY difference between the two arms, deliberately — see
# PART 13's header for what that does and does not buy.
apply_chain () {
  local case_name="$1" counter="$2" transport="$3" db="$4" through="$5"
  local i label
  for (( i = 0; i < through; i++ )); do
    label="${MIGRATION_LABELS[$i]}"
    if [ "$transport" = "editor" ]; then
      setup_step "$case_name" "$counter" "$label via editor path" \
        -d "$db" -c "$(cat "$(crlf_of "${MIGRATIONS[$i]}")")" || return 1
    else
      setup_step "$case_name" "$counter" "$label" -d "$db" -f "${MIGRATIONS[$i]}" || return 1
    fi
  done
  return 0
}

# The throwaway database this suite drops and recreates once per case. Per-process by
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

# How many cases this file is supposed to run: 109 mutations plus 1 control.
# Asserted at the end, because "69 passed, 0 failed" and "72 passed, 0 failed"
# both print green and exit 0. Losing cases to a three-way merge is the same
# silent-reversion failure the whole boundary is defended against, applied to
# the artifact that is its only proof. Change this number in the same commit as
# a case, never to make a run go quiet.
EXPECTED_CASES=113

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

  setup_step "$name" fail "create db" -c "drop database if exists $DB;" -c "create database $DB;" || return
  setup_step "$name" fail "stub"      -d $DB -f "$SP/_supabase_surface_stub.sql"     || return
  # The whole chain runs BEFORE the mutation. `0002` ASSIGNS as well as asserts
  # (it pins ownership and fixes EXECUTE grants), so applying it afterwards would
  # repair the very thing under test and the case would prove nothing. The mirror
  # carries 0004 and 0005 for a related reason: a mirror missing a migration is
  # not a mirror of the live schema, and 0002's trust-root and nesting assertions
  # would be proven against a database that never had them.
  apply_chain "$name" fail psql "$DB" "${#MIGRATIONS[@]}" || return

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

# EVERY DIGEST PIN NORMALIZES ITS INPUT. Checked here, mechanically, because the
# alternative was a comment asking the next person to remember.
#
# `prosrc` is the raw body text. A pin written `md5(prosrc)` matches only a body
# stored with the line endings the maintainer happened to have, so a migration
# pasted into the Supabase SQL Editor from a CRLF clipboard misses every digest
# and the file refuses a perfectly correct install. That is not a hypothesis: it
# stopped a client mid-provision on 2026-08-19, and it very nearly shipped a
# second time when 0004 arrived carrying a raw pin of its own.
#
# PART 13 catches it, but only for the migrations it applies and only once
# somebody runs this suite against a cluster. This check needs neither, and it
# covers a NEW migration the moment it is added.
#
# The one legitimate raw use is this suite's own delete-the-CRs case, which must
# hash un-normalized text to prove the shorter normalization is a hole. That case
# lives in THIS file, not in supabase/migrations/, so scanning only the
# migrations keeps the check exact rather than approximate.
#
# COMMENTS ARE STRIPPED FIRST, and that is not tidiness. 0002's note at the pin
# quotes the wrong form in prose in order to warn against it, and 0004's
# re-derivation instructions name it too. Grepping the raw text flags both and
# the check fails on a correct tree — a guard that cries wolf on the file it is
# guarding gets deleted, which is worse than not having written it. `awk` blanks
# everything from `--` to end of line, so only EXECUTABLE text is scanned; line
# numbers survive because the line is emptied rather than dropped.
if raw=$(awk '{ sub(/--.*/, ""); print FILENAME ":" FNR ":" $0 }' "$REPO"/supabase/migrations/*.sql \
           | grep -E "md5[[:space:]]*\([[:space:]]*(p\.)?prosrc[[:space:]]*\)"); then
  echo "a migration pins a function body with a RAW md5(prosrc):" >&2
  echo "$raw" >&2
  echo "Hash the NORMALIZED text instead, exactly as 0002 does at its pin:" >&2
  echo "  md5(replace(replace(prosrc, chr(13)||chr(10), chr(10)), chr(13), chr(10)))" >&2
  echo "A raw pin refuses every SQL-Editor install of that migration while this" >&2
  echo "suite's psql arm stays green. See 0002's note at the pin." >&2
  exit 2
fi

# A missing artifact makes every case ERROR at the mutation step or, worse, pass
# vacuously — fail loudly instead.
for f in "$SP/_supabase_surface_stub.sql" "${MIGRATIONS[@]}"; do
  [ -r "$f" ] || { echo "missing or unreadable: $f" >&2; exit 2; }
done
if ! $BASE -c "select 1" >/dev/null 2>&1; then
  echo "no PostgreSQL at $SOCK:$PORT — start a throwaway cluster (see the header) or set BC_SOCK/BC_PORT" >&2
  exit 2
fi

# PART 13's fixtures, built and checked HERE rather than at PART 13 itself.
# Everything below `exit 2`s, and by PART 13 the psql arm has already run its
# cases and printed them — exiting there would throw that away and never reach
# the TOTAL line. A dependency problem should stop the run before it starts.
command -v perl >/dev/null 2>&1 || {
  echo "perl is required to build the Editor-path fixtures (PART 13)" >&2; exit 2; }
EDIR="$(mktemp -d "${TMPDIR:-/tmp}/bc-editor.XXXXXX")"
trap 'rm -rf "$EDIR"' EXIT
# THE WHOLE CHAIN, driven by MIGRATIONS so it cannot be a shorter chain than the
# psql arm's. That is not a hypothetical tidy-up: this arm HAD drifted to two
# files while `run_case` had grown to four, so 0004's own digest pin was proven
# on the maintainer's route and never on the client's. 0004's pin is normalized
# for exactly the reason this arm exists; had the arm not applied 0004, nothing
# would have caught it being written the raw way.
#
# Fixtures are named after the migration, so `apply_chain editor` can find each
# one from MIGRATIONS without a second list to keep in step.
for f in "${MIGRATIONS[@]}"; do
  perl -pe 's/\n/\r\n/' "$f" > "$(crlf_of "$f")"
done
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
for f in "$EDIR"/*.crlf.sql; do
  sz=$(wc -c < "$f")
  if [ "$sz" -gt "$lim" ]; then
    # NOT `exit 2`. This is PART 13's problem alone, and exiting here would throw
    # away every psql case that was about to run and report perfectly well.
    # Appended, not assigned: with both fixtures over the limit, overwriting would
    # name only the second and send the reader after half the problem. `$((sz))`
    # strips the padding macOS `wc -c` adds.
    EDITOR_ARM_BLOCKED="${EDITOR_ARM_BLOCKED:+$EDITOR_ARM_BLOCKED; }$f is $((sz)) bytes, over the $lim byte limit for one -c argument"
  fi
done
# The CRLF-ing must have actually happened. `perl` exiting 0 says nothing: a
# perl that did nothing would leave the arm testing the LF path a second time
# and reporting seven green cases for a route it never touched — the exact
# failure mode PART 13 exists to end, so it is asserted, not assumed.
#
# The threshold is a floor, not a count: 0001 is 1735 lines and 0002 is 968, so
# a CR count under 100 means the conversion did not happen rather than that it
# half-happened. An exact count would have to be maintained against the files and
# would fail on every edit.
for f in "$EDIR"/*.crlf.sql; do
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
# WAS "authenticated granted INSERT on trust root", which 0004 made legitimate:
# the admin screen promotes people on the caller's own token, and the INSERT
# POLICY (asserted separately below) is what stops a non-admin using it. UPDATE
# is the verb that stayed forbidden, and it is the dangerous one — it changes no
# row COUNT, so the last-administrator guard never sees it.
run_case "authenticated granted UPDATE on trust root"     REFUSED "grant update on basecamp.super_admins to authenticated;"
# The hole the privilege grant would open if the policy stopped gating on the
# CALLER. With this policy in place a non-admin's INSERT is accepted, and
# self-promotion is one statement.
run_case "trust root INSERT policy no longer checks caller" REFUSED "drop policy basecamp_super_admins_insert_super_admin on basecamp.super_admins; create policy basecamp_super_admins_insert_super_admin on basecamp.super_admins for insert to authenticated with check (true);"
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
# Signature follows 0004, which added banned_until and member_type_id. CREATE OR
# REPLACE cannot change a function's OUT columns, so a mutation written against
# the 0001 shape no longer applies — and a mutation that fails to apply is
# reported as an ERROR rather than silently passing.
run_case "list_people() keeps auth.users but drops its admin gate" REFUSED "create or replace function basecamp.list_people() returns table(id uuid, email text, created_at timestamptz, is_super_admin boolean, banned_until timestamptz, member_type_id uuid) language sql stable security definer set search_path='' as \$x\$ select u.id, u.email::text, u.created_at, exists (select 1 from basecamp.super_admins s where s.user_id = u.id), u.banned_until, (select m.member_type_id from basecamp.members m where m.user_id = u.id) from auth.users u where u.email is not null order by u.email \$x\$;"

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


echo
echo "=== PART 12: CATEGORY NESTING — 0005's assertions, proven to bite ==="
# Each of these breaks ONE thing 0005 or D20 claims to guard, then requires 0002
# to REFUSE. Without them D20 runs on every case above and has never been
# observed to fail — which is the exact trap 0005's own header names when it
# deletes post-condition 4b ("a check that could not fire").
run_case "the category depth cap disabled"          REFUSED "alter table basecamp.categories disable trigger basecamp_categories_depth_cap;"
run_case "the depth cap's upward half gutted"       REFUSED "create or replace function basecamp.enforce_category_depth() returns trigger language plpgsql security definer set search_path='' as \$x\$ begin return new; end \$x\$;"
# Comments must not be a hiding place — this is the shape that defeated the
# audit writer's mention test once already.
run_case "the depth cap gutted, phrases hidden in comments" REFUSED "create or replace function basecamp.enforce_category_depth() returns trigger language plpgsql security definer set search_path='' as \$x\$ begin -- parent_id = new.id and for share
 return new; end \$x\$;"
# Three hiding places, not one. The first fix stripped `--` comments only and a
# review walked past it twice.
run_case "the depth cap gutted, phrases hidden in a BLOCK comment" REFUSED "create or replace function basecamp.enforce_category_depth() returns trigger language plpgsql security definer set search_path='' as \$x\$ begin /* parent_id = new.id and for share and c.id = new.parent_id */ return new; end \$x\$;"
run_case "the depth cap gutted, phrases hidden in a STRING LITERAL" REFUSED "create or replace function basecamp.enforce_category_depth() returns trigger language plpgsql security definer set search_path='' as \$x\$ begin raise debug 'parent_id = new.id for share c.id = new.parent_id'; return new; end \$x\$;"
run_case "the depth cap keeps UPWARD but drops DOWNWARD" REFUSED "create or replace function basecamp.enforce_category_depth() returns trigger language plpgsql security definer set search_path='' as \$x\$ begin if new.parent_id is not null then if exists (select 1 from basecamp.categories c where c.parent_id = new.id for share) then raise exception 'x' using errcode='restrict_violation'; end if; end if; return new; end \$x\$;"
# THE MIRROR IMAGE, and it is the one that got past this file. The self-parent
# guard 0005 added contains the substring the upward assertion matched on, so
# 0002 could no longer tell the upward probe had been deleted. PROVEN before the
# fix: this mutation COMMITTED, and a three-level tree was then built in two
# statements. Keep BOTH directions as cases — each one is the other's blind spot.
run_case "the depth cap keeps DOWNWARD but drops UPWARD" REFUSED "create or replace function basecamp.enforce_category_depth() returns trigger language plpgsql security definer set search_path='' as \$x\$ declare v boolean; begin if new.parent_id is not null then if new.parent_id = new.id then raise exception 'self' using errcode='restrict_violation'; end if; select (c.parent_id is not null) into v from basecamp.categories c where c.id = new.parent_id for share; if v is null then raise exception 'missing' using errcode='foreign_key_violation'; end if; if v then raise exception 'deep' using errcode='restrict_violation'; end if; end if; return new; end \$x\$;"
run_case "the depth cap's parent lock removed"      REFUSED "create or replace function basecamp.enforce_category_depth() returns trigger language plpgsql security definer set search_path='' as \$x\$ declare v boolean; begin if new.parent_id is not null then select (c.parent_id is not null) into v from basecamp.categories c where c.id = new.parent_id; if v then raise exception 'nope' using errcode='restrict_violation'; end if; if exists (select 1 from basecamp.categories c where c.parent_id = new.id) then raise exception 'nope' using errcode='restrict_violation'; end if; end if; return new; end \$x\$;"
run_case "categories.parent_id flipped to CASCADE"  REFUSED "alter table basecamp.categories drop constraint basecamp_categories_parent_id_fkey; alter table basecamp.categories add constraint basecamp_categories_parent_id_fkey foreign key (parent_id) references basecamp.categories(id) on delete cascade;"
run_case "entries.category_id flipped to CASCADE"   REFUSED "alter table basecamp.entries drop constraint basecamp_entries_category_id_fkey; alter table basecamp.entries add constraint basecamp_entries_category_id_fkey foreign key (category_id) references basecamp.categories(id) on delete cascade;"
run_case "the self-parent CHECK dropped"            REFUSED "alter table basecamp.categories drop constraint basecamp_categories_parent_not_self;"
run_case "the read path narrowed back to category_has_grant" REFUSED "drop policy basecamp_categories_select_granted on basecamp.categories; create policy basecamp_categories_select_granted on basecamp.categories for select to authenticated using ((select basecamp.is_super_admin()) or basecamp.category_has_grant(id));"
run_case "the depth cap flipped to SECURITY INVOKER" REFUSED "alter function basecamp.enforce_category_depth() security invoker;"
# THE READ GATE'S BODY. Existence, prosecdef and the policy's mention are all
# satisfied by `select true`, which hands every category name, description and
# slug to a signed-in person with zero grants. PROVEN: before the digest pin was
# added to 0002 and 0005, this exact mutation COMMITTED. It is the same defeat
# this suite records for `category_has_grant`, on the function 0005 added.
run_case "the nesting read gate stubbed to select true" REFUSED "create or replace function basecamp.category_or_child_has_grant(p_category_id uuid) returns boolean language sql stable security definer set search_path='' as \$x\$ select true \$x\$;"
# And the comment-hiding variant, because that is what beat the audit writer's
# first, mention-only guard.
run_case "the nesting read gate stubbed, tokens hidden in a COMMENT" REFUSED "create or replace function basecamp.category_or_child_has_grant(p_category_id uuid) returns boolean language sql stable security definer set search_path='' as \$x\$ select true /* basecamp.category_has_grant parent_id */ \$x\$;"
# A same-named decoy on another table: the defeat that beat the first draft of
# the named trigger set.
run_case "a guard trigger moved to another table, name kept" REFUSED "drop trigger basecamp_member_types_no_system_delete on basecamp.member_types; create trigger basecamp_member_types_no_system_delete before insert on basecamp.categories for each row execute function basecamp.set_updated_at();"

# ============================================================================
# PART 13: THE EDITOR PATH. Everything above this line reached the database
# through `psql -f` on files with LF endings — the maintainer's route, not the
# client's. A client pastes the migration files into the Supabase SQL Editor,
# and a full-green psql route said nothing whatsoever about that. It could not: on
# 2026-08-19 a client ran 0001 clean in the Editor and 0002 refused on the
# `is_super_admin` digest, with this suite green on that same commit.
#
# WHAT THIS ARM REPRODUCES, and it is two things, both of which matter:
#   1. CRLF line endings. A Windows clipboard, a `core.autocrlf` checkout or a
#      browser download turns every LF into CRLF. `prosrc` stores a function
#      body byte-for-byte, so every pinned body gains carriage returns the
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
#   - The remaining eight are TRANSPORT COVERAGE: digest-only catches from the
#     psql arm, re-run through the CRLF route to show the pin still bites once
#     bodies arrive carrying carriage returns. They do not discriminate between
#     normalizations and are not claimed to.
EXPECTED_EDITOR_CASES=11
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

  setup_step "$name" fail "create db" -c "drop database if exists $ED_DB;" -c "create database $ED_DB;" || return
  setup_step "$name" fail "stub"      -d "$ED_DB" -f "$SP/_supabase_surface_stub.sql"      || return
  # THE SAME CHAIN AS `run_case`, delivered the way the Editor delivers it: CRLF,
  # whole file, one statement. Same array, same length — the two arms are meant to
  # differ in TRANSPORT and in nothing else, and reading the length from
  # MIGRATIONS is what now makes that true by construction rather than by memory.
  apply_chain "$name" fail editor "$ED_DB" "${#MIGRATIONS[@]}" || return

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
    if ! $BASE -d "$ED_DB" -c "$(printf '%s' "$mutation" | perl -pe 's/\n/\r\n/')" >/dev/null 2>&1; then
      echo "  ERROR   mutation did not apply: $name"; fail=$((fail+1)); return
    fi
  fi
  # THE ASSERTION, through the same transport, and via crlf_of for the same reason
  # the arm applies the chain that way: a literal name here is a name that can
  # stop matching the one the preflight writes.
  if $BASE -d "$ED_DB" -c "$(cat "$(crlf_of "$TPL")")" >/dev/null 2>&1; then got=COMMITTED; else got=REFUSED; fi
  if [ "$got" = "$expect" ]; then
    echo "  PASS  [$got] $name"; pass=$((pass+1))
  else
    echo "  FAIL  [got $got, wanted $expect] $name"; fail=$((fail+1))
  fi
}

echo
echo "=== PART 13: THE EDITOR PATH — the chain pasted CRLF, whole-file, one statement ==="
if [ -n "$EDITOR_ARM_BLOCKED" ]; then
  echo "  ERROR   the editor arm cannot run: $EDITOR_ARM_BLOCKED"
  echo "  ERROR   split the file, or apply it with a transport that does not pass it as one argument"
  fail=$((fail+1))
fi
# THE REGRESSION GUARD. This is the client's failure, reproduced. Against the
# pre-fix 0002 it goes red directly — 0002 refuses the clean CRLF install — and
# the cases after it go red too, but for a duller reason: their "0002 first"
# setup step is that same refusal, so they report `setup failed` rather than a
# verdict. Do not read that as many independent findings; there is one bug here
# and this is the case that names it.
#
# IT NOW COVERS THE WHOLE CHAIN, and that is a second guarantee in the same
# case: 0004 pins its own body by digest, and a raw `md5(prosrc)` there would
# refuse every Editor install of 0004 while the psql arm stayed green — the
# 2026-08-19 failure, one migration later. This case is what makes that
# impossible to ship unnoticed.
run_editor_case "clean CRLF paste of the whole migration chain must commit" COMMITTED ""
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
# The OUT columns are 0004's, not 0001's, because this arm now applies the whole
# chain: `create or replace` cannot change a function's return type, so the
# pre-0004 shape would fail to apply and the case would report "mutation did
# not apply" rather than a verdict. Same mutation as the psql arm's
# "list_people() keeps auth.users but drops its admin gate" — keep them in step.
run_editor_case "CRLF route: list_people keeps auth.users, drops its admin gate" REFUSED "create or replace function basecamp.list_people() returns table(id uuid, email text, created_at timestamptz, is_super_admin boolean, banned_until timestamptz, member_type_id uuid) language sql stable security definer set search_path='' as \$x\$ select u.id, u.email::text, u.created_at, exists (select 1 from basecamp.super_admins s where s.user_id = u.id), u.banned_until, (select m.member_type_id from basecamp.members m where m.user_id = u.id) from auth.users u where u.email is not null order by u.email \$x\$;"
run_editor_case "CRLF route: log_access_change body altered" REFUSED "create or replace function basecamp.log_access_change() returns trigger language plpgsql security definer set search_path='' as \$\$ begin insert into basecamp.access_audit (action, source_table) values ('grant','members'); return null; end \$\$;"
run_editor_case "CRLF route: list_people gains an ungated overload" REFUSED "create function basecamp.list_people(p int) returns table(id uuid, email text, created_at timestamptz) language sql stable security definer set search_path='' as \$x\$ select u.id, u.email::text, u.created_at from auth.users u \$x\$;"

# THE THREE BELOW EXIST BECAUSE THE CHAIN NOW REACHES 0004 AND 0005. Each breaks
# something only the later migrations assert, so each one goes green if the arm
# ever stops applying them — which is the failure mode this file keeps having to
# guard against, in a new place.
#
# 1. 0004's OWN BODY PIN, through the CRLF route. This is the case that would
#    have caught the ported pin being written as a raw `md5(prosrc)`: on a body
#    carrying carriage returns a raw digest misses, so 0002 would refuse the
#    UNMUTATED install and the control case above would already be red. Here the
#    body really is gutted, and the requirement is that a normalized pin still
#    says no. The phrases the mention checks look for are left in COMMENTS, which
#    is the shape that defeated this function's first, mention-only guard.
run_editor_case "CRLF route: log_privileged_action gutted, phrases hidden in comments" REFUSED "create or replace function basecamp.log_privileged_action(p_action text, p_subject_user_id uuid) returns void language plpgsql security definer set search_path='' as \$x\$ begin /* basecamp.is_super_admin() auth.uid() insert into basecamp.access_audit */ return; end \$x\$;"
# 2. THE DIGEST SELECTOR, through the CRLF route. 0002 picks which `list_people`
#    digest to expect by asking whether `log_privileged_action` exists. Drop the
#    sentinel and leave the 0004 body behind and the pre-0004 digest is selected,
#    which would let a revert of the roster function pass unnoticed. 0002 has an
#    explicit guard for that, and this proves the guard reads a NORMALIZED digest
#    — with a raw one the guard could not recognise the 0004 body at all on a
#    CRLF-installed database, and would silently never fire.
run_editor_case "CRLF route: log_privileged_action dropped, its 0004 body left behind" REFUSED "drop function basecamp.log_privileged_action(text, uuid);"
# 3. 0005's DEPTH CAP, through the CRLF route. Nothing else in this arm touches
#    the nesting guard, so without this case 0005 is covered on the maintainer's
#    transport only.
run_editor_case "CRLF route: the category depth cap disabled" REFUSED "alter table basecamp.categories disable trigger basecamp_categories_depth_cap;"
# 4. THE NESTING READ GATE, through the CRLF route. 0005 pins this body too, so
#    a raw digest there would refuse every Editor install of 0005 exactly as it
#    would for 0004 — this is the case that would say so.
run_editor_case "CRLF route: the nesting read gate stubbed to select true" REFUSED "create or replace function basecamp.category_or_child_has_grant(p_category_id uuid) returns boolean language sql stable security definer set search_path='' as \$x\$ select true \$x\$;"
# ---------------------------------------------------------------------------
# PART 14: THE PRIVILEGE 0004 OPENED, EXERCISED FOR REAL
#
# Every case above asks the same question: does `0002` REFUSE a broken schema?
# That is a question about assertions. These ask a different one: does the
# DATABASE refuse a real attacker holding a real session?
#
# The distinction is the whole reason this part exists. 0004 grants
# `authenticated` INSERT and DELETE on the trust root. Nothing above proves
# that the POLICY is what stops a non-administrator using that privilege — a
# schema check cannot, because the privilege is now supposed to be there. So
# these run actual statements as `authenticated` with a real `auth.uid()` and
# require the database to say no.
#
# THIS IS THE SECURITY GATE. `npm test` is convenience — it covers pure
# TypeScript logic and cannot reach Postgres, so it can be green while every
# property below is broken. Run this file when you touch 0002, 0004, or any
# policy.
#
# One schema, many cases: each runs inside a transaction that is ROLLED BACK, so
# they are isolated from each other without paying a database rebuild each time.
# The begin/rollback is wrapped around every case by run_rls_assert — an earlier
# draft claimed this isolation in a comment and did not implement it, and it held
# only by accident because every case either raised or mutated zero rows. A case
# that mutated AND passed would have leaked into every case after it.
# ---------------------------------------------------------------------------

rls_pass=0; rls_fail=0; rls_ran=0

# How many assertions PART 14 runs. Same discipline as EXPECTED_CASES, and
# asserted the same way: a lost case is silent, and silence here reads as proof.
EXPECTED_RLS_CASES=21

ADMIN_UID=11111111-1111-1111-1111-111111111111
OTHER_UID=22222222-2222-2222-2222-222222222222
SPARE_UID=33333333-3333-3333-3333-333333333333

# Each case is an assertion that MUST HOLD: the SQL raises when the security
# property is violated, so psql exiting 0 is a pass. Expressing them this way
# rather than as "expect an error" lets the zero-rows cases — where RLS filters
# silently instead of raising — be checked in exactly the same shape.
run_rls_assert () {
  local name="$1" sql="$2"
  rls_ran=$((rls_ran+1))
  # stderr is CAPTURED, not discarded. A typo in a case's SQL fails exactly like
  # a real security failure, and a suite that cannot tell those apart tells you
  # nothing on the day it goes red.
  local out
  if out=$($BASE -d $RLSDB -c "begin; $sql rollback;" 2>&1); then
    echo "  PASS  $name"; rls_pass=$((rls_pass+1))
  else
    echo "  FAIL  $name"; rls_fail=$((rls_fail+1))
    echo "$out" | grep -E "ERROR|FATAL" | head -2 | sed 's/^/          /'
  fi
}

echo
echo "=== PART 14: RUNTIME REFUSALS — the trust root under a real session ==="

RLSDB="${DB}_rls"
rls_setup () {
  # Same chain as every other arm, from the same array. This one builds its mirror
  # ONCE for all its cases rather than per case, because each case runs inside a
  # transaction that is rolled back.
  $BASE -c "drop database if exists $RLSDB;" -c "create database $RLSDB;" >/dev/null 2>&1 || return 1
  $BASE -d $RLSDB -f "$SP/_supabase_surface_stub.sql"                      >/dev/null 2>&1 || return 1
  apply_chain "PART 14 setup" rls_fail psql "$RLSDB" "${#MIGRATIONS[@]}"                   || return 1
  $BASE -d $RLSDB -c "insert into auth.users (id,email) values ('$ADMIN_UID','admin@test'),('$OTHER_UID','nobody@test'),('$SPARE_UID','spare@test'); insert into basecamp.super_admins (user_id) values ('$ADMIN_UID');" >/dev/null 2>&1 || return 1
}
if ! rls_setup; then
  echo "  ERROR   PART 14 setup failed — cannot build the runtime mirror" >&2
  rls_fail=$((rls_fail+1))
fi

# THE self-promotion case. A signed-in nobody inserting their OWN id: the exact
# statement the 0004 privilege grant would enable if the policy stopped gating
# on the caller.
run_rls_assert "a non-admin cannot promote THEMSELVES" "
do \$\$
declare msg text;
begin
  begin
    set local role authenticated;
    perform set_config('request.jwt.claims', '{\"sub\":\"$OTHER_UID\"}', true);
    insert into basecamp.super_admins (user_id) values ('$OTHER_UID');
    raise exception 'SELF-PROMOTION SUCCEEDED — a signed-in non-admin made themselves an administrator';
  exception when insufficient_privilege then
    get stacked diagnostics msg = message_text;
    -- RLS refusal and 'permission denied for table' are BOTH 42501. A review
    -- PROVED this case passed with 0004's grant revoked — testing nothing,
    -- because the statement never reached the policy. Assert on the message so
    -- a reverted grant goes red instead of green.
    if msg not like '%row-level security policy%' then
      raise exception 'refused by table privilege, not by the policy (%) — the 0004 grant is missing and this case proved nothing', msg;
    end if;
  end;
end \$\$;"

# The same statement naming someone else. Refused for the same reason — the
# policy checks the caller, not the row — but worth its own case: a policy
# rewritten as \`user_id = auth.uid()\` would pass the case above and fail this one.
run_rls_assert "a non-admin cannot promote SOMEONE ELSE" "
do \$\$
declare msg text;
begin
  begin
    set local role authenticated;
    perform set_config('request.jwt.claims', '{\"sub\":\"$OTHER_UID\"}', true);
    insert into basecamp.super_admins (user_id) values ('$SPARE_UID');
    raise exception 'a signed-in non-admin promoted another user';
  exception when insufficient_privilege then
    get stacked diagnostics msg = message_text;
    if msg not like '%row-level security policy%' then
      raise exception 'refused by table privilege, not by the policy (%) — this case proved nothing', msg;
    end if;
  end;
end \$\$;"

# DELETE under RLS does not raise — the policy filters the rows away and the
# statement reports success having removed nothing. Checking the ROW COUNT is
# the only way to tell "refused" from "deleted".
run_rls_assert "a non-admin cannot delete an existing administrator" "
do \$\$
declare n integer;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', '{\"sub\":\"$OTHER_UID\"}', true);
  delete from basecamp.super_admins where user_id = '$ADMIN_UID';
  get diagnostics n = row_count;
  if n <> 0 then
    raise exception 'a signed-in non-admin deleted % administrator row(s)', n;
  end if;
end \$\$;"

# The lockout guard. An ADMIN — legitimately privileged — removing the final
# administrator must still be refused, or the app has no way back in.
run_rls_assert "even an admin cannot delete the LAST administrator" "
do \$\$ begin
  begin
    set local role authenticated;
    perform set_config('request.jwt.claims', '{\"sub\":\"$ADMIN_UID\"}', true);
    delete from basecamp.super_admins where user_id = '$ADMIN_UID';
    raise exception 'the last administrator was deleted — the app is now unadministrable';
  exception when restrict_violation then null;
  end;
end \$\$;"

# The audit log's writer. It is the one path that reaches the append-only table
# without any client role holding INSERT, so it carries its own gate.
run_rls_assert "a non-admin cannot write the audit log through the RPC" "
do \$\$
declare msg text;
begin
  begin
    set local role authenticated;
    perform set_config('request.jwt.claims', '{\"sub\":\"$OTHER_UID\"}', true);
    perform basecamp.log_privileged_action('ban', '$SPARE_UID');
    raise exception 'a signed-in non-admin wrote an audit row';
  exception when insufficient_privilege then
    get stacked diagnostics msg = message_text;
    -- 'permission denied for function' is ALSO 42501, and swallowing it meant
    -- this case passed without ever reaching the function's is_super_admin()
    -- gate. Require the gate's own message.
    if msg not like '%only an administrator%' then
      raise exception 'refused before the gate (%) — the EXECUTE grant is missing and this case proved nothing', msg;
    end if;
  end;
end \$\$;"

# The roster is a definer function, so its gate is in its BODY rather than in a
# policy — nothing above would notice if that WHERE clause were lost, and losing
# it publishes every account on the project to every signed-in user.
run_rls_assert "a non-admin sees ZERO people, not a filtered list" "
do \$\$
declare n integer;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', '{\"sub\":\"$OTHER_UID\"}', true);
  select count(*) into n from basecamp.list_people();
  if n <> 0 then
    raise exception 'list_people() returned % row(s) to a non-administrator', n;
  end if;
end \$\$;"

# POSITIVE CONTROLS. Every case above asserts a refusal, and a refusal is also
# what a completely broken schema produces. These two require the intended path
# to WORK, so a revoked grant or a dropped policy cannot masquerade as security.
run_rls_assert "an admin CAN promote someone — the grant really is there" "
do \$\$
declare n integer;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', '{\"sub\":\"$ADMIN_UID\"}', true);
  insert into basecamp.super_admins (user_id) values ('$SPARE_UID');
  get diagnostics n = row_count;
  if n <> 1 then
    raise exception 'an administrator could not promote anyone — the admin screen is broken';
  end if;
end \$\$;"

run_rls_assert "an admin CAN write the audit log, pinned to their own uid" "
do \$\$
declare a uuid; s text; lbl text;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', '{\"sub\":\"$ADMIN_UID\"}', true);
  perform basecamp.log_privileged_action('ban', '$SPARE_UID');
  select actor_id, source_table, subject_label into a, s, lbl
    from basecamp.access_audit order by id desc limit 1;
  if a <> '$ADMIN_UID' or s <> 'auth_admin' then
    raise exception 'the audit row was not pinned to the caller (actor=%, source=%)', a, s;
  end if;
  -- The label is LOOKED UP, not supplied. If this is null the snapshot broke.
  if lbl <> 'spare@test' then
    raise exception 'the subject label was not snapshotted from auth.users (got %)', lbl;
  end if;
end \$\$;"

# ---------------------------------------------------------------------------
# PART 15: THE CATALOG, UNDER A REAL SESSION
#
# 0005 lets administrators build the catalog from the UI, which means
# `authenticated` now writes `basecamp.categories` from a browser. Everything
# that keeps that safe is a policy or a trigger, and PARTS 1-11 can only ask
# whether 0002 refuses a broken schema — not whether Postgres refuses a real
# person. Same distinction PART 14 draws for the trust root.
#
# THE ZERO-ROW CASES ARE THE POINT. RLS does not raise on UPDATE or DELETE: the
# policy filters the row away and PostgREST answers 204, which supabase-js
# reports as success. This repo has shipped that bug twice. A test that only
# asks "did it error?" would pass on a refused delete, so these check the ROW
# COUNT.
#
# Reuses PART 14's schema, roles and admin/non-admin uuids; each case runs in a
# rolled-back transaction.
# ---------------------------------------------------------------------------

echo
echo "=== PART 15: CATALOG WRITES — the database refusing a real session ==="

run_rls_assert "a non-admin cannot CREATE a category" "
do \$\$
declare msg text;
begin
  begin
    set local role authenticated;
    perform set_config('request.jwt.claims', '{\"sub\":\"$OTHER_UID\"}', true);
    insert into basecamp.categories (slug, name, description)
      values ('rogue-cat', 'Rogue', 'should not exist');
    raise exception 'a signed-in non-admin created a category';
  exception when insufficient_privilege then
    get stacked diagnostics msg = message_text;
    -- 'permission denied for table' is the GRANT missing, not the POLICY
    -- working. 0001 grants authenticated INSERT here, so a case that passed on
    -- a missing grant would be proving nothing.
    if msg not like '%row-level security policy%' then
      raise exception 'refused by table privilege, not by the policy (%) — this case proved nothing', msg;
    end if;
  end;
end \$\$;"

run_rls_assert "a non-admin cannot CREATE an entry" "
do \$\$
declare msg text; cat_id uuid;
begin
  set local role postgres;
  insert into basecamp.categories (slug, name, description)
    values ('victim-cat', 'Victim', 'x') returning id into cat_id;
  begin
    set local role authenticated;
    perform set_config('request.jwt.claims', '{\"sub\":\"$OTHER_UID\"}', true);
    insert into basecamp.entries
      (category_id, display_name, description, entry_type, status, host,
       auth_boundary, trigger_type, owner, slug)
      values (cat_id, 'Rogue', 'x', 'reference_only', 'active', 'unknown', 'unknown', 'user', 'nobody', 'rogue-entry');
    raise exception 'a signed-in non-admin created an entry';
  exception when insufficient_privilege then
    get stacked diagnostics msg = message_text;
    if msg not like '%row-level security policy%' then
      raise exception 'refused by table privilege, not by the policy (%) — this case proved nothing', msg;
    end if;
  end;
end \$\$;"

run_rls_assert "a category a non-admin can see SURVIVES their delete" "
do \$\$
declare cat_id uuid; ent_id uuid;
begin
  set local role postgres;
  insert into basecamp.categories (slug, name, description)
    values ('del-target', 'Target', 'x') returning id into cat_id;
  insert into basecamp.entries
    (category_id, display_name, description, entry_type, status, host,
     auth_boundary, trigger_type, owner, slug)
    values (cat_id, 'Tile', 'x', 'reference_only', 'active', 'unknown', 'unknown', 'user', 'o', 'del-target-e')
    returning id into ent_id;
  insert into basecamp.access_grants (user_id, entry_id) values ('$OTHER_UID', ent_id);

  set local role authenticated;
  perform set_config('request.jwt.claims', '{\"sub\":\"$OTHER_UID\"}', true);
  if not exists (select 1 from basecamp.categories where id = cat_id) then
    raise exception 'the target is not readable by the stranger — this case would prove nothing';
  end if;

  -- WHAT THIS CASE CAN AND CANNOT PROVE, stated plainly.
  --
  -- It asserts the OUTCOME (the category survives), not which guard produced
  -- it, because two independent guards refuse and they cannot be separated
  -- here: a category is only readable by a non-admin when it holds something
  -- (category_has_grant requires an entry, or a granted child), and holding
  -- something is exactly what makes entries.category_id ON DELETE RESTRICT
  -- refuse the delete. So a non-admin can never reach a category that is both
  -- visible to them and deletable.
  --
  -- An earlier version used an EMPTY category and checked only the row count.
  -- That proved nothing at all: an empty category is invisible to everyone, so
  -- PostgreSQL filtered it out of the DELETE target set before the policy was
  -- consulted, and the case still passed with the DELETE policy rewritten to
  -- \`using (true)\`. PROVEN. The RENAME case below is the one that isolates
  -- the write policy, because UPDATE has no foreign key in its way.
  begin
    delete from basecamp.categories where id = cat_id;
  exception when foreign_key_violation then null;
  end;
  if not exists (select 1 from basecamp.categories where id = cat_id) then
    raise exception 'a signed-in non-admin deleted a category';
  end if;
end \$\$;"

run_rls_assert "a non-admin RENAMING a category changes ZERO rows" "
do \$\$
declare n integer; cat_id uuid; ent_id uuid;
begin
  set local role postgres;
  insert into basecamp.categories (slug, name, description)
    values ('ren-target', 'Target', 'x') returning id into cat_id;
  insert into basecamp.entries
    (category_id, display_name, description, entry_type, status, host,
     auth_boundary, trigger_type, owner, slug)
    values (cat_id, 'Tile', 'x', 'reference_only', 'active', 'unknown', 'unknown', 'user', 'o', 'ren-target-e')
    returning id into ent_id;
  insert into basecamp.access_grants (user_id, entry_id) values ('$OTHER_UID', ent_id);

  set local role authenticated;
  perform set_config('request.jwt.claims', '{\"sub\":\"$OTHER_UID\"}', true);
  if not exists (select 1 from basecamp.categories where id = cat_id) then
    raise exception 'the target is not readable by the stranger — this case would pass without testing the UPDATE policy';
  end if;
  update basecamp.categories set name = 'Renamed by a stranger' where id = cat_id;
  get diagnostics n = row_count;
  if n <> 0 then
    raise exception 'a signed-in non-admin renamed % category row(s)', n;
  end if;
end \$\$;"

run_rls_assert "a category cannot be made its own parent" "
do \$\$
declare cat_id uuid;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', '{\"sub\":\"$ADMIN_UID\"}', true);
  insert into basecamp.categories (slug, name, description)
    values ('selfp', 'Self', 'x') returning id into cat_id;
  begin
    -- On UPDATE the depth cap's two probes BOTH pass on this statement (one
    -- reads the OLD parent, the other asks about rows that do not exist yet),
    -- so this is the case the CHECK and the trigger's self-guard exist for. A
    -- self-parented row is a 1-cycle that ON DELETE RESTRICT makes undeletable.
    update basecamp.categories set parent_id = id where id = cat_id;
    raise exception 'a category was made its own parent — an undeletable 1-cycle';
  exception when restrict_violation or check_violation then null;
  end;
end \$\$;"

run_rls_assert "a granted viewer can read the PARENT of a subcategory they can see" "
do \$\$
declare top_id uuid; sub_id uuid; ent_id uuid; n integer;
begin
  set local role postgres;
  insert into basecamp.categories (slug, name, description)
    values ('vis-top', 'Container', 'x') returning id into top_id;
  insert into basecamp.categories (slug, name, description, parent_id)
    values ('vis-sub', 'Child', 'x', top_id) returning id into sub_id;
  insert into basecamp.entries
    (category_id, display_name, description, entry_type, status, host,
     auth_boundary, trigger_type, owner, slug)
    values (sub_id, 'Tile', 'x', 'reference_only', 'active', 'unknown', 'unknown', 'user', 'o', 'vis-e')
    returning id into ent_id;
  insert into basecamp.access_grants (user_id, entry_id) values ('$OTHER_UID', ent_id);

  set local role authenticated;
  perform set_config('request.jwt.claims', '{\"sub\":\"$OTHER_UID\"}', true);
  select count(*) into n from basecamp.categories where id = top_id;
  if n <> 1 then
    raise exception 'a container parent is invisible while its child is visible — the client holds a parent_id it cannot resolve';
  end if;
end \$\$;"

run_rls_assert "an EMPTY category with no granted children stays hidden" "
do \$\$
declare n integer;
begin
  set local role postgres;
  insert into basecamp.categories (slug, name, description)
    values ('secret-empty', 'Secret', 'must not be disclosed');

  set local role authenticated;
  perform set_config('request.jwt.claims', '{\"sub\":\"$OTHER_UID\"}', true);
  -- The invariant the widened read predicate must NOT have broken: a category
  -- with nothing visible inside it must not disclose its name.
  select count(*) into n from basecamp.categories where slug = 'secret-empty';
  if n <> 0 then
    raise exception 'an empty category is readable by somebody granted nothing in it';
  end if;
end \$\$;"

run_rls_assert "the depth cap refuses a THIRD level" "
do \$\$
declare top_id uuid; sub_id uuid;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', '{\"sub\":\"$ADMIN_UID\"}', true);
  insert into basecamp.categories (slug, name, description)
    values ('cap-top', 'Top', 'x') returning id into top_id;
  insert into basecamp.categories (slug, name, description, parent_id)
    values ('cap-sub', 'Sub', 'x', top_id) returning id into sub_id;
  begin
    insert into basecamp.categories (slug, name, description, parent_id)
      values ('cap-deep', 'Deep', 'x', sub_id);
    raise exception 'a third level was created — the depth cap did not fire';
  exception when restrict_violation then null;
  end;
end \$\$;"

run_rls_assert "the depth cap refuses building a third level BOTTOM-UP" "
do \$\$
declare a_id uuid; b_id uuid; c_id uuid;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', '{\"sub\":\"$ADMIN_UID\"}', true);
  insert into basecamp.categories (slug, name, description)
    values ('bu-a', 'A', 'x') returning id into a_id;
  insert into basecamp.categories (slug, name, description, parent_id)
    values ('bu-b', 'B', 'x', a_id) returning id into b_id;
  insert into basecamp.categories (slug, name, description)
    values ('bu-c', 'C', 'x') returning id into c_id;
  begin
    -- A is legal in isolation and so is C. The TREE is what breaks, which is
    -- why checking only the downward direction is not enough.
    update basecamp.categories set parent_id = c_id where id = a_id;
    raise exception 'a category with children was given a parent — the upward half of the cap did not fire';
  exception when restrict_violation then null;
  end;
end \$\$;"

run_rls_assert "deleting a category that still holds a SUBCATEGORY is refused" "
do \$\$
declare top_id uuid;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', '{\"sub\":\"$ADMIN_UID\"}', true);
  insert into basecamp.categories (slug, name, description)
    values ('hold-sub', 'Holder', 'x') returning id into top_id;
  insert into basecamp.categories (slug, name, description, parent_id)
    values ('held-sub', 'Held', 'x', top_id);
  begin
    delete from basecamp.categories where id = top_id;
    raise exception 'a category was deleted while it still had a subcategory — its contents would have gone with it';
  exception when foreign_key_violation then null;
  end;
end \$\$;"

run_rls_assert "deleting a category that still holds an ENTRY is refused" "
do \$\$
declare cat_id uuid;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', '{\"sub\":\"$ADMIN_UID\"}', true);
  insert into basecamp.categories (slug, name, description)
    values ('hold-entry', 'Holder', 'x') returning id into cat_id;
  -- reference_only, not launchable: a launchable entry carries
  -- CHECK (entry_type <> 'launchable' OR launch_url IS NOT NULL), and this case
  -- is about the FK refusing a delete, not about URL validation.
  insert into basecamp.entries
    (category_id, display_name, description, entry_type, status, host,
     auth_boundary, trigger_type, owner, slug)
    values (cat_id, 'Tile', 'x', 'reference_only', 'active', 'unknown', 'unknown', 'user', 'someone', 'held-entry');
  begin
    delete from basecamp.categories where id = cat_id;
    raise exception 'a category was deleted while it still held an entry';
  exception when foreign_key_violation then null;
  end;
end \$\$;"

# POSITIVE CONTROLS. Every case above asserts a refusal, and a refusal is also
# what a completely broken schema produces. These require the intended path to
# WORK, so a revoked grant cannot masquerade as security.
run_rls_assert "an admin CAN create a category and nest one level under it" "
do \$\$
declare top_id uuid; n integer;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', '{\"sub\":\"$ADMIN_UID\"}', true);
  insert into basecamp.categories (slug, name, description)
    values ('ok-top', 'Top', 'x') returning id into top_id;
  insert into basecamp.categories (slug, name, description, parent_id)
    values ('ok-sub', 'Sub', 'x', top_id);
  select count(*) into n from basecamp.categories where parent_id = top_id;
  if n <> 1 then
    raise exception 'an administrator could not nest a subcategory — the catalog screen is broken';
  end if;
end \$\$;"

run_rls_assert "an admin CAN rename and delete an empty category" "
do \$\$
declare cat_id uuid; n integer;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', '{\"sub\":\"$ADMIN_UID\"}', true);
  insert into basecamp.categories (slug, name, description)
    values ('ok-empty', 'Empty', 'x') returning id into cat_id;
  update basecamp.categories set name = 'Renamed' where id = cat_id;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'an administrator could not rename a category'; end if;
  delete from basecamp.categories where id = cat_id;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'an administrator could not delete an empty category'; end if;
end \$\$;"


echo
echo "=== PARTS 14+15 TOTAL: $rls_pass passed, $rls_fail failed (of $EXPECTED_RLS_CASES expected) ==="
# NO `exit` here. An earlier draft exited on a count drift at this point, which
# suppressed the main suite's own summary and the EXPECTED_CASES and
# whitelist assertions below — the exact "silence reads as proof" failure this
# file exists to prevent, reachable from its newest part. Every count check,
# summary and exit now happens in one block at the end.
$BASE -c "drop database if exists $RLSDB;" >/dev/null 2>&1


# ---------------------------------------------------------------------------
# PART 16: 0004's OWN POST-CONDITIONS, AS THE FILE UNDER TEST
#
# Every case in PARTS 1-11 re-runs 0002. That leaves 0004's post-conditions
# completely uncovered, and a review found the consequence: roughly half of them
# guard objects 0004 itself recreates a few hundred lines earlier, so they could
# never fail. The ones that matter — the trust-root grant, the guard triggers,
# the members UNIQUE — are only meaningful if something breaks them BEFORE 0004
# runs. That is what this part does.
#
# Same rebuild-per-case discipline as run_case, but the target is 0004.
# ---------------------------------------------------------------------------

m4_pass=0; m4_fail=0; m4_ran=0
EXPECTED_M4_CASES=7

run_0004_case () {
  local name="$1" expect="$2" mutation="$3"
  m4_ran=$((m4_ran+1))
  local db="${DB}_m4"
  # EVERY setup step is checked, for the reason run_case spells out at length:
  # unchecked, a failed step makes each REFUSED-expecting case pass for the
  # wrong reason. PROVEN here too — skipping 0002 entirely left all four cases
  # matching their expectations, so this part would have printed "4 passed,
  # 0 failed" against a database that never had the boundary applied.
  setup_step "$name" m4_fail "create db" -c "drop database if exists $db;" -c "create database $db;" || return
  setup_step "$name" m4_fail "stub"      -d $db -f "$SP/_supabase_surface_stub.sql"          || return
  # STOPS AT 0002, and the 2 is the point of this arm: 0004 is the file under
  # test, so it must not already be applied. Passing the length explicitly is what
  # makes that a visible decision instead of an omission someone has to notice.
  apply_chain "$name" m4_fail psql "$db" 2 || return
  if [ -n "$mutation" ]; then
    $BASE -d $db -c "$mutation" >/dev/null 2>&1 || { echo "  ERROR   mutation did not apply: $name"; m4_fail=$((m4_fail+1)); return; }
  fi
  if $BASE -d $db -f "$M4" >/dev/null 2>&1; then got=COMMITTED; else got=REFUSED; fi
  # A refusal must also leave nothing behind — that is D1's whole point.
  local leaked
  leaked=$($BASE -d $db -At -c "select has_table_privilege('authenticated','basecamp.super_admins','insert');" 2>/dev/null)
  if [ "$got" = "REFUSED" ] && [ "$leaked" = "t" ]; then
    echo "  FAIL  [refused but the trust-root grant COMMITTED anyway] $name"; m4_fail=$((m4_fail+1))
    $BASE -c "drop database if exists $db;" >/dev/null 2>&1
    return
  fi
  if [ "$got" = "$expect" ]; then
    echo "  PASS  [$got] $name"; m4_pass=$((m4_pass+1))
  else
    echo "  FAIL  [got $got, wanted $expect] $name"; m4_fail=$((m4_fail+1))
  fi
  $BASE -c "drop database if exists $db;" >/dev/null 2>&1
}

echo
echo "=== PART 16: 0004 AS THE FILE UNDER TEST ==="
run_0004_case "clean schema — 0004 must apply" COMMITTED ""
# D9: the guard that makes an opened DELETE survivable.
run_0004_case "last-admin guard disabled before 0004 opens DELETE" REFUSED "alter table basecamp.super_admins disable trigger basecamp_super_admins_keep_last;"
# The trust root's audit writer — a promotion nobody can see is not a promotion.
run_0004_case "trust-root audit writer detached before 0004" REFUSED "drop trigger basecamp_super_admins_audit on basecamp.super_admins;"
# D1's own case, kept here so the atomicity guarantee has a permanent home.
run_0004_case "members loses UNIQUE (user_id) — roster shape breaks" REFUSED "alter table basecamp.members drop constraint basecamp_members_user_id_key;"
# THE UPGRADE PATH, AS A POSITIVE CONTROL. Not a mutation: this is the state a
# real install is in, and 0004 must APPLY on it.
#
# Every stamp before 0004 had zero member types and its Add-person dialog told
# the administrator to create one on the Types tab — so an upgrading database
# very likely already holds a hand-made `staff` with `is_system = false`. The
# seed was written `on conflict (slug) do nothing`, which skipped those rows;
# post-condition 6g then counted fewer than three is_system types and 0004 rolled
# back ENTIRELY, trust-root grants included. The people most likely to hit it
# were the ones who had followed the previous instructions.
#
# `do update set is_system = true` adopts them instead, leaving name and
# description alone so a rename survives. Expect COMMITTED: if anyone puts
# `do nothing` back, this case goes red instead of an upgrading client's install.
run_0004_case "an install with hand-made types of the same slug still applies" COMMITTED "insert into basecamp.member_types (slug, name, is_system) values ('staff','Our People',false),('contractor','Contractor',false),('client','Client',false);"
# AND THE COUNT HALF OF 6g STILL BITES. Make the seed unable to take — anything
# that stops three is_system rows existing — and 0004 must refuse rather than
# ship a database whose Add-person screen has nothing to offer.
run_0004_case "the seed prevented from marking any type is_system" REFUSED "alter table basecamp.member_types add constraint bc_no_system check (not is_system);"
# is_system is only worth anything while the trigger reads it. Disabled, the
# flag is a boolean nobody consults and a client can delete their way back to
# zero types — which breaks Add person with no way back except SQL.
run_0004_case "the is_system delete guard disabled" REFUSED "alter table basecamp.member_types disable trigger basecamp_member_types_no_system_delete;"

echo
echo "=== PART 16 TOTAL: $m4_pass passed, $m4_fail failed (of $EXPECTED_M4_CASES expected) ==="


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
if [ "$m4_ran" -ne "$EXPECTED_M4_CASES" ]; then
  echo "0004 CASE COUNT CHANGED: ran $m4_ran, expected $EXPECTED_M4_CASES." >&2
  exit 1
fi
if [ "$rls_ran" -ne "$EXPECTED_RLS_CASES" ]; then
  echo "RLS CASE COUNT CHANGED: ran $rls_ran, expected $EXPECTED_RLS_CASES." >&2
  echo "A runtime case was added or lost. If deliberate, update EXPECTED_RLS_CASES in the same commit." >&2
  exit 1
fi
if [ "$whitelist_hits" -ne "$EXPECTED_WHITELIST_HITS" ]; then
  echo "WHITELIST DRIFT: $whitelist_hits case(s) matched an expect-COMMIT list, expected $EXPECTED_WHITELIST_HITS." >&2
  echo "An entry names a case that no longer exists (a rename?), or a new case matched one." >&2
  exit 1
fi
[ "$fail" -eq 0 ] && [ "$rls_fail" -eq 0 ] && [ "$m4_fail" -eq 0 ] || exit 1
