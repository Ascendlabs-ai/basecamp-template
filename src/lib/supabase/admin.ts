// A BUILD ERROR, not a comment. The header below says "route handlers only";
// this makes it true. Without it, the rule is a convention sitting in the same
// directory as client.ts — the single most likely place for an autocomplete
// mistake — and the whole design principle here is that a guard which can be
// switched off by the thing it guards is not a guard.
import "server-only";

import { NextResponse } from "next/server";

import { createClient as createServiceClient, type SupabaseClient } from "@supabase/supabase-js";

import { createClient } from "./server";
import { banDuration, isAlreadyRegistered } from "../adminLink";
import { SUPABASE_URL } from "./env";

/**
 * The single privileged path in this application.
 *
 * IMPORT FROM ROUTE HANDLERS ONLY. Never from a component, client or server.
 *
 * ─── THE NARROWED RULE ──────────────────────────────────────────────────────
 *
 * Everywhere else, this app holds only the anon key and Postgres RLS is the
 * sole authority on access. Creating an auth account cannot be expressed as an
 * RLS policy — identities live in `auth.users`, which the app does not own — so
 * one privileged path exists, and it is bounded three ways:
 *
 *   1. IT IS AUTHORISED BY THE DATABASE, NOT BY THIS FILE. `requireSuperAdmin`
 *      asks Postgres `basecamp.is_super_admin()` on the CALLER'S OWN TOKEN. The
 *      answer comes from the same trust root every RLS policy consults. This is
 *      not "a role check in TypeScript" (CLAUDE.md's phrase for a lock on the
 *      front door of a building with no walls) — TypeScript only relays it.
 *
 *   2. THE PRIVILEGED CLIENT DOES NOT EXIST UNTIL THAT ANSWER IS `true`. It is
 *      constructed after the check, never before, and is never returned raw.
 *
 *   3. IT CANNOT REACH A `basecamp` TABLE. What callers receive is a facade with
 *      four auth methods and no `.from`, no `.rpc`, no `.schema`. Catalog rows,
 *      grants, member types and the audit log stay behind RLS exactly as before
 *      — the privileged key cannot read or write any of them.
 *
 * So the property that makes this app safe is unchanged for every byte of data
 * it protected before. What is added beside it is the ability to mint and
 * suspend identities, which is a different thing in a different schema.
 */

/**
 * What the privileged key is permitted to DO — verbs, not methods.
 *
 * THIS SHAPE IS THE BOUNDARY. An earlier version handed callers the four
 * GoTrue admin METHODS bound to the privileged client. That removed the
 * PostgREST surface (no `.from`, no `.rpc`) but left the whole auth-admin
 * surface intact, and a review named the consequence exactly: GoTrue's
 * `AdminUserAttributes` includes `password`, `email`, `app_metadata` and
 * `role` — so one line of future code in any route,
 *
 *     await admin.updateUserById(id, { role: "service_role" })
 *
 * would hand that person a browser session that bypasses every RLS policy in
 * `basecamp`, permanently, with no audit row and without ever touching a table.
 * `{ password }` on the same method is silent takeover of an administrator's
 * account. Neither is reachable now: `ban_duration` is the only attribute this
 * module ever passes to `updateUserById`, and it is computed here.
 *
 * The measure of a facade is not how many methods it exposes — it is what those
 * methods accept. Four task-shaped functions with pinned arguments make the
 * invariant checkable by reading one file, instead of trusting three.
 */
export type AdminFacade = {
  /**
   * Create the account if it is new, and return a one-time token either way.
   * `created` distinguishes the two, because the caller must record and say
   * something different for each.
   */
  createOrRecoverAccount(
    email: string,
    /**
     * Did this address already have an account before this request?
     *
     * The CALLER knows — `POST /people` reads the roster before calling — and
     * it must, because GoTrue's own answer is not trustworthy here: an invite
     * against an existing but UNCONFIRMED user succeeds rather than reporting a
     * conflict, so "the invite worked" does not mean "we created it". That is
     * the ordinary state of everybody who has been added and has not yet opened
     * their link, and arming a hard delete on it risked destroying a real
     * member's account, whose `members` row cascades with it.
     */
    alreadyExisted: boolean,
  ): Promise<
    | {
        userId: string;
        token: string;
        created: boolean;
        /**
         * Undo THIS creation. Present only when `created` is true, so the
         * capability cannot be named for an account this request did not mint.
         */
        rollback?: () => Promise<boolean>;
      }
    | { error: string }
  >;
  /** A fresh recovery token for somebody who already exists. */
  issueRecoveryToken(userId: string): Promise<{ email: string; token: string } | { error: string }>;
  /** Suspend or restore sign-in. `ban_duration` is the ONLY attribute reachable. */
  setBanned(userId: string, banned: boolean): Promise<{ ok: true } | { error: string }>;
  /** Does this account exist, and what is its address? */
  lookup(userId: string): Promise<{ email: string | null } | null>;

};

