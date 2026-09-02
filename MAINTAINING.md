# Maintaining this template

**Clients do not need this file.** It is for whoever re-extracts this repository
from the private application it is generated from. If you stamped a copy of this
template, you can delete it.

---

## What this repository is

A **generated artifact**. It is not a fork of the upstream application and there
is no submodule, no remote link, and no automation between them. A change
upstream does not reach here; someone re-runs the extraction by hand.

That makes one thing load-bearing: **the anchor.**

| | |
|---|---|
| **Extracted from upstream commit** | `f880dda` |
| **Baseline squashed from migration** | `20260814100100` (see `SOURCE-MIGRATION-VERSION` in `0001_baseline.sql`) |
| **Baseline generated on** | 2026-08-14 (see `GENERATED-ON` in the same file) |
| **SQL boundary ported forward from** | `b3fba04` on 2026-08-17 — **`supabase/` only**, see below |

**Update the anchor row above in the same commit as every re-extraction**, and
mirror it in the upstream repo's `issues.md`. Everything below depends on knowing
which upstream commit this tree currently corresponds to. A wrong guess silently
reverts or duplicates prose edits across dozens of files, and nothing will fail
to warn you.

### The out-of-band SQL port, and why the anchor did not move

On 2026-08-17 the security boundary was brought forward on its own, without a
full re-extraction. **The tree still corresponds to `f880dda` everywhere except
`supabase/`.** Do not "correct" the anchor to `4f340e0` — that would tell the
next re-extraction that dozens of app files are already current when they are
not, and the three-way merge would then skip them silently.

What was ported, from upstream `4f340e0`:

- `supabase/migrations/0002_security_boundary.sql` — copied whole; only comments
  differ from upstream's `supabase/template/0002_security_boundary.sql`, and the
  executable text is byte-identical.
- `supabase/migrations/0001_baseline.sql` — the six
  `REVOKE ALL ON FUNCTION ... FROM PUBLIC` lines for the definer trigger
  functions, spliced in verbatim. That is the whole DDL delta; the file's own
  header records it.
- `supabase/tests/` — the mutation suite and its Supabase-surface stub, retargeted
  at this repo's `supabase/migrations/` layout and reduced to the one arm that
  applies here (upstream's other arm runs against a migration this repo does not
  ship).

Two published defects are what forced it, both proven by execution before and
after: `0002` used to grant `EXECUTE` on all six definer **trigger** functions to
`authenticated` — the audit-forgery path — and it asserted nothing about five of
the six access helpers, so `category_has_grant` rewritten to `select true` made
the entire catalog readable by any signed-in user while the file printed
"security boundary asserted".

**This table was followed on 2026-08-17 to port upstream `806723b`** — `0002`'s
executable text taken whole (verified zero code differences, comments re-applied
by hand), the new mutation cases taken and the harness kept, the stub confirmed
byte-identical. It works; use it again.

**At the next full re-extraction, do NOT take upstream's side wholesale for
these.** They diverge from upstream for different reasons and need different
treatment:

| File | Take upstream's | Keep this repo's |
|---|---|---|
| `0002_security_boundary.sql` | the **executable text**, in full | the comments only |
| `supabase/tests/boundary_mutations.sh` | any **new mutation cases** | the whole harness (see the eight below) |
| `supabase/tests/_supabase_surface_stub.sql` | all of it — byte-identical today | — |
| `0003_seed_categories.sql` | **nothing** | all of it |
| `0004_admin_write_paths.sql` | **nothing** | all of it |
| `0005_category_nesting.sql` | **nothing** | all of it |

`0003`, `0004` and `0005` have **no upstream counterpart**. They were written
here, and upstream's baseline generator neither produces nor knows about them. A
three-way merge has nothing to say about them, so the rows above exist to stop a
future maintainer concluding from their absence upstream that they were deleted
there and should be dropped here.

- `0003_seed_categories.sql` contains rows and no schema. It is a provisioning
  step — `supabase/README.md` step 1 lists it — and removing it returns a freshly
  stamped app to an empty category list. It is the optional one.
- `0004_admin_write_paths.sql` is **not** optional. It opens the trust root's
  INSERT/DELETE, adds `basecamp.log_privileged_action()`, widens `list_people()`,
  and seeds the three `is_system` member types. Drop it and **Add person**, the
  roster's ⋮ menu and the whole account-lifecycle path stop working — and `0002`
  will still commit, because a database that never had `0004` is a valid
  pre-`0004` database.
