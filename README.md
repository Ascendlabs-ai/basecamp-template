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
- **A people roster** showing every account on the project, when it joined,
  whether it is suspended, and whether it is an administrator — with **Add
  person**, which creates the account and hands you a one-time sign-in link to
  pass on yourself. No administrator ever handles a password and nothing is
  emailed; see [Adding people](#adding-people) below.
- **An append-only audit log** at **Admin → Audit** — every grant and revoke,
  who did it and to whom, written by database triggers rather than by the app,
  so a change cannot be made without being recorded.
- **Deny-by-default auth.** Unauthenticated requests are redirected to
  `/login` by middleware that runs on every route except static assets.

## How access actually works

Worth understanding before you deploy, because it is unusual and it is the
reason this app is safe to point at a shared database:

**Everything is enforced by Postgres row-level security.** There is no
server-side role check anywhere in the application. A signed-in user's requests
carry their own JWT, and the database returns only the rows their grants allow.
If someone has no grants, they get an empty catalog — not a filtered one, an
empty one.

**There is exactly one privileged path, and it is narrow.** Creating a person's
account cannot be expressed as a policy, because identities live in
`auth.users`, a schema this app does not own. So three `/api/admin/*` routes —
add a person, issue their sign-in link, suspend or restore them — use
`SUPABASE_SERVICE_ROLE_KEY`. It is read in one function, only after Postgres has
answered `basecamp.is_super_admin()` true for the caller's own token, and what
it exposes is a facade of four verbs with pinned arguments rather than Supabase
Auth itself: it cannot read or write a single `basecamp` table and cannot set a
password, an email or a role. Every catalog row, grant, member type and audit
entry is still decided by RLS on the signed-in person's own token.
`.env.local.example` and `src/lib/supabase/admin.ts` both spell out the
boundary; skip the key entirely and everything except those three actions works
unchanged.

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
3. Apply the SQL files in order: `0001_baseline.sql`, `0002_security_boundary.sql`,
   optionally `0003_seed_categories.sql` for four starter categories, then
   `0004_admin_write_paths.sql` and `0005_category_nesting.sql`. Only `0003` is
   optional — `0004` is what makes **Add person** work and what seeds the three
   starter member types, and `0005` adds subcategories.
4. Create your administrator account, then insert their trust-root row.
5. `cp .env.local.example .env.local` and fill in the values — two required, plus
   `SUPABASE_SERVICE_ROLE_KEY` if you want to add people from the app.
6. Add `/auth/confirm` and `/accept-invite` to the project's Redirect URLs.
7. `npm install && npm run dev`, sign in, confirm `/admin/access` renders.
8. Build your catalog in **Admin → Catalog**, and add your first person.

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
decide access, or the policies that call them are wrong. `0004` and `0005` add
their own assertions in the same style and each pins the function it ships — the
audit writer and the nesting-aware read gate — bringing the total to nine bodies
pinned once the whole chain is applied.

Those assertions are mutation-tested, and **the test is in the box**:
`supabase/tests/boundary_mutations.sh` breaks one thing at a time in a throwaway
PostgreSQL 16 or 17 cluster and requires the file under test to refuse. It runs
four arms, counted separately so a lost one cannot hide in a rolled-up total:
the static `psql` arm, an Editor-path arm that pastes the whole migration chain
CRLF the way a client does, a runtime arm that issues real statements as
`authenticated` and requires the DATABASE to refuse them, and one that puts
`0004` itself under test. A handful of cases expect a COMMIT and say why.
Nothing about provisioning needs it; run it if you edit `0002`, `0004`, `0005`,
a policy or a definer function — or if you would rather see the proof than read
about it.

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
environment variables, plus `SUPABASE_SERVICE_ROLE_KEY` if you want to add
people from the app, and no other configuration.

## Building the catalog

`/admin/catalog` is where the catalog is filled in, and everything on it is a
write from your browser on your own token. **This screen has no server route and
never touches the service-role key** — the privileged path described above is
only the three account-lifecycle routes, and it cannot reach a `basecamp` table
at all. What you can do here is decided by a Postgres policy, so the screen
cannot offer you anything the database would refuse.

- **Create a category.** Name it; the identifier is derived, so renaming later
  is safe.
- **Nest one level.** The "Sits under" picker on the new-category form makes it
  a subcategory. Only top-level categories are offered, because **nesting is
  capped at one level** — a cap enforced by the database
  (`enforce_category_depth`, in `0005_category_nesting.sql`), not by the form.
  The cap exists because every reader of this data assumes a fixed shape: the
  home page, the access matrix and the grant model are all flat or one-deep, and
  arbitrary depth would break each differently.
- **Add entries as tiles**, in a top-level category or a subcategory — the
  entry dialog lists both, indented.
- **Reorder, rename, and move.** Arrows move a row among its own siblings, so a
  subcategory cannot be moved past its parent. Editing a category also lets you
  change what it sits under — including promoting a subcategory back to top
  level. A category that has subcategories of its own cannot be moved under
  another; the database refuses it and the picker says so first.
- **Deleting refuses rather than cascading.** A category holding entries,
  subcategories, or both cannot be deleted; the button says which is in the way.
  Both foreign keys are `ON DELETE RESTRICT`, so this holds even against a
  client that ignores the UI.

**Grants do not inherit.** `category_has_grant()` is flat: granting somebody
"Finance" grants them nothing about "Finance › Reports". Each category — parent
or subcategory — is its own column in the access matrix, and subcategories are
labelled with their parent there so two called "Reports" are distinguishable.

**A category used only as a container renders fine.** If every tile lives in the
subcategories and none in the parent, the parent still appears as a heading with
its children beneath it — `0005` widened the read rule by exactly one level for
this case. What has *not* changed is the protection it sits next to: a category
with nothing visible inside it at all — no entries of its own and no granted
subcategory — stays hidden, because otherwise a grant on an empty category would
disclose its name and description to somebody with no access to anything in it.

**A refused write never renders as a success.** RLS does not raise on UPDATE or
DELETE — the policy filters the row away and PostgREST answers `204`, which
reads as `{ error: null }`. Every mutation on this screen therefore asks for the
affected rows back and treats zero as "that did not apply". This repo has
shipped that bug twice; `supabase/tests/boundary_mutations.sh` PART 14 now
checks the row count for exactly this reason.

## Adding people

`/admin/access` → **Add person**. Enter their email, pick their type, and the
app creates the account and shows you a **one-time sign-in link**. Copy it and
send it to them however you already talk to them — a chat message, a text, in
person.

**Nothing is emailed.** The link is generated, not delivered: there is no mail
provider here and none is needed. That is also why the link is shown exactly
once and never stored — it is a credential, so it is never written to the audit
log, a server log, or an error message.

The link takes them to `/auth/confirm`, which renders a button and verifies
nothing until they click it. That deliberate click matters: the token is
single-use, so a link preview, a mail scanner or a browser prefetch would
otherwise consume it and the recipient would be told their brand-new link had
expired.

Each person's ⋮ menu on the roster also offers:

- **Issue a sign-in link** — for someone locked out or who never used the first
  one. Same flow, nothing emailed.
- **Make / remove an administrator** — writes `basecamp.super_admins` directly
  from the browser on your own token. The database refuses a non-administrator,
  and refuses the demotion that would leave nobody.
- **Suspend / restore sign-in** — bans the auth account. It touches **no
  grants**, which is what makes it reversible: restoring someone returns them to
  exactly the access they had. A session they already have open stays valid for
  up to an hour, so for an urgent case revoke their grants as well, which RLS
  applies on the very next request.

Removing someone permanently is not a button. Suspension is reversible and keeps
their audit history readable; a genuine data-removal request is a deliberate
manual act, not a click.

**One-time setup:** this needs `SUPABASE_SERVICE_ROLE_KEY` in `.env.local` (see
`.env.local.example` for what it is bounded to and why it carries no
`NEXT_PUBLIC_` prefix), and `/auth/confirm` and `/accept-invite` added to the
project's redirect allow-list — `issues.md` → Pending Manual Steps has both.

## What is deliberately not here

- **Almost no seed data.** `0003_seed_categories.sql` adds four empty starter
  categories — Sales, Marketing, Operations, Useful Tools — so a new app has
  somewhere to put its first entry. It is optional and you can skip it. No
  entries are seeded; the schema is still the deliverable.
  `supabase/seed.example.sql` is a separate, fuller worked example you can run
  and then delete — it is not applied for you.

  The one exception is **member types**. `0004` seeds three — staff, contractor,
  client — and marks them `is_system` so they cannot be deleted, because **Add
  person** requires a type and a database with none ships a screen that cannot
  be used. Rename them freely; grants attach to the row, not the label.
- **No signup screen — which is not the same as signup being off.** This app
  ships no way to register through it, and the sign-in page says accounts are
  issued by an administrator. That is true of the app; it is *not* true of the
  Supabase project underneath, where signup is **open by default**. People who
  sign up arrive with zero access until an administrator grants them something,
  which is the intended model — but if you want the sign-in copy to be literally
  true, turn signup off in Authentication → Providers → Email.
- **No email provider.** No SendGrid, Mailgun, Postmark, Resend, nodemailer or
  SMTP credentials anywhere in this repository, and no mail dependency in
  `package.json`. This is the constraint the onboarding flow is built around,
  not a gap in it.
- **No self-service password reset, and this is a decision.** Earlier versions
  shipped a `/auth/reset` page fed by Supabase's own recovery email. Both are
  gone. The reason is that the emailed route has two dashboard settings that
  fail *silently* when wrong — the Site URL and the Redirect allow-list — on top
  of a built-in mailer capped at a handful of messages an hour, so the button
  reported success whether or not anything was delivered. **Issue a sign-in
  link** replaces it and is strictly better for an app with no mail provider:
  the administrator sees the link appear or sees why it did not, and the
  recipient can open it in any browser. What it costs is real and worth saying:
  somebody who forgets their password has to ask an administrator rather than
  helping themselves. If you would rather have the self-service form back, the
  receiver it needs is a page that consumes a fragment callback on an
  implicit-flow client — `/auth/confirm` is the nearest working example — and
  you would be taking on those two silent failure modes deliberately.
