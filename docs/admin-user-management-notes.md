<!--
  MAINTAINER DOCUMENT — not part of the application.

  This records why the account-lifecycle path — Add person, issued sign-in links,
  suspend and restore, and the `0004` migration under it exists and what was decided along the way, for
  whoever next touches it. Where the implementation ended up stronger than the
  design, the design text is corrected in place rather than left standing —
  a spec that disagrees with the code it shipped is worse than no spec.

  If you stamped this template, you can delete this file, exactly as you can
  delete MAINTAINING.md. Nothing in the app reads it.
-->

# Admin user management — design

**Status:** implemented. Deviations from the approved design are marked **CHANGED**
below; where the implementation is stronger than the design, this file says so and
describes what shipped, not what was proposed.

## The problem

An administrator cannot add a person to this app. Doing it today means opening the Supabase
dashboard, creating the account by hand, returning to `/admin/access` to grant them something, and
sending a password link from the roster. `README.md` lists this under "What is deliberately not
here"; `issues.md` carries it under Later as `(bigger)`.

The `/admin/access` screen already answers "who has access to what" completely — three views over
personal grants and type grants, plus an audit log. That half needs no work. What is missing is
everything about the person's *existence*: creating them, re-issuing their sign-in link, removing
them, and promoting them to administrator.

There must be no email provider. No SendGrid, no SMTP, no mail dependency — the repository ships
none today and will ship none after this change.

## What gets built

1. **Add a person** — email plus member type, in one dialog, producing a one-time sign-in link the
   administrator copies and hands over out of band.
2. **Re-issue a sign-in link** — for someone locked out or who never used their first one.
3. **Ban and unban a person** — stop sign-in, reversibly, touching **no grants at all**. (The approved design said revoke every grant; see the CHANGED note below for why that was not what shipped.)
4. **Promote and demote administrators** — a UI for the `basecamp.super_admins` trust root.

## Why a one-time link rather than an email or a password

`supabase.auth.admin.generateLink()` returns an action link and **sends nothing**. That is the
whole reason this approach was chosen: the account gets created, the administrator sees a URL, and
delivery is a human handing it to another human over whatever channel they already trust. No mail
provider enters the repository, no password is typed into a chat window, and the link carries
Supabase's own expiry.

This also removed the app's last dependency on Supabase's built-in mailer. The
`resetPasswordForEmail` call that used to live in `AccessAdmin.tsx` relied on it silently, and that
service is rate limited to a couple of messages an hour and is not intended for production
onboarding. That call, and the `/auth/reset` page it fed, are both gone — `README.md` under "What
is deliberately not here" records the decision and what it costs.

## The security decision

This app's safety rests on one property, stated in `CLAUDE.md` and repeated in three source files:
every Supabase client holds the anon key, so Postgres row-level security is the only thing deciding
access. There is no server-side role check anywhere, on purpose — a role check in application code
is a lock on the front door of a building with no walls.

Creating an auth account requires the Admin API, which requires the `service_role` key, which
bypasses RLS. Those cannot both be absolutely true, so the invariant gets **narrowed and
documented** rather than quietly broken.

**The narrowed rule:** the `service_role` client exists in exactly one module, is constructed only
after the caller has been proven a super admin, and may call **only** `supabase.auth.admin.*`. It
never issues a statement against any `basecamp.*` table. Every read and write of catalog data,
grants, member types and the audit log continues to travel on the signed-in person's own token,
decided by RLS, exactly as before.

That distinction is what makes this safe to add. The RLS boundary is not weakened for any data it
currently protects; a separate, minimal path is opened alongside it for the one operation Postgres
policies cannot express — the creation of an identity.

### Why not the alternatives

- **Supabase Edge Function.** Keeps `service_role` out of the Vercel environment entirely, which is
  genuinely stronger isolation. Rejected because the repository has no Edge Functions today, so it
  would add a second deployment pipeline, a second place to debug, and JWT/CORS plumbing for one
  feature.