- `0005_category_nesting.sql` is not optional either, and its absence is louder:
  three read paths select `categories.parent_id`, so all three fail with
  `42703 column does not exist`.

**If you regenerate `0001` from a database that has these applied**, the dump
will carry `0004`'s corrected `COMMENT ON COLUMN member_types.is_system` and
`0005`'s column and constraints, which is intended — but it will NOT carry their
rows, and it must not. Starter data stays in its own file. Re-deriving `0002`'s
digests after such a regeneration is the moment to re-read the normalization
note at the pin: hash the **normalized** text, or a digest taken from a database
provisioned through a CRLF paste will refuse every clean install afterwards.

None of them may be folded into `0001_baseline.sql`: that file is regenerated by
`pg_dump --schema-only`, its header promises no rows, and a hand-added INSERT
there disappears at the next regeneration with nothing to mark its passing.

The eight harness changes to preserve in `boundary_mutations.sh`, none of which
exists upstream:

1. paths pointing at `supabase/migrations/`, not upstream's `supabase/template/`;
2. `EXPECTED_CASES` and the `ran` counter, which fail the run if a case is lost;
3. the `setup_step` helper checking **every** per-case setup step, shared by all four arms;
4. the preflight for missing artifacts and a dead cluster (`exit 2`);
5. the `repairs_before_asserting` / `not_an_error_here` split;
6. **PART 13, the Editor-path arm**, with `EXPECTED_EDITOR_CASES`, the `eran`
   counter and the CRLF fixtures built in the preflight. This is the arm that
   covers the route clients actually use — pasting the migrations into the
   Supabase SQL Editor — and its absence is what let a CRLF digest mismatch stop
   a client's provision with the suite green on the same commit. It is also the
   easiest of the eight to lose, because the psql arm keeps printing a full green
   total without it and that total still looks like a plausible number.

   **It applies the whole chain**, not just `0001` and `0002`. `run_case` builds
   its mirror with `0004` and `0005` too, and the two arms are meant to differ in
   TRANSPORT and in nothing else — an arm that stopped at `0002` would leave
   `0004`'s own digest pin and `0005`'s depth cap proven on the maintainer's
   route and unproven on the client's, which is the shape of the bug this arm
   exists to end. That is not hypothetical either: the ported `0004` arrived with
   a raw `md5(prosrc)` pin, and reverting to it makes the psql arm report 110
   passed while every Editor case fails at `0004 via editor path`;
7. **PARTS 14-15, the runtime arms**, with `EXPECTED_RLS_CASES` and
   `run_rls_assert`. These ask a different question from everything else in the
   file: not "does `0002` refuse a broken schema?" but "does the DATABASE refuse
   a real session?" Since `0004` grants `authenticated` INSERT and DELETE on the
   trust root, no schema assertion can answer the second — the privilege being
   there is now correct, and only a policy stops a non-administrator using it;
8. **PART 16, `0004` as the file under test**, with `EXPECTED_M4_CASES` and
   `run_0004_case`. Every other static case re-runs `0002`, which left roughly
   half of `0004`'s own post-conditions unable to fail: they guard objects `0004`
   itself creates a few hundred lines earlier. These break things BEFORE `0004`
   runs.

Taking upstream's copy wholesale reverts all eight. The worst is (3): upstream
discards setup failures to `/dev/null`, so with paths pointing at a directory
this repo does not have, **almost every case reports PASS on an empty
database** — a green suite proving nothing at all. Only the control notices.

**Do not rely on `templateHygiene.test.ts` to catch this.** It fires on
upstream's copies today only because their comments happen to name
`supabase/template/` and a timestamped migration filename — an accident of
wording, not a designed guard, and one an upstream reword would silently remove.
It checks identity leaks, and it checks the suite's SHAPE: every arm's declared
count against the invocations it actually makes (`EXPECTED_CASES`,
`EXPECTED_EDITOR_CASES`, `EXPECTED_RLS_CASES`, `EXPECTED_M4_CASES` — one per
arm, deliberately, because a rolled-up number is where a lost arm hides), plus
the fact that the Editor arm still builds CRLF fixtures for **all four**
migrations and applies each as one whole-file `-c`. It also names the runtime
cases that carry a security property outright, so one dropped as "redundant"
fails the suite rather than quietly removing a proof. Those are designed guards
and will survive an upstream reword. Nothing in this repository asserts anything
about `setup_step`, the preflight or the whitelist split beyond the shape checks.

