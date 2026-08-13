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
 * `ORG_NAME` is whose catalog this is. It appears on the home heading and the
 * sign-in page.
 */
export const APP_NAME = "Basecamp";

export const ORG_NAME = "your organisation";

/** Home page heading. Kept here so the phrasing is a branding decision, not a code edit. */
export const CATALOG_HEADING = "Everything we run";

/** One-line description used in metadata and on the sign-in card. */
export const CATALOG_TAGLINE =
  "The catalog of every app, tool and automation your team runs.";
