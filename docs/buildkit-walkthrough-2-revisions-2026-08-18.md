<!--
  MAINTAINER DOCUMENT — not part of the application.

  This is the source specification for the work recorded in this repository as
  "Stream B". It is committed here, rather than left in a chat log, so that the
  next person to touch the Catalog admin, the starter-category seed, the empty
  states or the error messages can read what was actually asked for and why.

  Only "STREAM B" applies to this repository. Stream A describes a separate
  application and is kept only so the two halves stay readable side by side —
  several Stream A items are written against Stream B's outcome.

  If you stamped this template, you can delete this file, exactly as you can
  delete MAINTAINING.md. Nothing in the app reads it.

  The body below is the specification as written, unedited.
-->

# AI Build Kit — Second Walkthrough Revisions

> Source: full end-to-end client walkthrough by Kevin, 2026-08-18, run as a real user:
> stamped `AppCloset` from the template, provisioned a Supabase project, deployed to Vercel,
> took the keys, and reached a working signed-in app. 37 findings.
> Original walk numbering (w1–w37) is preserved in parentheses for cross-reference.
>
> **Two work streams, two repos, run in parallel:**
> - **Stream A — `ai-build-kit-app`** (+ authorized commits to `ai-build-kit-templates`): step
>   content, console code, and composer fixes.
> - **Stream B — `basecamp-template`**: app fixes, seed data, and one genuine feature build.
>
> One writer per repo. The streams share no files.

---

## Context that governs both streams

**The walkthrough completed end to end.** Stamp → local clone → migrations applied → deploy →
sign-in → super_admin insert → working app. The machine works. What failed was almost entirely
the final two phases, which had never been walked before.

**Five findings were hard blockers** that would stop every client permanently:
- w26: instructed to click a Sign up button the app deliberately does not have
- w27: email confirmation that a fresh Supabase project cannot reliably deliver
- w31: `basecamp` schema never exposed to the Data API — every client hits `PGRST106`
- w28: the app reports an invalid API key as "email and password did not work"
- w36: the app has **no entry or category management UI at all** — `/admin/entries` and
  `/admin/catalog` both 404, so the catalog can never be filled

**Two lessons from this session are constraints, not suggestions:**
1. **Content and the code that reads it ship together.** Migration 037's `[[PANEL]]` marker was
   applied to production before the renderer understood it; clients saw literal `[[PANEL]]` text.
   Any item below that introduces new body syntax lands code-first or atomically.
2. **Errors must tell the truth.** Half the session's lost hours came from the app blaming the
   user's password for a configuration failure. Both streams carry error-message work.

---

# STREAM A — `ai-build-kit-app`

