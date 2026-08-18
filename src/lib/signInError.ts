/**
 * Telling a misconfigured app apart from a wrong password.
 *
 * THE FAILURE THIS EXISTS FOR. With a missing or invalid anon key, Supabase Auth
 * answers 401 and the sign-in form said "That email and password combination did
 * not work." The person at the keyboard then does the only thing that message
 * suggests: retypes the password, resets it, deletes the account and recreates
 * it — until the project's email rate limit stops them. Half a day was lost to
 * exactly that. The password was never wrong; the app could not authenticate
 * itself to its own backend.
 *
 * The rule this encodes: **a failure the user cannot fix from this screen must
 * not be phrased as something they got wrong.**
 *
 * WHAT IS DELIBERATELY *NOT* DISTINGUISHED. Supabase reports "user not found"
 * and "wrong password" differently, and `email_not_confirmed` differently again.
 * All three collapse into one credentials message here, and that is not an
 * oversight: `authenticated` is a project-global label, so on a Supabase project
 * shared with client-facing apps, anyone holding a project JWT can drive this
 * form. Distinguishing those answers turns the sign-in page into an
 * account-enumeration oracle — it would confirm which email addresses exist. The
 * configuration/credentials split does not leak anything, because a
 * configuration failure is the same for every caller including one who typed no
 * password at all.
 *
 * Pure and dependency-free so it can be tested without a browser or a network.
 */

/**
 * The fields of supabase-js's `AuthError` this needs. Typed structurally rather
 * than imported: the test runner strips types but does not resolve `@/…` paths,
 * and this module has no reason to depend on the SDK's class hierarchy.
 */
export type SignInErrorLike = {
  name?: string;
  status?: number;
  code?: string;
  message?: string;
} | null;

export type SignInFailure = {
  /**
   * `credentials` — the person can fix it here by typing something else.
   * `configuration` — they cannot; the app or the project is set up wrong.
   */
  kind: "credentials" | "configuration";
  message: string;
};

const CREDENTIALS_MESSAGE = "That email and password combination did not work.";

/**
 * Where a configuration message sends people. Deliberately vague about WHICH
 * value is wrong: the person reading it may be a team member who cannot see the
 * project at all, and the useful instruction for them is "this is not you, tell
 * whoever set it up".
 */
const CONFIG_SUFFIX =
  "This is a problem with how the app is set up, not with your details — signing in again will not help. " +
  "Whoever set this app up should check its Supabase URL and anon key.";

export function classifySignInError(error: SignInErrorLike): SignInFailure {
  if (!error) {
    // Not reachable from the form, which only calls this when Supabase returned
    // an error — but returning "credentials" for "no error" would be the exact
    // wrong default, so it is stated rather than left to fall through.
    return {
      kind: "configuration",
      message: `Sign-in failed for an unknown reason. ${CONFIG_SUFFIX}`,
    };
  }

  const status = error.status;
  const message = error.message ?? "";

  // 1. The request never got an answer. supabase-js raises
  //    `AuthRetryableFetchError` for a transport failure, and it carries either
  //    no status or 0. A wrong project URL looks exactly like this, and so does
  //    a browser that is simply offline — neither is a password problem.
  if (error.name === "AuthRetryableFetchError" || status === undefined || status === 0) {
    return {
      kind: "configuration",
      message:
        "Could not reach the sign-in service. Check your connection — if it is fine, " +
        "the app's Supabase URL may be wrong. " +
        CONFIG_SUFFIX,
    };
  }

  // 2. 401 is the API key being rejected. This is THE case that cost the day:
  //    the key is missing, truncated, from another project, or is a
  //    `service_role` key where the anon key belongs.
  if (status === 401 || /api key/i.test(message)) {
    return {
      kind: "configuration",
      message: `The app was refused by its own database (invalid API key). ${CONFIG_SUFFIX}`,
    };
  }

  // 3. The service answered, but is unwell. Not the user's doing either.
  if (status >= 500) {
    return {
      kind: "configuration",
      message:
        "The sign-in service is not answering properly right now. " +
        "This is not a problem with your details. Try again shortly.",
    };
  }

  // 4. 429 is Supabase rate-limiting sign-in attempts. It is neither a
  //    configuration fault nor wrong credentials, and it is the one failure here
  //    where trying again later is exactly the remedy — so it must not inherit
  //    the "signing in again will not help" wording from either branch.
  if (status === 429) {
    return {
      kind: "credentials",
      message:
        "Too many sign-in attempts. Wait a minute and try again — this is a rate limit, not a problem with your details.",
    };
  }

  // 5. 400 and 422 are the genuine "we processed your request and the answer is
  //    no" statuses — invalid credentials, unconfirmed email, a malformed
  //    address. One message for all of them; see the enumeration note above.
  if (status === 400 || status === 422 || error.code === "invalid_credentials") {
    return { kind: "credentials", message: CREDENTIALS_MESSAGE };
  }

  // 6. Anything else. Defaulting to `credentials` here would reintroduce the
  //    original bug for every failure mode not yet enumerated — an unknown code
  //    would once again be reported as the user's password being wrong. So the
  //    default is the honest one: something is wrong and we do not know what.
  return {
    kind: "configuration",
    message: `Sign-in failed (${status}). ${CONFIG_SUFFIX}`,
  };
}
