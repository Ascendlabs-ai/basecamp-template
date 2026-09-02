import type { Metadata } from "next";

import AuthCard from "@/components/AuthCard";
import { getBranding } from "@/lib/brandingServer";
import ConfirmForm from "./ConfirmForm";

export async function generateMetadata(): Promise<Metadata> {
  const branding = await getBranding();
  return {
    title: `Confirm your access · ${branding.displayName}`,
    robots: { index: false, follow: false },
  };
}

/**
 * Where an admin-issued sign-in link lands.
 *
 * THIS PAGE READS NOTHING AND DOES NOTHING. The token is in the URL FRAGMENT,
 * which browsers never transmit — so it is not in `searchParams`, not in this
 * server component, and not in the hosting platform's access logs. Only the
 * client component below can see it, and only when the person clicks.
 *
 * Outside the (shell) group for the same reason /accept-invite is: the visitor is
 * not meaningfully signed in yet, and drawing the app shell around this would
 * claim they are.
 */
export default async function ConfirmPage() {
  const branding = await getBranding();
  return (
    <AuthCard branding={branding}>
      <ConfirmForm />
    </AuthCard>
  );
}