export type Authorised = {
  /**
   * Anon-key client on the caller's cookies. Every `basecamp` read and write in
   * a route handler goes through THIS, so RLS decides it and the audit triggers
   * see `auth.uid()` as the actor.
   */
  caller: Awaited<ReturnType<typeof createClient>>;
  admin: AdminFacade;
  /** The caller's own id, for logging who did it. */
  actorId: string;
};

/**
 * What a route returns when the caller may not be here.
 *
 * `denied: true` is a TAG, not decoration. An earlier version discriminated on
 * the presence of a `status` key, which is a duck-type on a very plausible
 * future field name: any success shape that happened to carry an HTTP status
 * would silently be read as a refusal. It failed into the error branch rather
 * than the privileged one, so it was not a breach — but it would have presented
 * as an inexplicable 500, and one reserved field removes the whole class.
 */
export type Denied = {
  denied: true;
  // 401/403 are the gate; 400/404/502 are the other refusals these routes make.
  // They were inline `NextResponse.json({ error }, { status })` literals, which
  // meant `denied()` was one wire contract and eleven hand-written objects were a
  // second — the exact duplication `denied()` was extracted to end. Same envelope,
  // same reader (`readAdminResponse`), so they belong to the same type.
  status: 400 | 401 | 403 | 404 | 500 | 502;
  message: string;
};

/**
 * Generic over the success shape so it narrows both `requireSuperAdmin` and
 * `logPrivilegedAction` — the two return different successes and share this one
 * failure. A signature pinned to `Authorised` made the audit call site a type
 * error, and widening it to `unknown` would have stopped narrowing at all.
 */
export function isDenied<T extends object>(result: T | Denied): result is Denied {
  return "denied" in result;
}

/**
 * One place that decides what a refusal looks like on the wire.
 *
 * Six copies of this object literal across three routes meant the error
 * envelope was defined in three files; a fourth route would have made it four.
 * `readJson` on the client reads `{ error }`, so this is the shape both ends
 * agree on and it should have exactly one definition.
 */
export function denied(result: Denied): NextResponse {
  return NextResponse.json({ error: result.message }, { status: result.status });
}

/**
 * Module-local and lazily built. Not exported, not returned, not reachable.
 *
 * Cached across requests deliberately: it carries no user state — no cookies,
 * no session — so there is nothing to leak between callers, and rebuilding it
 * per request would only add work. Contrast `caller`, which is per-request
 * precisely because it does carry a session.
 */
let privileged: SupabaseClient | null = null;

/**
 * The service-role key is read HERE and exported by nothing.
 *
 * It lived in its own module briefly, exported as `serviceRoleKey()`. That made
 * the facade below a convention rather than a boundary: any server file could
 * import it and build its own unrestricted, RLS-bypassing client, which is
 * exactly what CLAUDE.md promises cannot happen. Keeping the read private to
 * this module means the only way to reach the key is through
 * `requireSuperAdmin`, which will not return until Postgres has confirmed the
 * caller is an administrator.
 *
 * WHY THE NAME HAS NO `NEXT_PUBLIC_` PREFIX. Next.js inlines any env var so
 * prefixed into the client bundle at build time. The prefix is not a convention
 * here — it is the difference between a secret and a published one.
 *
 * Read lazily rather than at module load. `env.ts` validates at load because a
 * missing anon key breaks every page; a missing service-role key breaks only
 * these three routes, and throwing at load would take the whole app down with
 * it, including the sign-in page an administrator needs to get anywhere.
 */
