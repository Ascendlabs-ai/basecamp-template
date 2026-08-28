import { NextResponse } from "next/server";

import {
  requireMemberOfThisApp,
  denied,
  isDenied,
  logPrivilegedAction,
  requireSuperAdmin,
} from "@/lib/supabase/admin";

/**
 * POST /api/admin/people/[id]/ban — suspend or restore someone's sign-in.
 *
 * Body: `{ banned: boolean }`.
 *
 * IT TOUCHES NO `basecamp` TABLE, AND THAT IS THE FEATURE. An earlier draft
 * revoked every grant and deleted the member row as part of banning. That made
 * "unban" a lie: the person could sign in again and would find an empty
 * catalog, with no record of what they used to have and no way to restore it
 * short of an administrator remembering. Banning here is exactly one thing —
 * the account cannot sign in — so lifting it returns the person to precisely
 * the access they had. Removing someone's access is a separate, deliberate act
 * on the access screen, which is audited grant by grant.
 *
 * A ban takes effect at the next token refresh rather than instantly, because
 * an already-issued JWT stays valid until it expires. For a genuine emergency —
 * a compromised account rather than an ordinary departure — ban here AND revoke
 * their grants on the access screen, which RLS applies to the very next request.
 * That caveat is repeated in the UI, where the decision is actually made.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireSuperAdmin();
  if (isDenied(auth)) return denied(auth);
  const { caller, admin, actorId } = auth;

  const { id } = await context.params;
  if (!id) {
    return NextResponse.json({ error: "No person specified." }, { status: 400 });
  }

  let body: { banned?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }
  if (typeof body.banned !== "boolean") {
    return NextResponse.json({ error: "Expected `banned` to be true or false." }, { status: 400 });
  }
  const banned = body.banned;

  // An administrator who bans themselves is locked out of the app with no way
  // back in — there is no in-app recovery for a suspended account, and the
  // remaining administrators would have to fix it from the Supabase dashboard.
  // The database's last-admin guard does not cover this: banning is not a
  // delete, so the row survives and the trigger never fires.
  //
  // Compared case-insensitively. Both sides are uuids and Postgres and GoTrue
  // both parse them case-insensitively, so a hand-made request naming the same
  // account in upper case walked straight past this guard and suspended the
  // caller — the one state with no in-app way back. The UI only ever sends the
  // lowercase roster id, so this is an accident-guard closing on a request the
  // UI does not make.
  if (banned && id.toLowerCase() === actorId.toLowerCase()) {
    return NextResponse.json(
      { error: "You cannot suspend your own account — you would be locked out." },
      { status: 400 },
    );
  }

  // `auth.users` is shared across the whole Supabase project; without this an
  // administrator here could suspend a stranger's account, including an
  // administrator of a different app on the same project.
  //
  // CONCURRENT WITH THE ACCOUNT LOOKUP, because neither feeds the other: both are
  // pure reads keyed on the same id, and both must pass before anything is logged
  // or written. Serially this paid a full GoTrue round trip after two Postgres
  // reads had already finished. The branch order below is unchanged, so which
  // refusal wins is unchanged too — only the waiting is.
  const [notMember, found] = await Promise.all([
    requireMemberOfThisApp(caller, id),
    admin.lookup(id),
  ]);
  if (notMember) return denied(notMember);
  if (!found) {
    return NextResponse.json({ error: "That person no longer has an account." }, { status: 404 });
  }

  const logged = await logPrivilegedAction(caller, {
    action: banned ? "ban" : "unban",
    subjectUserId: id,
  });
  if (isDenied(logged)) return denied(logged);

  const result = await admin.setBanned(id, banned);
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 502 });
  }

  return NextResponse.json({ banned, user_id: id });
}
