/**
 * Plain language for the PostgREST failures a client can actually hit, and
 * silence for the ones they cannot act on.
 *
 * THE FAILURE THIS EXISTS FOR. A freshly provisioned Supabase project does not
 * serve the `basecamp` schema through its Data API until somebody adds it to a
 * setting in the dashboard. Until they do, every read in this app answers
 * `PGRST106`, and the catalog rendered a bare `Error PGRST106`. That is a code
 * with no verb in it: it does not say what is wrong, that it is a project
 * setting rather than a fault in the app, or where the setting lives. It is the
 * first thing a brand-new administrator sees, and it stops the app dead.
 *
 * WHY IT IS NOT SIMPLY "SHOW THE POSTGREST MESSAGE". The pages that call this
 * deliberately keep server-side detail out of the browser: on a Supabase project
 * shared with client-facing apps, any of their customers holds credentials that
 * reach the same error branch, and PostgREST's own message carries schema names
 * and hints. So this maps a KNOWN code to a sentence written for this app, and
 * returns `null` for everything else — the caller then falls back to the bare
 * code, which is what lets an operator tell 42501 from PGRST301 without a log
 * dive. Adding a case here is a decision to disclose something; make it
 * deliberately.
 *
 * `PGRST106` is safe to spell out precisely because it is not user-specific.
 * When it fires, it fires for everybody including the owner — nobody is signed
 * in and seeing someone else's data, because nobody can read anything at all.
 * The `basecamp` schema name is already public in this template, and the
 * remedy is a setting only the project owner can reach.
 */

/** The shape both supabase-js `PostgrestError` and `AuthError` satisfy. */
type CodedError = { code?: string; message?: string } | null | undefined;

/**
 * The exposed-schemas setting, named exactly as the dashboard labels it.
 *
 * Kept as a constant because `supabase/README.md` step 0 gives the same path and
 * the two must not drift — a client following a message to a menu that is not
 * there is worse off than one following a code to a search engine.
 */
export const EXPOSED_SCHEMAS_LOCATION =
  "Supabase Dashboard → Project Settings → API → Exposed schemas";

/**
 * A sentence for a read failure, or `null` to leave the caller's bare-code
 * fallback in place.
 */
export function explainReadError(error: CodedError): string | null {
  if (!error?.code) return null;

  switch (error.code) {
    case "PGRST106":
      // Named in full — code AND remedy. The code stays in the sentence on
      // purpose: it is the string a client will paste into a search box or find
      // in the walkthrough, and dropping it to sound friendlier would cost them
      // the one term that connects this screen to the instructions.
      return (
        `PGRST106 — the database is fine, but the \`basecamp\` schema is not being served ` +
        `to the API yet. Add it under ${EXPOSED_SCHEMAS_LOCATION}, then hard-refresh this page. ` +
        `The change takes a moment to propagate, so a refresh straight away can still show this.`
      );
    default:
      return null;
  }
}
