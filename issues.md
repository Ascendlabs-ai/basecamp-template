# Basecamp — what we're building

This is your project's memory. It's the one place that says what's done, what's next, and what's
waiting on you. Keep it in plain English. Your assistant reads it to know what to work on, you
read it to know where things stand, and when you come back next week it's how you both remember
where you left off.

**This list is yours.** The AI can suggest something worth adding, but it doesn't write here unless
you ask it to — you decide what earns a line. That's deliberate: a list that fills itself gets long,
stops getting read, and a list nobody trusts is worse than no list at all.

**Worth a line:** something still to do, something that would waste your time if you forgot it, a
step you have to do by hand. **Not worth a line:** anything already fixed, or a note explaining how
something works.

**One rule:** write each line so that someone reading only that line understands what it is and
why it matters. "Fix the thing" is useless in a week. "Let people reset their password by email"
still makes sense.

**Two habits that make it worth keeping:**

- **Date things** when you move them. A line without a date can't tell you whether it's fresh.
- **Never write a status you haven't seen.** If something is built but you haven't looked at it,
  say "built, not checked." Nothing moves to Done on faith.

## Next up

- [ ] **Get the app running against your own database, and sign in as the first administrator.**
      Everything else waits on this. The steps are in `supabase/README.md` and the ones you have to
      do by hand are listed under **Pending manual steps** below. You'll know it worked when you can
      sign in and `/admin/access` renders.

- [ ] **Fill in the standards-repository address in `CLAUDE.md`.** There's a line near the bottom
      waiting for it. Until it's filled in, your assistant can't find the shared documents and will
      have to ask you every time.

- [ ] **Put your own name on it.** Four places — name, logo, colours, icons — all shipping as
      neutral placeholders. The table of exactly which files is in `README.md` under Rebranding.

- [ ] **Delete `MAINTAINING.md` and `docs/`.** Both are for whoever maintains the template rather
      than for you: `MAINTAINING.md` covers re-extracting it from the private app it came from, and
      `docs/` holds the notes recording why the catalog admin, the account-lifecycle path, the
      category nesting and the line-ending normalization are built the way they are. Nothing in the
      app reads either. If you stamped this, they aren't for you.

- [ ] **Add your first few catalog entries** in Admin → Catalog, then **add your first person** in
      Admin → Access and walk them through the link end to end. Confirm somebody with no grants
      sees an empty catalog rather than an error — that's the check that proves access is actually
      working, and the link walkthrough is the check that proves onboarding is.

## In progress

One thing at a time, ideally. Each item here carries a **Next action** — a literal sentence saying
the very next thing to do, so you can pick it up cold. Not "continue work."

_(nothing yet)_

## Pending manual steps

Things a human has to do outside the app before something will work — set a key, flip a setting in
a dashboard, verify a domain, approve an account. These get lost constantly, so park them here the
moment they come up.

- [ ] **Expose the `basecamp` schema to the Data API — do this first.** Supabase Dashboard →
      Integrations → Data API → Settings → Exposed schemas (older projects have it under
      Project Settings → API). **Add** `basecamp` alongside whatever is already
      listed; the field is replaced wholesale when you edit it, so don't remove an existing entry.
      Skip this and every request fails with `PGRST106`, the app shows an error, and nothing in the
      database looks wrong — it is a genuinely hard failure to diagnose.

- [ ] **Apply the SQL files, in order:** `supabase/migrations/0001_baseline.sql`, then
      `0002_security_boundary.sql`, then — optionally — `0003_seed_categories.sql`, which adds
      four empty starter categories and no schema at all, then `0004_admin_write_paths.sql`,
      which opens the trust root's write path, adds the roster's ban and type columns, and seeds
      the three starter member types **Add person** needs in order to offer anything —
      without it, **Add person** and the ⋮ menu on the roster will not work — and finally
      `0005_category_nesting.sql`, which adds `categories.parent_id` and the one-level depth cap.
      **`0005` is required, not optional.** Three read paths — the home page, the catalog admin and
      the access matrix — all select `parent_id`, so skipping it does not merely disable
      subcategories: all three screens fail with `42703 column does not exist`, and the error names
      a column rather than a migration. `0002` checks a long list of things
      about the security boundary and refuses to commit if any of them is wrong. Read **Known gaps in the security
      boundary** below before you treat a clean run as proof — there are things it does not
      catch, and you should know what kind of thing they are.