---

## Three files this repo owns, which upstream also has

`CLAUDE.md`, `issues.md` and `.claude/` are **shipped deliberately** and are
**this repository's own**, not upstream's. They are the client-facing versions:
the Build Kit walkthrough teaches a client to recognize `CLAUDE.md` and
`issues.md` on sight, and then has them open `CLAUDE.md` and read it aloud. Until
they shipped, that step sent every client to a file that was not there.

Two consequences for a re-extraction, both easy to get wrong:

- **Take this repo's side for all three, always.** They are not app files and
  step 3's "upstream's side where upstream has genuinely improved the logic" does
  not apply — upstream's copies describe the private application, name its
  organization, and would trip `templateHygiene.test.ts` on the identity
  patterns. Do not three-way merge them; keep them.
- **`.claude/` is vendored, not authored here.** It is copied verbatim from the
  Build Kit's shared guardrails set, which itself vendors it from the private
  base-camp repository; that set carries a `PROVENANCE.md` recording the exact
  source commit and the two deliberate deviations in `settings.json`. Fixes
  belong at the original source — re-vendor rather than hand-editing here, or the
  next re-vendor silently reverts you. `.claude/basecamp.json` is load-bearing:
  without it `workflow-guard.mjs` blocks every commit in the client's project.

`templateHygiene.test.ts` no longer forbids referring to `CLAUDE.md` or
`issues.md` for this reason, and it now asserts positively that they ship. The
operative note about which paths are still forbidden lives in that file's own
comment — read it there rather than trusting a paraphrase here.

---

## How to re-extract

Do **not** re-derive the transform by hand. Recover it mechanically, apply it
mechanically, and let a three-way merge preserve the edits this repo already
carries.

```bash
# 1. Two archives of the upstream repo: the anchor above, and its new head.
git -C <upstream> archive <ANCHOR_SHA> | tar -x -C /tmp/old
git -C <upstream> archive HEAD         | tar -x -C /tmp/new
```

**2. Recover the transform set.** `diff -rq /tmp/old <this repo>` prints exactly
what the last extraction did — every file deleted, added, renamed and edited.
That listing *is* the specification; it does not need to be written down
separately, and a written copy would drift.

**3. Port app files by three-way merge**, so this repo's edits survive:

```bash
git merge-file <this-repo>/path  /tmp/old/path  /tmp/new/path
```

Take this repo's side on identity/prose conflicts, and upstream's side where
upstream has genuinely improved the logic. Resolve every conflict; do not commit
a file containing markers.

**4. Re-apply the SQL hand edits** (see the next section) — the generator does
not make them.

**5. Verify.** See "Before publishing" below.

---

## The SQL hand edits

`supabase/migrations/0001_baseline.sql` is `pg_dump --schema-only --no-owner`
output from the upstream database. Two edits are applied afterwards **every
time**, and `0001`'s own header repeats this list:

1. **Rename the two `entry_auth_boundary` labels** that name upstream's own
   infrastructure to `platform_auth` / `external_auth`. Verify nothing references
   them first — no DEFAULT, no CHECK, no function body. Update
   `supabase/seed.example.sql` and `src/lib/__fixtures__/catalog.json` to match.
2. **Rewrite every `COMMENT ON` string** that names the originating
   organization, its issue tracker, its probe suite, its exporter, or a
   timestamped migration version. These land permanently in every client
   database.

### Two edits that are no longer yours to make

Removing `SET transaction_timeout = 0;` and stripping `MAINTAIN` from every
`GRANT` and `ALTER DEFAULT PRIVILEGES` used to be steps 1 and 2 of this list.
Both are PG17-only and either one aborts the entire script on PG15/16
(`unrecognized privilege type "maintain"`) before a single object is created.
**Upstream's generator does both now**, so a fresh dump arrives already
compatible.

That history is worth keeping, because it is why the checks stayed: this list
once shipped half-applied — `transaction_timeout` was being stripped while
`MAINTAIN` still blocked PG15/16 — so the stated compatibility was simply false
and nothing said so. `src/lib/templateHygiene.test.ts` still asserts both, and
should: a guard that moved upstream is a guard this repository can no longer
see. If one of them reappears in a regenerated baseline, that test failing is
the signal the generator regressed, not an invitation to hand-strip it here.

`0002_security_boundary.sql` is hand-written on both sides and should be merged,
not regenerated. So is `supabase/tests/` — see the out-of-band port note above
for which side to take.

