import { NextResponse } from "next/server";

import {
  requireMemberOfThisApp,
  denied,
  isDenied,
  logPrivilegedAction,
  requireSuperAdmin,
} from "@/lib/supabase/admin";
import { buildSignInUrl } from "@/lib/adminLink";

/**
 * POST /api/admin/people/[id]/link — re-issue a sign-in link.
 *
 * For someone who already exists and cannot get in: their first link expired,
 * was never delivered, or they have forgotten their password. Issues a recovery
 * token and returns the URL for the administrator to hand over. Sends nothing.
 *
 * This replaces the screen's old `resetPasswordForEmail` call, which depended on
 * Supabase's built-in mailer — rate limited to a couple of messages an hour and
 * explicitly not for production use. That dependency failed silently: the screen
 * reported success and no mail arrived.
 *
 * THE ID IS THE INPUT, THE EMAIL IS LOOKED UP. Taking an email from the client
 * would let a request name any address; taking the id and resolving it through
 * the privileged client means the link can only ever be for an account that
 * exists — and `belongsToThisApp` narrows that to an account this app knows.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireSuperAdmin();
  if (isDenied(auth)) return denied(auth);
  const { caller, admin } = auth;

  const { id } = await context.params;
  if (!id) {
    return NextResponse.json({ error: "No person specified." }, { status: 400 });
  }

  // `auth.users` is shared across the whole Supabase project, so without this an
  // administrator here could mint a sign-in link for somebody who belongs to a
  // different app on the same project. The rule lives in admin.ts so that a route
  // which forgets it does not compile into the shape its siblings have.
  const notMember = await requireMemberOfThisApp(caller, id);
  if (notMember) return denied(notMember);

  // LOG FIRST, THEN MINT. Minting a recovery token overwrites the one the
  // person may already be holding, so it is a state change to their account —
  // and an earlier version did it before writing the audit row. On any log
  // failure (including the live case where the caller was demoted mid-request)
  // that left the previous link silently dead, no record of why, and a 403 on
  // screen. `logPrivilegedAction` documents this ordering as the fail-closed
  // property and 0004 asserts it in prose; the cost is a row for an action that
  // may then fail, which is the safe direction and the one /ban already takes.
  const logged = await logPrivilegedAction(caller, { action: "reissue_link", subjectUserId: id });
  if (isDenied(logged)) return denied(logged);

  const issued = await admin.issueRecoveryToken(id);
  if ("error" in issued) {
    return NextResponse.json({ error: issued.error }, { status: 404 });
  }

  // Link in the body only. Never logged, never audited.
  return NextResponse.json({
    link: buildSignInUrl(new URL(request.url).origin, issued.token, "recovery"),
    email: issued.email,
  });
}
