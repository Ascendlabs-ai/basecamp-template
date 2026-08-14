/**
 * The one place to rebrand this app.
 *
 * Everything user-visible that names the product or the organisation reads from
 * here, so a client fork changes these two constants and the placeholder mark in
 * `src/components/Logo.tsx` — and nothing else.
 *
 * `APP_NAME` is the product ("Basecamp"). Rename it if you want; nothing in the
 * database or the auth layer depends on the string.
 *
 * `ORG_NAME` is whose catalog this is. It reaches the screen only through
 * `CATALOG_HEADING` below — it is not read anywhere else, so setting it alone
 * changes nothing unless the heading interpolates it.
 */
export const APP_NAME = "Basecamp";

export const ORG_NAME = "your organisation";

/**
 * Home page heading. Kept here so the phrasing is a branding decision, not a
 * code edit — and composed from ORG_NAME rather than hardcoded, so that constant
 * has exactly one job and doing that job is visible.
 *
 * Replace the whole string if you prefer something that does not name the org
 * ("Everything we run" was the previous default).
 */
export const CATALOG_HEADING = `Everything ${ORG_NAME} runs`;

/** One-line description used in metadata and on the sign-in card. */
export const CATALOG_TAGLINE =
  "The catalog of every app, tool and automation your team runs.";
