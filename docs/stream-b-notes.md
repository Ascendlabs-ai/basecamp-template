<!--
  MAINTAINER DOCUMENT — not part of the application.

  This records why the "Stream B" work in this repository's history exists, for
  whoever next touches the Catalog admin, the starter categories, or the
  sign-in/catalog error messages. It replaces an earlier walkthrough-specific
  spec that named a person and a specific test deployment; nothing here does.

  If you stamped this template, you can delete this file, exactly as you can
  delete MAINTAINING.md. Nothing in the app reads it.
-->

# Why Stream B was built

An end-to-end walkthrough — stamp the template, provision Supabase, deploy to Vercel, reach a
working signed-in app — turned up gaps that would block every client. This repository's share of
the fix covers four things:

1. **Entry and category management UI.** The app's stated purpose is a catalog, but it shipped
   with no way to put anything in it (`/admin/entries` and `/admin/catalog` both 404'd).
   Minimal CRUD for categories and entries now lives under the Admin section, writing through the
   same RLS policies as the rest of the app — no service_role key, no server-side role check.
2. **Seed categories.** Four starter categories (Sales, Marketing, Operations, Useful Tools),
   shipped as their own idempotent migration rather than hand-edited into the schema baseline,
   since the baseline is regenerated and hand edits to it are lost.
3. **Honest empty states.** A super_admin signing into a freshly provisioned, correctly
   configured app was seeing "you do not have access to anything here" — success rendered as
   failure. That case is now distinguished from an account that genuinely has no grants.
4. **Honest sign-in and catalog errors.** A misconfigured Supabase API key was surfacing as a
   wrong-password message, and a Postgrest schema-exposure error was rendering as a bare error
   code. Both now say what actually went wrong and where to look.

The security boundary (`0001`/`0002_security_boundary.sql`, the digest pins, the mutation suite)
was not touched by this work except where explicitly required.
