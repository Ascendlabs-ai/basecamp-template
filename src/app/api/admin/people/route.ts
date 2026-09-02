import { NextResponse } from "next/server";

import {
  belongsToThisApp,
  denied,
  isDenied,
  logPrivilegedAction,
  requireSuperAdmin,
  type Authorized,
} from "@/lib/supabase/admin";
import { buildSignInUrl, isEmailShaped, normaliseEmail } from "@/lib/adminLink";

/**
 * POST /api/admin/people — add someone to this app.
 *
 * Creates the auth account, gives them a member type, and returns ONE sign-in
 * link for the administrator to hand over. No email is sent: the token is
 * minted and returned, and delivery is a person passing a link to another
 * person over a channel they already trust.
 *
 * IDEMPOTENT-ISH BY DESIGN. If the address already has an account, that is not
 * an error — an administrator adding someone who signed up themselves, or
 * re-adding someone who was removed, means "this person needs access". The
 * facade falls through to a recovery token and the type is upserted, so the
 * same click does the right thing either way.
 *
 * ORDER OF OPERATIONS, AND WHY. The account is resolved FIRST, because the
 * audit row cannot name its subject until the user id exists — and an audit row
 * that cannot name who it affected is not a record. The audit row is written
 * SECOND, on the caller's token, and a failure there rolls back an account this
 * request created rather than leaving a person nobody can account for. The
 * `members` row is written THIRD, also on the caller's token, so RLS decides it
 * and the existing audit trigger records the type assignment with the right
 * actor.
 *
 * An earlier draft logged FIRST, which forced it to guess `invite` before it
 * knew whether the account existed, then emit a second, unlinked `reissue_link`
 * row to retract the guess. 0004's own reasoning says forcing an event into the
 * wrong vocabulary makes the log claim something that did not happen — so the
 * verb is now chosen after the fact it describes is known.
 */