function privilegedClient(): SupabaseClient {
  if (!privileged) {
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!key) {
      throw new Error(
        "SUPABASE_SERVICE_ROLE_KEY is not set. Adding, suspending and re-inviting people need " +
          "it — see .env.local.example. Every other screen works without it.",
      );
    }
    privileged = createServiceClient(SUPABASE_URL, key, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }
  return privileged;
}

/**
 * The only place GoTrue's admin methods are called, and the only place their
 * arguments are chosen.
 *
 * Every function here pins what it passes: `setBanned` can send nothing but
 * `ban_duration`, `createOrRecoverAccount` nothing but an email and a link
 * type. Errors come back as plain `{ error }` strings rather than throwing,
 * because the routes already branch on shapes and a throw would be the one
 * failure mode they do not handle.
 *
 * There is deliberately NO general `deleteUser`. Hard deletion exists for
 * exactly one caller — rolling back an account minted seconds earlier in the
 * same request — so it lives inside `createOrRecoverAccount`'s own failure
 * path in the route, exposed as `rollback` on the result rather than as a verb
 * anyone can reach for.
 */
function buildFacade(client: SupabaseClient): AdminFacade {
  const auth = client.auth.admin;

  return {
    async createOrRecoverAccount(email, alreadyExisted) {
      // `invite` creates the account and returns the token. It does NOT send
      // mail — that is `inviteUserByEmail`, which this app never calls.
      let created = true;
      let result = await auth.generateLink({ type: "invite", email });

      if (result.error && isAlreadyRegistered(result.error)) {
        created = false;
        result = await auth.generateLink({ type: "recovery", email });
      }

      const token = result.data?.properties?.hashed_token;
      const userId = result.data?.user?.id;
      if (result.error || !token || !userId) {
        console.error("[basecamp] generateLink failed:", result.error?.code, result.error?.message);
        return { error: "Could not create the sign-in link. The account was not added." };
      }

      // The rollback is a CLOSURE over the client this function already holds,
      // handed back only when this request genuinely minted the account —
      // decided by the caller's roster read, NOT by whether GoTrue returned an
      // already-registered error. An earlier
      // version exported a module-level `rollbackNewAccount(userId)` that built
      // the privileged client itself with no authorization check — the one path
      // in this file that reached the service-role key without Postgres having
      // answered `is_super_admin()`, exposing the most destructive verb GoTrue
      // has. It also falsified this module's own header. Shaping it as a
      // closure means the capability cannot be named without having passed the
      // gate, and cannot be aimed at an account this request did not mint.
      const rollback = created && !alreadyExisted
        ? async () => {
            const { error } = await auth.deleteUser(userId);
            if (error) {
              console.error("[basecamp] rollback deleteUser failed:", error.message);
              return false;
            }
            return true;
          }
        : undefined;

      return { userId, token, created, rollback };
    },

    async issueRecoveryToken(userId) {
      const { data: found, error: lookupError } = await auth.getUserById(userId);
      const email = found?.user?.email;
      if (lookupError || !email) {
        return { error: "That person no longer has an account, or has no email address." };
      }

      const { data, error } = await auth.generateLink({ type: "recovery", email });
      const token = data?.properties?.hashed_token;
      if (error || !token) {
        console.error("[basecamp] recovery generateLink failed:", error?.code, error?.message);
        return { error: "Could not create a sign-in link." };
      }
      return { email, token };
    },

    async setBanned(userId, banned) {
      // `ban_duration` and nothing else. This is the whole point of the verb
      // shape: `role`, `password` and `email` are not expressible here.
      const { error } = await auth.updateUserById(userId, { ban_duration: banDuration(banned) });
      if (error) {
        console.error("[basecamp] ban update failed:", error.code, error.message);
        return {
          error: banned
            ? "Could not suspend that account. The audit log records the attempt."
            : "Could not restore that account. The audit log records the attempt.",
        };
      }
      return { ok: true };
    },

    async lookup(userId) {
      const { data, error } = await auth.getUserById(userId);
      if (error || !data?.user) return null;
      return { email: data.user.email ?? null };
    },
  };
}

/**
 * Prove the caller is an administrator, then hand back the two clients.
 *
 * Fails CLOSED at every branch: no session is 401, a `false` answer is 403, and
 * an RPC that errors is 500 rather than being read as either. The last one
 * matters — an unreachable database must not be mistaken for a granted answer.
 */
