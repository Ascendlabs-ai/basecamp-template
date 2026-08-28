import type { Metadata } from "next";

import AuthCard from "@/components/AuthCard";
import { APP_NAME } from "@/lib/brand";
import AcceptInviteForm from "./AcceptInviteForm";

export const metadata: Metadata = {
  title: `Choose a password · ${APP_NAME}`,
  // Same as /auth/confirm, and for the same reason: this is a signed-out
  // credential screen. Nothing here is worth indexing and a search result
  // pointing at it only ever confuses somebody.
  robots: { index: false, follow: false },
};

/**
 * Second half of the admin-issued sign-in flow: set a password.
 *
 * Reached from /auth/confirm once the one-time token has been exchanged for a
 * session. No token is in this URL, so it is safe to reload or bookmark — and
 * the form says so when there is no session to work with.
 */
export default function AcceptInvitePage() {
  return (
    <AuthCard><AcceptInviteForm /></AuthCard>
  );
}
