import type { Metadata } from "next";

import AuthCard from "@/components/AuthCard";
import { getBranding } from "@/lib/brandingServer";
import AcceptInviteForm from "./AcceptInviteForm";

export async function generateMetadata(): Promise<Metadata> {
  const branding = await getBranding();
  return {
    title: `Choose a password · ${branding.displayName}`,
    robots: { index: false, follow: false },
  };
}

/**
 * Second half of the admin-issued sign-in flow: set a password.
 *
 * Reached from /auth/confirm once the one-time token has been exchanged for a
 * session. No token is in this URL, so it is safe to reload or bookmark — and
 * the form says so when there is no session to work with.
 */
export default async function AcceptInvitePage() {
  const branding = await getBranding();
  return (
    <AuthCard branding={branding}><AcceptInviteForm /></AuthCard>
  );
}