export async function requireSuperAdmin(): Promise<Authorised | Denied> {
  const caller = await createClient();

  // CONCURRENT, not sequential. Neither call consumes the other's result —
  // `is_super_admin()` authenticates off the same cookie jar, and `user.id` is
  // only needed for `actorId` at the end — so running them in series added a
  // whole extra round trip (GoTrue, then PostgREST) to every admin request.
  //
  // Safe here specifically because the middleware has already refreshed this
  // request's token (see server.ts), so the concurrent RPC cannot race an
  // expiring access token. The BRANCH order below is unchanged and still
  // fails closed: 401 before 500 before 403.
  const [userResult, adminResult] = await Promise.all([
    caller.auth.getUser(),
    caller.rpc("is_super_admin"),
  ]);

  const {
    data: { user },
    error: userError,
  } = userResult;

  if (userError || !user) {
    return { denied: true, status: 401, message: "Not signed in." };
  }

  const { data, error } = adminResult;
  if (error) {
    console.error("[basecamp] admin route: is_super_admin RPC failed:", error.code, error.message);
    return { denied: true, status: 500, message: "Could not verify your permissions. Try again." };
  }
  if (data !== true) {
    return { denied: true, status: 403, message: "Administrators only." };
  }

  let admin: AdminFacade;
  try {
    admin = buildFacade(privilegedClient());
  } catch (cause) {
    // The key is missing or malformed. Say so plainly — this is a setup error,
    // and an administrator staring at "something went wrong" has no way to
    // discover that one env var was never filled in.
    console.error("[basecamp] admin route: privileged client unavailable:", cause);
    // Only OUR OWN message is relayed. The try also wraps createServiceClient,
    // whose thrown text is not authored here and could carry connection detail;
    // that gets the generic sentence instead.
    const ours = cause instanceof Error && cause.message.startsWith("SUPABASE_SERVICE_ROLE_KEY");
    return {
      denied: true,
      status: 500,
      message: ours
        ? (cause as Error).message
        : "The privileged client could not be created. Check the server logs.",
    };
  }

  return { caller, admin, actorId: user.id };
}

/**
 * Is this person known to THIS app, rather than merely present in `auth.users`?
 *
 * `auth.users` is shared by every app on a Supabase project. The privileged
 * client can therefore see, link and suspend accounts that have nothing to do
 * with this app — including an administrator of a different app on the same
 * project. CLAUDE.md is careful to say `basecamp.super_admins` "says nothing
 * about any other app sharing the project"; without this check the account
 * routes would make it say quite a lot.
 *
 * BOTH READS ARE ON THE CALLER'S TOKEN, so RLS decides them: everything for a
 * super admin, nothing for anyone else. `members` covers ordinary people;
 * `super_admins` covers an administrator who was never given a member type.
 *
 * Not applied to `POST /api/admin/people`, which legitimately targets someone
 * who is not a member yet — that is what it is for.
 *
 * WHAT THIS IS NOT. It is a check that the target belongs to this app, not a
 * guarantee that they always did: an administrator can give any account on the
 * project a member type — from `Add person`, or from the type selector on the
 * access screen — and it will answer "yes" afterwards. That is inherent in
 * sharing an auth directory, and it is written up in issues.md under
 * "The roster spans the whole Supabase project". What this check does buy is
 * that the two credential-adjacent routes cannot be pointed at a stranger
 * WITHOUT that deliberate, audited step first.
 */
export async function belongsToThisApp(
  caller: Authorised["caller"],
  userId: string,
): Promise<"yes" | "no" | "unknown"> {
  const [member, admin] = await Promise.all([
    caller.from("members").select("user_id").eq("user_id", userId).maybeSingle(),
    caller.from("super_admins").select("user_id").eq("user_id", userId).maybeSingle(),
  ]);

  if (member.data || admin.data) return "yes";

  // THREE STATES, NOT TWO. An earlier version returned a boolean, so a dropped
  // connection or a malformed uuid (22P02) came back `false` and the routes
  // rendered it as a definitive "that person is not a member of this app" — an
  // assertion about the roster made on no evidence. This repo already draws the
  // distinction elsewhere (`isTransportFailure`), and the caller needs it to
  // answer 500 rather than 404.
  if (member.error || admin.error) {
    console.error(
      "[basecamp] membership check failed:",
      member.error?.code ?? admin.error?.code,
      member.error?.message ?? admin.error?.message,
    );
    return "unknown";
  }
  return "no";
}

