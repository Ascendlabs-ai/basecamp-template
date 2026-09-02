/**
 * The pure logic behind the admin API routes.
 *
 * In `src/lib` for the reason `adminAccess.ts` and `auditText.ts` give: the test
 * suite globs `src/**` but only this layer carries tests, so anything left
 * inside a route handler is structurally untestable. And this IS logic — a
 * wrong branch in `buildSignInUrl` hands someone a URL that consumes their
 * one-time token, and a wrong branch in `isAlreadyRegistered` silently creates
 * a duplicate path for an existing account.
 */

/** The two link kinds this app issues. Mirrors Supabase's `generateLink` types. */
export type LinkKind = "invite" | "recovery";

/**
 * Build the URL an administrator hands over.
 *
 * WHY NOT `properties.action_link`, WHICH SUPABASE ALSO RETURNS. That URL points
 * at Supabase's `/auth/v1/verify` endpoint, which verifies the token ON GET and
 * then redirects. One-time tokens are consumed by that GET — so any preview
 * fetch of the link burns it before the person ever clicks: a chat app
 * unfurling it, a mail scanner, a corporate link-rewriter, or the
 * administrator's own browser prefetching a hovered link. The person then gets
 * "token has expired or is invalid" on a link nobody used.
 *
 * The token hash travels to our own `/auth/confirm` instead, which renders a
 * button and verifies only on click. Same token, one deliberate consumer.
 *
 * IN THE FRAGMENT, NOT THE QUERY STRING. A query string is sent to the server
 * on every request, so a token placed there is written verbatim into the
 * hosting platform's access logs, any reverse proxy's logs, and any log drain —
 * every time the link is opened. That defeats the rule that a sign-in link is a
 * credential and never reaches a log. Fragments are never transmitted to any
 * server; only the browser sees them — which is also how Supabase's own recovery
 * links carry their token.
 *
 * The consequence is that `/auth/confirm` cannot read the token server-side at
 * all — which is fine, because it must not verify on load anyway.
 *
 * `origin` is passed in rather than read from env: the correct value is the
 * origin the ADMINISTRATOR is currently on, so a link generated from a preview
 * deployment points back at that preview rather than at production.
 */
export function buildSignInUrl(origin: string, hashedToken: string, kind: LinkKind): string {
  const url = new URL("/auth/confirm", origin);
  // Built with URLSearchParams so a token containing `&` or `#` is encoded
  // rather than truncating the fragment.
  const fragment = new URLSearchParams({ token_hash: hashedToken, type: kind });
  url.hash = fragment.toString();
  return url.toString();
}

/**
 * Read back what `buildSignInUrl` wrote, from `window.location.hash`.
 *
 * Lives here beside the writer so the two cannot drift — a mismatch would make
 * every link silently unusable, which is the least debuggable failure this
 * feature has.
 */
export function parseSignInFragment(hash: string): { token: string; kind: LinkKind } | null {
  const params = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);
  const token = params.get("token_hash");
  const type = params.get("type");
  if (!token) return null;
  if (type !== "invite" && type !== "recovery") return null;
  return { token, kind: type };
}

/**
 * Is this address shaped like an email?
 *
 * Deliberately permissive. The authority on whether an address is acceptable is
 * GoTrue, which will refuse what it refuses; this exists to catch the typo that
 * would otherwise cost a round trip, not to re-implement RFC 5322. Rejecting a
 * valid-but-unusual address here would be worse than accepting an invalid one,
 * because the database's refusal is visible and this function's is not.
 */
export function isEmailShaped(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 254) return false;
  if (/\s/.test(trimmed)) return false;
  const at = trimmed.indexOf("@");
  if (at < 1 || at !== trimmed.lastIndexOf("@")) return false;
  const domain = trimmed.slice(at + 1);
  return domain.includes(".") && !domain.startsWith(".") && !domain.endsWith(".");
}

/** Normalize before sending to GoTrue, which lowercases addresses itself. */
export function normaliseEmail(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Did `generateLink({type:'invite'})` fail because the person already exists?
 *
 * This is a NORMAL outcome, not an error: an administrator adding someone who
 * already has an account almost always means "this person needs a link", and
 * the route falls through to a recovery link rather than reporting a failure
 * they would have to interpret.
 *
 * Both the code and the message are checked. `email_exists` is the current
 * GoTrue code, but this path is the difference between onboarding working and
 * an administrator seeing an opaque 422, so it does not rest on one field
 * staying stable across a Supabase upgrade.
 */
export function isAlreadyRegistered(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  if (error.code === "email_exists" || error.code === "user_already_exists") return true;
  const message = (error.message ?? "").toLowerCase();
  return message.includes("already been registered") || message.includes("already registered");
}

/**
 * Turn the ban switch into GoTrue's `ban_duration`.
 *
 * '876000h' is a hundred years — GoTrue has no "forever", so the idiom is a
 * duration nobody outlives. 'none' is the documented clear value; the empty
 * string and null both leave the ban in place, which would make an unban button
 * that silently does nothing.
 */
export function banDuration(banned: boolean): string {
  return banned ? "876000h" : "none";
}