- [ ] **Set the Auth URL configuration.** Authentication → URL Configuration: set the Site URL,
      and add **two** paths to the Redirect URLs — `/auth/confirm` and `/accept-invite` — on every
      origin you use, localhost included. They are where an administrator-issued sign-in link lands
      and where the person then chooses their password; without them the link comes back pointing
      somewhere else and the person cannot get in. Get the Site URL wrong and Supabase does **not**
      error — it silently substitutes it, which on a fresh project is localhost.

- [ ] **Nothing new for the catalog.** Category nesting needs no dashboard change — `0005` adds a
      column, a trigger and a widened SELECT policy, all inside the `basecamp` schema that is
      already exposed to the Data API by the first step above. Applying `0005` is the whole of it.

- [ ] **Turn on Secure password change.** Authentication → Providers → Email → **Secure password
      change**. Without it, any live session can set a new password without re-entering the current
      one — so a borrowed or hijacked session becomes permanent account takeover. This is a project
      setting, not something the app can enforce: `supabase.auth.updateUser({ password })` is
      callable from any signed-in browser regardless of what `/accept-invite` does.

- [ ] **Nothing to do about email, and that is the point.** This app sends none: **Add person**
      and **Issue a sign-in link** display the link for you to pass on. There is no
      forgot-password form to configure. Supabase itself will still mail a confirmation when
      somebody signs up on your project, and the built-in mailer delivers only to members of your
      own Supabase organisation at roughly two messages an hour — so if you ever add a flow of
      your own that depends on delivery, attach your own SMTP **and** raise the rate limit
      together. Each fails silently on its own; `supabase/README.md` has both.

- [ ] **Create your own account, then make it the administrator.** Create the account yourself in the
      Supabase dashboard. Making it an administrator is one INSERT into
      `basecamp.super_admins` — the exact statement is in `supabase/README.md`. This is a
      bootstrapping step and stays manual: it is the one administrator nobody can create from
      inside the app. Everyone after them you add from `/admin/access` → **Add person**, including
      promoting them from that person's ⋮ menu.

- [ ] **Nothing to do about member types.** `0004` seeds three — Staff, Contractor, Client — and
      marks them undeletable, because **Add person** has to have one to assign. Rename them on the
      Types tab if the labels do not suit you; grants attach to the row rather than the label.

- [ ] **Copy `.env.local.example` to `.env.local` and fill in the values** from Project
      Settings → API. `NEXT_PUBLIC_SUPABASE_ANON_KEY` is the **anon** key, never the
      `service_role` key. `SUPABASE_SERVICE_ROLE_KEY` is separate and is what **Add person**,
      **Issue a sign-in link** and **Suspend** need; without it the app runs but you are back to
      creating each person by hand in the dashboard. Read the note beside it before setting it.

- [ ] **Deploy to Vercel.** Connect this repository and set the same environment variables there.
      If you set `SUPABASE_SERVICE_ROLE_KEY`, add it as a **server-side** variable — it must never
      gain a `NEXT_PUBLIC_` prefix.

- [x] **DONE — the `.env.*` deny in `.claude/settings.json` was narrowed.** Raised 2026-08-19,
      closed the same day. The catch-all `Read(./.env.*)` also matched `.env.local.example` and
      applied to Write and to any shell command naming the path, so the builder could neither read
      the example it is told to copy from nor create `.env.local` at all — the policy in CLAUDE.md
      described something impossible. It is now Next.js's own enumerated env filenames plus
      staging/preview, with `.env.local` moved to `ask`. **Known gap kept deliberately:** an env
      file under some other name (`.env.ci`, `.env.qa`) is no longer covered by any rule; add the
      name if you start using one. `docs/stream-b-notes-2026-08-19.md` has the full reasoning.

## Review record — Admin → Catalog (Stream B)

**Committed as a recorded override: `threshold_met: false`, zero HARD findings.**

The naysayer quality gate ran its full three iterations against this change set.
Iteration 1 found 4 hard and ~28 soft/minor items; iteration 2 confirmed all 32
fixed but caught one NEW hard defect introduced *by* those fixes (the
`updated_at` concurrency guard wedged the edit dialog and its message promised a
reopen no code performed) — found independently by two reviewers. Iteration 3
confirmed that defect properly fixed and returned **zero hard findings**, plus
six soft/minor items which were then fixed as well.