export async function POST(request: Request) {
  const auth = await requireSuperAdmin();
  if (isDenied(auth)) return denied(auth);
  const { caller, admin } = auth;

  let body: { email?: unknown; member_type_id?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  if (typeof body.email !== "string" || !isEmailShaped(body.email)) {
    return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  }
  if (typeof body.member_type_id !== "string" || body.member_type_id.length === 0) {
    return NextResponse.json({ error: "Choose a member type." }, { status: 400 });
  }
  const email = normaliseEmail(body.email);
  const memberTypeId = body.member_type_id;

  // Validate the type ON THE CALLER'S TOKEN before creating anything. This is a
  // read RLS already governs, so it doubles as a check that the type is one this
  // administrator can actually see — and it turns a foreign-key violation three
  // steps later, after an account exists, into a clean 400 now.
  const { data: type, error: typeError } = await caller
    .from("member_types")
    .select("id")
    .eq("id", memberTypeId)
    .maybeSingle();
  if (typeError) {
    return NextResponse.json({ error: "Could not check the member type." }, { status: 500 });
  }
  if (!type) {
    return NextResponse.json({ error: "That member type no longer exists." }, { status: 400 });
  }

  // ADOPTING A FOREIGN ACCOUNT DOES NOT HAND OVER A CREDENTIAL.
  //
  // `auth.users` is shared by every app on the Supabase project, so an address
  // typed here may already belong to somebody who has nothing to do with this
  // app — including an administrator of a different app. Without this branch,
  // adding them would mint a working sign-in link for that account, which is a
  // takeover, not an onboarding. `belongsToThisApp` gating the other two routes
  // does not help: this route's own `members` upsert is what would make the
  // stranger pass that gate afterwards.
  //
  // So: an account this app already knows gets the ordinary flow. One it does
  // not gets adopted — a `members` row, fully audited — and NO link. If they
  // genuinely need one, that is a second, separate, audited click on
  // "Issue a sign-in link", which is exactly the deliberate act it should be.
  // Asked through `list_people()` on the CALLER'S OWN TOKEN, not the privileged
  // client. That RPC is already gated to administrators, already returns every
  // account on the project, and — critically — mints nothing: checking whether
  // an address exists must not itself invalidate the person's outstanding link,
  // which any `generateLink` probe would.
  const { data: roster, error: rosterError } = await caller.rpc("list_people");
  if (rosterError) {
    return NextResponse.json(
      { error: "Could not check whether that person already has an account. Try again." },
      { status: 500 },
    );
  }
  const existing = (roster as { id: string; email: string }[] | null)?.find(
    (p) => p.email.toLowerCase() === email,
  );

  if (existing) {
    const known = await belongsToThisApp(caller, existing.id);
    if (known === "unknown") {
      return NextResponse.json(
        { error: "Could not check whether that person is already a member. Try again." },
        { status: 500 },
      );
    }
    if (known === "no") {
      // `adopt`, not `invite`. Nothing was invited and no link is issued on
      // this path, and 0004 says in its own words that forcing an event into
      // the wrong vocabulary makes the log claim something that did not happen.
      const logged = await logPrivilegedAction(caller, {
        action: "adopt",
        subjectUserId: existing.id,
      });
      if (isDenied(logged)) return denied(logged);

      if (!(await assignType(caller, existing.id, memberTypeId))) {
        return NextResponse.json(
          { error: "Could not give that person a member type." },
          { status: 500 },
        );
      }
      return NextResponse.json(
        {
          link: null,
          email,
          user_id: existing.id,
          created: false,
        },
        { status: 201 },
      );
    }
  }

  // `Boolean(existing)` is the evidence, and it comes from the roster read
  // above rather than from GoTrue's error shape. See the parameter's own note.
  const account = await admin.createOrRecoverAccount(email, Boolean(existing));
  if ("error" in account) {
    return NextResponse.json({ error: account.error }, { status: 502 });
  }
  const { userId, token, created, rollback } = account;

  // `existing`, NOT `created`, decides the VERB — and the two are not the same
  // question. `created` records which GoTrue call produced the token, and an
  // `invite` against an existing but UNCONFIRMED account SUCCEEDS rather than
  // reporting a conflict (the facade's own parameter note says so). That is the
  // ordinary state of everybody added who has not yet opened their link, so
  // `created` reads true for people who plainly already existed, and the log
  // would claim an `invite` that did not happen. The roster read above is the
  // evidence, and it is already trusted one line earlier for `alreadyExisted`.
  //
  // This file argues at length that forcing an event into the wrong vocabulary
  // makes the log claim something that did not happen. This was the one path
  // where it still did.
  const wasCreated = !existing;

  const logged = await logPrivilegedAction(caller, {
    action: wasCreated ? "invite" : "reissue_link",
    subjectUserId: userId,
  });
  if (isDenied(logged)) {
    // The account may have just been created and is now unrecorded. Roll it
    // back rather than leaving a person nobody can account for. `rollback` is
    // present only when THIS request minted the account, so it can never delete
    // a pre-existing one whose token was merely re-issued.
    if (rollback && !(await rollback())) {
      // Both halves failed. Saying only "it was not carried out" would now be
      // untrue — an unrecorded account survives, which is the state the
      // rollback exists to prevent. The sibling branch below says the same.
      return NextResponse.json(
        {
          error:
            "The account was created but could not be recorded in the audit log, and removing it " +
            "again also failed. Check the roster before retrying.",
        },
        { status: 500 },
      );
    }
    return denied(logged);
  }

  const assigned = await assignType(caller, userId, memberTypeId);
  if (!assigned) {
    if (rollback) {
      const ok = await rollback();
      if (!ok) {
        return NextResponse.json(
          {
            error:
              "The account was created but could not be given a type, and removing it again also " +
              "failed. Check the roster before retrying.",
          },
          { status: 500 },
        );
      }
    }
    return NextResponse.json(
      {
        error: wasCreated
          ? "Could not assign the member type, so the account was not kept."
          : "That person already had an account, but their member type could not be set.",
      },
      { status: 500 },
    );
  }

  // The link is built here and written NOWHERE else — not the audit row above,
  // not a log line, not an error message.
  //
  // `created` HERE, not `wasCreated`, and the difference is deliberate: this
  // argument names the TOKEN KIND GoTrue actually minted, which is what
  // `verifyOtp` must be given back. The response field is `wasCreated`, because
  // that one drives what the administrator is told.
  const link = buildSignInUrl(new URL(request.url).origin, token, created ? "invite" : "recovery");
  return NextResponse.json(
    { link, email, user_id: userId, created: wasCreated },
    { status: 201 },
  );
}

/**
 * Give the person their type, on the caller's token so the audit trigger fires.
 *
 * `upsert` on `user_id` rather than `insert`: the already-registered path can
 * reach a person who has a row already, and a duplicate-key error there would
 * report a failure for a request that should simply update them. The unique
 * constraint on `members.user_id` is what makes this well-defined.
 */
async function assignType(
  caller: Authorized["caller"],
  userId: string,
  memberTypeId: string,
): Promise<boolean> {
  const { error } = await caller
    .from("members")
    .upsert({ user_id: userId, member_type_id: memberTypeId }, { onConflict: "user_id" });
  if (error) {
    console.error("[basecamp] member type assignment failed:", error.code, error.message);
    return false;
  }
  return true;
}
