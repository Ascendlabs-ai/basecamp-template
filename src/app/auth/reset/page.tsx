import type { Metadata } from "next";

import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";

import Logo from "@/components/Logo";
import { APP_NAME } from "@/lib/brand";
import ResetPasswordForm from "./ResetPasswordForm";

export const metadata: Metadata = {
  title: `Set your password · ${APP_NAME}`,
};

/**
 * Where the password-recovery email lands.
 *
 * The recovery link carries its token in the URL **fragment**, which never
 * reaches the server — so this page is a thin shell and all the work happens in
 * the client component. Supabase's browser client picks the fragment up and
 * exchanges it for a short-lived session automatically; the user then sets their
 * own password with `updateUser`.
 *
 * That flow is why no administrator ever handles a password here, and why none
 * of this needs a service-role key: the admin triggers an email, and the person
 * who owns the mailbox is the only one who can complete it.
 *
 * This route is deliberately OUTSIDE the (shell) group — the visitor is not
 * signed in yet in any meaningful sense, and rendering the app shell around a
 * password form would imply they are.
 */
export default function ResetPasswordPage() {
  return (
    <Box
      sx={{
        minHeight: "100dvh",
        display: "grid",
        placeItems: "center",
        px: 2,
        backgroundColor: "background.default",
      }}
    >
      <Paper
        elevation={0}
        sx={{
          width: "100%",
          maxWidth: 400,
          p: { xs: 3, sm: 4 },
          border: 1,
          borderColor: "divider",
        }}
      >
        <Box sx={{ mb: 2.5 }}>
          <Logo variant="primary" height={44} />
        </Box>
        <ResetPasswordForm />
      </Paper>
    </Box>
  );
}
