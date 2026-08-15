# How your safety net works

AI Build Kit installed a couple of automatic helpers that run in the background every
time your AI assistant does something. You don't need to configure them. This page
just explains what they do, so nothing feels like magic (or a mystery) when it
fires.

## 1. The safety guard

Before the agent runs a command or writes a file, this checks it. Most of the
time you'll never notice it — it only speaks up for genuinely dangerous things,
and it splits them into two levels:

**Hard stop (the agent is blocked, and told what to do instead).** These are
things that are catastrophic and can't be undone:

- Deleting your whole project, home folder, or drive (`rm -rf /`, `rm -rf ~`, …)
- Running an install script downloaded straight off the internet (`curl … | bash`)
- Committing your `.env` secrets file to git (once pushed, those keys are leaked)
- Hard-force-pushing over a shared branch like `main` (erases other people's work)
- Destroying a database (`DROP TABLE`, `TRUNCATE`)

**Speed bump (it asks you first).** These are legitimate but worth a second look:

- Deploying to a live/production environment — real users see it immediately
- Deleting a folder recursively, or throwing away un-saved work
- Writing a file that looks like it has a real API key hardcoded in it

When you get an "ask," you're in control: approve it if you meant it. The guard
exists so a slip never becomes a disaster, not to slow you down.

> Need to turn one rule off? Create `.claude/basecamp.json` with, e.g.,
> `{ "disable": ["deploy"] }`. Options: `remote-exec`, `sudo-rm`, `rm-rf`, `sql`,
> `force-push`, `discard`, `env-commit`, `chmod`, `deploy`, `secret-write`.
> You can also set `protected_branches` and `deploy_command_patterns`.

## 2. The review you can ask for

AI Build Kit ships a reviewer called **naysayer**. Say **"run /naysayer"** and a
demanding-but-fair reviewer reads exactly what changed, looks for real problems
(crashes, security holes, logic bugs, sloppy structure), and tells you in plain
language what it found — leading with whether anything would actually break for a
user. It reviews; it doesn't fix. Ask for the fixes after, and run it again if you
want another look.

**It's a tool, not a toll gate.** It doesn't run on its own and it doesn't block
your commits. Reach for it when the change is bigger than usual, when you're about
to put something in front of real people, or any time you just want a second pair
of eyes.

The habit that catches more than any review does is simpler: **open the thing and
click it.** Watch it do what you asked before you call it done. See
`HOW-TO-BUILD.md`.

> This project ships with `.claude/basecamp.json` → `{ "disable": ["naysayer"] }`,
> which is what keeps the review advisory instead of automatic. The safety guard
> above is unaffected by that setting.

## 3. The auto-formatter

After the agent writes a file, if your project has a formatter set up
(Biome, Prettier, or Ruff), it tidies the file automatically — consistent spacing,
quotes, and layout — so your code stays clean without you thinking about it. If no
formatter is set up, it does nothing. It never blocks and never changes what your
code *does*, only how it looks.

---

All of these live in `.claude/`. They're plain files you own — nothing phones
home, nothing runs in the cloud. AI Build Kit support can update them for you as best
practices evolve.
