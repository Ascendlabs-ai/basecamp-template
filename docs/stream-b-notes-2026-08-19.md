<!--
  MAINTAINER DOCUMENT — not part of the application.

  This records why the 2026-08-19 changes to the security boundary's digest
  pins, its mutation suite, and CLAUDE.md's `.env.local` policy exist. It is
  written from a walkthrough spec that named individuals and an organisation;
  the technical findings are kept and nothing identifying is, exactly as
  `stream-b-notes.md` did before it.

  If you stamped this template, you can delete this file, exactly as you can
  delete MAINTAINING.md. Nothing in the app reads it.
-->

# Why the digest normalization, the Editor-path arm, and the `.env.local` rewrite exist

Three findings came out of an end-to-end provisioning walkthrough. Each one stopped real
work, and each fix here is aimed at the specific thing that stopped it.

## 1. `0002` refused a correct install, because of line endings

`0001_baseline.sql` applied cleanly in the Supabase SQL Editor and `0002_security_boundary.sql`
then refused, reporting that `is_super_admin`'s body differed from the one the template ships.
Nothing was wrong with the database: no boundary, no first administrator and no login, at the
last step of an otherwise finished setup.

Two explanations were possible and they call for opposite fixes:

- **Stale pins** — a commit had changed a `0001` function body without re-deriving `0002`'s
  digests, so the template shipped broken from HEAD.
- **CRLF** — the Editor/clipboard route stores carriage returns in the function bodies that the
  template's own file does not have, so every digest misses.

It is CRLF, and the pins were never stale. Applying HEAD's `0001` over an LF path reproduces all
seven pinned digests exactly and `0002` commits; applying the identical file with CRLF line
endings stores `\r` in `prosrc` and all seven digests miss, with the exact error the walkthrough
hit.

The fix normalizes line endings on both sides of the comparison — mapping CRLF and lone CR to LF
before hashing, in `0002` and in every documented re-derivation query. The pinned constants did
not change, because normalizing LF text is a no-op.

**Mapping to LF, not deleting the carriage returns.** Deleting them is shorter and also fixes the
bug, and it is a hole: a carriage return is insignificant to SQL only *outside* a string literal.
`log_access_change` chooses what the audit log records with `then 'grant' else 'revoke'`. A body
carrying `'gr<CR>ant'` writes a different value into `access_audit` forever, and under
delete-the-CRs it hashes identically to the shipped body and commits. `0002` explains this at the
pin, and the suite has one case whose only job is to fail if anyone simplifies it.

## 2. The mutation suite could not have caught it

The suite proved the boundary against `psql -f` on LF files — the maintainer's route. Clients
paste both files into the SQL Editor. A full green run said nothing whatsoever about that route,
and stayed green on the commit that broke it.

PART 12 applies both migrations the way a client does: CRLF, whole file, one statement. It is
counted separately from the psql arm so a lost arm cannot hide inside a plausible-looking total.
Against the pre-fix `0002` the arm goes red; the psql arm reads unchanged either way, which is the
demonstration that the old coverage could not have found this.

The arm is a transport mimic, not the Editor: no browser, no HTTP, no pg_meta, no Supabase role
switching. It catches the byte-level and transaction-shape classes and says so in its header.

## 3. The `.env.local` rule stopped the work it existed to protect

CLAUDE.md said *"If you need a key, ask the owner for it rather than writing one into a file."*
Read as covering `.env.local` itself, that refuses to create the file the setup requires, and there
is no way forward from inside the rule — the build cannot start and the rule forbids the fix.

The policy now says what it means: create the file from the example when it is absent, write the
non-sensitive values, never write or echo the `service_role` key or the database password, never
overwrite an existing file, and check which key you were handed rather than trusting the label.

**This is not yet runnable, and the reason is recorded in CLAUDE.md and `issues.md`.** This
repository's `.claude/settings.json` denies reading `.env.*`, and that deny covers the Read tool,
Write, and any shell command naming the path — including `.env.local.example`. Until the deny is
narrowed, the policy describes something the builder cannot do, which is the same dead end one
layer down.

## What was deliberately not changed

The empty-catalog panel already points at Admin → Catalog and was left alone. The catalog
visibility filter was not touched. `0002`'s executable behaviour changed by exactly one
expression — the digest input — and every assertion it makes is otherwise unchanged.


## Appendix — the `.claude/settings.json` change this needs

Proposed, not applied: `.claude/` belongs to the owner. Today's rule is

```json
"deny": ["Read(./.env)", "Read(./.env.*)", "Read(./**/.env)", ...]
```

`Read(./.env.*)` is the problem, and it fails in two ways at once. It matches
`.env.local.example`, so the builder cannot read the template it is told to copy from; and a
`Read` deny also blocks `Write` and any shell command naming the path, so it cannot create
`.env.local` or even test whether the file exists. The narrowest replacement:

```json
"deny": [
  "Read(./.env)",
  "Read(./**/.env)",
  "Read(./secrets/**)",
  "Read(./**/*.pem)",
  "Read(./**/id_rsa)"
],
"ask": [
  "Read(./.env.local)",
  "Write(./.env.local)",
  "Edit(./.env.local)"
]
```

What each part buys:

- **Dropping `Read(./.env.*)`** makes `.env.local.example` readable. It is a committed file with
  no values in it, and nothing is protected by hiding it.
- **`.env.local` moves from `deny` to `ask`.** Creating and filling it becomes possible with one
  approval, and a read of a populated file becomes a prompt the owner sees — which is exactly the
  moment a stray `cat` should be caught.
- **`.env` and nested `.env` stay denied outright.** This project does not use them, so there is
  no cost to leaving them hard-blocked.

**Be clear about what this trades.** `deny` is "impossible"; `ask` is "the owner is asked". That
is a real reduction, and it is the price of the builder being able to do the step at all. Two
things still stand behind it: the `secret-write` hook prompts on any write whose content looks
like a key, and `.gitignore` keeps `.env.local` out of history either way. If the owner would
rather keep reads absolutely impossible, the alternative is to leave `Read(./.env.local)` in
`deny` and accept that a person creates and fills the file — which restores the manual step this
policy exists to remove, and should then be said plainly in CLAUDE.md rather than left implied.

One caveat: `ask` needs an interactive session. A headless or scheduled run fails closed on these
paths rather than proceeding, which is the right direction but worth knowing before it surprises
someone in CI.
