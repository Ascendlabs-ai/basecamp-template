# Basecamp — internal app catalog and launcher

An authenticated catalog of everything your team runs: what exists, what it
does, who owns it, where it runs, and — for the things that have a URL — a
button that opens them. Plus an access-administration screen that decides who
sees which entries.

This is a **GitHub template repository**. Stamp your own copy from it, point it
at your own Supabase project, and it is yours; nothing links back here.

---

## What you get

- **A catalog** grouped into categories, filtered per-viewer by the database.
- **A launcher sidebar** for the entries that are actually openable.
- **Access administration** at `/admin/access` — grant a person a single entry
  or a whole category, or grant a *type* of person (staff, contractor, client)
  a set of things once and assign people to it.
- **A people roster** showing every account on the project, when it joined, and
  whether it is an administrator — with **Send password link**, which triggers
  Supabase's own recovery email so the person sets their own password at
  `/auth/reset`. No administrator ever handles a password, and no service-role
  key is involved. Read the email limits in
  [`supabase/README.md`](supabase/README.md#email-built-in-only-and-it-will-not-carry-a-real-rollout)
  before you rely on it.
- **An append-only audit log** at **Admin → Audit** — every grant and revoke,
  who did it and to whom, written by database triggers rather than by the app,
  so a change cannot be made without being recorded.
- **Deny-by-default auth.** Unauthenticated requests are redirected to
  `/login` by middleware that runs on every route except static assets.

## How access actually works

Worth understanding before you deploy, because it is unusual and it is the
reason this app is safe to point at a shared database:

**Everything is enforced by Postgres row-level security.** There is no
server-side role check anywhere in the application, and no service_role key. A
signed-in user's requests carry their own JWT, and the database returns only the
rows their grants allow. If someone has no grants, they get an empty catalog —
not a filtered one, an empty one.

Effective access is the **union** of two independent sources: what a person's
member *type* is granted, and what that person is granted individually. Neither
overrides the other and neither can subtract. There is no deny rule, on purpose
— a deny would make effective access depend on evaluation order, which turns an
access model into something you have to simulate instead of read.

**The trust root is a table this schema owns**, `basecamp.super_admins`.
Membership in it *is* the admin role. It is deliberately hard to destroy: rows
can be added and removed but never edited, the last row cannot be deleted, and
`TRUNCATE` is refused outright by a trigger.

## Setup

Full provisioning instructions, including the first-administrator step, are in
[`supabase/README.md`](supabase/README.md). In short:

1. Create a Supabase project.
2. **Expose the `basecamp` schema to the Data API** (Integrations → Data API →
   Settings → Exposed schemas; older projects have it under Project Settings →
   API). Nothing works before this and the failure is opaque.
3. Apply `supabase/migrations/0001_baseline.sql`, then `0002_security_boundary.sql`,
   then optionally `0003_seed_categories.sql` for four starter categories.
4. Create your administrator account, then insert their trust-root row.
5. `cp .env.local.example .env.local` and fill in the two values.
6. `npm install && npm run dev`, sign in, confirm `/admin/access` renders.
7. Build your catalog in **Admin → Catalog**.

## Rebranding

Four places, by design:

| What | Where |
|---|---|
| Product name, org name, home heading, tagline | `src/lib/brand.ts` — the heading is composed from `ORG_NAME`, so setting that one constant changes the home page |
| The logo mark | `src/components/Logo.tsx` (a neutral placeholder — swap the inline SVG, or render your own asset) |
| Colours, type, the dark sidebar | `src/theme/theme.ts` |
| Browser/app icons | `src/app/icon.png`, `src/app/apple-icon.png`, `public/favicon-*.png` — neutral placeholders, replace with your own |

`src/lib/logoUsage.test.ts` enforces that the brand stays in those files: any
`.ts` or `.tsx` file under `src/` that hardcodes the product name, or reaches for
a logo asset directly, fails the suite. (Test files themselves are exempt — they
are not a user-visible surface.) That guard exists because in the app this was
extracted from, two surfaces had each inlined their own logo and pinned
themselves to light mode.

The colour caveat: `theme.ts` holds the palette, but a few focus-ring literals
sit outside it. Grep `src/theme/theme.ts` for raw hex before assuming a palette
edit covered everything.

## Commands

| Action | Command |
|---|---|
| Install | `npm install` |
| Develop | `npm run dev` (port 3000) |
| Lint | `npm run lint` |
| Typecheck | `npx tsc --noEmit` |
| Test | `npm test` |
| Build | `npm run build` |

Tests are Node's built-in runner with type stripping — **Node 22.6 or newer**,
enforced by `engines` in `package.json`. They cover the pure logic: access
resolution, catalog shaping, redirect safety, middleware placement, audit-log
phrasing, the brand
guard, and a template-hygiene guard that fails if the SQL baseline picks up a
psql meta-command or a PostgreSQL-17-only construct. They do not need a
database.

**`npm test` does not touch a database**, which is where 100% of the access
enforcement lives. What you get instead is `0002_security_boundary.sql`, which
asserts the boundary at apply time and refuses to commit if ownership, RLS,
definer hardening, the trust root's privileges and guards, the audit table's
append-only guards and writers, the schema's default privileges, view safety,
the ACLs on the definer trigger functions, the bodies of the seven functions that
decide access, or the policies that call them are wrong.

Those assertions are mutation-tested, and **the test is in the box**:
`supabase/tests/boundary_mutations.sh` breaks one thing at a time in a throwaway
PostgreSQL 16 or 17 cluster and requires `0002` to refuse — 72 mutations plus a
control that must commit, plus an Editor-path arm that pastes both files CRLF the way a
client does. Nine cases expect a COMMIT and say so. Nothing about
provisioning needs it; run it if you edit `0002`, or if you would rather see the
proof than read about it.

It is a floor, not a clean bill of health: a review on 2026-08-17 defeated
several of `0002`'s stated invariants with mutations the suite does not contain.
None is available to an ordinary signed-in user, and a service-role API key does
not reach them either. They are enumerated in [`issues.md`](issues.md) under
"Known gaps in the security boundary" — that list is the single copy; this
paragraph deliberately does not restate its length.

But `0002` runs **once**, at install. There is no shipped suite that proves your
policies DENY correctly for a non-admin — verify that by hand after install
(sign in as a user with no grants; you should see an empty catalog, not an
error).

## Stack

Next.js App Router (React Compiler enabled), React 19, TypeScript, MUI 7 with
Emotion, Framer Motion, and Supabase Auth + Postgres. Deploys to Vercel with two
environment variables and no other configuration.

## What is deliberately not here

- **Almost no seed data.** `0003_seed_categories.sql` adds four empty starter
  categories — Sales, Marketing, Operations, Useful Tools — so a new app has
  somewhere to put its first entry. It is optional and you can skip it. No
  entries are seeded; the schema is still the deliverable.
  `supabase/seed.example.sql` is a separate, fuller worked example you can run
  and then delete — it is not applied for you.
- **No signup screen — which is not the same as signup being off.** This app
  ships no way to register through it, and the sign-in page says accounts are
  issued by an administrator. That is true of the app; it is *not* true of the
  Supabase project underneath, where signup is **open by default**. People who
  sign up arrive with zero access until an administrator grants them something,
  which is the intended model — but if you want the sign-in copy to be literally
  true, turn signup off in Authentication → Providers → Email.
- **No invite flow.** Adding a user means creating the account in the Supabase
  dashboard, granting them access in `/admin/access`, and sending them a
  password link from the roster. There is no single "invite" action, and the
  password link runs on Supabase's built-in email service until you attach your
  own SMTP — see the email section in `supabase/README.md`, which you should
  read before onboarding anyone.
- **No email provider.** No SendGrid, Mailgun, Postmark, Resend, nodemailer or
  SMTP credentials anywhere in this repository, and no mail dependency in
  `package.json`.
- **No admin panel for the trust root.** Adding or removing an administrator is
  a SQL statement, documented in `supabase/README.md`. The policies for a UI are
  written and correct; the privileges are deliberately withheld until something
  consumes them.