/**
 * The membership RULE, decided here rather than in each route that needs it.
 *
 * `belongsToThisApp` returns evidence — yes / no / unknown — and stays exported
 * because `POST /people` genuinely needs the raw `no` to branch into the adopt
 * path. This is the other caller shape: the two `[id]` routes do not want to
 * branch, they want to be stopped, and both were making the identical decision
 * about it — same 500 wording for `unknown`, same 404 wording for `no`, ten
 * duplicated lines apiece.
 *
 * WHY THAT MATTERED MORE THAN THE DUPLICATION. This module's own header states
 * as an invariant that the credential-adjacent routes cannot be pointed at a
 * stranger, and `auth.users` is shared across the whole Supabase project — so a
 * missing check here means an administrator of this app suspending, or minting a
 * sign-in link for, somebody who belongs to a different app entirely. With the
 * rule spread across route handlers, a fourth `[id]` route can simply not call
 * it and nothing notices: not a type, not a test, not the compiler. As a gate
 * that returns `Denied`, forgetting it is a route that does not compile into the
 * shape its siblings have.
 *
 * Returns `null` when the person is a member — the caller continues — and a
 * `Denied` otherwise, so the call site reads exactly like `requireSuperAdmin`.
 */
export async function requireMemberOfThisApp(
  caller: Authorised["caller"],
  userId: string,
): Promise<null | Denied> {
  const membership = await belongsToThisApp(caller, userId);
  if (membership === "unknown") {
    return {
      denied: true,
      status: 500,
      message: "Could not check whether that person is a member. Try again.",
    };
  }
  if (membership === "no") {
    return { denied: true, status: 404, message: "That person is not a member of this app." };
  }
  return null;
}

/** The account-lifecycle events the audit log accepts. Mirrors the SQL allowlist. */
export type PrivilegedAction = "invite" | "reissue_link" | "ban" | "unban" | "adopt";

/**
 * Record what is about to happen, on the caller's own token.
 *
 * ON THE CALLER'S TOKEN, so `auth.uid()` inside the definer function resolves to
 * the administrator who clicked — not to a service identity, which would make
 * every row in the log say the same anonymous thing.
 *
 * CALLED BEFORE THE PRIVILEGED OPERATION, and its failure is fatal to the
 * request. That ordering is the fail-closed property: if the log cannot be
 * written, the ban does not happen. The alternative — act first, log after —
 * has a failure mode where the account is suspended and nothing records it,
 * which is the exact state an audit log exists to make impossible.
 *
 * The cost of this ordering is the opposite error: a row saying "ban" when the
 * ban itself then failed. That is the safe direction to be wrong in, because it
 * over-reports rather than under-reports, and the route surfaces the failure to
 * the administrator who can look.
 *
 * NEVER PASS A LINK VALUE HERE. Sign-in links are single-use credentials; the
 * audit log is readable by every administrator and is append-only, so a link
 * written into it could not be redacted afterwards. The signature makes that
 * structural: the only inputs are a verb and a user id, and the RPC looks the
 * email labels up itself rather than accepting them.
 */
export async function logPrivilegedAction(
  caller: Authorised["caller"],
  event: { action: PrivilegedAction; subjectUserId: string },
): Promise<{ ok: true } | Denied> {
  const { error } = await caller.rpc("log_privileged_action", {
    p_action: event.action,
    p_subject_user_id: event.subjectUserId,
  });

  if (error) {
    console.error("[basecamp] audit write refused:", error.code, error.message);
    // 42501 is the RPC's own gate refusing a caller who is no longer an
    // administrator — they lost it between requireSuperAdmin and this call.
    // That is an authorization answer, not a server fault, and telling someone
    // "could not record this action" for it sends them looking at the database.
    if (error.code === "42501") {
      return { denied: true, status: 403, message: "You are no longer an administrator." };
    }
    return {
      denied: true,
      status: 500,
      message: "Could not record this action in the audit log, so it was not carried out.",
    };
  }
  return { ok: true };
}
