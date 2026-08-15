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
| **Baseline squashed from migration** | `20260813100600` (see `SOURCE-MIGRATION-VERSION` in `0001_baseline.sql`) |
| **Baseline generated on** | 2026-08-14 (see `GENERATED-ON` in the same file) |

**Update the anchor row above in the same commit as every re-extraction**, and
mirror it in the upstream repo's `issues.md`. Everything below depends on knowing
which upstream commit this tree currently corresponds to. A wrong guess silently
reverts or duplicates prose edits across dozens of files, and nothing will fail
to warn you.

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
`issues.md` for this reason. It still forbids `AGENTS.md` and `WBS.md`, which
this template does not ship.

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
output from the upstream database. Four edits are applied afterwards **every
time**, and `0001`'s own header repeats this list:

1. **Remove `SET transaction_timeout = 0;`** — PG17-only. An unrecognised `SET`
   aborts the whole script on PG15/16.
2. **Remove `MAINTAIN` from every `GRANT` and from `ALTER DEFAULT PRIVILEGES`** —
   also PG17-only. Fails with `unrecognized privilege type "maintain"`. This one
   shipped undetected once: the `transaction_timeout` edit was being applied
   while `MAINTAIN` still blocked PG15/16 anyway, so the stated compatibility was
   false. `src/lib/templateHygiene.test.ts` now guards both.
3. **Rename the two `entry_auth_boundary` labels** that name upstream's own
   infrastructure to `platform_auth` / `external_auth`. Verify nothing references
   them first — no DEFAULT, no CHECK, no function body. Update
   `supabase/seed.example.sql` and `src/lib/__fixtures__/catalog.json` to match.
4. **Rewrite every `COMMENT ON` string** that names the originating
   organisation, its issue tracker, its probe suite, its exporter, or a
   timestamped migration version. These land permanently in every client
   database.

`0002_security_boundary.sql` is hand-written on both sides and should be merged,
not regenerated.

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

Test on the **oldest** PostgreSQL a client might have (PG15/16), not just the
version upstream runs. Both PG-only edits above exist because of that gap, and
only the older version can catch a third one.

A bare cluster needs the Supabase surfaces stubbed: roles `anon`,
`authenticated`, `service_role`; schema `auth`; table `auth.users(id, email,
created_at)`; and `auth.uid()` reading `request.jwt.claims`. That stub cannot
prove PostgREST, the Data API exposure step, or GoTrue — say so rather than
implying an end-to-end pass.

Finally, confirm the repository settings a client stamp depends on:

```bash
gh api repos/<org>/basecamp-template --jq '{is_template,default_branch,visibility}'
```

`is_template` must be `true` (or `gh repo create --template` fails),
`default_branch` must be `main`, and `.env.local.example` must exist under
exactly that name — a consuming walkthrough says `cp .env.local.example .env.local`
verbatim.