- **`SECURITY DEFINER` function writing to `auth.users`.** Needs no `service_role` at all, but
  Supabase treats `auth.users` as private; hand-inserting identity rows breaks across GoTrue
  upgrades, and it cannot generate action links, which is the mechanism this design depends on.

## Data layer — `supabase/migrations/0004_admin_write_paths.sql`

**CHANGED — the audit log did NOT become client-writable.** The approved design and the
implementation brief both called for a super-admin-scoped INSERT *policy* on `basecamp.access_audit`,
plus the matching privilege. That was reconsidered during Phase 1, once the existing assertions were
read: `authenticated` holds SELECT and nothing else there, `access_audit` has no write policy at
all, and `0002` asserts both facts. Granting INSERT would let any administrator forge rows —
including plausible `grant`/`revoke` rows naming tables they never touched — in the one table whose
job is being the record of what happened.

Instead, `basecamp.log_privileged_action(text, uuid)` is a `SECURITY DEFINER` RPC that writes
past RLS while pinning everything a forger would want to control: `actor_id` is `auth.uid()`,
`source_table` is `'auth_admin'`, and the action must be one of four literals. It gates on
`basecamp.is_super_admin()` in its own body. The caller invokes it on their own token, so the actor
is still the administrator who clicked — the property the brief asked for — and `0002`'s audit
assertions did not need to be weakened at all. Its body is digest-pinned in `0004`, and the digest
is taken over line-ending-normalized text for the reason `0002` records at its own pins.

**CHANGED — two arguments, not three.** The design named a third, the subject's *email*. Accepting
it as text let an administrator record a ban of one person labeled with another's address, and
because `access_audit` is append-only the false label could never be corrected. Both labels are
looked up from `auth.users` inside the function instead; the caller names only the subject's id.

**Open the trust-root write path.** `authenticated` currently holds only `SELECT` on
`basecamp.super_admins` (`0001_baseline.sql:1705`). The INSERT and DELETE *policies* already exist
and are correct — only the table privileges were withheld, deliberately, until something consumed
them. This migration grants them. Lockout stays impossible: the
`basecamp_super_admins_keep_last` trigger already refuses the deletion of the final administrator.

**Extend `basecamp.list_people()`.** It returns `id, email, created_at, is_super_admin` today. Add:

- `banned_until` — so the roster can render banned state without a second query.
- `member_type_id` — so the roster can show the person's type, and so the add-person flow can
  confirm the assignment it just made.

The function keeps its `SECURITY DEFINER`, its `search_path TO ''`, its `where basecamp.is_super_admin()`
gate, and its `email is not null` filter. The empty result remains the authorization answer.

**Keep `0002_security_boundary.sql` honest.** That file asserts the privilege surface at apply time
and raises if it finds something unexpected. Its assertions must be updated in the same change, or
the new `super_admins` grant will make it refuse to apply. This is the file working as designed, not
an obstacle to route around.

## Server layer — `src/app/api/admin/`

### The guard — `src/lib/supabase/admin.ts`

One exported helper, used identically by every route:

1. Build an **anon-key** client from the caller's cookies, the same way `server.ts` does.
2. Call `rpc('is_super_admin')` on it. A missing session gives 401; `false` gives 403.
3. **Only then** construct the `service_role` client, from `SUPABASE_SERVICE_ROLE_KEY` — no
   `NEXT_PUBLIC_` prefix, so Next.js cannot inline it into a client bundle.

The privileged client does not exist as a value until the caller has been proven an administrator by
the database itself. The check is not "does this TypeScript think you are an admin" — it is the same
`basecamp.is_super_admin()` that every RLS policy consults.

This module is imported only by route handlers. It must never be imported by a client component,
and its file comment says so.

### The routes