The gate's own arithmetic still scores the third review at 6.0/10, below its 8.0
threshold, because that score is computed on the review as delivered rather than
on the state after its findings were closed. Nothing hard remains, and nothing
remaining is reachable by a client using a stamped app with client-held
credentials. The last round of fixes was covered by the gates (tests, typecheck,
lint, production build), by fresh installs on PostgreSQL 16 and 17, by a full
mutation-suite run, and by targeted live re-tests — but not by a fourth
adversarial round, since three is the cap.

## Review record — account lifecycle and category nesting

Ported in from a downstream stamp that built both features on top of this
template, then reconciled against what this template actually ships. What
arrived: `0004_admin_write_paths.sql` (Add person, issued sign-in links,
suspend/restore, the audit writer, self-administering trust root),
`0005_category_nesting.sql` (one level of subcategories), the `/api/admin/*`
routes and the `src/lib/supabase/admin.ts` facade behind them, and the screens
that use all of it.

Four things were decided rather than merely merged, and each is worth knowing:

- **The line-ending normalization won.** The ported `0004` pinned its audit
  writer with a raw `md5(prosrc)`, as did `0002`'s new digest selector. On this
  template that is a shipped-broken file: every Editor-route install of `0004`
  would have been refused while the `psql` arm stayed green — the 2026-08-19
  failure, one migration later. Verified by reverting the pin and re-running:
  the `psql` arm reported 110 passed, and the Editor arm failed every case at
  `0004 via editor path`. All of them are normalized now, and the Editor arm
  applies the whole chain rather than stopping at `0002`, so nothing can
  reintroduce it quietly.

- **Member types are seeded.** Three source comments described starter types
  that no migration created, so a fresh stamp had zero and **Add person** could
  not be used. `0004` now seeds staff/contractor/client as `is_system`, asserts
  it took, and the comments say what is true. See the note under Pending manual
  steps.

- **`/auth/reset` was removed rather than kept.** The template had a working
  recovery-email sender; the ported branch replaced it with issued links and
  left the page behind with nothing feeding it. Keeping both would have meant
  two buttons doing the same job, one of which fails silently unless two
  dashboard settings are right. `README.md` → "What is deliberately not here"
  records the decision and its cost.

- **Nothing client-specific came across.** The stamp's own standards-repository
  line and its `.gitattributes` stayed behind; its two design documents were
  de-identified into `docs/`, and the two places where they described a design
  the implementation had deliberately rejected were corrected to describe what
  shipped.

## Known limits

- **The admin screens read every row in one request, and refuse to render past
  PostgREST's cap.** `/admin/catalog` and `/admin/access` compare the rows they
  received against an exact count and show an error instead of a partial
  picture — deliberately, because the slug de-duplication and the reorder
  arithmetic both reason over "every row that exists", and a silently short read
  would renumber a subset or propose a slug that is already taken. The cap is
  PostgREST's `max-rows`, 1000 on a default Supabase project. A catalog that
  large would make the admin screens unusable rather than wrong; the fix is
  either paging those reads or raising `max-rows`. No client is near it, and
  nothing about it is a security question.

## Known gaps in the security boundary

**Read this once before you trust `0002`. It came with the template; you did not cause it.**

`supabase/migrations/0002_security_boundary.sql` checks a long list of things and refuses to
install if any of them is wrong. That is real — `supabase/tests/boundary_mutations.sh` breaks
things one at a time, across four separately counted arms, and requires the file under test to
refuse each; the handful it does NOT refuse are the ones it is *designed* to repair or ignore, and
the file names each of them. Two
of the gaps below were closed on **2026-08-17**; the rest were got past by review on that date,
each proven on live PostgreSQL 16 and 17. `0002`'s own closing message is an enumerated list and every item on it is
true; what is too strong is the shorthand *"if it commits, the boundary holds"* that these
documents used to print.

**This section describes each gap by class, not by method.** This repository is public and every
project is stamped from it, so a working recipe written here would be a recipe against every stamp
rather than a note to yourself. What you need in order to decide well is which *kind* of change
`0002` will not object to, and that is what is below.

**What it takes to do any of these.** None is reachable by an ordinary signed-in user of your app,
and **a service-role key does not reach any of them** — it speaks to the Data API, not the
database, and cannot issue DDL at all. Both of those were tested directly, with purpose-built
roles, and refused every time. Almost all of these need DDL as the schema owner: in practice the
Supabase SQL editor, or a direct database connection as `postgres`. One needs less than full
ownership, but still needs a **direct database connection** rather than any API key. So the honest
reading is "`0002` will not catch a hostile or careless administrator", not "your app is open".

