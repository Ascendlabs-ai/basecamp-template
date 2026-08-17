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
| **SQL boundary ported forward from** | `4f340e0` on 2026-08-17 — **`supabase/` only**, see below |

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

**At the next full re-extraction, do NOT take upstream's side wholesale for
either of these.** The two files diverge from upstream for different reasons and
need different treatment:

| File | Take upstream's | Keep this repo's |
|---|---|---|
| `0002_security_boundary.sql` | the **executable text**, in full | the comments only |
| `supabase/tests/boundary_mutations.sh` | any **new mutation cases** | the whole harness (see the five below) |
| `supabase/tests/_supabase_surface_stub.sql` | all of it — byte-identical today | — |

The five harness changes to preserve in `boundary_mutations.sh`, none of which
exists upstream:

1. paths pointing at `supabase/migrations/`, not upstream's `supabase/template/`;
2. `EXPECTED_CASES` and the `ran` counter, which fail the run if a case is lost;
3. the `setup ()` wrapper checking **every** per-case setup step;
4. the preflight for missing artifacts and a dead cluster (`exit 2`);
5. the `repairs_before_asserting` / `not_an_error_here` split.

Taking upstream's copy wholesale reverts all five. The worst is (3): upstream
discards setup failures to `/dev/null`, so with paths pointing at a directory
this repo does not have, **72 of the 73 cases report PASS on an empty
database** — a green suite proving nothing at all.

**Do not rely on `templateHygiene.test.ts` to catch this.** It fires on
upstream's copies today only because their comments happen to name
`supabase/template/` and a timestamped migration filename — an accident of
wording, not a designed guard, and one an upstream reword would silently remove.
It checks identity leaks and nothing else. Nothing in this repository asserts
anything about `EXPECTED_CASES`, `setup ()`, the preflight or the whitelist
split beyond the one count check described above.

---

## Three files this repo owns, which upstream also has

`CLAUDE.md`, `issues.md` and `.claude/` are **shipped deliberately** and are
**this repository's own**, not upstream's. They are the client-facing versions:
the Build Kit walkthrough teaches a client to recognise `CLAUDE.md` and
`issues.md` on sight, and then has them open `CLAUDE.md` and read it aloud. Until
they shipped, that step sent every client to a file that was not there.

Two consequences for a re-extraction, both easy to get wrong:

- **Take this repo's side for all three, always.** They are not app files and
  step 3's "upstream's side where upstream has genuinely improved the logic" does
  not apply — upstream's copies describe the private application, name its
  organisation, and would trip `templateHygiene.test.ts` on the identity
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
   organisation, its issue tracker, its probe suite, its exporter, or a
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
- Upstream's adapter and planning files, its `docs/`, and its design sources.

---

## Before publishing

Run all of it. The first three are cheap and catch most of what goes wrong.

```bash
npm ci && npm test && npx tsc --noEmit && npm run lint && npm run build
```

`src/lib/templateHygiene.test.ts` is the guard that matters most here: a
three-way merge takes upstream hunks verbatim wherever this repo had no
conflicting edit, so an upstream comment naming the organisation, its database,
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
