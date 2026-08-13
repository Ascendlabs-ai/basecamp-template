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
2. **Expose the `basecamp` schema to the Data API** (Project Settings → API →
   Exposed schemas). Nothing works before this and the failure is opaque.
3. Apply `supabase/migrations/0001_baseline.sql`, then `0002_security_boundary.sql`.
4. Create your administrator account, then insert their trust-root row.
5. `cp .env.local.example .env.local` and fill in the two values.
6. `npm install && npm run dev`, sign in, confirm `/admin/access` renders.
7. Build your catalog.

## Rebranding

Three places, by design:

| What | Where |
|---|---|
| Product name, org name, home heading, tagline | `src/lib/brand.ts` |
| The logo mark | `src/components/Logo.tsx` (a neutral placeholder — swap the inline SVG, or render your own asset) |
| Colours, type, the dark sidebar | `src/theme/theme.ts` |

`src/lib/logoUsage.test.ts` enforces that the brand stays in those files: any
component that hardcodes the product name, or reaches for a logo asset directly,
fails the suite. That guard exists because in the app this was extracted from,
two surfaces had each inlined their own logo and pinned themselves to light mode.

## Commands

| Action | Command |
|---|---|
| Install | `npm install` |
| Develop | `npm run dev` (port 3000) |
| Lint | `npm run lint` |
| Typecheck | `npx tsc --noEmit` |
| Test | `npm test` |
| Build | `npm run build` |

Tests are Node's built-in runner with type stripping — **Node 22.6 or newer**.
They cover the pure logic: access resolution, catalog shaping, redirect safety,
and the brand guard. They do not need a database.

## Stack

Next.js App Router (React Compiler enabled), React 19, TypeScript, MUI 7 with
Emotion, Framer Motion, and Supabase Auth + Postgres. Deploys to Vercel with two
environment variables and no other configuration.

## What is deliberately not here

- **No seed data.** The catalog starts empty; the schema is the deliverable.
- **No self-signup.** Accounts are issued by an administrator. The sign-in page
  says so.
- **No invite flow.** Adding a user today means creating the account in the
  Supabase dashboard and granting them access in `/admin/access`.
- **No admin panel for the trust root.** Adding or removing an administrator is
  a SQL statement, documented in `supabase/README.md`. The policies for a UI are
  written and correct; the privileges are deliberately withheld until something
  consumes them.