- [ ] **A policy can be widened without `0002` noticing.** It rejects the obvious permit-alls, but
      a predicate that *mentions* the access model while still admitting every signed-in user gets
      past it. Adding a brand-new wide-open policy passes too. Everything the policies protect is
      in range — the catalog, the administrator roster and the audit log. **Read policy changes
      yourself; `0002` is not a substitute for reviewing them.**
- [ ] **An audit trigger can be pointed somewhere else.** `0002` checks each trigger's *name*, table
      and enabled flag, never which function it actually calls. So a trigger can be present,
      correctly named and enabled while doing nothing at all, and `0002` will still report its full
      count of enabled audit writers.
- [x] **FIXED 2026-08-17 — `list_people()` had no exact body check**, and it is the function that
      returns everybody's email address. Relaxing its own administrator check used to commit while
      any signed-in user pulled the full roster with emails. It is now pinned exactly
      like the other five, and the pins also cover *arity*, so adding a second `list_people(...)`
      signature is refused too — that used to slip through **and** be granted EXECUTE by `0002`
      itself.
- [ ] **Not every guard function's body is checked.** The functions that decide access are pinned
      by checksum, but several of the guards around them are not, so one can be hollowed out and
      still satisfy `0002`. One of those guards is what stops the last administrator being deleted,
      and losing it locks you out of your own project.
- [ ] **A single database- or role-level setting can silence every trigger at once** — all the
      guards and all the audit writing together — and `0002` still commits.
      (This one is a superuser-scope setting. Whether Supabase's `postgres` role can actually set
      it was **not** verified — treat this bullet as unconfirmed on Supabase specifically; it is
      proven on a self-hosted cluster.)
- [ ] **The audit log can be made to stop recording, invisibly.** A write can be discarded *before*
      any trigger runs, which leaves every trigger present, enabled, pointed at the right function
      and matching its checksum. `0002` reads none of this and commits. This is the quietest one on
      the list: if the audit log matters to you, check every so often that it is still gaining rows,
      because nothing else will tell you.
- [x] **FIXED 2026-08-17 — `0002` used to look only inside the `basecamp` schema.** An object
      created in `public` that reads `basecamp` data could run with its owner's rights and return
      the whole catalog to a user with no grants. This was the
      one most likely to happen **by accident**, because "add a SECURITY DEFINER helper" is the
      standard advice for policy recursion and the SQL editor creates objects as `postgres`.

      Sixteen ways of doing it were found across three review rounds and **all sixteen are now
      refused.** `0002` follows the dependency graph out of `basecamp` — through views, materialized
      views, rewrite rules on ordinary tables, inheritance parents, and now through *other
      functions* as well — instead of guessing which kinds of object to inspect. Re-owning an
      intermediate object to an unprivileged account no longer hides it either.

      **Still true and worth knowing:** `with (security_invoker = true)` is necessary but **not
      sufficient** on its own. It resolves as whoever is running, and inside any `SECURITY DEFINER`
      that is `postgres`. **Keep helpers that read `basecamp` inside `basecamp`** — that one habit
      avoids this whole class. A few shapes stay out of reach of any catalog check, chiefly
      anything that assembles its query at run time instead of declaring it, and definers inside
      `basecamp` itself beyond those that are checksum-pinned.

- [ ] **`0002` never checks that nothing *extra* was added.** It verifies that the triggers it
      expects are present; a trigger it does not know about, attached to an audited table, is
      invisible to it. Doing that needs more than an API key but less than full ownership. (A
      service-role API key still cannot do it — PostgREST does not issue DDL.)

Two smaller ones worth knowing:

- [ ] **`0002` refuses a perfectly good policy of your own.** If you add a table and give it an
      own-row rule — restricting each person to their own rows, the tightest rule there is —
      `0002` calls it a permit-all and refuses. Do not delete the policy to get past it, and do not
      stop running `0002`. Until this is fixed, either keep such policies in a schema other than
      `basecamp`, or add the policy after `0002` has run.
- [ ] **`0002` checks that `authenticated` can SELECT `entries` and the audit log, but not the
      other five tables.** If `0001` only half-applies, you can end up with a database `0002`
      signs off on and an admin screen that fails with `permission denied`. Applying `0001` with
      `-v ON_ERROR_STOP=1 --single-transaction`, as `supabase/README.md` says to, avoids this
      entirely.

