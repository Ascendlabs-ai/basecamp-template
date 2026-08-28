import type { Metadata } from "next";

import AuthCard from "@/components/AuthCard";
import { APP_NAME } from "@/lib/brand";
import ConfirmForm from "./ConfirmForm";

export const metadata: Metadata = {
  title: `Confirm your access · ${APP_NAME}`,
  robots: { index: false, follow: false },
};

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
export default function ConfirmPage() {
  return (
    <AuthCard>
      <ConfirmForm />
    </AuthCard>
  );
}
