/**
 * What counts as an acceptable new password, in one place.
 *
 * ONE SCREEN SETS PASSWORDS: `/accept-invite`, where somebody following an
 * administrator's issued link chooses their first. It shared this file with a
 * self-service reset form that has since been removed, and when the two
 * existed each carried its own `const MIN_LENGTH = 8` and its own copies of the
 * same two messages — agreeing on 8 by coincidence rather than by construction,
 * so raising the minimum fixed one screen and silently not the other. The rule
 * stays here with one caller so the next password screen has nowhere else to
 * put it.
 *
 * In `src/lib` rather than beside either form for the reason `adminAccess.ts`
 * and `auditText.ts` give: the test suite globs `src/**` but only this layer
 * carries tests, so a rule left inside a component is structurally untestable.
 * And this is a rule, not glue — it decides whether a credential is allowed to
 * exist.
 *
 * THE DATABASE IS STILL THE AUTHORITY. Supabase enforces its own minimum and
 * whatever strength requirements the project sets, and `updateUser` will refuse
 * what it refuses. This exists to say so before a round trip, and to say it the
 * same way wherever a password is chosen.
 */

/** Supabase's own default floor. Raise it here and every password screen follows. */
export const MIN_PASSWORD_LENGTH = 8;

/** Shown under the first field wherever a password is chosen. */
export const PASSWORD_HINT = `At least ${MIN_PASSWORD_LENGTH} characters.`;

/**
 * The message to show, or null when the pair is acceptable.
 *
 * Returns a message rather than a boolean because the two failures need
 * different words, and a caller reduced to `if (!ok)` would have to re-derive
 * which one happened — the branch this function exists to own.
 */
export function checkPassword(password: string, confirm: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (password !== confirm) {
    return "Those two passwords do not match.";
  }
  return null;
}