These live in the template's upstream and the fix belongs there, so that every project stamped
from it gets the same one. Nothing here is worse than what shipped before **2026-08-17** — that
version handed every signed-in user the ability to forge entries in the audit log, which needed no
administrator at all, and this one closes it.

### Grants are flat, and a container category is invisible

Two properties of category nesting that surprise people, both deliberate:

- **`category_has_grant()` does not walk the tree.** Granting a parent grants
  nothing about its subcategories. Making grants inherit is a real design
  question — it would change what every existing grant means — so it is left
  alone rather than half-done. The access matrix gives each category its own
  column and labels subcategories with their parent.
- **A category with nothing visible inside it stays hidden.** `0005` widened the
  read rule by exactly one level — `category_or_child_has_grant()` — so a parent
  used purely as a container DOES render once a viewer can see a tile in one of
  its subcategories. What is still hidden is a category with no entries of its
  own and no granted children, because a grant on an empty category would
  otherwise disclose its name and description. The widening is bounded by the
  depth cap: one join, no recursion.

### The roster spans the whole Supabase project, and so does adoption

`auth.users` is shared by every app on a Supabase project, and `basecamp.list_people()`
deliberately returns all of it — that is what lets you onboard somebody who signed up and arrived
with zero access. The consequence is that an administrator here can give **any** account on the
project a member type, and once it has one, `/api/admin/people/[id]/link` and `.../ban` will act on
it: a sign-in link for that account, or a suspension of it.

There is no signal that distinguishes "self-signed-up, needs access" from "belongs to a different
app on this project", so this is a property of sharing an auth directory rather than a defect with
an obvious fix. What the app does do: `Add person` refuses to hand over a credential for an account
it did not create — it assigns the type, records an `adopt` row, and shows no link — so adopting
somebody is visible in the audit log rather than silent.

**If that matters to you, give this app its own Supabase project.** That is the only complete
answer, and it costs nothing to do at the start.

## Later

Ideas worth keeping but not doing yet. Tag each one `(small)` or `(bigger)` so you can pick
something that fits the time you have.

- **Check the colours really are all in one place.** `(small)` A few focus-ring colours sit
  outside the palette; the caveat is written up in `README.md` under Rebranding.

- **Add person reads the whole roster to match one email.** `(small)` `POST /api/admin/people`
  calls `list_people()`, which returns every account on the Supabase project, and then finds the
  address client-side. That is fine at any size a client of this template will have, and it is
  deliberate in one respect — it avoids minting a token merely to discover whether an account
  exists. But it grows with the project's whole auth directory, not with this app's roster, so on
  a Supabase project shared with other apps it is the first thing here that gets slower for
  reasons unrelated to Basecamp. The fix is a narrow definer RPC carrying the same admin gate —
  `basecamp.find_person_by_email(text)` returning at most one row.

- **The mutation suite rebuilds an identical mirror once per case.** `(bigger)` Every case
  replays roughly a quarter-second of DDL to arrive at the same schema. `CREATE DATABASE x
  TEMPLATE mirror` costs about what the bare `create database` already costs, because template1
  is copied either way — so building the mirror once and cloning it would take roughly half the
  wall time off a full run without changing what any case means. Each case would still apply its
  own mutation and re-apply the file under test. Not urgent: a full run is a couple of minutes and
  it is deliberately not part of `npm test`.

## Done

Move things here when you've *seen them work*, with the date. Say briefly what changed and how you
checked — that's what makes this section useful six months from now instead of just long.

> **A note on the PART numbers below.** `boundary_mutations.sh` grew a fourth arm and its parts were
> renumbered when the account-lifecycle and nesting work landed here. The counts in the older
> entries are what was true on the day, and the part numbers they name have since moved: the
> Editor-path arm is now PART 13, the runtime arms are PARTS 14-15, and `0004`-as-file-under-test is
> PART 16. Left as written rather than back-dated — a record of what was checked is worth more than
> a record that matches today's headings.