### Regenerating the baseline itself

The generator lives upstream (`scripts/generate-template-baseline.mjs`) and reads
a live database:

```bash
DATABASE_URL='postgresql://postgres.<ref>:<pw>@aws-0-<region>.pooler.supabase.com:5432/postgres' \
  node scripts/generate-template-baseline.mjs
```

Use the **session pooler** on port 5432 with the tenant-qualified user
`postgres.<ref>`. The direct host `db.<ref>.supabase.co` is IPv6-only and will
simply hang from a machine without IPv6 egress.

---

## What is deliberately not shipped

Kept out by construction; do not "restore" them:

- The upstream catalog seed, and the real inventory. Everything in
  `seed.example.sql` and `src/lib/__fixtures__/catalog.json` is invented.
- The upstream probe suite. It is calibrated to the real catalog's data and
  would either fail or pass vacuously on a fresh install. **A client-appropriate
  suite is unbuilt — this is the template's honest gap.**
- The baseline staleness guard, which needs the upstream migrations directory.
  Hence "provenance only" on the stamp.
- Upstream's adapter and planning files, **its** `docs/`, and its design sources.
  (This template now has a `docs/` directory of its own, holding the specification
  the Catalog admin was built from. It is unrelated to upstream's, and a
  re-extraction should neither take upstream's nor drop this one.)

---

## Before publishing

Run all of it. The first three are cheap and catch most of what goes wrong.

```bash
npm ci && npm test && npx tsc --noEmit && npm run lint && npm run build
```

`src/lib/templateHygiene.test.ts` is the guard that matters most here: a
three-way merge takes upstream hunks verbatim wherever this repo had no
conflicting edit, so an upstream comment naming the organization, its database,
or a real person can arrive **silently**. That test fails on it. Do not add an
allowlist entry to make it pass — rewrite the prose.

Then apply the SQL to a throwaway database and confirm `0002` **commits**, which
is the whole point of that file:

```bash
psql "$SCRATCH_URL" -v ON_ERROR_STOP=1 --single-transaction -f supabase/migrations/0001_baseline.sql
psql "$SCRATCH_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/0002_security_boundary.sql
psql "$SCRATCH_URL" -v ON_ERROR_STOP=1 -f supabase/seed.example.sql
```

Test on the **oldest** PostgreSQL a client might have, not just the version
upstream runs. Both PG-compat edits above exist because of that gap, and only
the older version can catch a third one.

**State what you actually ran.** As of 2026-08-17 the pair is verified on
**PostgreSQL 16.15 and 17.10** — clean install and the full mutation suite on
both. PG15 is named as a floor in a few places but **has not been tested**;
treat it as untested rather than supported until someone runs it. Do not widen
that claim without a run behind it.

A bare cluster needs the Supabase surfaces stubbed: that is
`supabase/tests/_supabase_surface_stub.sql` — roles `anon`, `authenticated`,
`service_role`; schema `auth`; table `auth.users(id, email, created_at)`; and
`auth.uid()` reading `request.jwt.claims`. That stub cannot prove PostgREST, the
Data API exposure step, or GoTrue — say so rather than implying an end-to-end
pass.

Then run the mutation suite, on **both** PostgreSQL versions:

```bash
bash supabase/tests/boundary_mutations.sh
```

It breaks one thing at a time in a throwaway database and requires `0002` to
refuse; 72 mutations plus a control that must commit, and it now fails if the
case count changes. `0002` committing on a clean install only shows it does not
object to a correct schema — the suite is what shows it objects to a wrong one.
A change to `0002` that leaves the suite at 73/73 without touching a case is
either a no-op or a hole.

**The suite is a floor.** A review on 2026-08-17 defeated several of `0002`'s
stated invariants with mutations it does not contain — see `issues.md`, "Known
gaps in the security boundary", which is the single enumeration. Those belong upstream, so that every stamp gets
the same fix; when they land, port the fix *and* the new cases together, and
raise `EXPECTED_CASES` in the same commit.

Finally, confirm the repository settings a client stamp depends on:

```bash
gh api repos/<org>/basecamp-template --jq '{is_template,default_branch,visibility}'
```

`is_template` must be `true` (or `gh repo create --template` fails),
`default_branch` must be `main`, and `.env.local.example` must exist under
exactly that name — a consuming walkthrough says `cp .env.local.example .env.local`
verbatim.