| Route | Behavior |
|---|---|
| `POST /api/admin/people` | `generateLink({ type: 'invite' })` creates the account and returns the link without sending mail; insert the `basecamp.members` row with the chosen `member_type_id`; return the link once. |
| `POST /api/admin/people/[id]/link` | `generateLink({ type: 'recovery' })` for an existing person. Returns the link once. |
| `POST /api/admin/people/[id]/ban` | `updateUserById(id, { ban_duration: '876000h' })`. Unban passes `'none'`. |

Three routes, not four.

**CHANGED — banning touches no `basecamp` table.** The approved design had it revoke every grant
and delete the member row. That makes "unban" a lie: the person signs in again to an empty catalog,
with no record of what they used to have and no way to restore it short of an administrator
remembering. Banning is now exactly one thing — the account cannot sign in — so lifting it returns
them to precisely the access they had. Removing someone's access stays a separate, deliberate act on
the access screen, audited grant by grant.

The consequence is stated in the UI: a ban takes effect at the next token refresh, because an
already-issued JWT stays valid until it expires. For a compromised account rather than an ordinary
departure, ban *and* revoke their grants, which RLS applies on the very next request.

The route also refuses to ban the caller's own account. The database's last-administrator guard does
not cover this — banning is not a delete, so the row survives and the trigger never fires — and a
self-ban has no in-app recovery.

**Promoting and demoting administrators does not get a route.** Once migration 0004 grants the
privilege, writing `basecamp.super_admins` is an ordinary RLS-decided write, and `CLAUDE.md` is
explicit that admin screens write to the database directly from the browser on the signed-in
person's own token: "a policy, not a check in TypeScript." It therefore uses the existing
`useAdminWrite` hook, exactly like every grant toggle on the same screen. Putting it behind a server
route would add an application-code role check where the database already refuses — the precise
thing the constitution warns against.

## UI layer

- **`AccessAdmin.tsx`** — remove `INVITE_REASON` and the `aria-disabled` treatment on the "Invite
  staff" button (lines 52–53, 594–620); wire it to a new `AddPersonDialog`. Replace the
  `resetPasswordForEmail` call at line 460 with the re-issue-link route. Update the file's header
  comment, which currently states there is no `service_role` path and must never be one — it now
  states the narrowed rule instead.
- **`AddPersonDialog.tsx`** (new) — email field plus member-type select, sourced from the
  `member_types` the screen already loads.
- **`LinkRevealDialog.tsx`** (new) — displays the returned link with a copy button and an explicit
  "shown once, not stored" warning. Shared by the add and re-issue flows.
- **`PersonList.tsx`** — a row overflow menu: re-issue link, promote/demote administrator,
  ban/unban. Banned rows render dimmed with a chip.
- **`src/types/admin.ts`** — `Person` gains `banned_until: string | null` and
  `member_type_id: string | null`. The comment on `is_super_admin` declaring it "READ-ONLY in the
  UI, deliberately" is now false and gets replaced.

## Documentation — part of the work, not a follow-up

- **`CLAUDE.md`** is the project's constitution and currently states two things this change makes
  untrue: that there is no `service_role` key, and that deciding whether a write is allowed never
  happens in application code. Both need amending to the narrowed rule. The file invites exactly
  this: "add to it when you and Claude agree on something that should be permanent."
- **`.env.local.example`** — add `SUPABASE_SERVICE_ROLE_KEY` with a plain account of why this one
  key is exempt, what it may be used for, and why it carries no `NEXT_PUBLIC_` prefix.
- **`README.md`** — "No invite flow" and "No admin panel for the trust root" leave the "What is
  deliberately not here" section. The "No email provider" bullet stays true and stays.
- **`issues.md`** — both `(bigger)` items move to Done with the date and how it was checked.
- **`supabase/README.md`** — the onboarding section describing the dashboard round-trip is replaced
  by the link flow.