Step bodies are database rows in `buildkit.onboarding_steps`. Code changes are the console app.
Standing rules apply: pre-cockpit prompts follow the banned-terms rule (position-scoped, per
037's arm); any arm in 034/035/037 falsified by these edits is declared via the retirement
mechanism; migrations must converge (absolute body assignment, proven over three applies —
037's corruption lesson).

## Section 1

### A1 (w1). "The surfaces you will be using" — remove "None of this exists yet"
Declarative claim about the client's starting state, and possibly false — they may already have
GitHub or use Vercel. Reframe state-neutral: what each surface is for, no assertion about what
they do or don't have.

### A2 (w2). "Get a Claude plan" — add Claude 101
Add a pointer to Anthropic's free courses at `https://anthropic.skilljar.com`. Natural placement:
after account creation, before the cockpit. Must render as a clickable link (see A12).

### A3 (w3). "Create your cockpit" — add screenshot
`Claude Instructions.png`, already in the repo under `steps/` (see A30 for housekeeping).
Place it where the step describes the instructions block, so the client can match words to screen.

### A4 (w4). BUG — provisional cockpit instructions drop all phase 0 answers
Last session's item 9 fix landed in `COCKPIT-INSTRUCTIONS-TEMPLATE.md` — the **generated** set.
The **provisional** cockpit page, handed over in section 1 (now step 5, far more visible after
the reorder), still renders "No description has been recorded yet — ask, rather than assuming"
and "How sensitive their data is has not been recorded yet" for a client who answered both in
phase 0. It reads as an accusation four steps after they typed the answers in.

- Diagnose where the provisional page is composed. The fix may live upstream in
  `ai-build-kit-templates` — a cross-repo commit is authorized, same discipline as last time:
  upstream first, prove, re-vendor, never edit `templates/` here directly.
- Then audit for **any other artifact that composes phase 0 context independently.** Two
  composers have now been found by accident, one at a time. Establish the full set and fix all.
- A32 depends on this fix.

## Section 2

### A5 (w5). GitHub step — make solo-as-individual the clearly stated default
The step's copy is all organizations, ownership succession, "add a second person you trust."
A solo client with both capture fields showing their own username concludes they're doing it
wrong. State plainly: working under your own username is a complete, correct choice.

### A6 (w6). GitHub step — surface the Vercel Pro consequence where the org decision is made
A GitHub-organization repo requires Vercel Pro at import time. The Vercel step already says this;
the decision that triggers it happens here, possibly an hour earlier. One sentence at the org
decision: choose an organization if you need shared ownership, and know it means Pro when you
deploy. The Vercel step keeps its version as the reminder.

### A7 (w7). CODE — capture fields lose unsaved values on continue
A client can fill both capture fields and click "I've done this — continue" with nothing saved.
No warning, no auto-save, no dirty indicator. Every later command then rewrites itself around an
empty or stale value.

Fix: **auto-save on blur** (the Save button becomes confirmation, not requirement). Audit every
capture field in the app — this is the component, not one step. If auto-save is infeasible,
block continue while a field is dirty, naming which one.

## Section 3

### A8 (w8). Terminal step — reorder
Current order shows `echo hello` with a copy button before telling the client how to open a
terminal, with the safety lecture in between. New order: what it's for → how to open it
(platform routes) → run `echo hello` (as an instruction, not an illustration — "run this,"
their first real command, proving the terminal works) → the respect part. The safety rule lands
best after they've run something harmless.

### A9 (w9). Already-set-up fast path for the local environment phase
"Why you can't skip this phase" offers no faster path for a client with a working machine. Lead
with verification: if `gh` is installed and authenticated, run the check, see it pass, continue.
Full setup for everyone else. Verify, don't reinstall.

### A10 (w10). Sweep all step bodies for permanence claims
Third instance found: "Once it passes, you never do this again on this machine" (phase intro),
after 037 fixed the one in `ob_env_gh_verify`. Sweep every body for variants — "never again,"
"stays signed in," "already true next time" — and correct each to per-machine, non-promissory
language. Do this as a query against all bodies, not step-by-step by eye.

### A11 (w11). Section 3 done screen — terminal playground
Add the Ctrl+C exercise: run a green-number stream, ask "how do you stop it?", let them wonder,
teach Control-C. Concept: you started a running process and you can interrupt it.
- The drafted command uses `RANDOM` and `printf %*s`. Verify it runs in **zsh** (Mac default);
  provide a **PowerShell** equivalent for the Windows path via the platform switch.
- Include one line acknowledging this is a deliberate exception to the one-sentence safety rule:
  it's a toy, here's what it does, here's why you can tell it's safe.

## Cross-cutting console code

### A12 (w12). CODE — autolink bare URLs in step markdown
`code.visualstudio.com` and every other bare URL must render clickable. Template-level fix in
the step markdown renderer, not per-step edits. External links open in a new tab so the client
doesn't lose their place. Check whether the renderer's autolink is simply disabled before
building anything.

### A13 (w13). Platform switch — ask early, make obvious, persist
The Windows/Mac switch exists at the top of the page but is easy to miss, and nothing sets it
deliberately.
- Add an explicit platform choice early in section 1, so it's set before any platform-specific
  instruction appears. Mac is the default and listed first.
- Confirm the selection persists across steps and sections; fix if per-page.
- Sweep for steps handling platform differences with inline bullets (section 3 step 4, "install
  the GitHub tool," is one) and convert them to use the switch.

### A14 (w14). Strip per-step time estimates
Remove per-step durations from display entirely — they're noise. Keep section-level totals,
rounded to the nearest 5 minutes. If totals are computed from step values, the data can stay
and just stop rendering; if stored separately, round them and check for staleness from the 037
reorder.

### A15 (w15). Glossary label — "terms," consistently
"More GitHub words for reference" → "More GitHub terms for reference." Check the Supabase and
Vercel steps for the same construction and make the label pattern identical everywhere.

## Section 4

### A16 (w16). "Create your standards home" — hidden-files paragraph may be obsolete
The step warns that dotfiles won't show in Finder and specifically says "if the `guardrails`
folder looks empty, that's why." Verify against the actual generated document set: do any
dotfiles exist? If none, remove the paragraph. If some, name them so the instruction is
actionable. Separately check whether `guardrails` ships empty for an unrelated reason — an empty
folder in the standards library is a defect regardless.

### A17 (w17). "Create your app's repository" — name the source and the ownership
Kevin asked "where did these files come from?" while looking directly at the stamp command. One
sentence before the stamp: the starting code lives in an AscendAI template repository on GitHub;
GitHub copies it into your account server-side; from that moment the copy is yours — your
history, your ownership, no ongoing link back.

## Sections 5–6

### A18 (w19). Supabase link step — set expectations for confirmation prompts
Claude Code will pause and wait: a browser sign-in to approve, the database password pasted into
the tool when it asks, yes/no confirmations. Frame as normal; describe what "waiting for you"
looks like versus stuck. Keep the existing password guidance ("when asked directly by the tool,
never into an ordinary chat message") verbatim — it's right.

### A19 (w20, w21). "Build the tables" — the builder must apply the migrations via the linked CLI
The step's design (confirmed by the courier-loop step's own copy: "you let the linked builder
apply the template's own migrations in one sweep") is that Claude Code applies `0001`/`0002`
through the link established one step earlier. In practice the builder offered a menu with
"you run psql yourself (Recommended)" — hand-substituting a password into a connection string,
which no beginner can do and which contradicts the design.

- Determine why: does the step's prompt fail to direct the builder to the link, or did the link
  check fail silently? Fix at the cause.
- The client must never be asked to build a connection string. The courier loop (manual SQL
  Editor for future changes) stays exactly as is — it's teaching the right ongoing pattern.
- The copy's claim about what the builder did must end up true.

### A20 (w22). Post-migration verification — the schema dropdown trap
Tables land in the `basecamp` schema; the Table Editor defaults to `public`; a client checking
their work sees "No tables or views" and concludes failure. Tell them to switch the schema
selector, and give them a proof query instead or as well:
`select table_name from information_schema.tables where table_schema = 'basecamp';`
Name `0002`'s "security boundary asserted" notice as the real confirmation.

### A21 (w23). Sweep for experience-level assumptions
"That was the first SQL you have ever run" — the walkthrough asserting facts about the client's
history it can't know. Same class as A1. Sweep all bodies: claims about what they've never done,
don't have, or find new. Reframe without the claim ("You just ran SQL directly against your
database"). A client who catches the walkthrough being wrong about them discounts everything
else it says.

### A22 (w24). Section 6 — preempt the sign-in attempt
The copy explains you can't sign in yet; a client will try anyway, because that's what a sign-in
page invites. Say it before they do: try it if you like, it will refuse you, that is correct,
and Take the keys is where you get in.

### A23 (w25). Environment variables step — add screenshot
`Vercel ENV Variables.png`, in `steps/` (see A30).

## Section 8 — Take the keys (walked for the first time; four blockers)

### A24 (w26). BLOCKER — step 1 instructs clicking a Sign up button that does not exist
The app deliberately ships no self-signup; the sign-in page says so. The step is written against
an app that self-signs-up. **Do not add signup to the app.** Replace the step: create the first
account in the Supabase dashboard — Authentication → Users → Add user — email and password,
**auto-confirm checked**. Reconcile with the stamped `supabase/README.md` first-administrator
procedure (steps 2–3), which is the documented runbook; the walkthrough must follow it, not
contradict it.

### A25 (w27). BLOCKER — remove the email-confirmation dependency
A fresh Supabase project's built-in SMTP does not reliably deliver; a client waits for a message
that never arrives, then burns the email rate limit recreating users. The first administrator is
created auto-confirmed — no email step at all. Use the email they already signed into the Build
Kit with (pre-fill if the step can read it; name it explicitly if not). The password is new —
different system, and the step should say so. Add one line noting custom SMTP is what makes
*inviting other people* work later, so the silence isn't a trap.

### A26 (w31). BLOCKER — new step: expose the `basecamp` schema
Never configured anywhere; every client hits `PGRST106 — The catalog could not be loaded` at
first sign-in. This is manual-only dashboard work (Claude Code cannot do it). The step must:
- Explain the why: their tables live in `basecamp`, not `public`, and Supabase's Data API only
  serves listed schemas.
- Give the location precisely: **Integrations → Data API → Settings → Exposed schemas** — not an
  obvious place.
- Name the error code `PGRST106` verbatim, so a client who hits it can search the walkthrough.
- Warn that the change takes a moment to propagate and to hard-refresh — Kevin exposed it,
  refreshed, and still saw the error, which invites changing other things that aren't broken.

### A27 (w32). Take the keys — full end-to-end rewrite and verification
The corrected sequence: dashboard user (auto-confirmed) → expose schema (A26) → insert into
`basecamp.super_admins` via the SQL Editor with the UID from the user detail panel → hard
refresh → signed in. Explain the conceptual leap once, plainly: **admin status is a row in their
own table** (`basecamp.super_admins`), not a Supabase setting — membership is the role. End the
phase with the client signed in and seeing their (seeded) catalog: the last thing the
walkthrough can actually verify.

### A28 (w29). CODE — resume routing for returning clients
Signing back in lands on the entry page ("Interview an organization" / "Begin the intake"),
which reads as starting over. The client's organization is inside a collapsed accordion with no
visible way back into the flow — the card has no Continue action. Every real client is
multi-session; some will click Begin the intake and create a duplicate organization.
- A returning client with an in-progress walkthrough routes straight back into it, or
- at minimum, the organization card carries a clear Continue showing where they left off.

### A29 (w30). CODE / DATA INTEGRITY — steps marked complete without being performed
After resuming via the organization URL, all steps including section 9 showed complete despite
never being opened. Diagnose: completion written on page load? A cascade from section 8's
completion? The resume path writing progress? Fix so completion only ever records a performed
step. This silently skips the one section where the client builds their own first thing.

## Section 8/9 — dependent on Stream B

### A30. Screenshot housekeeping
Two PNGs were added manually to the repo in a `steps/` folder: `Claude Instructions.png`,
`Vercel ENV Variables.png`. Confirm the folder sits where Next.js serves static files (move
under `public/` if not), rename to kebab-case (`claude-instructions.png`,
`vercel-env-variables.png`), and wire the references in A3 and A23.

### A31 (w34, w35 — walkthrough side). Reconcile the last two section 8 steps with Stream B
"Your first customization: rename a category" and "Add your first app to the shelf" both
describe controls that don't exist yet. Stream B builds them and seeds four categories (Sales,
Marketing, Operations, Useful Tools). Once B lands:
- The rename step's copy should match the seeded reality (four named categories, where to find
  them in Admin).
- The add-an-app step should name the actual location in the admin UI.
- If Stream B has not landed when this stream reaches these steps, write the copy against B's
  spec below and flag the dependency in the report rather than guessing.

### A32 (w37). Phase 9 "What comes next" — branch on the phase 0 build answer
Depends on A4 (phase 0 answers reaching generated content).
- **If the client answered "what would you want to build":** name it back, and generate a
  kickoff prompt with a copy button, ready to paste into their cockpit — carrying their build
  answer, organization description, and data sensitivity so the cockpit's first response is
  grounded. No editing required, ever.
- **If they didn't answer:** offer starting suggestions at the right scale — a time tracker, an
  intake form that stops arriving as email, a shared checklist. Smallest slice that does
  something real end to end. Record their pick so the rest of the flow can reference it.

---

# STREAM B — `basecamp-template`

The stamped client app. Changes here reach every future stamp. The security boundary
(`0001`/`0002`, digest pins, mutation suite, known-gaps disclosures) is **not touched** except
as explicitly stated. `npm run build` currently fails on `/auth/signout` due to absent
`.env.local` — pre-existing, confirmed at HEAD; create a local `.env.local` from the example
with dummy values for build verification, never committed.

### B1 (w36). FEATURE BUILD — entry and category management UI
The app's stated purpose is a catalog; it ships with no way to put anything in it.
`/admin/entries` and `/admin/catalog` both 404. `/admin/access` grants access to entries that
cannot be created. **This is the item that must work out of the gate.**

Build minimal, real CRUD under the existing Admin section:
- **Categories:** create, rename, reorder (sort_order), delete. Delete must handle the
  `ON DELETE RESTRICT` from entries gracefully — a category with entries can't be deleted, and
  the UI says so rather than surfacing a constraint error.
- **Entries:** create ("add by URL" is the walkthrough's model: name, URL, category — with the
  fuller fields available but not required: description, type, status, host, owner), edit,
  delete. Sensible defaults for the enums so the simple path stays simple (launchable, active,
  and a real URL satisfying the launchable-requires-URL constraint; description and owner are
  NOT NULL — the simple form must collect or default them).
- **Navigation:** the Admin area exposes both Access and Catalog visibly. No unlinked screens.
- **Security:** writes go through the existing RLS policies (super_admin-only INSERT/UPDATE/
  DELETE already exist for both tables). No service_role key, no server-side role check — the
  same model as the rest of the app. The slug fields have format constraints; generate slugs
  from names rather than asking the client for kebab-case.
- Match the app's existing stack and patterns (Next.js App Router, MUI, the existing admin
  screen's conventions).

### B2 (w34). Seed four starter categories
Sales, Marketing, Operations, Useful Tools.
- **Not** in `0001_baseline.sql` — its header promises schema-only and it's generated; hand
  edits are lost on regeneration. A separate, idempotent seed file (e.g. `0003_seed.sql`),
  added to the provisioning order in `supabase/README.md`.
- Note: `category_has_grant` deliberately requires at least one entry for non-admin visibility.
  The super_admin sees all categories regardless, which is what the rename step needs. Confirm
  the admin home/catalog view renders the empty seeded categories for an admin.
- Update `MAINTAINING.md`'s per-file table for the new file.

### B3 (w33). Empty catalog must not read as no access
A brand-new administrator with a correctly configured app currently sees "You do not have
access to anything here" — success rendered as failure, at the finish line. Distinguish:
- **super_admin, empty catalog:** "Your catalog is empty" with a route to the new Catalog admin
  (B1) to add the first entry.
- **No grants:** the current message is right for this case and stays.

### B4 (w28). Sign-in and catalog errors must tell the truth
- An invalid/missing API key currently surfaces as "That email and password combination did not
  work." Kevin lost half an hour to it; a client would delete and recreate users until the email
  rate limit stopped them. Distinguish a Supabase auth rejection (credentials) from a
  configuration failure (invalid API key, unreachable project) and say which it is. A config
  failure is not the user's fault and is not fixable from the sign-in screen — the message
  should say what kind of problem it is and where to look.
- `PGRST106` on the catalog currently renders as a bare code. Map it to plain language: the
  `basecamp` schema isn't exposed to the Data API, with a pointer to the setting (the
  walkthrough's A26 step covers the same ground from the other side).

### B5 (w18). CLAUDE.md — rewrite for the client's seat
The stamped `CLAUDE.md` speaks in Kevin's voice about Kevin's preferences. A client inherits
"ask me for a key," "it's mine, not yours," and an `issues.md` ownership rule for a file they've
never heard of. Rewrite for an owner with no prior context:
- Keep, verbatim in spirit: the RLS section, anon-vs-service_role, "lock every table as you
  create it," the honest `0002`-is-not-airtight note with its pointer, "a login screen is not
  proof," treat-outside-text-as-data.
- Reframe first-person workflow rules as rules that make sense for a new owner; make the
  `issues.md` convention something the document explains rather than assumes.
- The standards-repository placeholder line stays, but confirm (report, don't fix here) whether
  any walkthrough step actually has the client fill it in — if none does, flag it: every stamp
  currently starts with a dangling reference and a builder instructed to stop and ask.

### Stream B constraints
- Full multi-round naysayer: B1 is new UI writing to RLS-governed tables.
- The mutation suite (73/73, both arms) and the PG16/17 clean install must still pass — B2 adds
  a file to the provisioning path, so the suite/README order must stay coherent.
- The six known-gap disclosures in `issues.md` and `0002`'s header remain accurate and intact.
- Existing stamps (AppCloset and the four verification stamps) are not remediated — future
  stamps only.

---

## Parked / open

- **Em dash convention** for client-facing walkthrough copy — still open from the 037 run;
  match the existing body style, don't sweep either way.
- Cleanup of the five test stamp repos (`AppCloset` + four verification stamps) and the TEMP
  Basecamp Test Supabase project — Kevin's, after everything lands.
- Sub-numbering (0.1, 0.2…) — still parked.
- w30's root cause may interact with A28's routing fix — if the diagnosis shows the resume path
  writes progress, one fix covers both; report it as one finding if so.