- **The account-lifecycle path and category nesting, ported in and reconciled.** `2026-08-27`
  Brought `0004`/`0005`, the three `/api/admin/*` routes, the `admin.ts` facade and the screens over
  from a downstream stamp, then fixed what only mattered on this side. Full account in the review
  record above.

  **Checked, on PostgreSQL 17.10:** `boundary_mutations.sh` **120/120** static and Editor cases,
  **21/21** runtime, **6/6** with `0004` as the file under test, exit 0. The documented chain
  `stub → 0001 → 0002 → 0003 → 0004 → 0005 → seed.example.sql` applied clean and every file
  re-applied idempotently, with `0002` still committing against the post-`0004` state. The
  line-ending fix was proven by reverting it: with a raw `md5(prosrc)` in `0004` the psql arm still
  reported 110 passed while the Editor arm failed every case at `0004 via editor path`.
  `npm run lint && npx tsc --noEmit && npm test` clean (**191 tests**), production build clean.

  **Not yet exercised in a browser** against a live Supabase project. The local mirror has no
  PostgREST and the stub does not implement GoTrue's `generateLink`, so walk one person through
  **Add person** → link → `/accept-invite` end to end before onboarding anybody.

- **Build the catalog from the UI, including one level of subcategories.** `2026-08-26`
  `/admin/catalog` creates, renames, reorders and deletes categories and entries, and a category
  can now hold subcategories one level deep. `0005_category_nesting.sql` carries the database half:
  `categories.parent_id` as an ON DELETE RESTRICT self-reference, and
  `basecamp.enforce_category_depth()` capping the tree in both directions — downward (nesting under
  a subcategory) and upward (giving a parent to a category that already has children), because
  checking only the first lets a three-level tree be built from the bottom up.

  No new grant and no new policy: `authenticated` already held SELECT/INSERT/UPDATE/DELETE on
  `categories` from 0001 and the super_admin policies already governed all four, so adding a
  category is settled by a policy rather than by a check in TypeScript.

  **Checked:** the chain 0001→0005 applied clean on a throwaway PostgreSQL 17 cluster and re-applied
  idempotently; `boundary_mutations.sh` ran **110/110 mutation, 21/21 runtime (PARTS 12+14) and 4/4
  migration (PART 13)** cases green — PART 15 adds thirteen mutations that break the nesting guards
  one at a time and require `0002` to refuse each, including three that gut the depth cap while
  hiding the phrases the drift check looks for in a line comment, a block comment and a string
  literal. The runtime cases prove, against a real session, that a
  non-administrator cannot create a category or an entry, that their delete and rename affect **zero
  rows** rather than erroring, that both directions of the depth cap refuse, and that deleting a
  category holding entries or subcategories refuses. Two positive controls prove an administrator
  still can — so a revoked grant turns the suite red instead of green, which was verified by
  revoking it. `npm run lint && npx tsc --noEmit && npm test` clean (**189 tests**), production
  build clean.

  **Not yet exercised in a browser** against a live Supabase project — the local mirror has no
  PostgREST, so the screen's own round trips are covered by types and unit tests rather than by use.

- **A way to add someone.** `2026-08-26` `/admin/access` → **Add person** creates the account and
  shows a one-time sign-in link to hand over. No email provider was added and none is needed — the
  link is generated by Supabase's admin API, which returns it without sending anything.
  `0004_admin_write_paths.sql` carries the database half; three routes under `/api/admin/` carry
  the privileged half.

  **Checked:** the migration chain 0001→0004 applied clean on a throwaway PostgreSQL 17 cluster and
  re-applied idempotently; `boundary_mutations.sh` ran **97/97 mutation cases, 8/8 runtime cases
  (PART 12) and 4/4 migration cases (PART 13)** green, including a real signed-in non-administrator
  being refused when inserting their own `auth.uid()` into `basecamp.super_admins`;
  `npm run lint && npx tsc --noEmit && npm test` clean (**172 tests**).
  **Not yet checked against a live Supabase project** — the link flow depends on GoTrue's
  `generateLink`, which the local stub does not implement, so walk one person through it end to end
  before onboarding anybody.

- **A screen for adding and removing administrators.** `2026-08-26` The ⋮ menu on each roster row
  promotes and demotes. No route: `0004` granted `authenticated` the INSERT/DELETE privileges whose
  policies `0001` already had, so it is an ordinary RLS-decided write from the browser on the
  administrator's own token.

  **Checked:** the four refusals that matter were exercised against a real session in
  `boundary_mutations.sh` PART 12 — a non-administrator cannot promote themselves, cannot promote
  anyone else, cannot delete an existing administrator, and even a legitimate administrator cannot
  delete the last one.

<!-- template issues.md v1.0.0 -->
