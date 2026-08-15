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

- [ ] **Put your own name on it.** Product name, org name and tagline live in `src/lib/brand.ts`;
      the logo in `src/components/Logo.tsx`; colours and type in `src/theme/theme.ts`; the browser
      and app icons in `src/app/icon.png`, `src/app/apple-icon.png` and `public/favicon-*.png`.
      All of them ship as neutral placeholders. `README.md` has the table.

- [ ] **Add your first few catalog entries** and confirm somebody with no grants sees an empty
      catalog rather than an error. That's the check that proves access is actually working.

## In progress

One thing at a time, ideally. Each item here carries a **Next action** — a literal sentence saying
the very next thing to do, so you can pick it up cold. Not "continue work."

_(nothing yet)_

## Pending manual steps

Things a human has to do outside the app before something will work — set a key, flip a setting in
a dashboard, verify a domain, approve an account. These get lost constantly, so park them here the
moment they come up.

- [ ] **Expose the `basecamp` schema to the Data API — do this first.** Supabase Dashboard →
      Project Settings → API → Exposed schemas. **Add** `basecamp` alongside whatever is already
      listed; the field is replaced wholesale when you edit it, so don't remove an existing entry.
      Skip this and every request fails with `PGRST106`, the app shows an error, and nothing in the
      database looks wrong — it is a genuinely hard failure to diagnose.

- [ ] **Apply the two SQL files, in order:** `supabase/migrations/0001_baseline.sql`, then
      `0002_security_boundary.sql`. `0002` asserts the whole security boundary and refuses to
      commit if it's wrong, so if it finishes without complaining, the boundary holds.

- [ ] **Create your own account, then make it the administrator.** The account is created in the
      Supabase dashboard (there's no self-signup). Making it an administrator is one INSERT into
      `basecamp.super_admins` — the exact statement is in `supabase/README.md`.

- [ ] **Copy `.env.local.example` to `.env.local` and fill in the two values** from Project
      Settings → API. The second one is the **anon** key, never the `service_role` key.

- [ ] **Deploy to Vercel.** Connect this repository and set the same two environment variables
      there. Nothing else is needed.

- [ ] **Delete `MAINTAINING.md`.** It's for whoever re-extracts the template from the private app
      it came from. If you stamped this, it isn't for you.

## Later

Ideas worth keeping but not doing yet. Tag each one `(small)` or `(bigger)` so you can pick
something that fits the time you have.

- **A screen for adding and removing administrators.** `(bigger)` Today that's a SQL statement.
  The database policies for a UI are already written and correct — the privileges are deliberately
  withheld until something actually uses them.

- **A way to invite someone.** `(bigger)` Right now adding a person means creating their account in
  the Supabase dashboard and then granting them access in `/admin/access`.

- **Check the colours really are all in one place.** `(small)` `src/theme/theme.ts` holds the
  palette, but a few focus-ring colours sit outside it. Grep that file for raw hex values before
  assuming a palette edit covered everything.

## Done

Move things here when you've *seen them work*, with the date. Say briefly what changed and how you
checked — that's what makes this section useful six months from now instead of just long.

_(nothing yet)_

<!-- ascend-template issues.md v1.0.0 -->