**CHANGED — `list_people()` is pinned to ONE digest, selected by applied state.** `0002` pins the
access-model function bodies by md5, and it runs *before* `0004` replaces `list_people`. Pinning
only the new body breaks every fresh stamp; pinning only the old one breaks every re-run of `0002`
afterwards, including the mutation suite's core mechanism.

The design proposed a SET of two acceptable digests. That is the wrong shape and `0002` says so at
the pin: a set is monotonic — every future migration that replaces a pinned function appends
another, and "the body is exactly this" decays into "the body is any body we ever shipped". It
would also let a DROP+CREATE that *reverts* `list_people` to its `0001` body pass, which is the
silent regression the pin exists to catch.

What shipped instead selects the expected digest from a fact about the database — whether
`log_privileged_action` exists, which only `0004` creates. The accept set stays size **one** for any
given database, a revert is still refused, and a third body later means changing a branch rather
than lengthening a list. The selector is itself pinned in both directions, because a selector that
can be dropped unnoticed is not a selector.

## Verification

**`supabase/tests/boundary_mutations.sh` IS THE SECURITY GATE. `npm test` is convenience.**

That distinction is not a style note, it is a statement about what each one can observe. `npm test`
is Node's own runner over `src/**`; it never opens a database connection, and every access decision
in this application is made by Postgres. It can be entirely green while the trust root is wide open.
Run the shell suite whenever you touch `0002`, `0004`, a policy, or a definer function.

The shell suite gained a twelfth part for this work. Parts 1–11 all ask one question — does `0002`
*refuse* a broken schema? — and that question cannot cover what `0004` opens, because after `0004`
the INSERT privilege on the trust root is *supposed* to be there. PART 12 asks a different question:
it runs real statements as `authenticated` with a real `auth.uid()` and requires the database to
refuse. Six assertions, with their own counter (`EXPECTED_RLS_CASES`) and their own `npm test`
guard, since a case lost from a separate runner would be invisible to the existing count:

- a non-administrator cannot promote **themselves** — the exact hole the privilege grant would open
- a non-administrator cannot promote **someone else** — a policy rewritten as `user_id = auth.uid()`
  would pass the first case and fail this one
- a non-administrator cannot delete an existing administrator (checked by **row count**: RLS filters
  silently rather than raising, so a `DELETE 0` and a refusal are indistinguishable without it)
- even a legitimate administrator cannot delete the **last** administrator
- a non-administrator cannot write the audit log through the RPC
- `list_people()` returns **zero** rows to a non-administrator, not a filtered list

`npm test` covers the pure logic beside it: link construction (including that the URL is our own
`/auth/confirm` and not Supabase's self-consuming `action_link`), the already-registered fall-through,
ban-duration values, `isBanned`'s lapsed-timestamp comparison, the trust-root error messages, and
the audit renderer's new events.

**Still to be demonstrated end to end**, per `CLAUDE.md`'s "a login screen is not proof": add a real
person on a live Supabase project, copy the link, open it in a clean browser profile, set a password,
sign in, and confirm they see exactly what their member type grants and nothing else. The local
Postgres mirror has no GoTrue, so `generateLink` is the one link in the chain no test here exercises.

## Out of scope

- Sending email of any kind, from the app or the database.
- **Hard deletion as a user-facing action.** Ban is reversible and preserves the audit trail;
  hard deletion orphans past log entries against a user id that no longer resolves to a name. If a
  genuine data-removal request arrives, it is a deliberate manual act, not a button.

  **One exception, and only one:** rolling back an account created seconds earlier in the same
  request. If `POST /api/admin/people` mints an account and the follow-up `members` insert then
  fails, the route deletes that account again — otherwise it leaves a person who exists in auth
  with no type and no grants, invisible to the roster's purpose and cleanable only by hand in the
  dashboard. `deleteUser` is on the admin facade for that caller alone, and no route exposes it as
  an offboarding tool.
- Bulk import.
- Any change to how grants themselves are decided. The union of type grants and personal grants,
  with no deny rule, is untouched.
